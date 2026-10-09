# Neo Admin — Plataforma do Administrativo

Aplicação interna do grupo Neo Formas (Cuiabá/MT) que reúne, em um só lugar, as rotinas do administrativo,
separadas por área. Cada área é um **módulo** sobre um **núcleo comum**.

Antes de qualquer tarefa, leia:
- `docs/VISAO_GERAL.md` — áreas, módulos, núcleo comum e ordem de construção.
- `docs/modulos/<area>-<modulo>.md` — especificação do módulo em que estiver trabalhando.

## Idioma
- Interface, mensagens, comentários de negócio e commits em **português do Brasil**.
- Tabelas/colunas em português, sem acento, snake_case. Tabelas de módulo com prefixo da área
  quando houver risco de conflito (ex.: `rec_titulos`, `fis_parcelamentos`). Núcleo sem prefixo.

## Stack
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui.
- **Backend/banco:** Supabase (Postgres, Auth, Storage, RLS, Edge Functions, pg_cron).
- **Automações:** Supabase Edge Functions agendadas com pg_cron.
- **Integrações:** Gmail API (rascunhos), WhatsApp Business Cloud API (oficial), ClickUp API (tarefas).
- **Testes:** Vitest (regras de negócio) e Playwright (fluxos principais).

## Arquitetura
```
app/
  (auth)/login
  (plataforma)/
    inicio/                  -> Fila do dia geral (pendências de todos os módulos do usuário)
    financeiro/recebiveis/   -> um módulo = uma pasta de rotas
    fiscal/parcelamentos/
    ...
    configuracoes/
    apps/[codigo]/           -> aplicativo externo (sistema separado) embutido no painel; cadastro em Configurações > Aplicativos
lib/
  nucleo/                    -> empresas, usuários, permissões, anexos, pendências, auditoria
  integracoes/               -> gmail, whatsapp, clickup, importador de planilhas
  modulos/<area>/<modulo>/   -> regras de negócio do módulo (puras e testadas)
supabase/
  migrations/                -> 0001_nucleo.sql, 0100_financeiro_recebiveis.sql, 0200_fiscal_...
  functions/<area>-<modulo>-<funcao>/
docs/modulos/                -> uma especificação por módulo
```
- Faixa de numeração das migrations por área: núcleo 0001–0099, financeiro 0100–0199, fiscal 0200–0299,
  contratos 0300–0399, jurídico 0400–0499, RH/SST 0500–0599, compras/patrimônio 0600–0699.
- Um módulo **nunca** acessa tabelas internas de outro módulo diretamente: usa o núcleo (pendências,
  anexos, empresas, contrapartes) ou uma view/função pública documentada.
- Todo módulo publica suas pendências na tabela `pendencias` do núcleo (alimenta a Fila do dia).
- Permissão por área: o usuário pode ser gestor no Financeiro e não ver o Jurídico.

## Regras globais
1. Valores monetários: `numeric(14,2)`; interface R$ 1.234,56. Datas dd/mm/aaaa. Fuso **America/Cuiaba**.
2. Nada que comunique terceiros sai sem regra explícita: a configuração global `modo_rascunho` começa `true`.
3. E-mails terminam em "Atenciosamente," sem assinatura no corpo.
4. Registros que servem de prova (mensagens enviadas, aprovações, baixas) nunca são apagados; mudam de status.
5. Toda alteração relevante passa por `auditoria`.
6. Áreas sensíveis (Jurídico, RH/SST) com acesso restrito por padrão.
7. Regras fiscais, trabalhistas e jurídicas vêm da especificação do módulo. **Nunca inventar** alíquota,
   prazo legal, fundamento ou cláusula; em dúvida, perguntar.
8. O Neo Admin é o **super painel** do grupo: aplicativos de outras áreas (Vigilância Fiscal, NEOControl, apps de Produção…)
   são cadastrados na tabela `aplicativos` (Configurações > Aplicativos) e abrem em `/apps/<codigo>`; nunca fixar URL de app no código.
   Eles continuam sistemas separados, com login próprio: o painel só organiza o acesso por área.

## Segurança
- Nunca commitar chaves (`.env.local` no `.gitignore`); `.env.example` com os nomes das variáveis.
- RLS ativa em todas as tabelas, usando as funções do núcleo `tem_acesso_area()` e `nivel_area()`.
- Service role somente em Edge Functions. LGPD: só os dados necessários a cada rotina.

## Forma de trabalho
- Construir por fases (ver `docs/VISAO_GERAL.md`). Não avançar de fase sem minha aprovação.
- Antes de cada fase: plano curto. Depois: o que foi feito e como testar.
- Banco só via migrations. Testes obrigatórios para cálculos (encargos, prazos, valores).
- Ao terminar um módulo, atualizar a especificação dele com o que mudou.

@AGENTS.md
