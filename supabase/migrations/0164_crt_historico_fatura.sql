-- =========================================================
-- Neo Admin — 0164 Cartão de crédito: histórico da fatura nos títulos do Consistem (regras 56 a 60)
--
-- Primeiro uso real (13/10/2026): o borderô (CCFFE065) não filtra pelo portador; filtra pelo HISTÓRICO. Decisões do Alan: um
-- histórico por cartão, cadastrado no Consistem (80 = CARTÃO SICREDI PJ); a troca do portador continua (marca extra); o
-- histórico é só descritivo (não mexe em contabilização). No fechamento, portador e histórico vão juntos no mesmo PUT; os
-- títulos lançados pelo painel já nascem com os dois. Os títulos já trocados só de portador voltam à fila para o histórico.
-- =========================================================

-- 1) Histórico por cartão -----------------------------------------------------------------------------------------------
alter table crt_cartoes add column historico_fatura integer
  constraint crt_cartoes_historico_fatura_ck check (historico_fatura is null or historico_fatura between 1 and 999999999);
comment on column crt_cartoes.historico_fatura is 'Código do histórico do Consistem dos títulos da fatura deste cartão (filtro do borderô CCFFE065). Nulo = não troca o histórico.';
update crt_cartoes set historico_fatura = 80 where codigo = 'SICREDI PJ';

-- 2) Histórico na troca ----------------------------------------------------------------------------------------------------
alter table crt_trocas_portador add column historico_anterior integer, add column historico_novo integer;

create or replace function fn_crt_troca_portador_regras() returns trigger language plpgsql as $$
begin
  if (new.ciclo_id, new.cod_lancamento, new.criado_por, new.criado_em) is distinct from (old.ciclo_id, old.cod_lancamento, old.criado_por, old.criado_em) then
    raise exception 'A troca de portador é imutável (mês, título, quem e quando).';
  end if;
  -- Trocado só volta à fila quando o alvo muda (ex.: o cartão ganhou o histórico da fatura).
  if old.situacao = 'trocado' and not (new.situacao = 'reservado'
       and (new.portador_novo, new.historico_novo) is distinct from (old.portador_novo, old.historico_novo)) then
    raise exception 'O portador deste título já foi trocado no Consistem.';
  end if;
  if new.situacao <> old.situacao and not (
       (old.situacao = 'reservado' and new.situacao in ('enviando', 'erro')) or
       (old.situacao = 'enviando' and new.situacao in ('trocado', 'erro')) or
       (old.situacao in ('erro', 'trocado') and new.situacao = 'reservado')) then
    raise exception 'Mudança de situação inválida: % → %.', old.situacao, new.situacao;
  end if;
  return new;
end $$;

-- 3) Pendência com o histórico -----------------------------------------------------------------------------------------------
create or replace function crt_sincronizar_pendencia_trocas(p_ciclo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo crt_ciclos;
  v_erros int;
  v_portador int;
  v_historico int;
begin
  select * into v_ciclo from crt_ciclos where id = p_ciclo;
  if v_ciclo.id is null then return; end if;
  select count(*), max(portador_novo), max(historico_novo) into v_erros, v_portador, v_historico
    from crt_trocas_portador where ciclo_id = p_ciclo and situacao = 'erro';
  if v_erros = 0 then
    perform crt_encerrar_pendencias(p_ciclo, 'Trocar o banco dos títulos', 'concluida');
  else
    perform crt_abrir_pendencia(v_ciclo, 'Trocar o banco dos títulos da fatura ' || crt_rotulo_ciclo(v_ciclo),
      v_erros || case when v_erros = 1 then ' título da fatura não teve' else ' títulos da fatura não tiveram' end
      || ' o banco trocado para ' || v_portador || coalesce(' e o histórico para ' || v_historico, '')
      || ' no Consistem. Abra o mês e use "Trocar de novo".',
      greatest(v_ciclo.vencimento_nominal, (now() at time zone 'America/Cuiaba')::date));
  end if;
end $$;
revoke all on function crt_sincronizar_pendencia_trocas(uuid) from public, anon, authenticated;

-- 4) Reservar com o histórico (p_titulos ganha "historico_atual") ---------------------------------------------------------
create or replace function crt_reservar_trocas(p_ciclo uuid, p_titulos jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo crt_ciclos;
  v_portador int;
  v_historico int;
  v_lote uuid := gen_random_uuid();
  v_t jsonb;
  v_cod text;
  v_n int := 0;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) troca o banco dos títulos no Consistem.';
  end if;
  if not crt_trocar_portador_ligado() then
    raise exception 'A troca do banco dos títulos no Consistem está desligada (Configurações: financeiro.cartao.trocar_portador_no_erp).';
  end if;
  select * into v_ciclo from crt_ciclos where id = p_ciclo for update;
  if v_ciclo.id is null or v_ciclo.situacao not in ('fechada', 'paga') then
    raise exception 'O banco dos títulos é trocado com o mês fechado.';
  end if;
  select portador_fatura, historico_fatura into v_portador, v_historico from crt_cartoes where codigo = v_ciclo.cartao;
  if v_portador is null then
    raise exception 'O cartão não tem o código do banco da fatura no Consistem (cadastro de cartões).';
  end if;
  if jsonb_typeof(p_titulos) <> 'array' or jsonb_array_length(p_titulos) > 500 then
    raise exception 'Lista de títulos inválida.';
  end if;
  for v_t in select * from jsonb_array_elements(p_titulos) loop
    v_cod := trim(v_t ->> 'cod_lancamento');
    if v_cod is null or v_cod !~ '^\d{1,12}$' then
      raise exception 'Código de lançamento inválido: %.', coalesce(v_cod, '(vazio)');
    end if;
    insert into crt_trocas_portador (ciclo_id, cod_lancamento, num_documento, fornecedor, valor, portador_anterior, portador_novo,
                                     historico_anterior, historico_novo, lote)
    values (p_ciclo, v_cod, left(v_t ->> 'num_documento', 60), left(v_t ->> 'fornecedor', 120), (v_t ->> 'valor')::numeric,
            case when (v_t ->> 'portador_atual') ~ '^\d{1,9}$' then (v_t ->> 'portador_atual')::int end, v_portador,
            case when (v_t ->> 'historico_atual') ~ '^\d{1,9}$' then (v_t ->> 'historico_atual')::int end, v_historico, v_lote)
    on conflict (ciclo_id, cod_lancamento) do update
       set lote = excluded.lote, portador_novo = excluded.portador_novo, historico_novo = excluded.historico_novo,
           situacao = 'reservado', erro = null
     where crt_trocas_portador.situacao in ('erro', 'reservado')
        or (crt_trocas_portador.situacao = 'trocado'
            and (crt_trocas_portador.portador_novo, crt_trocas_portador.historico_novo) is distinct from (excluded.portador_novo, excluded.historico_novo));
    if found then v_n := v_n + 1; end if;
  end loop;
  return case when v_n > 0 then v_lote end;
end $$;
revoke all on function crt_reservar_trocas(uuid, jsonb) from public, anon;
grant execute on function crt_reservar_trocas(uuid, jsonb) to authenticated;

-- 5) Concluir com o histórico anterior --------------------------------------------------------------------------------------
drop function crt_concluir_troca(uuid, boolean, int, jsonb, jsonb, jsonb, text);
create function crt_concluir_troca(p_id uuid, p_trocado boolean, p_portador_anterior int, p_historico_anterior int, p_antes jsonb, p_depois jsonb, p_resposta jsonb, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo uuid;
begin
  update crt_trocas_portador
     set situacao = case when p_trocado then 'trocado'::crt_situacao_troca else 'erro'::crt_situacao_troca end,
         portador_anterior = coalesce(portador_anterior, p_portador_anterior), historico_anterior = coalesce(historico_anterior, p_historico_anterior),
         antes = coalesce(antes, p_antes), depois = p_depois,
         resposta = p_resposta, erro = case when p_trocado then null else coalesce(nullif(trim(p_erro), ''), 'Erro não informado.') end,
         concluido_em = now()
   where id = p_id and situacao = 'enviando'
  returning ciclo_id into v_ciclo;
  if v_ciclo is null then raise exception 'A troca não está em envio.'; end if;
  perform crt_sincronizar_pendencia_trocas(v_ciclo);
end $$;
revoke all on function crt_concluir_troca(uuid, boolean, int, int, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function crt_concluir_troca(uuid, boolean, int, int, jsonb, jsonb, jsonb, text) to service_role;
