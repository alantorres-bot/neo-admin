# GED — primeira indexação (procedimento operacional)

Usar quando o administrador do Google Workspace responder o **PENDENTE 12** (`docs/modulos/administrativo-ged.md`, seção 14, item 12,
e 5.11.8). Base: commit `35cd4b6` (migration `0807_ged_agendamento.sql`, `scripts/ged-primeira-indexacao.sql` e `nucleo-ged-indexar`
v2, publicada em 25/10/2026 com a reconciliação semanal).

**Cada bloco (A, B, C, D, E) precisa de autorização própria do responsável.** Autorizar um bloco não autoriza o seguinte.

`Q` = `npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no`

## Por que a 0807 não indexa nada sozinha

- **Migration 0807:** o job `ged-indexar-30min` é criado e desligado no mesmo bloco, numa transação só. Ele nunca existe ligado.
- **`ged_chamar_indexacao()`:** volta sem chamar nada se `administrativo.ged.indexar` não for `true` (teste em
  `tests/db/ged-indice.test.ts`). Não executa por chamada de usuário nem pela service role.
- **Edge Function `nucleo-ged-indexar` (v2):** só aceita POST com o segredo de agendamento (sem ele ou com outro: 401, conferido em
  produção). `ged_iniciar_indexacao` recusa abrir a rodada com o interruptor desligado, antes de qualquer chamada ao Google (teste em
  `tests/db/ged-indexacao.test.ts`).
- **O PENDENTE 12 não fica no banco:** `scripts/ged-primeira-indexacao.sql` não tem como conferi-lo. A barreira é o passo A3 (registro na
  especificação, com commit) e o B0, que confere esse registro antes de qualquer passo em produção.

## Tipos de rodada (v2)

- **Primeira rodada (D):** `inicial` nas duas raízes (ainda não há ponto de continuação).
- **Depois:** `incremental`; a cada 7 dias desde a carga ou a última reconciliação, `reconciliacao` (5.3.4). A reconciliação não mexe no
  ponto de continuação; só grava `reconciliada_em`.
- **Leitura incompleta na reconciliação:** a rodada falha com `listagem_incompleta`, nada é marcado como sumido e o token fica onde estava.
  Enquanto isso se repetir, a raiz não volta ao incremental (o índice dela fica parado, sem perda: as mudanças continuam no Drive).

## Pré-requisitos técnicos ainda não comprovados

1. **Desligar o job na criação:** se o pg_cron de produção não aceitar `cron.alter_job(..., active := false)`, a 0807 falha inteira e
   nada fica gravado. Só aparece ao aplicar.
2. **Endereço da função:** a URL vem da URL de Recebíveis no Vault, trocando o nome da função (como nos Pedidos, 0701). Ainda não foi
   testada com o GED.
3. **Segredo do agendamento:** a igualdade entre o segredo do Vault e o `SINCRONIZACAO_SEGREDO` foi deduzida das respostas 200 de outras
   rotinas; não foi testada nesta função.
4. **Tempo de execução:** nenhuma rodada real rodou ainda. Não está comprovado que a carga das duas raízes cabe no tempo máximo da Edge
   Function e nos 150 s de espera do `net.http_post`.
5. **Drive compartilhado:** `changes.list` e `startPageToken` só foram testados com o Drive simulado.
6. **Reconciliação em produção:** a primeira só acontece 7 dias depois da carga; até lá, não há prova de que a leitura completa das duas
   raízes cabe no prazo de 100 s (o mesmo risco do item 4).

## A. Preparação (sem nada em produção)

| # | Passo | Resultado esperado | Parar se |
|---|---|---|---|
| A1 | **Resposta do administrador:** anotar os membros do Drive compartilhado `0ADGzgMWcDLTWUk9PVA` e a decisão "a elaboração precisa ou não de permissões próprias". | Lista de membros e decisão, com data e nome de quem respondeu. | Resposta parcial ou sem decisão. |
| A2 | **Pendente 12 resolvido?** Comparar com a especificação (5.11.8 e pendente 12). | Ou os membros fora da área Contratos são aceitos pelo responsável, ou a restrição exigida já foi aplicada no Drive. | Há quem não deveria ver a elaboração e a restrição ainda não foi feita no Drive. |
| A3 | **Registrar** (com autorização para editar e commitar): item 12 da seção 14 e item 8 da 5.11 em `docs/modulos/administrativo-ged.md`; commit. | Pendente 12 marcado como decidido, com a data. | — |

## B. Aplicar a 0807 (o job continua inativo)

| # | Passo | Resultado esperado | Parar se |
|---|---|---|---|
| B0 | **PENDENTE 12 registrado?** `git log -1 --format=%h -- docs/modulos/administrativo-ged.md` e conferir, no item 12 da seção 14, a decisão com data. | O commit do A3 existe e o item 12 diz decidido. | Item 12 ainda em aberto: não seguir para nenhum passo em produção. |
| B1 | **Conferir o estado:** `Q -f scripts/ged-primeira-indexacao.sql` | `pronto = true` | Qualquer coluna `false`. |
| B2 | **Aplicar:** `Q -f supabase/migrations/0807_ged_agendamento.sql` | Sem erro. | Erro, sobretudo no desligamento do job. Não reaplicar às cegas. |
| B3 | **Conferir o job:** `Q "select jobname, schedule, active from cron.job where jobname='ged-indexar-30min'"` | `20,50 11-22 * * 1-5`, `active = false` | Ausente ou `active = true`. Nesse caso desligar na hora com `select cron.alter_job(<jobid>, active := false)`. |
| B4 | **Registrar a migration:** `Q "insert into supabase_migrations.schema_migrations (version, name) values ('0807','ged_agendamento') on conflict do nothing"` | 0801 a 0807 registradas. | — |
| B5 | **Conferir de novo:** repetir B1. | `pronto = true`, com o agendamento inativo. | Qualquer `false`. |

## C. Ligar o interruptor (o job continua inativo)

| # | Passo | Resultado esperado | Parar se |
|---|---|---|---|
| C1 | **Conferir:** repetir B1 imediatamente antes de ligar. | `pronto = true` | Qualquer `false`. |
| C2 | **Ligar:** `Q "update configuracoes set valor='true' where chave='administrativo.ged.indexar'"` | 1 linha alterada. | — |
| C3 | **Conferir que nada rodou sozinho:** `Q "select count(*) from ged_indexacoes"` | `0` | Maior que 0. Desligar com `valor='false'` e investigar. |

## D. Primeira rodada manual

| # | Passo | Resultado esperado | Parar se |
|---|---|---|---|
| D1 | **Disparar:** `Q "select public.ged_chamar_indexacao()"` | Volta um número, que é o id da requisição. | Volta nulo (interruptor ou Vault com problema). |
| D2 | **Resposta da função**, uns 2 minutos depois: `Q "select status_code, content from net._http_response where id = <id>"` (só contagens e códigos; o pg_net guarda a resposta por algumas horas) | 200, com `raizes` contendo 2 itens `tipo:"inicial"`, `resultado:"ok"` e `completa:true`. | 401 (segredo), 404 (URL), timeout, `resultado` diferente de `ok` ou `completa:false` (prazo de 100 s: não disparar de novo, não seguir para E e investigar o tempo, pré-requisito 4). |
| D3 | **Rodadas:** `Q "select tipo, erro, resumo, concluida_em from ged_indexacoes order by iniciada_em"` | 2 rodadas `inicial`, sem erro e concluídas. | `erro` preenchido ou `concluida_em` nulo. |
| D4 | **Pontos de continuação e contagens:** `Q "select r.finalidade, r.page_token is not null tem_token, r.indexada_em, (select count(*) from ged_pastas p where p.raiz_id=r.id) pastas, (select count(*) from ged_documentos d where d.raiz_id=r.id) docs from ged_pastas_raiz r"` | Token presente nas duas raízes. Pastas (menos a raiz) mais documentos perto da verificação: cerca de 814 na elaboração e 1.478 no dossiê. | Sem token, ou diferença maior que 5% sem explicação. |
| D5 | **Trava e conexão:** `Q "select tomada_em from ged_trava"` e `Q "select ultimo_erro from ged_conexao"` | Trava livre e conexão sem erro. | Trava presa ou conexão com erro. |
| D6 | **Logs** (painel do Supabase > Edge Functions > `nucleo-ged-indexar`) | Só linhas `ged-indexacao: tipo=... resultado=... novos=...`. | Qualquer nome, ID ou link no log. |

As consultas de D2 a D5 só leem: não chamam a função, não abrem rodada e não mostram segredo.

**Se algo falhar:** desligar com `Q "update configuracoes set valor='false' where chave='administrativo.ged.indexar'"` (e, se o job já
estiver ativo, `select cron.alter_job(<jobid>, active := false)`). O que já foi gravado continua no banco (o índice nunca apaga), e a
próxima rodada refaz sem duplicar.

## E. Ligar o agendamento (só com D2 a D6 corretos)

- **Comando:** `Q "select cron.alter_job((select jobid from cron.job where jobname='ged-indexar-30min'), active := true)"`
- **Conferir:** no primeiro horário :20 ou :50 de um dia útil, aparece uma rodada `incremental` sem erro e o ponto de continuação avança.
- **Uma semana depois:** conferir a primeira `reconciliacao` (`select tipo, erro, concluida_em from ged_indexacoes where tipo =
  'reconciliacao'`). Com `erro = 'listagem_incompleta'` repetido, desligar o job e avaliar o prazo (pré-requisito 6).
