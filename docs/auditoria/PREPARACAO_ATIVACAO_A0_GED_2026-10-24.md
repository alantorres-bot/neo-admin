# Preparação da ativação controlada — A0-GED

Data: 24/10/2026.
Branch: `auditoria-contratos-ged`, HEAD `d2e643b`, sincronizado com a origem (0/0).
Nada foi aplicado em produção, nenhum segredo foi gravado, nada foi publicado e não houve commit nem push. Todas as alterações
locais e os arquivos não versionados foram preservados.

## 1. Checklist operacional criado

O checklist está em `docs/auditoria/CHECKLIST_ATIVACAO_A0_GED_2026-10-24.md`. Tem 12 etapas, cada uma com responsável,
pré-requisitos, ação, resultado esperado e critério para seguir ou parar:

1. Aprovação documental da revisão 4 do GED.
2. Autorização expressa da fase A0.
3. Decisão sobre a revogação no Google (D-REV).
4. Conta corporativa dedicada e cliente OAuth Interno.
5. URI de retorno cadastrado no Google.
6. Disponibilidade e nomes exatos dos segredos.
7. Revisão final da 0801, com consultas só de leitura em produção.
8. Aplicação em produção e registro em `schema_migrations`.
9. Segredos, Edge Function e publicação do aplicativo.
10. Configuração da conta do GED.
11. Primeira conexão e testes reais: 8 testes.
12. Interrupção e recuperação.

O checklist também tem:
- uma tabela de valores fixos conferidos no código: projeto `chdszjpbtfpstjrqnmmm`, migration `0801`/`ged_conexao`, função
  `nucleo-ged-conectar`, URI de retorno, quatro segredos, escopos e domínio `hd`;
- consultas só de leitura para antes da aplicação (estado da 0801, tabelas, Vault, módulo e parâmetros);
- consultas só de leitura para depois da aplicação (permissões das funções para `anon`, `authenticated` e `service_role`, e
  leitura direta da tabela);
- os comandos de `docs/PUBLICACAO.md`, seção 2;
- uma tabela de recuperação para cada ponto em que a ativação pode parar.

## 2. Decisão: configurar a conta do GED pela tela

O projeto já tem um padrão para gravar parâmetros, usado em `app/(plataforma)/gestao/atividades/acoes.ts`:
- o admin geral faz o `update` em `configuracoes`;
- a política RLS `configuracoes_admin` exige `eh_admin_geral()`;
- o gatilho `trg_aud_configuracoes` registra o antes, o depois e o usuário.

Por isso, implementei um campo na tela existente. Não criei mecanismo paralelo de acesso ao banco.

**Onde ficou:**
- `lib/nucleo/ged/conexao-tela.ts`: nova função `validarContaGed`.
- `app/(plataforma)/configuracoes/documentos/acoes.ts`: nova ação `definirContaGed`.
- `conexao-drive.tsx`: novo campo "Conta dedicada do GED", com o botão "Salvar conta".
- `page.tsx`: passa a enviar a conta atual ao componente, no lugar do booleano.

**Regras aplicadas:**
- **Quem grava:** só o admin geral. A ação confere antes de tocar no banco, e a RLS confere de novo.
- **O que aceita:** só `^[a-z0-9._%+-]+@neoformas\.com\.br$`, com no máximo 254 caracteres.
  - Recusa outro domínio, subdomínio, domínio parecido e texto com espaço ou com `<`.
  - O motivo é o `id_token`, que já é conferido com `hd = neoformas.com.br`: outro domínio nunca conectaria.
- **Normalização:** grava sem espaços nas pontas e em minúsculas, como `ged_conta_configurada()` compara.
- **D-TROCA:**
  - a ação consulta `ged_situacao_conexao` e recusa a troca com conexão ativa ou com erro;
  - se a situação não puder ser lida, também recusa;
  - o campo só aparece sem conexão ativa.
- **Migration ausente:** se o parâmetro não existir, a ação devolve "aplique a migration 0801".
- **Erro do banco:** a mensagem passa por `mensagemDeErroBanco`; a recusa da RLS vira "Você não tem permissão".
- **Endereço:** nenhum foi gravado e nenhum foi presumido.

Se a tela ainda não estiver publicada, o checklist traz o `update` por SQL como alternativa. Por esse caminho, a auditoria fica
sem usuário, então é preciso anotar quem fez a mudança e quando.

## 3. Inconsistências encontradas e correções

1. **Transação da 0801:** o plano antigo (Anexo A, A.7, já superado) afirma que a migration "roda em transação única (padrão do
   projeto)".
   - O arquivo não tem `begin`/`commit` explícitos; os `begin` encontrados são de corpos plpgsql.
   - O comportamento atômico do `supabase db query -f` não foi comprovado.
   - **Correção:** não alterei a migration. O checklist (etapa 12) manda não registrar em `schema_migrations` se ela falhar,
     verificar o que ficou criado e não reaplicar por cima.
2. **Etapa faltando no roteiro:** a tela só existe em produção depois do commit, do push e da publicação do aplicativo.
   **Correção:** incluí isso no checklist, etapa 9.3.
3. **Relatório desatualizado:** `IMPLEMENTACAO_A0_CONEXAO_GED_2026-10-24.md` dizia que não havia tela para a conta.
   **Correção:** atualizei a pendência 5 e apontei para o checklist.
4. **Coluna da auditoria:** a consulta do checklist usava `criado_em`, mas a coluna real é `em`. Corrigi a consulta.

**Conferências sem divergência:**
- **Numeração:** a 0801 é a única com esse número e não depende da 0800. A duplicidade `0163` já existia e não tem relação com
  este trabalho.
- **Edge Function:** `supabase/functions/nucleo-ged-conectar`, com `[functions.nucleo-ged-conectar] verify_jwt = false`, como
  no plano.
- **Segredos:** `GED_DRIVE_CLIENT_ID`, `GED_DRIVE_CLIENT_SECRET`, `GED_DRIVE_REDIRECT_URI` e `NEO_ADMIN_URL` têm os mesmos
  nomes em `_shared/ged.ts` (`configConexao`), no `index.ts`, no plano consolidado e no checklist. No Anexo A, já superado, o
  `GED_DRIVE_REDIRECT_URI` aparece como opcional; isso é histórico e está marcado como "não usar".
- **Publicação:** os comandos seguem `docs/PUBLICACAO.md`, seção 2: `db query -f` e, em seguida, o insert em `schema_migrations`.
- **Bloqueio de tráfego externo no E2E:**
  - O navegador continua bloqueando e reprovando qualquer pedido para fora de `127.0.0.1`.
  - No servidor, o app só usa `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`, e o `playwright.ged.config.ts`
    sobrescreve as duas para o simulador.
  - O `.env.local` aponta para produção, mas as variáveis do processo têm precedência sobre ele.

## 4. Testes executados

- `npx vitest run lib/nucleo/ged tests/ui`: 149 passaram.
  - Novo em `conexao-tela.test.ts`: normalização e recusas da validação.
  - Novos em `tests/ui/ged-conexao-tela.test.ts`, todos sobre a ação de gravar a conta:
    - admin grava a conta normalizada e a tela é revalidada;
    - usuário comum é recusado sem tocar no banco;
    - e-mail inválido é recusado sem tocar no banco;
    - a troca é recusada com conexão ativa, com erro ou com situação ilegível;
    - parâmetro ausente e recusa da RLS dão erro claro, sem revalidar.
  - O render no servidor confere que o campo aparece desconectado e some conectado.
- `npx playwright test -c playwright.ged.config.ts`: 11 de 11 passaram.
  - Teste novo "3b": um e-mail de outro domínio é recusado sem enviar nada; a gravação faz um único PATCH, com o valor
    normalizado, e habilita o botão Conectar; com conexão ativa, o campo some.
  - O simulador ganhou o PATCH em `configuracoes`, que exige o admin e o filtro exato da chave.
- `npx tsc --noEmit` e `eslint` nos arquivos alterados: sem erro e sem aviso.
- `npm run verificar`: 1.999 testes passaram e 1 foi pulado (o mesmo de antes); 195 arquivos passaram e 4 foram pulados.

## 5. Bloqueios que dependem de aprovação ou de configuração externa

| Item | Quem resolve |
|---|---|
| Aprovação da revisão 4 do GED (o aprovador não está definido) | Alan |
| Autorização expressa da fase A0 | Alan |
| D-REV: a 0801 cria o parâmetro ligado, como na recomendação; se a decisão for contrária, desligar logo após aplicar | Alan |
| Conta dedicada `@neoformas.com.br` (o endereço não está definido) | Alan, com o admin do Workspace |
| Cliente OAuth Interno exclusivo do GED, com o URI exato `https://chdszjpbtfpstjrqnmmm.supabase.co/functions/v1/nucleo-ged-conectar` | Alan |
| D-URL / `NEO_ADMIN_URL`: candidata `https://neo-admin-474748357673.southamerica-east1.run.app` (`docs/LOGIN_GOOGLE.md`), a confirmar | Alan |
| Commit e push autorizados deste trabalho, e publicação do aplicativo | Alan |
| Aplicar a 0801, gravar os 4 segredos, publicar `nucleo-ged-conectar` | Alan |
| Primeira conexão real e os 8 testes da etapa 11 | Alan |

## 6. Limitações

- Não houve teste contra o banco real nem com OAuth ou Google de verdade.
- A gravação da conta foi exercitada contra o simulador, não contra a RLS real. Ela segue o mesmo caminho já usado em produção
  por `gestao/atividades`.
- Durante o E2E, o `next dev` baixa as fontes do `next/font/google` pelo servidor. Esse tráfego não vai ao OAuth, ao Drive nem à
  produção, mas não é bloqueado pelo teste.
- Continuam fora da A0:
  - D-INVALID;
  - a melhoria do cookie ligado ao navegador;
  - a A0-verificação (GED-P13);
  - o endurecimento da conexão Gmail, que não foi alterada.

## 7. Arquivos desta rodada

**Novos:**
- `docs/auditoria/CHECKLIST_ATIVACAO_A0_GED_2026-10-24.md`
- `docs/auditoria/PREPARACAO_ATIVACAO_A0_GED_2026-10-24.md` (este relatório)

**Alterados (todos ainda não versionados, da rodada anterior):**
- `lib/nucleo/ged/conexao-tela.ts` e `conexao-tela.test.ts`
- `app/(plataforma)/configuracoes/documentos/acoes.ts`, `conexao-drive.tsx` e `page.tsx`
- `tests/ui/ged-conexao-tela.test.ts`
- `e2e/ged-conexao.spec.ts` e `e2e/supabase-simulado.mjs`
- `docs/auditoria/IMPLEMENTACAO_A0_CONEXAO_GED_2026-10-24.md`
