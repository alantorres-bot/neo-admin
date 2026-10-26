# GED — publicação e primeira indexação (procedimento operacional)

Arquitetura e garantias: `docs/GED_ARQUITETURA.md`. Especificação: `docs/modulos/administrativo-ged.md`.

**Cada bloco (P, A, B, C, D, E) precisa de autorização própria do responsável.** Autorizar um bloco não autoriza o seguinte.

```
Q   = npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no
REF = chdszjpbtfpstjrqnmmm
```

Ferramentas (todas só leitura, nenhuma chama o Google nem a função):

| Comando | Para quê |
|---|---|
| `node scripts/ged-conferir-assinaturas.mjs --ref REF` | Funções, privilégios, RLS e políticas do GED em produção x repositório. Saída 0 = tudo OK; 1 = diferenças (listadas); 2 = não conferiu. |
| `node scripts/ged-conferir-segredo.mjs --ref REF` | Segredo do agendamento (Vault) x `SINCRONIZACAO_SEGREDO`, só por resumo SHA-256. `IGUAL` (0), `DIFERENTE` (1), `NAO_COMPROVADO` (2). |
| `Q -f scripts/ged-primeira-indexacao.sql` | Conferência prévia: `pronto`. |
| `Q -f scripts/ged-verificar-agendamento.sql` | Job, horário, comando, privilégios, interruptor e últimas execuções. |
| `Q -f scripts/ged-diagnostico.sql` | Estado de cada rodada e consistência por raiz. |

## Regras de migration (valem para P e B)

1. **Antes:** `ged-conferir-assinaturas` mostra exatamente as diferenças que a migration corrige, e nenhuma outra.
2. **Aplicar:** `Q -f supabase/migrations/<arquivo>.sql`. A CLI envia o arquivo inteiro de uma vez, mas não está comprovado que ela o
   execute numa transação só; por isso o que vale é a conferência do item 3, nunca a ausência de erro.
3. **Conferir a definição instalada:** `ged-conferir-assinaturas` de novo. As diferenças da migration sumiram.
4. **Registrar a versão só depois do item 3:** `Q "insert into supabase_migrations.schema_migrations (version, name) values ('<NNNN>','<nome>') on conflict do nothing"`. O registro não prova que a migration foi aplicada; a prova é o item 3.
5. **O SQL entrou, mas o registro falhou:** repetir o item 3 (deve continuar OK) e repetir só o insert. Não reaplicar o SQL.
6. **O SQL falhou:** o item 3 mostra as diferenças de antes. Não registrar, não reaplicar às cegas; investigar o erro.
7. **Registro existe, mas a definição diverge:** parar. Algo mudou a função depois; investigar antes de seguir.

## P. Publicar o código desta etapa (sem indexar)

| # | Passo | Esperado | Parar se |
|---|---|---|---|
| P1 | Commit e push dos arquivos da etapa. | Branch igual à remota. | — |
| P2 | **Edge Function:** `npx supabase functions deploy nucleo-ged-indexar --project-ref REF --no-verify-jwt`. Compatível com o banco de antes e de depois da 0810. | Nova versão publicada; `curl -s -X POST https://REF.supabase.co/functions/v1/nucleo-ged-indexar` responde `{"erro":"nao_autorizado"}` (401). | Qualquer outra resposta. |
| P3 | **0810, antes:** `ged-conferir-assinaturas`. | Só `AUSENTE ged_chamar_indexacao()` (0807) e `DIVERGENTE [corpo_md5]` em `ged_iniciar_indexacao`, `ged_gravar_indice` e `ged_concluir_indexacao`. | Qualquer outra diferença. |
| P4 | **0810, aplicar:** `Q -f supabase/migrations/0810_ged_rodada_interrompida.sql` | Sem erro. | Erro (regra 6). |
| P5 | **0810, conferir:** `ged-conferir-assinaturas`. | Só `AUSENTE ged_chamar_indexacao()`. | As três ainda divergentes (regra 6) ou outra diferença. |
| P6 | **0810, registrar:** `Q "insert into supabase_migrations.schema_migrations (version, name) values ('0810','ged_rodada_interrompida') on conflict do nothing"` | A lista final do script traz 0810. | — (falhou: regra 5) |

**Reversão (não validada em produção):** a 0810 só substitui três funções. Voltar ao comportamento anterior = aplicar de novo o texto
dessas três funções da `0806_ged_indice.sql` como `create or replace`. Isso reabre os defeitos que a 0810 corrige; só faz sentido se a
0810 der problema. A Edge Function volta com `git checkout 35cd4b6 -- supabase/functions` e deploy (depois restaurar o arquivo).

## A. PENDENTE 12 (sem nada em produção)

| # | Passo | Esperado | Parar se |
|---|---|---|---|
| A1 | Resposta do administrador do Workspace: membros do Drive compartilhado `0ADGzgMWcDLTWUk9PVA` e a decisão "a elaboração precisa ou não de permissões próprias". | Lista e decisão, com data e nome de quem respondeu. | Resposta parcial ou sem decisão. |
| A2 | Comparar com a especificação (5.11.8 e item 12 da seção 14). | Ou os membros fora de Contratos são aceitos pelo responsável, ou a restrição exigida já foi aplicada no Drive. | Alguém que não deveria ver a elaboração continua com acesso no Drive. |
| A3 | Registrar a resposta no item 12 da seção 14 e no item 8 da 5.11; commit. | Pendente 12 decidido, com data. | — |

## B. Agendamento (0807), criado inativo

| # | Passo | Esperado | Parar se |
|---|---|---|---|
| B0 | `git log -1 --format=%h -- docs/modulos/administrativo-ged.md` e ler o item 12 da seção 14. | O commit do A3 existe e o item diz decidido. | Item em aberto. |
| B1 | `node scripts/ged-conferir-segredo.mjs --ref REF` | `IGUAL` | `DIFERENTE` ou `NAO_COMPROVADO`. Resposta 200 de outra rotina não é prova. |
| B2 | `Q -f scripts/ged-primeira-indexacao.sql` | `pronto = true`, `interruptor_ainda_desligado = true` | Qualquer outro. |
| B3 | **Antes:** `ged-conferir-assinaturas` | Só `AUSENTE ged_chamar_indexacao()` (P concluído). | Outra diferença (P5 não foi feito?). |
| B4 | **Aplicar:** `Q -f supabase/migrations/0807_ged_agendamento.sql` | Sem erro. | Erro (regra 6). |
| B5 | **Conferir:** `ged-conferir-assinaturas` e `Q -f scripts/ged-verificar-agendamento.sql` | Assinaturas: tudo OK. Agendamento: `jobs_ged = 1`, `ativo = false`, `horario_utc = 20,50 11-22 * * 1-5`, `comando = select public.ged_chamar_indexacao()`, `chamadora_fechada_a_usuarios = true`. | `ativo = true`: desligar na hora com `Q "select cron.alter_job((select jobid from cron.job where jobname='ged-indexar-30min'), active := false)"` e investigar. |
| B6 | **Registrar:** `Q "insert into supabase_migrations.schema_migrations (version, name) values ('0807','ged_agendamento') on conflict do nothing"` | 0807 na lista. | — (falhou: regra 5) |

**Reversão (não validada em produção):** `Q "select cron.unschedule('ged-indexar-30min')"` e `Q "drop function ged_chamar_indexacao()"`.

## C. Ligar o interruptor (o job continua inativo)

| # | Passo | Esperado | Parar se |
|---|---|---|---|
| C1 | Repetir B1 e B2 imediatamente antes. | `IGUAL`; `pronto = true`. | Qualquer outro. |
| C2 | `Q "update configuracoes set valor='true' where chave='administrativo.ged.indexar'"` | 1 linha. | — |
| C3 | `Q "select count(*) from ged_indexacoes"` | `0` (nada rodou sozinho). | Maior que 0: desligar (C2 com `'false'`) e investigar. |

## D. Primeira rodada manual (uma chamada, sem repetir)

| # | Passo | Esperado | Parar se |
|---|---|---|---|
| D1 | `Q "select public.ged_chamar_indexacao()"` — **uma vez**. Anotar o número devolvido. | Um número (id da requisição). | Nulo: interruptor ou Vault (conferir C2 e B2). |
| D2 | Uns 2 minutos depois: `Q "select status_code, timed_out, content from net._http_response where id = <id>"`. O pg_net guarda 6 h. | `status_code = 200`; em `content`, 2 itens com `tipo:"inicial"`, `resultado:"ok"`, `completa:true` e `itens`. | 401 (segredo), 404 (URL), `resultado` diferente de `ok`, `completa:false`. **Timeout, `timed_out = true` ou linha vazia: ir para "Timeout ou sem resposta".** |
| D3 | `Q -f scripts/ged-diagnostico.sql` | As 2 rodadas `concluida`, com `itens`; por raiz: `tem_ponto_de_continuacao = true`, `rodadas_abertas = 0` e as três colunas de inconsistência `false`. | Qualquer `falha`, `incompleta`, `interrompida` ou inconsistência. |
| D4 | Contagem: na 2ª consulta do D3, `pastas - 1 + documentos` de cada raiz. | Perto da última verificação: cerca de 814 (elaboração) e 1.478 (dossiê). | Diferença maior que 5% sem explicação. |
| D5 | `Q "select ultimo_erro from ged_conexao"` | Nulo. | Preenchido. |
| D6 | Tela `/documentos` como admin geral: buscar `229`. | Arquivos das duas raízes, com "Abrir no Drive". | Erro ou vazio para um nome que existe. |
| D7 | Painel do Supabase > Edge Functions > `nucleo-ged-indexar` > Logs. | Só `ged-indexacao: tipo=… resultado=… itens=… novos=…`. | Qualquer nome, ID, link ou segredo. |

### Timeout ou sem resposta no D2

O pg_net desiste em 150 s; a função pode continuar. **Nunca disparar outra chamada por causa de timeout.**

1. Rodar o D3 e olhar as rodadas desta tentativa:
   - `em_andamento`: a função ainda está rodando. Esperar e repetir **só o D3** (leitura);
   - todas `concluida`: terminou; seguir do D4;
   - `falha` ou `incompleta`: o token daquela raiz não avançou (na carga inicial). Parar; a coluna `etapa` diz onde parou;
   - `esquecida` (aberta há 15 min ou mais): a função morreu no meio. Parar e investigar nos logs (D7).
2. **Nova tentativa** (autorização própria): repetir C1. Com `pronto = true`, fazer o D1 de novo, **uma vez**. Se havia uma rodada
   `esquecida`, essa chamada a encerra como `interrompida` e começa outra (0810); o que já foi gravado fica, nada duplica, e só a raiz
   que não terminou é refeita. Raiz já carregada segue no incremental.
3. **Três `interrompida` seguidas da mesma raiz em 24 h:** a raiz deixa de abrir rodada (`interrupcoes_seguidas`) até passarem 24 h. Não
   insistir; investigar o tempo (limite da Edge Function e prazo de 100 s).

**Parar a qualquer momento:** `Q "update configuracoes set valor='false' where chave='administrativo.ged.indexar'"` (e, se o job estiver
ativo, o comando de desligar do B5). Nenhuma rodada nova começa; o que foi gravado continua (o índice nunca apaga).

## E. Ligar o agendamento (só com D2 a D7 corretos)

| # | Passo | Esperado | Parar se |
|---|---|---|---|
| E1 | `Q "select cron.alter_job((select jobid from cron.job where jobname='ged-indexar-30min'), active := true)"` | `ged-verificar-agendamento`: `ativo = true`. | — |
| E2 | Depois do primeiro :20 ou :50 de um dia útil: `ged-verificar-agendamento` e `ged-diagnostico`. | `ultimas_execucoes_do_job` com `succeeded`; nova rodada `incremental` `concluida`. | `failed`, ou rodada `falha`: desligar o job (B5) e investigar. |
| E3 | Uma semana depois: `ged-diagnostico`. | A primeira `reconciliacao` `concluida`. | `falha` com `listagem_incompleta` repetida: desligar o job e revisar o prazo. |

## O que está comprovado e o que não está

| Item | Situação |
|---|---|
| Funções, privilégios, RLS e políticas já aplicados (0801–0806, 0808, 0809) = repositório | Comprovado em produção (`ged-conferir-assinaturas`, 26/10/2026) |
| URL da chamadora = `.../functions/v1/nucleo-ged-indexar`; 401 sem segredo | Comprovado em produção (26/10/2026) |
| Segredo do Vault = `SINCRONIZACAO_SEGREDO` | Comprovado em produção pelos resumos (26/10/2026); refazer no B1 |
| pg_cron aceita criar o job e desligá-lo na mesma transação | Preparado: pg_cron 1.6.4 tem o parâmetro `active`; só se prova no B4 |
| Recuperação, posse da trava, idempotência, resumo e diagnóstico | Comprovado localmente (testes); concorrência real só no roteiro `scripts/local-sem-docker/ged-concorrencia.sh` |
| Carga das duas raízes cabe no tempo | Não comprovado: só na primeira rodada (D2/D3) |
| `changes.list` e `startPageToken` do Drive compartilhado real | Não comprovado: só na primeira rodada e no E2 |
