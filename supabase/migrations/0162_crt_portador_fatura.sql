-- =========================================================
-- Neo Admin — 0162 Cartão de crédito: banco (portador) da fatura nos títulos do Consistem
-- Especificação: docs/modulos/financeiro-cartao.md (seção 5, regras 56 a 60).
--
-- Pedido do Alan (13/10/2026): com o Consistem em "Sem Controle" (CCFFB000), o borderô (CCFFE065) mostra todos os títulos em
-- aberto e os da fatura do cartão ficaram misturados com os demais. Cada cartão ganha um código de banco/portador próprio,
-- cadastrado no Consistem; ao FECHAR o mês, o painel troca o portador dos títulos conciliados da fatura para esse código
-- (PUT lancamentoContasPagar/{id} com codPortador, Edge Function crt-trocar-portador), e o financeiro filtra o borderô por ele.
-- Decisões: um código por cartão; a troca nunca volta (nem ao reabrir); os títulos que o painel lança para a fatura (compras,
-- encargos, agrupados) já nascem com o código; o provisório não muda. A chave financeiro.cartao.trocar_portador_no_erp começa
-- desligada: o primeiro envio real é acompanhado pelo Alan.
-- =========================================================

-- 1) Código por cartão e chave geral -------------------------------------------------------------------------------------
alter table crt_cartoes add column portador_fatura integer
  constraint crt_cartoes_portador_fatura_ck check (portador_fatura is null or portador_fatura between 1 and 999999999);
comment on column crt_cartoes.portador_fatura is 'Código do banco/portador do Consistem dos títulos da fatura deste cartão (filtro do borderô). Nulo = não troca.';

insert into configuracoes (chave, valor, descricao) values
  ('financeiro.cartao.trocar_portador_no_erp', 'false',
   'Cartão de crédito: ao fechar o mês, troca no Consistem o portador dos títulos da fatura para o código do cartão (crt_cartoes.portador_fatura). Desligado = nada é alterado no ERP.')
on conflict (chave) do nothing;

create function crt_trocar_portador_ligado() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select valor from configuracoes where chave = 'financeiro.cartao.trocar_portador_no_erp'), 'false'::jsonb) = 'true'::jsonb
$$;

-- 2) Trocas feitas no Consistem (prova) ------------------------------------------------------------------------------------
create type crt_situacao_troca as enum ('reservado', 'enviando', 'trocado', 'erro');

create table crt_trocas_portador (
  id uuid primary key default gen_random_uuid(),
  ciclo_id uuid not null references crt_ciclos(id),
  cod_lancamento text not null check (cod_lancamento ~ '^\d{1,12}$'),
  num_documento text,
  fornecedor text,
  valor numeric(14,2),
  portador_anterior integer,                               -- lido do Consistem antes da troca
  portador_novo integer not null,
  lote uuid not null,                                      -- envio atual (muda ao tentar de novo)
  situacao crt_situacao_troca not null default 'reservado',
  antes jsonb,                                             -- detalhe do lançamento antes do PUT
  depois jsonb,                                            -- detalhe depois do PUT (conferência)
  resposta jsonb,
  erro text,
  tentativas int not null default 0,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  concluido_em timestamptz,
  unique (ciclo_id, cod_lancamento)
);
comment on table crt_trocas_portador is 'Troca do portador dos títulos da fatura do cartão no Consistem (um por título e mês): antes, depois, resposta e quem. Nunca apagadas.';
create index idx_crt_trocas_portador_lote on crt_trocas_portador (lote);

create function fn_crt_troca_portador_regras() returns trigger language plpgsql as $$
begin
  if (new.ciclo_id, new.cod_lancamento, new.criado_por, new.criado_em) is distinct from (old.ciclo_id, old.cod_lancamento, old.criado_por, old.criado_em) then
    raise exception 'A troca de portador é imutável (mês, título, quem e quando).';
  end if;
  if old.situacao = 'trocado' then
    raise exception 'O portador deste título já foi trocado no Consistem.';
  end if;
  if new.situacao <> old.situacao and not (
       (old.situacao = 'reservado' and new.situacao in ('enviando', 'erro')) or
       (old.situacao = 'enviando' and new.situacao in ('trocado', 'erro')) or
       (old.situacao = 'erro' and new.situacao = 'reservado')) then
    raise exception 'Mudança de situação inválida: % → %.', old.situacao, new.situacao;
  end if;
  return new;
end $$;
create trigger trg_crt_trocas_portador_regras before update on crt_trocas_portador for each row execute function fn_crt_troca_portador_regras();
create trigger trg_crt_trocas_portador_sem_delete before delete on crt_trocas_portador for each row execute function fn_bloquear_delete();
create trigger trg_aud_crt_trocas_portador after insert or update on crt_trocas_portador for each row execute function fn_auditoria();

alter table crt_trocas_portador enable row level security;
create policy crt_trocas_portador_ler on crt_trocas_portador for select to authenticated using (tem_acesso_area('financeiro'));

-- 3) Pendência "Trocar o banco dos títulos" (uso interno): aberta enquanto houver erro, concluída quando não houver ---------
create function crt_sincronizar_pendencia_trocas(p_ciclo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo crt_ciclos;
  v_erros int;
  v_portador int;
begin
  select * into v_ciclo from crt_ciclos where id = p_ciclo;
  if v_ciclo.id is null then return; end if;
  select count(*), max(portador_novo) into v_erros, v_portador from crt_trocas_portador where ciclo_id = p_ciclo and situacao = 'erro';
  if v_erros = 0 then
    perform crt_encerrar_pendencias(p_ciclo, 'Trocar o banco dos títulos', 'concluida');
  else
    perform crt_abrir_pendencia(v_ciclo, 'Trocar o banco dos títulos da fatura ' || crt_rotulo_ciclo(v_ciclo),
      v_erros || case when v_erros = 1 then ' título da fatura não teve' else ' títulos da fatura não tiveram' end
      || ' o banco trocado para ' || v_portador || ' no Consistem. Abra o mês e use "Trocar de novo".',
      greatest(v_ciclo.vencimento_nominal, (now() at time zone 'America/Cuiaba')::date));
  end if;
end $$;
revoke all on function crt_sincronizar_pendencia_trocas(uuid) from public, anon, authenticated;

-- 4) Reservar (painel; operador ou acima), com o mês fechado ou pago -------------------------------------------------------
-- p_titulos: [{ "cod_lancamento": "33626", "num_documento": "...", "fornecedor": "...", "valor": 12.34, "portador_atual": 91 }]
-- Título já trocado fica como está; o que deu erro (ou ficou reservado) entra no lote novo. Devolve o lote, ou nulo se nada.
create function crt_reservar_trocas(p_ciclo uuid, p_titulos jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo crt_ciclos;
  v_portador int;
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
  select portador_fatura into v_portador from crt_cartoes where codigo = v_ciclo.cartao;
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
    insert into crt_trocas_portador (ciclo_id, cod_lancamento, num_documento, fornecedor, valor, portador_anterior, portador_novo, lote)
    values (p_ciclo, v_cod, left(v_t ->> 'num_documento', 60), left(v_t ->> 'fornecedor', 120), (v_t ->> 'valor')::numeric,
            case when (v_t ->> 'portador_atual') ~ '^\d{1,9}$' then (v_t ->> 'portador_atual')::int end, v_portador, v_lote)
    on conflict (ciclo_id, cod_lancamento) do update
       set lote = excluded.lote, portador_novo = excluded.portador_novo, situacao = 'reservado', erro = null
     where crt_trocas_portador.situacao in ('erro', 'reservado');
    if found then v_n := v_n + 1; end if;
  end loop;
  return case when v_n > 0 then v_lote end;
end $$;
revoke all on function crt_reservar_trocas(uuid, jsonb) from public, anon;
grant execute on function crt_reservar_trocas(uuid, jsonb) to authenticated;

-- 5) Envio (Edge Function, service role) -----------------------------------------------------------------------------------
create function crt_iniciar_troca(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update crt_trocas_portador set situacao = 'enviando', tentativas = tentativas + 1, enviado_em = now() where id = p_id and situacao = 'reservado';
  if not found then raise exception 'A troca não está reservada.'; end if;
end $$;

create function crt_concluir_troca(p_id uuid, p_trocado boolean, p_portador_anterior int, p_antes jsonb, p_depois jsonb, p_resposta jsonb, p_erro text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo uuid;
begin
  update crt_trocas_portador
     set situacao = case when p_trocado then 'trocado'::crt_situacao_troca else 'erro'::crt_situacao_troca end,
         portador_anterior = coalesce(p_portador_anterior, portador_anterior), antes = coalesce(p_antes, antes), depois = p_depois,
         resposta = p_resposta, erro = case when p_trocado then null else coalesce(nullif(trim(p_erro), ''), 'Erro não informado.') end,
         concluido_em = now()
   where id = p_id and situacao = 'enviando'
  returning ciclo_id into v_ciclo;
  if v_ciclo is null then raise exception 'A troca não está em envio.'; end if;
  perform crt_sincronizar_pendencia_trocas(v_ciclo);
end $$;

create function crt_interromper_trocas(p_lote uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ciclo uuid;
begin
  select ciclo_id into v_ciclo from crt_trocas_portador where lote = p_lote limit 1;
  update crt_trocas_portador set situacao = 'erro', erro = p_motivo, concluido_em = now() where lote = p_lote and situacao = 'reservado';
  if v_ciclo is not null then perform crt_sincronizar_pendencia_trocas(v_ciclo); end if;
end $$;

revoke all on function crt_iniciar_troca(uuid) from public, anon, authenticated;
revoke all on function crt_concluir_troca(uuid, boolean, int, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function crt_interromper_trocas(uuid, text) from public, anon, authenticated;
grant execute on function crt_iniciar_troca(uuid) to service_role;
grant execute on function crt_concluir_troca(uuid, boolean, int, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function crt_interromper_trocas(uuid, text) to service_role;

-- Painel (operador): a função não respondeu e o lote ficou reservado → vira erro e abre a pendência.
create function crt_falha_trocas(p_lote uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima).';
  end if;
  perform crt_interromper_trocas(p_lote, left(coalesce(nullif(trim(p_motivo), ''), 'Envio não concluído.'), 500));
end $$;
revoke all on function crt_falha_trocas(uuid, text) from public, anon;
grant execute on function crt_falha_trocas(uuid, text) to authenticated;
