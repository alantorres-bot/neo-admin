# Fiscal Control — Status (22/10/2026)

Situação: **primeira versão funcional entregue para avaliação**, no branch `claude/fiscal-creditos-tributarios`.
**Não publicada**: nada foi aplicado no Supabase de produção nem em projeto de teste do grupo; não está acessível pela internet.
Validação feita em ambiente local desta sessão (detalhes abaixo).

## 1. O que está pronto
| Módulo | Situação | Observação |
| --- | --- | --- |
| Cadastros (estabelecimentos, tributos, categorias, origens, tipos de movimento e de obrigação) | ✅ funcional | parâmetros de exemplo **não validados** |
| Papéis (leitor, analista, revisor, contador, administrador) e escopo por empresa | ✅ funcional | testado no banco e na interface |
| Créditos (cadastro, consulta, filtros, paginação, ficha, edição controlada, validação, bloqueio, arquivamento) | ✅ funcional | |
| Razão de movimentações (lançamento, estorno, correção, aprovação, transferência autorizada) | ✅ funcional | |
| Apuração mensal e transporte de saldo, fechamento/reabertura/reconciliação | ✅ funcional | |
| Consolidado anual (tela, Excel, impressão/PDF) | ✅ funcional | PDF pela impressão do navegador |
| Obrigações (cadastro, geração pelo perfil, calendário, fluxo, recibo, retificação) | ✅ funcional | vencimentos "a confirmar" sem regra validada |
| Documentos (envio validado, bucket privado, download temporário, versões, vínculos, faltantes) | ✅ funcional | até 9 MB |
| Conciliação (15 verificações, comparativo, divergências) | ✅ funcional | |
| Tarefas e aprovações (fila, tarefas na Fila do dia, comentários, histórico de decisões) | ✅ funcional | |
| Dashboard (20 indicadores, 5 gráficos, filtros) | ✅ funcional | |
| Relatórios Excel e modelos de importação | ✅ funcional | |
| Importação de planilhas (créditos e movimentações) | ✅ funcional | XLSX/XLS/CSV |
| Leitura da EFD ICMS/IPI (saldo oficial) | ⚠️ parcial | só 0000/E110/E520; testado com arquivo sintético |
| Notificações externas, agendamento automático, outros importadores SPED/XML, atualização monetária calculada | ❌ não implementado | ver README, item 13 |

## 2. Decisões tomadas (sem consulta, conforme a missão)
1. Construído como **módulo do Neo Admin** (`fiscal.creditos`), e não como sistema novo: o repositório já é a plataforma do
   administrativo, com login, permissões por área, auditoria e Fila do dia; o CLAUDE.md manda módulos sobre o núcleo.
2. **Saldo derivado do razão** (nunca digitado); transporte entre meses por construção, por crédito.
3. Regras no **banco** (funções `fis_*` + RLS); a aplicação valida de novo no servidor (zod + formatos BR).
4. Papéis do módulo **derivados do nível na área Fiscal**; *Contador* escolhido em `fis_membros` (exige nível gestor).
5. Regras tributárias como **parâmetros não validados**; nenhum prazo legal cadastrado.
6. Registro/validado/pendente do painel medidos pelas **entradas no razão** (não pelo "valor original"), para que
   validado + pendente + contestado = registrado mesmo nos créditos escriturais que recebem entradas todo mês.
7. Demonstração **fora das migrations**, com travas contra base real/produção.
8. Ambiente local sem Docker em `scripts/local-sem-docker/` (só desenvolvimento/teste).
9. Desvio do CLAUDE.md ("não avançar de fase sem aprovação"): a missão pediu execução contínua das 7 fases; foi seguida a missão.

## 3. Testes executados nesta sessão (resultados reais)
| O quê | Como | Resultado |
| --- | --- | --- |
| Regras do banco do módulo | `tests/db/fis-creditos.test.ts` (PGlite + migrations reais) | **35/35** ✅ |
| Carga de demonstração | `tests/db/fis-creditos-demo.test.ts` | **6/6** ✅ |
| Regras puras (formatos/arredondamento, apuração, consolidado, papéis, arquivos, SPED, importação, planilha) | `lib/modulos/fiscal/creditos/*.test.ts` | **23/23** ✅ |
| Projeto inteiro | `npx vitest run` | **1.546 passaram, 1 pulado, 0 falhas** (antes: 1.482) |
| Tipos | `npm run typecheck` | ✅ sem erros |
| Lint | `npx eslint app components lib tests e2e scripts proxy.ts` | ✅ sem erros nem avisos |
| Compilação de produção | `npm run build` (Turbopack) | ✅ (92 páginas; 18 rotas do módulo) |
| Migrations em Postgres 16 real | aplicação de todas as migrations do projeto em ordem | ✅ sem erro |
| Interface (6 fluxos) | `playwright.fiscal.config.ts` contra `next start` + Postgres 16 + PostgREST 12.2.3 + Supabase Auth v2.164.0 + proxy local | **6/6** ✅ |
| Persistência após reinício | reinício do Postgres; créditos, movimentos e documentos criados pela interface continuavam lá | ✅ |

Coberto especificamente: arredondamento (2 casas, sem arredondar em silêncio; 0,10 + 0,20 = 0,30), movimentações duplicadas e
idempotência, estorno (inclusive o que deixaria saldo negativo), fechamento sequencial, competência fechada, reabertura com
motivo, correção de competência anterior marcando as seguintes para reconciliação, virada de exercício (janeiro = dezembro
anterior), utilização acima do saldo (inclusive em competência anterior), saídas pendentes reservando saldo, segregação de
funções, escopo por empresa (RLS do banco e do Storage), obrigação só transmitida com recibo vinculado, divergência virando
tarefa e pendência do núcleo, importação com erro/duplicidade/rejeição na confirmação, painel respeitando filtros.

Critérios de aceitação (seção 20 da missão): 1–19 atendidos e testados; o 17 (persistência) foi verificado no Postgres local,
não num Supabase hospedado.

## 4. Observações sobre o ambiente desta sessão
- Sem Docker: o Supabase oficial local (`supabase start`) não pôde ser usado; montei Postgres 16 + PostgREST + Auth com binários
  oficiais e um proxy com Storage mínimo (`scripts/local-sem-docker/`). O Storage real do Supabase **não** foi testado.
- A primeira compilação falhou ao baixar fontes do Google pelo proxy de rede do ambiente; com o proxy configurado e o cache
  `.next` limpo, compilou. Não é problema do código.
- O `next dev` reescreve o `tsconfig.json` quando usa outra pasta de saída; a alteração **não** foi commitada.

## 5. Pendências e próximos passos
1. **Você/contador:** revisar e validar os parâmetros (Configurações > Categorias e Tipos de obrigação) — formas de utilização,
   documentos exigidos, prazos de aproveitamento e regras de vencimento, com a fonte.
2. Aplicar as migrations 0200–0203 num **projeto Supabase de teste**, carregar a demonstração e avaliar com usuários reais.
3. Validar a leitura da EFD ICMS/IPI com um arquivo real (o leitor só foi testado com arquivo sintético).
4. Definir os saldos de abertura reais (tipo *Saldo inicial*) e a primeira competência a fechar.
5. Depois da aprovação: produção (PUBLICACAO.md, seção 2), `fiscal.creditos.bloquear_demonstracao = true`, backup do bucket `fiscal`.
6. Evoluções: agendamento das obrigações (pg_cron), avisos por e-mail (rascunho), importador da EFD-Contribuições.
