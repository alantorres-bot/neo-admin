# Gmail por usuário ("Conectar meu Gmail")

O e-mail da filial ao cliente (Faturamento Filial, Fase C) sai do Gmail de **quem o prepara** (ex.: minas@), e não da caixa
do financeiro. Cada pessoa autoriza o próprio Gmail **uma vez**. O escopo é só `gmail.compose`: o Neo Admin **cria
rascunhos** e nunca envia nem lê a caixa. Quem confere e envia é a pessoa, no Gmail.

- O refresh token de cada pessoa fica no **Vault** do Supabase (cifrado), nunca em tabela nem no app. A tabela
  `gmail_contas` guarda só o e-mail, o id do segredo e as datas (migration 0153).
- A conta autorizada no Google precisa ser **a mesma do usuário** no Neo Admin. Se for outra, o sistema recusa.
- O "Desconectar" (na ficha do kit) apaga o segredo do Vault.
- O Gmail "global" da Cobrança (financeiro@, `docs/GMAIL_CREDENCIAIS.md`) continua igual, separado.

## Configuração (uma vez, pelo Alan)

1. **Google Cloud**, projeto `neo-admin-neoformas` (o mesmo do login e do Gmail; a Gmail API já está ativada):
   - **APIs e serviços > Credenciais >** cliente **Neo Formas Login** (Aplicativo da Web) **> URIs de redirecionamento
     autorizados > adicionar:** `https://chdszjpbtfpstjrqnmmm.supabase.co/functions/v1/nucleo-gmail-conectar`
   - **Tela de consentimento OAuth > Acesso a dados (escopos) > Adicionar:** `https://www.googleapis.com/auth/gmail.compose`.
     A tela é do tipo **Interno**, então não precisa de verificação do Google.
2. **Segredos** das Edge Functions: o ID e o segredo do cliente "Neo Formas Login". Cole quando o script pedir; nada aparece
   na tela.
   ```
   node scripts/gravar-segredo.mjs GMAIL_WEB_CLIENT_ID --ref chdszjpbtfpstjrqnmmm
   node scripts/gravar-segredo.mjs GMAIL_WEB_CLIENT_SECRET --ref chdszjpbtfpstjrqnmmm
   ```
3. **Migration** `0153_gmail_por_usuario_kit_enviado.sql` aplicada e registrada (`docs/PUBLICACAO.md`, seção 2).
4. **Deploy** das funções. A `nucleo-gmail-conectar` usa `verify_jwt = false` (em `supabase/config.toml`), porque o Google
   redireciona o navegador para ela; a segurança é o `state`, de uso único e válido por 15 minutos.
   ```
   npx supabase functions deploy nucleo-gmail-conectar --project-ref chdszjpbtfpstjrqnmmm
   npx supabase functions deploy rec-kit-rascunho-gmail --project-ref chdszjpbtfpstjrqnmmm
   ```

## Uso

Na ficha de um kit **pronto para envio**:
1. **Conectar meu Gmail** (só na primeira vez). O botão abre o Google, você autoriza com a sua conta e volta para a ficha.
2. Confira **Para**, **Cc**, **Assunto** e **Texto**. Eles já vêm preenchidos: o último destinatário usado para o cliente
   ou os contatos dele, a cópia de `financeiro.filial.copia_cliente` e o texto no modelo da filial.
3. **Criar rascunho no meu Gmail**. O rascunho aparece na sua caixa com todos os documentos do kit anexados.
4. Envie pelo Gmail e volte para marcar **Enviado ao cliente**. O kit vira "Enviada", as parcelas ficam como "boleto
   enviado" e a cobrança segue a régua normal.
