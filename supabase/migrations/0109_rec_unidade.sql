-- =========================================================
-- Neo Admin — 0109 Matriz e Filial Contagem
-- O Consistem lista os títulos das duas unidades juntos (mesma empresa na API). A forma de cobrança é diferente em cada
-- uma, então o Neo Admin separa: título cujo documento começa com 4 é da Filial Contagem; os demais são da Matriz.
-- 1) rec_titulos.unidade (coluna calculada pelo documento: 'matriz' ou 'contagem'); a view é recriada para incluí-la.
-- 2) As pendências "Cobrar D+n", "Confirmar pagamento" e "Ligar para confirmar pagamento" passam a ser abertas por
--    cliente E unidade; as da Filial Contagem levam "(Filial Contagem)" no título. As funções de registro só aceitam
--    parcelas de uma unidade e só concluem as pendências daquela unidade.
-- =========================================================

alter table rec_titulos
  add column unidade text generated always as (case when documento like '4%' then 'contagem' else 'matriz' end) stored;
create index idx_rec_titulos_unidade on rec_titulos (unidade) where estagio not in ('pago','renegociado','cancelado');

-- Mesmo corpo da 0107 + a coluna nova (a view guarda a lista de colunas da época em que foi criada).
drop view rec_vw_titulos;
create view rec_vw_titulos with (security_invoker = true) as
with hoje as (select (now() at time zone 'America/Cuiaba')::date as d)
select t.*,
  greatest(h.d - t.vencimento, 0) as dias_atraso,
  case
    when t.estagio in ('pago','renegociado','cancelado') then 'encerrado'
    when h.d <= t.vencimento then 'a_vencer'
    when h.d - t.vencimento <= 15 then '01_15'
    when h.d - t.vencimento <= 30 then '16_30'
    when h.d - t.vencimento <= 60 then '31_60'
    else '60_mais'
  end as faixa,
  round(t.valor + case when h.d > t.vencimento then
      t.valor * coalesce(c.multa_pct, 2) / 100
      + t.valor * coalesce(c.juros_mes_pct, 2) / 100 / 30 * (h.d - t.vencimento)
    else 0 end, 2) as valor_atualizado
from rec_titulos t
cross join hoje h
left join rec_contratos c on c.id = t.contrato_id;

-- Confirmação de pagamento (0106) com a unidade ----------------------------------------------------------------------
create or replace function rec_registrar_confirmacao(p_titulos uuid[], p_resultado text, p_canal canal default 'whatsapp', p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_qtd int;
  v_clientes int;
  v_unidades int;
  v_unidade text;
  v_cliente uuid;
  v_nome text;
  v_venc date;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_atualizados int;
  v_concluidas int := 0;
  v_ligar int := 0;
  v_titulo_ligar text;
begin
  if p_resultado not in ('confirmou', 'sem_resposta') then
    raise exception 'Resultado inválido.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_titulos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos uma parcela.';
  end if;

  select count(*), count(distinct contraparte_id), min(contraparte_id::text)::uuid, min(vencimento), count(distinct unidade), min(unidade)
    into v_qtd, v_clientes, v_cliente, v_venc, v_unidades, v_unidade
    from rec_titulos
   where id = any(v_ids) and estagio in ('importado', 'aguardando_boleto', 'boleto_enviado');
  if v_qtd <> cardinality(v_ids) then
    raise exception 'Uma das parcelas já foi confirmada, paga ou encerrada (ou você não tem acesso a ela).';
  end if;
  if v_clientes <> 1 then
    raise exception 'As parcelas precisam ser do mesmo cliente.';
  end if;
  if v_unidades <> 1 then
    raise exception 'As parcelas precisam ser da mesma unidade (Matriz ou Filial Contagem).';
  end if;
  select nome into v_nome from contrapartes where id = v_cliente;

  if p_resultado = 'confirmou' then
    update rec_titulos set estagio = 'confirmado_cliente'
     where id = any(v_ids) and estagio in ('importado', 'aguardando_boleto', 'boleto_enviado');
    get diagnostics v_atualizados = row_count;
    if v_atualizados <> cardinality(v_ids) then
      raise exception 'Você não tem permissão para registrar esta confirmação (é preciso ser operador do Financeiro).';
    end if;
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, p_canal,
         case when p_resultado = 'confirmou' then 'confirmacao' else 'sem_resposta_confirmacao' end,
         p_descricao, auth.uid()
    from rec_titulos t where t.id = any(v_ids);

  -- A tentativa de contato foi feita: a pendência de confirmação DESTA UNIDADE acaba (a de ligação, se for o caso, nasce abaixo).
  update pendencias set status = 'concluida'
   where modulo = 'financeiro.recebiveis' and referencia_tabela = 'contrapartes' and referencia_id = v_cliente
     and titulo like 'Confirmar pagamento:%' and status in ('aberta', 'em_andamento')
     and (titulo like '%(Filial Contagem)%') = (v_unidade = 'contagem');
  get diagnostics v_concluidas = row_count;

  if p_resultado = 'sem_resposta' then
    v_titulo_ligar := 'Ligar para confirmar pagamento: ' || coalesce(nullif(trim(v_nome), ''), 'cliente')
      || case when v_unidade = 'contagem' then ' (Filial Contagem)' else '' end || ' — vence ' || to_char(v_venc, 'DD/MM');
    insert into pendencias (modulo, contraparte_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
    select 'financeiro.recebiveis', v_cliente, v_titulo_ligar,
           'O cliente não respondeu à confirmação por mensagem. Ligue para confirmar a programação do pagamento e registre o resultado na ficha.',
           v_hoje, 'alta', 'contrapartes', v_cliente,
           '/financeiro/recebiveis/confirmar/' || v_cliente || case when v_unidade = 'contagem' then '?unidade=contagem' else '' end
     where not exists (
       select 1 from pendencias
        where modulo = 'financeiro.recebiveis' and referencia_tabela = 'contrapartes' and referencia_id = v_cliente
          and titulo = v_titulo_ligar and status in ('aberta', 'em_andamento'));
    get diagnostics v_ligar = row_count;
  end if;

  return jsonb_build_object('parcelas', cardinality(v_ids), 'pendencias_concluidas', v_concluidas, 'pendencia_ligar', v_ligar);
end $$;

-- Cobrança (0108) com a unidade --------------------------------------------------------------------------------------
create or replace function rec_registrar_cobranca(
  p_titulos uuid[], p_marco int, p_resultado text, p_canal canal default 'whatsapp', p_data_prometida date default null, p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_qtd int;
  v_clientes int;
  v_unidades int;
  v_unidade text;
  v_cliente uuid;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_atualizados int;
  v_concluidas int := 0;
  v_tipo text;
  v_texto text;
  v_canal_txt text;
begin
  if p_resultado not in ('enviada', 'promessa', 'contestou') then
    raise exception 'Resultado inválido.';
  end if;
  if p_marco not in (1, 5, 10) then
    raise exception 'Marco da régua inválido.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_titulos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos uma parcela.';
  end if;

  select count(*), count(distinct contraparte_id), min(contraparte_id::text)::uuid, count(distinct unidade), min(unidade)
    into v_qtd, v_clientes, v_cliente, v_unidades, v_unidade
    from rec_titulos
   where id = any(v_ids)
     and estagio in ('importado', 'aguardando_boleto', 'boleto_enviado', 'confirmado_cliente', 'vencido', 'promessa');
  if v_qtd <> cardinality(v_ids) then
    raise exception 'Uma das parcelas já foi paga ou encerrada (ou você não tem acesso a ela).';
  end if;
  if v_clientes <> 1 then
    raise exception 'As parcelas precisam ser do mesmo cliente.';
  end if;
  if v_unidades <> 1 then
    raise exception 'As parcelas precisam ser da mesma unidade (Matriz ou Filial Contagem).';
  end if;

  v_canal_txt := case p_canal when 'email' then 'por e-mail' when 'whatsapp' then 'por WhatsApp' when 'telefone' then 'por telefone' else 'por outro meio' end;

  if p_resultado = 'promessa' then
    if p_data_prometida is null then
      raise exception 'Informe a data prometida para o pagamento.';
    end if;
    if p_data_prometida <= v_hoje then
      raise exception 'A data prometida precisa ser futura.';
    end if;
    if p_data_prometida > v_hoje + 90 then
      raise exception 'A data prometida não pode passar de 90 dias.';
    end if;
    update rec_titulos set estagio = 'promessa', regua_pausada_ate = p_data_prometida where id = any(v_ids);
    get diagnostics v_atualizados = row_count;
    if v_atualizados <> cardinality(v_ids) then
      raise exception 'Você não tem permissão para registrar esta promessa (é preciso ser operador do Financeiro).';
    end if;
    insert into rec_promessas (titulo_id, data_prometida, valor_prometido)
    select t.id, p_data_prometida, t.valor from rec_titulos t where t.id = any(v_ids);
    v_tipo := 'promessa';
    v_texto := 'Cobrança ' || 'D+' || p_marco || ': o cliente prometeu pagar em ' || to_char(p_data_prometida, 'DD/MM/YYYY') || ' (' || v_canal_txt || '). A régua fica pausada até essa data.';
  elsif p_resultado = 'contestou' then
    if length(trim(coalesce(p_descricao, ''))) < 5 then
      raise exception 'Informe o motivo da contestação.';
    end if;
    update rec_titulos set contestado = true where id = any(v_ids);
    get diagnostics v_atualizados = row_count;
    if v_atualizados <> cardinality(v_ids) then
      raise exception 'Você não tem permissão para registrar esta contestação (é preciso ser operador do Financeiro).';
    end if;
    v_tipo := 'contestacao';
    v_texto := 'Cobrança D+' || p_marco || ': o cliente contestou a cobrança (' || v_canal_txt || '). A régua fica pausada para estes títulos.';
  else
    v_tipo := 'cobranca';
    v_texto := 'Cobrança D+' || p_marco || ' enviada ' || v_canal_txt || '.';
  end if;
  if nullif(trim(coalesce(p_descricao, '')), '') is not null then
    v_texto := v_texto || ' ' || trim(p_descricao);
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, p_canal, v_tipo, v_texto, auth.uid()
    from rec_titulos t where t.id = any(v_ids);

  -- A pendência do marco, DESTA UNIDADE, acaba: a cobrança foi feita (ou a régua foi pausada).
  update pendencias set status = 'concluida'
   where modulo = 'financeiro.recebiveis' and referencia_tabela = 'contrapartes' and referencia_id = v_cliente
     and titulo like 'Cobrar D+' || p_marco || ':%' and status in ('aberta', 'em_andamento')
     and (titulo like '%(Filial Contagem)%') = (v_unidade = 'contagem');
  get diagnostics v_concluidas = row_count;

  return jsonb_build_object('parcelas', cardinality(v_ids), 'pendencias_concluidas', v_concluidas);
end $$;
