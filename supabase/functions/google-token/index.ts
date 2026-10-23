// Edge Function google-token
// Troca o refresh token guardado em public.google_tokens por um acesso novo ao Google,
// para o app sincronizar sem pedir login a cada hora.
// Segredos necessários (Edge Functions › Secrets): GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = ['https://neres1.github.io', 'http://localhost:8000'];

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: { user }, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !user) return json({ error: 'unauthorized' }, 401);

  const { data: row, error: rowError } = await admin
    .from('google_tokens').select('refresh_token').eq('user_id', user.id).maybeSingle();
  if (rowError) return json({ error: 'db' }, 500);
  if (!row) return json({ error: 'reauth' }, 401);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();

  if (!res.ok) {
    // Token revogado ou expirado: apaga e pede um login novo.
    if (data.error === 'invalid_grant') {
      await admin.from('google_tokens').delete().eq('user_id', user.id);
      return json({ error: 'reauth' }, 401);
    }
    return json({ error: 'google', detail: data.error }, 502);
  }

  return json({ access_token: data.access_token, expires_in: data.expires_in });
});
