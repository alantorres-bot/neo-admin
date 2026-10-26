# GED — arquitetura da indexação (estado do código em 26/10/2026)

Especificação: `docs/modulos/administrativo-ged.md`. Operação: `docs/GED_PRIMEIRA_INDEXACAO.md`. Este documento descreve o que o
código faz hoje, conferido nos arquivos citados; o que não está aqui não existe.

## Peças

| Peça | Onde | Papel |
|---|---|---|
| Agendamento | `0807_ged_agendamento.sql`: job `ged-indexar-30min` (pg_cron, UTC `20,50 11-22 * * 1-5` = 07h20–18h50 de Cuiabá) | Chama `ged_chamar_indexacao()`. Nasce **inativo**. |
| Chamadora | `ged_chamar_indexacao()` (0807) | Interruptor desligado: não faz nada. Ligado: `net.http_post` para a URL do Vault (`rec_sincronizar_url`, trocando o nome da função) com o cabeçalho `x-sincronizacao-segredo` (Vault `rec_sincronizar_segredo`), espera até 150 s. Ninguém além do `postgres` executa. |
| Edge Function | `supabase/functions/nucleo-ged-indexar/index.ts` → `tratarIndexacao` em `_shared/ged.ts` | Confere o segredo (`SINCRONIZACAO_SEGREDO`, comparação em tempo constante; menos de 32 caracteres = recusa), lê as raízes ativas e processa uma por vez. Sem chamada por usuário (PENDENTE 16). |
| Rodada | `ged_iniciar_indexacao` / `ged_gravar_indice` / `ged_concluir_indexacao` (0806, endurecidas na 0810) | Abrir, gravar e concluir, com a posse da trava. Só a service role executa. |
| Estado do índice | `ged_estado_indice` (0806) | Pastas e documentos da raiz no formato da camada pura, numa chamada (sem teto de linhas da API). |
| Camada pura | `_shared/ged.ts`: `cargaInicial`, `percorrerArvore`, `listarPasta`, `percorrerMudancas`, `aplicarMudanca`, `ausentesNaListagem`, `consultarAusente`, `loteParaGravar` | Decide o que gravar a partir dos metadados do Drive. Não grava nem lê conteúdo. |
| Cliente do Drive | `criarClienteDrive` | Só `GET` na Drive API v3 (outro método ou outro host = erro). Repete 429 e 5xx até 4 vezes (1 s, 2 s, 4 s). |
| Leitura | RLS de `ged_pastas`, `ged_documentos`, `ged_documento_revisoes` = `ged_pode_ler_raiz` = **só admin geral** (0809); `ged_raizes()` e `ged_indexacoes_visiveis()` (projeções) | Tela `/documentos` (`exigirAdminGeral`). |

## Fluxo de uma chamada

1. **Entrada:** POST com o segredo; senão 401 sem tocar no banco nem no Google.
2. **Para cada raiz ativa** (`ged_pastas_raiz.situacao = 'ativa'`, em ordem de finalidade):
   1. tipo: sem ponto de continuação = `inicial`; com ponto e última carga ou reconciliação há 7 dias ou mais = `reconciliacao`; senão
      `incremental` (`tipoDaRodada`);
   2. `ged_iniciar_indexacao` confere interruptor, raiz ativa, tipo e o bloqueio por interrupções seguidas; trava a linha de
      `ged_trava`; recupera trava esquecida (encerra a dona como `interrompida`); abre a rodada e assume a trava. Recusas:
      `indexacao_desligada` e `em_andamento` param a chamada inteira **antes de qualquer chamada ao Google**; `raiz_inativa` e
      `interrupcoes_seguidas` pulam só aquela raiz;
   3. acesso ao Drive (token do Vault renovado; `invalid_grant` marca a conexão com erro e para tudo);
   4. estado do índice → leitura do Drive (só metadados: `CAMPOS_ARQUIVO`) → decisão em memória (`aplicarPaginaNoIndice`);
   5. gravação em lotes de 500 documentos (pastas no primeiro), idempotente pelo `drive_id`; revisão nova só quando a revisão do
      Drive muda; `substituido` (decisão de pessoa) nunca é sobrescrito; nada é apagado;
   6. `ged_concluir_indexacao` grava o resumo e, só sem erro, o ponto de continuação; solta a trava.
3. **Resposta e log:** só contagens e códigos (`ged-indexacao: tipo=… resultado=… itens=… novos=…`).

| Tipo | Leitura | Ponto de continuação |
|---|---|---|
| `inicial` | `startPageToken` **antes** de ler; árvore em largura até a profundidade 4, 5 pastas por vez, prazo de 100 s, até 5.000 itens | Gravado só se a leitura foi completa. Incompleta: token nulo e a próxima rodada refaz a carga (sem duplicar). |
| `incremental` | `changes.list` do Drive compartilhado, página por página; cada página é gravada antes da seguinte | O `newStartPageToken` (fim) ou o da página seguinte (limite de 5.000 itens). |
| `reconciliacao` | árvore inteira; cada item indexado que não apareceu é consultado (`files.get`; 404 = removido) | Não muda; registra `reconciliada_em`. Leitura incompleta = falha `listagem_incompleta` (nada é marcado como sumido). |

## Garantias (e onde estão testadas)

| Garantia | Mecanismo | Teste |
|---|---|---|
| Uma rodada válida por vez | `for update` na linha da trava; trava com menos de 15 min = `em_andamento` | `tests/db/ged-indice.test.ts` (sequencial); `scripts/local-sem-docker/ged-concorrencia.sh` (duas sessões, ambiente isolado) |
| Rodada que perdeu a posse não grava, não conclui, não avança token | `gravar` exige ser dona (`for share`); `concluir` exige ser dona (`for update`) e estar aberta | `ged-indice.test.ts` (rodada antiga, órfã) |
| Recuperação atômica | encerrar a antiga e abrir a nova na mesma transação | `ged-indice.test.ts` (falha forçada no meio: nada muda) |
| Sem repetição perigosa | 3 rodadas encerradas como `interrompida` em 24 h = a raiz não abre rodada (as outras seguem) | `ged-indice.test.ts`, `ged-indexacao.test.ts` |
| Repetir não duplica | `on conflict (drive_id)`; pasta repetida no lote: vale a última; revisão `on conflict do nothing` | `ged-indice.test.ts`, `ged-indexacao.test.ts` |
| Token só depois dos dados | concluir só é chamado depois de todas as gravações; falha em qualquer etapa fecha a rodada com erro e sem token | `ged-indexacao.test.ts` (falha no meio do `changes.list`; falha na conclusão) |
| Item movido entre raízes | `raiz_divergente` até a raiz antiga marcá-lo fora do escopo; depois muda de raiz | `ged-indice.test.ts` |
| Segredo não vaza | comparação em tempo constante; resposta e log só com códigos; `ged-conferir-segredo.mjs` compara só resumos | `ged-indexacao.test.ts` (log), `tests/scripts/ged-conferir-segredo.test.ts` |
| Só metadados | campos fixos; cliente só `GET`; teste reprova `alt=media` e `export` | `ged-indexacao.test.ts`, `drive-http.test.ts` |

## Observabilidade

- `ged_indexacoes`: início, fim, tipo, `erro` (só código) e `resumo` = `{itens, completa, novos, alterados, removidos, ignorados,
  pastas}` na conclusão, ou `{completa: false, etapa}` na falha (`acesso_drive`, `estado_indice`, `leitura_drive`, `gravacao`, `conclusao`).
- `scripts/ged-diagnostico.sql`: estado de cada rodada (`em_andamento`, `esquecida`, `orfa`, `interrompida`, `falha`, `incompleta`,
  `concluida`) e checagens de consistência por raiz.
- `scripts/ged-verificar-agendamento.sql`: job, horário, comando, privilégios, interruptor e últimas execuções do pg_cron.
- `scripts/ged-conferir-assinaturas.mjs`: o que está instalado em produção x o que as migrations produzem.

## Pontos de falha conhecidos

| Falha | Efeito | Tratamento |
|---|---|---|
| Função morre no meio (tempo máximo) | rodada aberta, trava presa | Depois de 15 min, a próxima chamada encerra como `interrompida`. Três seguidas em 24 h param a raiz. |
| pg_net desiste em 150 s | resposta `timed_out`; a função pode continuar | Procedimento: olhar as rodadas (D3) e nunca disparar de novo por causa do timeout. |
| Carga inicial que nunca cabe em 100 s | cada rodada refaz a carga e não termina | Fica `incompleta` (diagnóstico). Sem correção automática: exige revisar o prazo. |
| Reconciliação sempre incompleta | a raiz não volta ao incremental | Falha `listagem_incompleta` repetida (diagnóstico); desligar o job e revisar. |
| `invalid_grant` | conexão com erro | Reconectar em Configurações > Google Drive. |
| Extração de conteúdo | **não existe** | O GED só guarda metadados (5.9.5). |
