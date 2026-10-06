# Gmail do Neo Admin: como criar as credenciais (uma vez por projeto)

O Neo Admin só **cria rascunhos** no Gmail (escopo `gmail.compose`). Ele não envia e-mails e não lê a caixa. Quem confere
e envia é uma pessoa, no Gmail. O rascunho aparece na caixa de quem autorizar (por exemplo, `financeiro@neoformas.com.br`).

## 1. No Google Cloud (console.cloud.google.com), com uma conta do Workspace da empresa

1. Escolha (ou crie) um projeto. Pode ser o mesmo do Gestor AKF.
2. **APIs e serviços > Biblioteca > Gmail API > Ativar.**
3. **Google Auth Platform (tela de consentimento OAuth):** tipo **Interno** (só contas do Workspace da empresa; não exige
   verificação do Google). Em **Acesso a dados (Scopes)**, adicione `https://www.googleapis.com/auth/gmail.compose`.
4. **Clientes > Criar cliente > Tipo de aplicativo: App para computador.** Nome: `Neo Admin Gmail`. Anote o **ID do cliente**
   e o **segredo do cliente** (não cole em chat nem em arquivo do projeto).

## 2. No terminal, na pasta do projeto

```
node scripts/gmail-autorizar.mjs
```

O script pergunta o ID, o segredo (não aparece ao digitar) e o e-mail da caixa; abre o login do Google; você entra com **a caixa
em que os rascunhos devem aparecer** e clica em Permitir. Ele grava no Supabase (`supabase secrets set`) os quatro segredos
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` e `GMAIL_REMETENTE`. Nada fica em arquivo.
Pré-requisito: `npx supabase login` e `npx supabase link` já feitos.

## 3. Publicar a função e testar

```
npx supabase functions deploy rec-rascunho-gmail
```

Na ficha de uma NF (Financeiro > Recebíveis), com o boleto anexado a cada parcela e um contato com e-mail, clique em
**Criar rascunho no Gmail** e confira na pasta Rascunhos da caixa autorizada.

## Revogar ou trocar de caixa

Rode o script de novo (grava o novo token por cima) ou remova o acesso em https://myaccount.google.com/permissions.
Se o Google responder "invalid_grant", o token expirou ou foi revogado: rode o script de novo.
