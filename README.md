# Habit Tracker

App web que transforma o que está na sua **Google Agenda** (eventos) e no **Google Tasks** (tarefas com data) em atividades que você conclui e avalia de **1 a 10**. Os dados ficam no **Supabase**, e a aba **Desempenho** mostra o quão efetivo você foi no dia, na semana e no mês.

Feito com HTML, CSS e JavaScript puros (sem etapa de build), no visual retrô "era atômica" dos anos 50, com tema claro e escuro automático.

## Como funciona

1. Você entra com a sua conta Google. O app pede acesso **somente leitura** à Agenda e às Tasks e nunca altera nada no Google.
2. **Sincronizar** traz os eventos de 60 dias para trás até 30 dias para frente, de todas as agendas marcadas como visíveis, e as tasks que têm data. Cada ocorrência vira uma atividade no Supabase.
3. Ao concluir uma atividade, você dá uma nota de 1 (muito ruim) a 10 (muito bom) e, se quiser, uma observação.
4. Sincronizar de novo atualiza título, horário e local, mas **nunca mexe nas suas notas**. O que foi apagado no Google sai do app, a não ser que você já tenha dado nota.

### As métricas

- **Disponíveis:** todas as atividades até o fim de hoje (mais as já concluídas). Dias futuros não entram.
- **Efetividade:** soma das notas ÷ (10 × disponíveis). Tudo o que não tem nota conta como zero, inclusive o que ainda está pendente hoje. Exemplo: 3 atividades com notas 8, 6 e uma sem nota dão (8 + 6 + 0) ÷ 30 = 47%.
- **Não feitas:** as que já passaram sem nota. **Pendentes:** as de hoje que ainda podem ser feitas.
- **Situação das atividades:** gráfico circular na aba Desempenho com concluídas por faixa de nota, não feitas, pendentes e por vir.
- **Nota média:** média das notas das atividades concluídas.
- **Atividades:** ocorrências com o mesmo título (ex.: todas as "Aula de Cálculo II") formam uma atividade, com evolução das notas, sequência e histórico próprios.

## Telas

| Rota | Tela |
| --- | --- |
| `#/hoje` | Atividades do dia (navegue entre dias), efetividade do dia e botão de sincronizar |
| `#/agenda` | Semana em colunas, com a nota de cada atividade |
| `#/desempenho` | Aba interativa: Dia, Semana ou Mês, com indicadores, gráfico (toque numa barra ou num dia para detalhar), distribuição das notas, Eventos × Tasks e destaques |
| `#/atividades` | Lista das atividades com tendência das últimas notas, conta e tema |
| `#/atividade/<chave>` | Detalhe: efetividade, sequência, gráfico de evolução e histórico |

## Modo demonstração

Com `js/config.js` vazio, o app abre com dados de exemplo salvos no navegador. Assim dá para experimentar tudo antes de configurar o Supabase.

## Configuração (uma vez só)

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Em **SQL Editor**, cole e execute o conteúdo de [`supabase/migrations/20261021000000_init.sql`](supabase/migrations/20261021000000_init.sql). Isso cria as tabelas e as regras de segurança: cada usuário só vê os próprios dados.
3. Em **Project Settings › API**, copie a **Project URL** e a chave **anon public**.

### 2. Google Cloud

1. Em [console.cloud.google.com](https://console.cloud.google.com), crie um projeto.
2. Em **APIs e serviços › Biblioteca**, ative a **Google Calendar API** e a **Google Tasks API**.
3. Em **Tela de consentimento OAuth**: escolha tipo **Externo**, preencha nome e e-mail, adicione os escopos `.../auth/calendar.readonly` e `.../auth/tasks.readonly` e, em **Usuários de teste**, adicione o seu e-mail. Enquanto o app estiver em modo de teste, só os usuários dessa lista conseguem entrar.
4. Em **Credenciais › Criar credenciais › ID do cliente OAuth**, escolha **Aplicativo da Web** e, em **URIs de redirecionamento autorizados**, adicione:
   `https://<seu-projeto>.supabase.co/auth/v1/callback`
5. Copie o **ID do cliente** e a **Chave secreta do cliente**.

### 3. Ligar os dois

1. No Supabase, em **Authentication › Providers › Google**, ative o provedor e cole o ID e a chave secreta.
2. Em **Authentication › URL Configuration**, coloque o endereço onde o app vai rodar em **Site URL** e em **Redirect URLs**. Para testar no computador, use `http://localhost:8000`.
3. Preencha [`js/config.js`](js/config.js) com a Project URL e a chave anon.

### 4. Rodar

O login com Google precisa de um endereço `http(s)`, então sirva a pasta com um servidor estático:

```bash
python -m http.server 8000
```

Depois abra `http://localhost:8000`. Para publicar na internet, qualquer hospedagem de site estático serve (GitHub Pages, Netlify, Vercel, Cloudflare Pages). Lembre de incluir o novo endereço nas **Redirect URLs** do Supabase.

## Limitações conhecidas

- O acesso ao Google vale cerca de **1 hora**. Para não pedir login de novo, o app guarda o refresh token do Google na tabela `google_tokens` (sem acesso pelo navegador) e a Edge Function [`google-token`](supabase/functions/google-token/index.ts) renova o acesso sozinha. Ela precisa dos segredos `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` em **Edge Functions › Secrets**. Se o Google revogar o acesso, o botão vira **Reconectar Google**.
- Enquanto o app estiver em **modo de teste** no Google Cloud, o Google faz o refresh token expirar em 7 dias. Para ficar conectado de vez, publique o app (**Google Auth Platform › Público-alvo › Publicar app**).
- Tasks **sem data** não entram, porque não têm um dia para contar nas métricas.
- Eventos recusados por você, feriados e aniversários são ignorados.
- O app não envia notificações e não escreve nada de volta no Google.

## Estrutura

```
index.html                      página, menus e janela de avaliação
css/styles.css                  tokens dos dois temas e componentes
js/config.js                    URL e chave anon do Supabase
js/store.js                     dados: Supabase, leitura do Google e modo demonstração
js/app.js                       telas, métricas, gráficos e rotas
supabase/migrations/*.sql       tabelas e regras de segurança
```
