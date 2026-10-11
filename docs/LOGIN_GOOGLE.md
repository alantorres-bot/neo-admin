# Entrar com Google (Neo Admin e aplicativos do super painel)

Desde 10/10/2026 o Neo Admin aceita **"Entrar com Google"** com a conta do Workspace da Neo Formas
(`@neoformas.com.br`). E-mail e senha continuam funcionando como reserva. A ideia é uma identidade só para
os três aplicativos (Neo Admin, Vigilância Fiscal e NEOControl): a conta Google da pessoa. Cada app continua
com seu banco e sua sessão; o que muda é que ninguém precisa de três senhas.

## 1. Como funciona no Neo Admin

1. Em `/login`, o botão "Entrar com Google" é um **link** para `GET /auth/google` (`app/auth/google/route.ts`).
   Não é formulário: a CSP `form-action 'self'` barraria o redirecionamento de um POST para o Google.
2. Essa rota pede ao Supabase a URL do Google (fluxo PKCE; o cookie do verificador fica no navegador) com
   `hd=neoformas.com.br` (abre direto na conta da empresa) e `prompt=select_account`.
3. O Google devolve ao Supabase (`https://chdszjpbtfpstjrqnmmm.supabase.co/auth/v1/callback`), que redireciona para
   `GET /auth/callback` (`app/auth/callback/route.ts`) com `?code=` ou com `?error_code=`.
4. O callback troca o código pela sessão (cookies), confere o domínio do e-mail e leva ao `proximo` (sempre por
   `destinoSeguro()`, só caminho interno). Recusas viram `/login?erro=`:

| `error_code` do Supabase | `?erro=` | Significado |
| --- | --- | --- |
| `signup_disabled` | `sem_cadastro` | cadastro fechado: só entra quem o admin já criou em Configurações > Usuários |
| `user_banned` | `desativado` | conta desativada pelo admin |
| (e-mail fora do domínio) | `dominio` | defesa extra; o consentimento Interno já impede isto |
| qualquer outro | `google` | erro genérico; tente de novo ou use a senha |

As regras puras (códigos, mensagens, domínio, leitura da claim `amr`) estão em `lib/nucleo/login.ts`.
`proxy.ts` deixa `/login` e `/auth/*` públicas; todo o resto continua exigindo sessão.

## 2. Quem pode entrar

- **Só quem já está cadastrado.** O cadastro público fica desligado no Supabase; o admin cria a pessoa em
  Configurações > Usuários e permissões. Quem já tem e-mail e senha pode passar a entrar pelo Google: o Supabase
  liga a identidade Google ao usuário existente de mesmo e-mail (o Google garante que o e-mail é verificado).
- **Novo usuário sem senha.** No diálogo "Novo usuário" a senha inicial é opcional. Em branco, a pessoa só entra
  pelo Google e não existe senha temporária para trocar. Com senha, vale a regra antiga: troca obrigatória no
  primeiro acesso **por senha**.
- **Só contas da empresa.** A tela de consentimento OAuth do projeto Google Cloud é do tipo **Interno**: contas
  de fora do Workspace nem chegam a autorizar. `hd` e a checagem do callback são camadas extras.

## 3. Troca de senha pendente × Google (migration 0007)

`perfis.deve_trocar_senha` bloqueava todo acesso (no banco e no app) até a pessoa trocar a senha. Quem entra pelo
Google não tem senha a trocar, então a regra passou a ser: **a troca pendente só prende sessão iniciada por senha.**

- O JWT do Supabase traz `amr: [{ method: "oauth" | "password" | ... }]`. No banco, `sessao_por_oauth()` lê
  `auth.jwt() -> 'amr'`; `acesso_liberado(id)` = ativo e (sem troca pendente ou sessão por OAuth). As funções
  `eh_admin_geral()`, `nivel_area()`, `usuario_ativo()` e `tem_acesso_alguma_area()` usam `acesso_liberado()`.
- No app, `lib/nucleo/sessao.ts` calcula `porSenha = !entrouPorOAuth(claims)` e só manda para `/conta` quem entrou por senha.
- Sem a claim `amr` (service role, token antigo), vale a regra de antes: bloqueia. Nunca libera por engano.
- A senha temporária definida pelo admin continua inútil até ser trocada: a sessão por senha segue presa.

## 4. Configuração (feita uma vez, pelo administrador, fora do código)

Nada disto vai para o repositório nem para o chat. ID e segredo ficam no gerenciador de senhas.

1. **Google Cloud**, projeto `neo-admin-neoformas` (o mesmo do Gmail, `docs/GMAIL_CREDENCIAIS.md`): APIs e
   serviços > Credenciais > Criar credenciais > ID do cliente OAuth > **Aplicativo da Web**, nome **Neo Formas Login**.
   URIs de redirecionamento autorizados (um cliente serve os três apps):
   - `https://chdszjpbtfpstjrqnmmm.supabase.co/auth/v1/callback` (Neo Admin)
   - `https://ycokizsmegdwntcsstfh.supabase.co/auth/v1/callback` (Vigilância Fiscal)
   - `https://scrvxqouaicjiogyagfk.supabase.co/auth/v1/callback` (NEOControl)
2. **Supabase** (`chdszjpbtfpstjrqnmmm`) > Authentication > Sign In / Providers > **Google**: ligar, colar ID e
   segredo. "Allow new users to sign up" continua **desligado**.
3. Supabase > Authentication > URL Configuration: Site URL
   `https://neo-admin-474748357673.southamerica-east1.run.app`; Redirect URLs: essa URL + `/auth/callback`,
   `http://localhost:3000/auth/callback` e `http://127.0.0.1:3000/auth/callback`.
4. Aplicar a migration `0007_nucleo_login_google.sql` em produção e registrá-la (`docs/PUBLICACAO.md`, seção 2).
5. Publicar o aplicativo no Cloud Run.

O bloco `[auth.external.google]` em `supabase/config.toml` só documenta a paridade; o projeto não roda Supabase local.

## 5. Limitações conhecidas

- Sair do Neo Admin não encerra as sessões da Vigilância Fiscal nem do NEOControl (bancos e sessões separados).
  Para tirar o acesso de alguém: desativar em cada app e suspender a conta no Google Workspace, o que bloqueia
  novos logins Google na hora.
- Os apps embutidos (iframe) têm armazenamento separado por site hospedeiro no Chrome e no Safari; o login Google
  dentro do quadro é tratado na Fase B (popup), em cada app.

## 6. Teste manual (com a própria conta; nunca com dados de clientes)

1. Deslogado, abrir `/configuracoes/empresas` → `/login?proximo=...` → "Entrar com Google" → volta em
   `/configuracoes/empresas` logado.
2. Sair; entrar por e-mail e senha: continua funcionando.
3. Com um usuário de teste com `deve_trocar_senha`: pelo Google entra direto; por senha cai em `/conta`.
4. Com um e-mail da empresa que não está cadastrado: `/login?erro=sem_cadastro`.
