#!/usr/bin/env bash
# GED — teste de CONCORRÊNCIA REAL das rodadas (migration 0810), com duas sessões do Postgres ao mesmo tempo.
# SOMENTE no banco local descartável do iniciar.sh (postgresql:///neo). Nunca em produção: o roteiro grava raízes e rodadas FICTÍCIAS
# e liga o interruptor do GED nesse banco.
#   sudo -u postgres bash scripts/local-sem-docker/ged-concorrencia.sh
# Saída: uma linha OK/FALHOU por cenário; código de saída 0 só se todos passarem.
set -euo pipefail
BANCO="${GED_BANCO:-postgresql:///neo}"
case "$BANCO" in postgresql:///neo|postgresql://127.0.0.1*|postgresql://localhost*) ;; *) echo "Recusado: só banco local ($BANCO)"; exit 2;; esac
psql_() { psql "$BANCO" -v ON_ERROR_STOP=1 -qtA "$@"; }
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "OK      $1"; else echo "FALHOU  $1 (esperado: $3; veio: $2)"; falhas=$((falhas+1)); fi; }

# Preparo: duas raízes fictícias ativas, interruptor ligado, trava livre (as raízes reais têm IDs fixos no check da 0804).
psql_ <<'SQL'
update configuracoes set valor = 'true' where chave = 'administrativo.ged.indexar';
insert into ged_pastas_raiz (drive_id, nome, finalidade, area, areas_leitura, area_operacao, situacao, criada_por)
select v.d, 'Raiz ficticia', v.f, 'contratos', '{}', 'contratos', 'ativa', (select id from perfis where admin_geral limit 1)
  from (values ('1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR', 'elaboracao'), ('1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak', 'dossie_cliente')) v(d, f)
on conflict (drive_id) do update set situacao = 'ativa';
update ged_indexacoes set concluida_em = now(), erro = 'teste' where concluida_em is null;
update ged_trava set tomada_em = null, por = null;
SQL
RAIZ=$(psql_ -c "select id from ged_pastas_raiz where finalidade = 'elaboracao'")
OUTRA=$(psql_ -c "select id from ged_pastas_raiz where finalidade = 'dossie_cliente'")

# 1) Duas aberturas ao mesmo tempo: a primeira segura a trava por 3 s; a segunda espera e recebe em_andamento.
( psql_ -c "begin; select ged_iniciar_indexacao('$RAIZ', 'incremental', false, null); select pg_sleep(3); commit;" >/dev/null ) &
sleep 1
R=$(psql_ -c "select ged_iniciar_indexacao('$OUTRA', 'incremental', false, null)" 2>&1 || true); wait
confere "duas aberturas simultâneas: só uma rodada" "$(echo "$R" | grep -o 'ged:em_andamento' || echo "$R")" "ged:em_andamento"
confere "uma rodada aberta" "$(psql_ -c "select count(*) from ged_indexacoes where concluida_em is null")" "1"

# 2) Gravação em curso x recuperação: a recuperação espera a gravação terminar e só então encerra a rodada antiga.
VELHA=$(psql_ -c "select por from ged_trava")
psql_ -c "update ged_trava set tomada_em = now() - interval '16 minutes'"
( psql_ -c "begin; select ged_gravar_indice('$VELHA', '[]', '[]'); select pg_sleep(3); commit;" >/dev/null ) &
sleep 1
INICIO=$(date +%s); NOVA=$(psql_ -c "select ged_iniciar_indexacao('$RAIZ', 'incremental', false, null)"); FIM=$(date +%s); wait
confere "recuperação esperou a gravação (>= 1 s)" "$([ $((FIM-INICIO)) -ge 1 ] && echo sim || echo nao)" "sim"
confere "rodada antiga encerrada como interrompida" "$(psql_ -c "select erro from ged_indexacoes where id = '$VELHA'")" "interrompida"

# 3) Rodada antiga tenta gravar e concluir depois de perder a posse: recusada, token intacto.
TOKEN=$(psql_ -c "select coalesce(page_token, '-') from ged_pastas_raiz where id = '$RAIZ'")
G=$(psql_ -c "select ged_gravar_indice('$VELHA', '[]', '[]')" 2>&1 || true)
C=$(psql_ -c "select ged_concluir_indexacao('$VELHA', '{}', 'tok-velho', null)" 2>&1 || true)
confere "antiga não grava" "$(echo "$G" | grep -o 'ged:rodada_invalida' || echo "$G")" "ged:rodada_invalida"
confere "antiga não conclui" "$(echo "$C" | grep -o 'ged:rodada_invalida' || echo "$C")" "ged:rodada_invalida"
confere "token intacto" "$(psql_ -c "select coalesce(page_token, '-') from ged_pastas_raiz where id = '$RAIZ'")" "$TOKEN"

# 4) Conclusão da dona x nova abertura ao mesmo tempo: nunca duas rodadas abertas.
( psql_ -c "begin; select ged_concluir_indexacao('$NOVA', '{}', null, null); select pg_sleep(2); commit;" >/dev/null ) &
sleep 1
R=$(psql_ -c "select ged_iniciar_indexacao('$OUTRA', 'incremental', false, null)" 2>&1 || true); wait
confere "abertura depois da conclusão: no máximo uma aberta" "$(psql_ -c "select (count(*) <= 1)::text from ged_indexacoes where concluida_em is null")" "true"

psql_ -c "update configuracoes set valor = 'false' where chave = 'administrativo.ged.indexar'"
[ "$falhas" -eq 0 ] && echo "TODOS OK" || { echo "$falhas FALHA(S)"; exit 1; }
