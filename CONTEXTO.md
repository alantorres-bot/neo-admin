# Neo Admin — Contexto do projeto

Resumo para quem chega agora (pessoa ou IA). Situação em **22/10/2026**.
Detalhes sempre nas fontes: `CLAUDE.md`, `docs/VISAO_GERAL.md` e `docs/modulos/<area>-<modulo>.md`.

## 1. O que é
Plataforma interna do **administrativo do grupo Neo Formas** (Cuiabá/MT). Ela junta num só lugar as rotinas que hoje
são feitas em planilha, e-mail, no ERP **Consistem** ou em skills avulsas, separadas por área.

- Cada área (Financeiro, Fiscal, Comercial, RH/SST, Contratos, Jurídico…) tem **módulos**.
- Todos os módulos usam um **núcleo comum**: empresas, contrapartes, usuários e permissões por área, pendências
  (Fila do dia), anexos, importador CSV/XLSX, auditoria, configurações e comunicação.
- É também o **super painel** do grupo. Os sistemas de outras áreas (Vigilância Fiscal, NEOControl, apps de Produção)
  são cadastrados em Configurações > Aplicativos e abrem embutidos em `/apps/<codigo>`. Cada um continua com o próprio
  banco e o próprio login.

Dono e principal usuário: Alan Torres (alantorres@neoformas.com.br).

## 2. Stack
| Camada | Tecnologia |
| --- | --- |
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind + shadcn/ui |
| Banco/backend | Supabase: Postgres, Auth, Storage, RLS, Edge Functions (Deno), pg_cron |
| Integrações | API do Consistem (ERP), Gmail API (só rascunhos), WhatsApp Cloud API, ClickUp, Slack |
| Arquivos | exceljs, papaparse, unpdf, tesseract.js (OCR), @react-pdf/renderer |
| Testes | Vitest (regras de negócio; PGlite para SQL) e Playwright |
| Hospedagem | Google Cloud Run (São Paulo) + Supabase `neo-admin-sp` (sa-east-1) |

Atenção: o Next.js desta versão traz mudanças que quebram o que se conhecia. Leia `node_modules/next/dist/docs/` antes de
codar (`AGENTS.md`).

## 3. Estrutura
```
app/(auth)/login
app/(plataforma)/
  inicio/                    super painel: cartões por área
  financeiro/  recebiveis, cobranca, contas-pagar, cartao, akf, filial
  fiscal/      creditos
  comercial/   pedidos, comissoes
  rh/          painel, colaboradores, folha, vale_transporte, ponto, banco_horas
  configuracoes/  empresas, contrapartes, usuarios, importador, aplicativos
  apps/[codigo]/  app externo embutido
lib/nucleo/                  permissões, fila, anexos, documentos, tabela, login…
lib/integracoes/             consistem, gmail, importador
lib/modulos/<area>/<modulo>/ regras de negócio puras e testadas
supabase/migrations/         ~114 migrations, numeradas por área
supabase/functions/          Edge Functions <area>-<modulo>-<funcao>
docs/modulos/                uma especificação por módulo
```
Faixas das migrations: núcleo 0001–0099, financeiro 0100–0199, fiscal 0200–0299, contratos 0300–0399,
jurídico 0400–0499, RH/SST 0500–0599, compras 0600–0699, comercial 0700–0799.

## 4. Módulos e situação
| Área | Módulo | Situação |
| --- | --- | --- |
| Financeiro | Recebíveis (carteira, boletos, confirmação, régua, renegociação) | no ar |
| Financeiro | Cobrança (filas do dia: boleto, envio, confirmar, cobrar, baixar) | concluído (08/10) |
| Financeiro | Contas a pagar (lista unificada, autorização da diretoria, confirmação CCFFB014, "Não pago") | no ar |
| Financeiro | Cartão de crédito (fatura PDF × Contas a pagar, lançamento no Consistem pela API) | no ar, fechamento passo a passo |
| Financeiro | AKF (títulos cedidos, solicitação de antecipação) | Fases 1 e 2 no ar |
| Financeiro | Faturamento Filial Contagem (kit NF + demonstrativo + comodato + boleto) | em construção |
| Fiscal | Créditos tributários (Fiscal Control) | publicado em 22/10; IPI aguarda o contador |
| Comercial | Pedidos (carteira, faturamento, MDF-e; só lê o Consistem) | Fases 1 e 2 no ar |
| Comercial | Comissões (fechamento mensal dos representantes) | no ar (20/10) |
| RH/SST | Painel do RH | no ar |
| RH/SST | Colaboradores (cadastro único) | no ar |
| RH/SST | Folha (fechamento mensal, BB, PIX, títulos no Consistem) | F4 publicada em 22/10; falta preencher os portadores e testar outubro |
| RH/SST | Vale-transporte | código pronto; aguarda o cadastro dos portadores |
| RH/SST | Ponto (inconsistências do Control iD por quinzena) | publicado em 21/10; falta configurar e testar |
| RH/SST | Banco de horas (saldo e vencimento) | no ar (21/10) |
| — | Parcelamentos, Notificações, Jurídico, Contratos, Conciliação bancária, Fluxo de caixa, POPs | não iniciados |

## 5. Regras que não se quebram
1. Dinheiro em `numeric(14,2)`, mostrado como R$ 1.234,56. Datas dd/mm/aaaa. Fuso **America/Cuiaba**.
2. Nada que fale com terceiros sai sozinho: `modo_rascunho` começa `true`. O Gmail só gera **rascunho**.
3. E-mails terminam em "Atenciosamente," sem assinatura no corpo.
4. Registro que serve de prova (mensagem, aprovação, baixa) nunca é apagado; ele muda de status.
5. Toda alteração relevante vai para a `auditoria`.
6. RLS em todas as tabelas, com `tem_acesso_area()` e `nivel_area()`. A service role só é usada nas Edge Functions.
7. Um módulo nunca lê as tabelas internas de outro módulo. Usa o núcleo ou uma view/função pública.
8. Todo módulo publica suas pendências na tabela `pendencias`, que alimenta a Fila do dia.
9. Toda grade usa `components/ui/table.tsx` (classificação e filtro). Nunca `<table>` cru, exceto em tela de impressão.
10. Alíquota, prazo legal, fundamento ou cláusula **nunca se inventa**: vem da especificação ou se pergunta.
11. Login por e-mail/senha ou Google (só `@neoformas.com.br`); cadastro fechado, o admin cria o usuário.
12. Tudo em português do Brasil: interface, commits e nomes de tabela (snake_case, sem acento).

## 6. Forma de trabalho
- Por fases. Antes de cada fase, um plano curto; depois, o que foi feito e como testar. Não avançar sem aprovação.
- Módulo novo começa por uma especificação em `docs/modulos/` (modelo `_MODELO.md`). Ao terminar, atualizar a especificação.
- Banco só por migration. Testes obrigatórios para cálculos (encargos, prazos, valores).
- `npm run verificar` = typecheck + lint + testes.
- **Publicação em produção fica com o Alan.** A migration aplicada com `supabase db query -f` precisa ser registrada à mão
  em `supabase_migrations.schema_migrations` (`docs/PUBLICACAO.md`, seção 2).
- Para retomar o trabalho entre sessões, use a skill `handoff`.

## 7. Onde ler mais
| Assunto | Arquivo |
| --- | --- |
| Instruções do projeto | `CLAUDE.md`, `AGENTS.md` |
| Áreas, núcleo e ordem de construção | `docs/VISAO_GERAL.md` |
| Fase 0 (núcleo) | `docs/FASE_0_NUCLEO.md` |
| Publicação, backup e segurança | `docs/PUBLICACAO.md` |
| Login com Google | `docs/LOGIN_GOOGLE.md` |
| Gmail (credenciais e conta por usuário) | `docs/GMAIL_CREDENCIAIS.md`, `docs/GMAIL_POR_USUARIO.md` |
| Visual | `docs/VISUAL.md` |
| Cada módulo | `docs/modulos/*.md` |
| Fiscal Control | `docs/fiscal-control/` |
