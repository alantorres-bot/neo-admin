-- =========================================================
-- Neo Admin — 0172 Financeiro / Comissões: histórico das planilhas e teto por pedido (Fase 1.1)
-- Especificação: docs/modulos/financeiro-comissoes.md (regras 12 e 13).
--
-- 1. Histórico: os meses pagos pelas planilhas "Comissões <Nome> - 2026.xlsx" entram como fechamentos de histórico
--    (já fechados). Com isso a trava por título (uq_fin_com_linhas_paga) passa a conhecer o que foi pago antes do sistema.
--    Título repetido na planilha (já pago em outro mês) entra como lançamento manual, para o total do mês bater com o
--    que foi pago, e fica marcado.
-- 2. Teto: cada linha guarda a unidade de controle (pedido, ou a NF quando não há pedido) e o valor dela; a proposta
--    não deixa a base comissionada de um pedido passar do valor do pedido (calculado no app, regras.ts).
-- =========================================================

alter table fin_com_fechamentos add column historico boolean not null default false;   -- importado das planilhas (já pago)
alter table fin_com_fechamentos add column historico_arquivos text[] not null default '{}';

alter table fin_com_linhas add column cod_pedido text;          -- pedido de venda do título/adiantamento
alter table fin_com_linhas add column teto_chave text;          -- "P:<pedido>" ou "N:<nota>": unidade do teto
alter table fin_com_linhas add column teto_valor numeric(14,2); -- valor do pedido (total − cancelado) ou da NF
alter table fin_com_creditos add column cod_pedido text;        -- coluna "Pedido de Venda" da CCCCI010

-- Fechado não muda — exceto o histórico, gravado só pela função de importação (marca local da transação).
create or replace function fn_fin_com_trava() returns trigger
language plpgsql set search_path = public as $$
declare v_status text; v_hist boolean; v_fech uuid;
begin
  if tg_op = 'DELETE' then v_fech := old.fechamento_id; else v_fech := new.fechamento_id; end if;
  select status, historico into v_status, v_hist from fin_com_fechamentos where id = v_fech;
  if v_status = 'fechado' then
    if v_hist and coalesce(current_setting('fin_com.importando_historico', true), '') = 'on' then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
    -- Única mudança aceita depois de fechado: o próprio fechamento marcando as linhas como fechadas.
    if tg_table_name = 'fin_com_linhas' and tg_op = 'UPDATE' then
      if old.fechada = false and new.fechada = true then return new; end if;
    end if;
    raise exception 'O fechamento deste mês já foi fechado; não pode mais ser alterado.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

/** Mês que só tem histórico não vira fechamento de trabalho. */
create or replace function fin_com_abrir(p_competencia date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_hist boolean;
begin
  perform fin_com_exigir('operador');
  if p_competencia is null or p_competencia > date_trunc('month', now() at time zone 'America/Cuiaba')::date then
    raise exception 'Escolha um mês que já começou.';
  end if;
  select id, historico into v_id, v_hist from fin_com_fechamentos where competencia = date_trunc('month', p_competencia)::date;
  if v_id is not null then return v_id; end if; -- já existe (de trabalho ou de histórico): abre a tela dele
  insert into fin_com_fechamentos (competencia, criado_por) values (date_trunc('month', p_competencia)::date, auth.uid())
  on conflict (competencia) do nothing returning id into v_id;
  if v_id is null then select id into v_id from fin_com_fechamentos where competencia = date_trunc('month', p_competencia)::date; end if;
  return v_id;
end $$;

/**
 * Histórico de um representante num mês (gestor), a partir da aba da planilha anual. Substitui o histórico dele nesse
 * mês. Recusa mês que já tem fechamento de trabalho no sistema. Título já pago (em outro fechamento) a este representante
 * entra como lançamento manual marcado "Repetido", porque foi pago de novo pela planilha.
 * Linhas: [{ origem: 'titulo'|'manual'|'antecipacao', cod_titulo, cod_cliente, nome_cliente, data_pagamento, tipo,
 *            valor_base, percentual, valor_comissao, observacao }]. Devolve quantos títulos vieram repetidos.
 */
create or replace function fin_com_importar_historico(p_competencia date, p_representante text, p_arquivo text, p_linhas jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare f fin_com_fechamentos; v_comp date := date_trunc('month', p_competencia)::date; x record; v_rep integer := 0; v_chave text; v_origem text; v_obs text;
begin
  perform fin_com_exigir('gestor');
  if not exists (select 1 from fin_com_representantes where cod_representante = p_representante) then
    raise exception 'Representante não cadastrado nas comissões.';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then raise exception 'Aba sem linhas.'; end if;
  select * into f from fin_com_fechamentos where competencia = v_comp;
  if f.id is not null and not f.historico then
    raise exception '% já tem fechamento no sistema; o histórico deste mês não foi importado.', to_char(v_comp, 'MM/YYYY');
  end if;
  if f.id is null then
    insert into fin_com_fechamentos (competencia, status, historico, criado_por, fechado_por, fechado_em)
    values (v_comp, 'fechado', true, auth.uid(), auth.uid(), now()) returning * into f;
  end if;
  perform set_config('fin_com.importando_historico', 'on', true);
  delete from fin_com_linhas where fechamento_id = f.id and cod_representante = p_representante;

  for x in select * from jsonb_to_recordset(p_linhas) as y(origem text, cod_titulo text, cod_cliente text, nome_cliente text,
    data_pagamento date, tipo text, valor_base numeric, percentual numeric, valor_comissao numeric, observacao text)
  loop
    v_origem := x.origem; v_obs := x.observacao;
    if v_origem not in ('titulo', 'manual', 'antecipacao') then raise exception 'Linha de histórico inválida.'; end if;
    if v_origem = 'titulo' then
      v_chave := 'T:' || upper(trim(x.cod_titulo));
      if exists (select 1 from fin_com_linhas where cod_representante = p_representante and chave = v_chave and fechada and incluida
                 and origem in ('titulo', 'credito')) then
        select 'Repetido: já pago em ' || to_char(ff.competencia, 'MM/YYYY') into v_obs
        from fin_com_linhas l join fin_com_fechamentos ff on ff.id = l.fechamento_id
        where l.cod_representante = p_representante and l.chave = v_chave and l.fechada and l.incluida limit 1;
        v_origem := 'manual'; v_rep := v_rep + 1;
      end if;
    end if;
    if v_origem <> 'titulo' then v_chave := (case when v_origem = 'antecipacao' then 'A:' else 'M:' end) || gen_random_uuid(); end if;
    insert into fin_com_linhas (fechamento_id, cod_representante, cod_representante_venda, chave, origem, cod_titulo, cod_cliente,
      nome_cliente, data_pagamento, tipo, valor_base, percentual, valor_comissao, observacao, fechada, atualizado_por)
    values (f.id, p_representante, p_representante, v_chave, v_origem, nullif(trim(x.cod_titulo), ''), nullif(trim(x.cod_cliente), ''),
      nullif(trim(x.nome_cliente), ''), x.data_pagamento, coalesce(x.tipo, 'venda'), coalesce(x.valor_base, 0), coalesce(x.percentual, 0),
      coalesce(x.valor_comissao, 0), v_obs, true, auth.uid());
  end loop;

  update fin_com_fechamentos set historico_arquivos = (select array_agg(distinct a) from unnest(historico_arquivos || array[left(p_arquivo, 200)]) as a)
  where id = f.id;
  perform set_config('fin_com.importando_historico', 'off', true);
  return v_rep;
end $$;

/** Substitui os créditos do mês pelos da planilha (data, código do cliente, nome, valor, pedido). */
create or replace function fin_com_importar_creditos(p_id uuid, p_arquivo text, p_creditos jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform fin_com_exigir('operador');
  perform fin_com_em_conferencia(p_id);
  if p_creditos is null or jsonb_typeof(p_creditos) <> 'array' then raise exception 'Planilha sem linhas.'; end if;
  delete from fin_com_creditos where fechamento_id = p_id;
  insert into fin_com_creditos (fechamento_id, linha, data, cod_cliente, nome_cliente, valor, cod_pedido)
  select p_id, x.linha, x.data, x.cod_cliente, x.nome_cliente, x.valor, nullif(trim(x.cod_pedido), '')
  from jsonb_to_recordset(p_creditos) as x(linha integer, data date, cod_cliente text, nome_cliente text, valor numeric, cod_pedido text);
  get diagnostics v_n = row_count;
  update fin_com_fechamentos set creditos_arquivo = left(p_arquivo, 200), creditos_importados_em = now() where id = p_id;
  return v_n;
end $$;

/**
 * Grava a proposta (regras.ts). Igual à 0171, mais o pedido/teto de cada linha e a decisão proposta (incluida/motivo):
 * a linha barrada pelo teto vem excluída com o motivo. Decisão tomada na conferência (atualizado_por preenchido) fica.
 */
create or replace function fin_com_gravar_proposta(p_id uuid, p_linhas jsonb, p_creditos jsonb, p_z_sem_credito jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform fin_com_exigir('operador');
  perform fin_com_em_conferencia(p_id);
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then raise exception 'Proposta inválida.'; end if;

  delete from fin_com_linhas l where l.fechamento_id = p_id and l.origem in ('titulo', 'credito')
    and not exists (select 1 from jsonb_to_recordset(p_linhas) as x(cod_representante text, chave text)
                    where x.cod_representante = l.cod_representante and x.chave = l.chave);

  insert into fin_com_linhas as l (fechamento_id, cod_representante, cod_representante_venda, chave, origem, cod_titulo, cod_cliente, nome_cliente,
    nota_fiscal, data_pagamento, tipo_baixa, tipo, valor_base, percentual, valor_comissao, valor_consistem, observacao,
    cod_pedido, teto_chave, teto_valor, incluida, motivo)
  select p_id, x.cod_representante, x.cod_representante_venda, x.chave, x.origem, x.cod_titulo, x.cod_cliente, x.nome_cliente,
    x.nota_fiscal, x.data_pagamento, x.tipo_baixa, x.tipo, x.valor_base, x.percentual, x.valor_comissao, x.valor_consistem, x.observacao,
    x.cod_pedido, x.teto_chave, x.teto_valor, coalesce(x.incluida, true), case when coalesce(x.incluida, true) then null else x.motivo end
  from jsonb_to_recordset(p_linhas) as x(cod_representante text, cod_representante_venda text, chave text, origem text, cod_titulo text,
    cod_cliente text, nome_cliente text, nota_fiscal text, data_pagamento date, tipo_baixa text, tipo text, valor_base numeric,
    percentual numeric, valor_comissao numeric, valor_consistem numeric, observacao text, cod_pedido text, teto_chave text,
    teto_valor numeric, incluida boolean, motivo text)
  where x.origem in ('titulo', 'credito')
  on conflict (fechamento_id, cod_representante, chave) do update set
    cod_representante_venda = excluded.cod_representante_venda, cod_titulo = excluded.cod_titulo, cod_cliente = excluded.cod_cliente,
    nome_cliente = excluded.nome_cliente, nota_fiscal = excluded.nota_fiscal, data_pagamento = excluded.data_pagamento,
    tipo_baixa = excluded.tipo_baixa, valor_base = excluded.valor_base, valor_consistem = excluded.valor_consistem, observacao = excluded.observacao,
    cod_pedido = excluded.cod_pedido, teto_chave = excluded.teto_chave, teto_valor = excluded.teto_valor,
    -- decisão, tipo e percentual trocados à mão (atualizado_por preenchido) ficam; senão vale o da proposta
    incluida = case when l.atualizado_por is null then excluded.incluida else l.incluida end,
    motivo = case when l.atualizado_por is null then excluded.motivo else l.motivo end,
    tipo = case when l.atualizado_por is null then excluded.tipo else l.tipo end,
    percentual = case when l.atualizado_por is null then excluded.percentual else l.percentual end,
    valor_comissao = round(excluded.valor_base * (case when l.atualizado_por is null then excluded.percentual else l.percentual end) / 100, 2);
  get diagnostics v_n = row_count;

  update fin_com_creditos c set cod_titulo_z = x.cod_titulo_z, cod_representante_sugerido = x.cod_representante_sugerido
  from jsonb_to_recordset(coalesce(p_creditos, '[]')) as x(id uuid, cod_titulo_z text, cod_representante_sugerido text)
  where c.id = x.id and c.fechamento_id = p_id;
  update fin_com_fechamentos set titulos_buscados_em = now(), z_sem_credito = coalesce(p_z_sem_credito, '[]') where id = p_id;
  return v_n;
end $$;

revoke all on function fin_com_importar_historico(date, text, text, jsonb) from public, anon;
grant execute on function fin_com_importar_historico(date, text, text, jsonb) to authenticated;
