-- Guarda o refresh token do Google para renovar o acesso sem pedir login de novo.
-- A tabela não tem políticas de RLS: o navegador não consegue ler nem escrever nela
-- diretamente. Só a função abaixo (grava o token do próprio usuário) e a Edge Function
-- google-token (com a service role) mexem nela.

create table if not exists public.google_tokens (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);

alter table public.google_tokens enable row level security;
revoke all on public.google_tokens from anon, authenticated;

create or replace function public.save_google_refresh_token(token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or token is null or length(token) < 10 then
    raise exception 'token inválido';
  end if;
  insert into public.google_tokens (user_id, refresh_token, updated_at)
  values (auth.uid(), token, now())
  on conflict (user_id) do update
    set refresh_token = excluded.refresh_token, updated_at = now();
end;
$$;

revoke all on function public.save_google_refresh_token(text) from public, anon;
grant execute on function public.save_google_refresh_token(text) to authenticated;
