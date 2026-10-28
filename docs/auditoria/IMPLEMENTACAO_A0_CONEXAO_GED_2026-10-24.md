# Implementação local da A0-conexão do GED (banco, Edge Function e tela)

Data: 24/10/2026 · Branch: `auditoria-contratos-ged` (HEAD `d2e643b`) · Situação: **implementado e testado localmente; nada aplicado,
publicado, conectado ou commitado.**

## Resumo

A conexão do GED com o Google Drive está implementada e coberta por testes automatizados:
- migration `0801`;
- Edge Function `nucleo-ged-conectar`;
- tela em Configurações.

**Não foi aberta num navegador.** Ela só funciona de verdade depois que a migration 0801 for aplicada no banco, e o projeto tem um único
Supabase, o de produção. Até lá, a tela mostra o aviso "ainda não disponível neste ambiente".

A conexão do Gmail e as especificações não foram tocadas. A especificação vigente continua sendo a **revisão 3**: a revisão 4 e a
autorização da fase A0 **não** foram aprovadas.

## Arquivos

**Banco e Edge Function** (rodada anterior):

| Situação | Arquivo |
|---|---|
| criado | `supabase/migrations/0801_ged_conexao.sql` |
| criado | `supabase/functions/nucleo-ged-conectar/index.ts` |
| alterado | `supabase/functions/_shared/ged.ts` |
| alterado | `supabase/config.toml` (`verify_jwt = false`, como no Gmail) |
| criado | `tests/db/ged-conexao.test.ts` |
| criado | `lib/nucleo/ged/conexao.test.ts` |
| alterado | `lib/nucleo/ged/drive-http.test.ts` |

**Tela** (esta rodada):

| Situação | Arquivo |
|---|---|
| criado | `app/(plataforma)/configuracoes/documentos/page.tsx` |
| criado | `app/(plataforma)/configuracoes/documentos/conexao-drive.tsx` |
| criado | `app/(plataforma)/configuracoes/documentos/acoes.ts` |
| criado | `lib/nucleo/ged/conexao-tela.ts` |
| criado | `lib/nucleo/ged/conexao-tela.test.ts` |
| criado | `tests/ui/ged-conexao-tela.test.ts` |
| alterado | `app/(plataforma)/configuracoes/layout.tsx` (aba nova, só admin geral) |

**Localização:** Configurações > **Google Drive (GED)**, rota `/configuracoes/documentos`. Essa rota é o destino fixo da volta do Google,
o mesmo aceito pelo banco.

## Como funciona

- **Acesso:** só o administrador geral, na tela e nas ações. Também é conferido no banco e na Edge Function.
- **Estados:**
  - **Desconectado:** botão "Conectar Google Drive", desabilitado com aviso se a conta do GED não estiver configurada.
  - **Conectado:** conta, "Somente leitura do Drive" e data da conexão.
  - **Com erro:** mensagem amigável conforme o código do erro, com "Reconectar" e "Desconectar".
- **Conectar:** gera o pedido no banco com o destino fixo e leva à Edge Function. Nenhum endereço de destino vem do navegador.
- **Volta do Google:** os códigos fixos viram mensagens amigáveis; qualquer outro texto vira mensagem genérica. Nada da URL é exibido; a
  URL é limpa e o estado é atualizado.
- **Desconectar:** pede confirmação e tem trava contra clique duplo. Chama a Edge Function, e a mensagem diz se a revogação no Google
  funcionou ou se precisa ser feita à mão.
- **Revogação no Google (D-REV, pendente):** a tela só descreve o comportamento atual de `administrativo.ged.revogar_no_google`, sem
  opção contrária. Não registra a decisão como aprovada. A desconexão local acontece sempre.
- **Dados sensíveis:** a tela nunca pede, mostra nem guarda token ou identificador interno.
- **Segurança do fluxo** (banco e Edge Function):
  - PKCE S256 e `state` de uso único, consumido antes da troca do código;
  - identidade da conta conferida por completo; conjunto exato de escopos;
  - tabelas protegidas e auditoria saneada;
  - execução das funções só pelos papéis necessários;
  - destino só interno; configuração obrigatória, sem valor padrão.

## Testes executados (resultados reais)

| Conjunto | Resultado |
|---|---|
| Lógica da tela (`lib/nucleo/ged/conexao-tela.test.ts`) | 13 passando: retorno do Google com texto injetado (inclusive `__proto__` e e-mail), três estados, URL segura, mensagens de erro, trava contra clique duplo |
| Ações de servidor e componente (`tests/ui/ged-conexao-tela.test.ts`) | 13 passando: admin e não-admin; falha do banco e da Edge Function sem vazar detalhe; três estados; nada sensível no HTML; texto da revogação conforme a configuração; aviso quando a migration não está aplicada |
| Banco da conexão (`tests/db/ged-conexao.test.ts`) | 21 passando (rodada anterior) |
| GED completo (`lib/nucleo/ged`) | 142 passando |
| `npm run verificar` | tipos e lint ok; **1.992 testes passando**, 1 pulado (o mesmo de antes) |
| Tipos da Edge Function (`npx --yes deno check`, Deno 2.9.6) | `nucleo-ged-conectar/index.ts` e o `_shared/ged.ts` importado passaram. Sem instalação global. O `deno.lock` da raiz já existia (14/10), está no `.gitignore` e não foi alterado |

**Limitação:** o projeto não tem DOM nos testes. Os cliques reais (abrir a confirmação, clicar duas vezes) não foram exercitados; a
lógica deles está testada à parte.

## Pendências para ativar em produção

1. Aprovar a revisão 4 do GED, autorizar a fase A0 e decidir a revogação no Google (D-REV). A configuração vem ligada; se a decisão for
   contra, desligue antes de ativar.
2. Criar a conta dedicada e o cliente OAuth Interno, com o URI de retorno exato.
3. Aplicar a `0801` em produção pelo roteiro do `docs/PUBLICACAO.md`, incluindo o registro em `schema_migrations`.
4. Gravar os segredos (`GED_DRIVE_CLIENT_ID`, `GED_DRIVE_CLIENT_SECRET`, `GED_DRIVE_REDIRECT_URI`, `NEO_ADMIN_URL`) e publicar a
   `nucleo-ged-conectar`.
5. Gravar a conta em `administrativo.ged.conta` (campo "Conta dedicada do GED" na própria aba, só admin geral, acrescentado depois),
   conectar com a conta dedicada e fazer a primeira validação real.

Roteiro detalhado, com responsável e critério de parada por etapa: `CHECKLIST_ATIVACAO_A0_GED_2026-10-24.md`.

**Pendências que não bloqueiam a A0-conexão:**
- D-INVALID (apagar o segredo ao receber `invalid_grant`), ainda não implementado;
- A0-verificação (prévia das raízes), que depende da GED-P13 e do PENDENTE 1;
- correção da conexão do Gmail, como tarefa separada.

Tudo está só na pasta de trabalho, sem commit, aguardando revisão.
