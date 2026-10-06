-- =========================================================
-- Neo Admin — 0107 Baixa de títulos (conferência dos "Possível baixa")
-- A API do Consistem só lista títulos EM ABERTO; quando um some, o Neo Admin abre a pendência "Possível baixa" e NUNCA
-- baixa sozinho. Esta migration traz:
-- 1) Evidência do Consistem: a sincronização procura o título na lista de PAGOS (tipoTitulo=1) e guarda o que o ERP
--    informa (data do pagamento, valor, código do tipo de baixa). É só evidência: quem dá a baixa é uma pessoa.
-- 2) rec_registrar_baixa(): baixa UM título (pago com data e valor, ou cancelado) numa transação, com a RLS de quem
--    chama (operador do Financeiro): muda o estágio, registra a interação e conclui a pendência "Possível baixa".
-- 3) rec_baixar_titulos(): vários de uma vez, tudo ou nada.
-- =========================================================

alter table rec_titulos
  add column consistem_pago_em date,             -- data do pagamento que o Consistem informa
  add column consistem_valor_pago numeric(14,2), -- valor do título + juros - desconto, como o Consistem informa
  add column consistem_tipo_baixa text,          -- código do tipo de baixa (o significado é do Consistem)
  add column consistem_verificado_em timestamptz;

-- Mesmo corpo da 0103 + as colunas novas (a view guarda a lista de colunas da época em que foi criada).
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

create function rec_registrar_baixa(
  p_titulo uuid,
  p_resultado text,
  p_data_pagamento date default null,
  p_valor_pago numeric default null,
  p_descricao text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_t record;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_concluidas int := 0;
  v_descricao text;
begin
  if p_resultado not in ('pago', 'cancelado') then
    raise exception 'Resultado inválido.';
  end if;

  select id, contraparte_id, documento, parcela, valor, emissao, estagio into v_t from rec_titulos where id = p_titulo;
  if not found then
    raise exception 'Título não encontrado (ou você não tem acesso a ele).';
  end if;
  if v_t.estagio in ('pago', 'renegociado', 'cancelado') then
    raise exception 'O título % já está encerrado.', v_t.documento;
  end if;

  if p_resultado = 'pago' then
    if p_data_pagamento is null then
      raise exception 'Informe a data do pagamento.';
    end if;
    if p_data_pagamento > v_hoje then
      raise exception 'A data do pagamento não pode ser futura.';
    end if;
    if v_t.emissao is not null and p_data_pagamento < v_t.emissao then
      raise exception 'A data do pagamento (%) é anterior à emissão do título (%).', to_char(p_data_pagamento, 'DD/MM/YYYY'), to_char(v_t.emissao, 'DD/MM/YYYY');
    end if;
    if p_valor_pago is null or p_valor_pago <= 0 then
      raise exception 'Informe o valor pago.';
    end if;
    if p_valor_pago <> v_t.valor and coalesce(trim(p_descricao), '') = '' then
      raise exception 'O valor pago difere do valor do título: informe o motivo (juros, desconto, pagamento parcial...).';
    end if;

    update rec_titulos set estagio = 'pago', data_pagamento = p_data_pagamento, valor_pago = p_valor_pago where id = p_titulo;
    v_descricao := format('Baixa: pago em %s, valor R$ %s.%s',
      to_char(p_data_pagamento, 'DD/MM/YYYY'), translate(to_char(p_valor_pago, 'FM999,999,999,990.00'), ',.', '.,'),
      case when coalesce(trim(p_descricao), '') <> '' then ' ' || trim(p_descricao) else '' end);
  else
    update rec_titulos set estagio = 'cancelado' where id = p_titulo;
    v_descricao := 'Título cancelado (baixa sem pagamento).' || case when coalesce(trim(p_descricao), '') <> '' then ' ' || trim(p_descricao) else '' end;
  end if;
  if not found then
    raise exception 'Você não tem permissão para dar baixa (é preciso ser operador do Financeiro).';
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  values ('financeiro.recebiveis', v_t.contraparte_id, 'rec_titulos', p_titulo, 'interno',
          case when p_resultado = 'pago' then 'baixa' else 'cancelamento' end, v_descricao, auth.uid());

  update pendencias set status = 'concluida'
   where modulo = 'financeiro.recebiveis' and referencia_tabela = 'rec_titulos' and referencia_id = p_titulo
     and titulo like 'Possível baixa:%' and status in ('aberta', 'em_andamento');
  get diagnostics v_concluidas = row_count;

  return jsonb_build_object('titulo', v_t.documento, 'resultado', p_resultado, 'pendencias_concluidas', v_concluidas);
end $$;

-- p_itens: [{"id": "...", "resultado": "pago", "data": "2026-10-02", "valor": 1234.56, "descricao": "..."}]
create function rec_baixar_titulos(p_itens jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_item jsonb;
  v_total int := 0;
  v_pendencias int := 0;
  v_r jsonb;
begin
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Marque pelo menos um título.';
  end if;
  if jsonb_array_length(p_itens) > 100 then
    raise exception 'No máximo 100 baixas de uma vez.';
  end if;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    begin
      v_r := rec_registrar_baixa(
        (v_item ->> 'id')::uuid, v_item ->> 'resultado', nullif(v_item ->> 'data', '')::date, nullif(v_item ->> 'valor', '')::numeric, v_item ->> 'descricao');
    exception when others then
      -- tudo ou nada: avisa QUAL título impediu o lote
      raise exception 'Título %: %', coalesce((select documento from rec_titulos where id::text = v_item ->> 'id'), v_item ->> 'id'), sqlerrm;
    end;
    v_total := v_total + 1;
    v_pendencias := v_pendencias + (v_r ->> 'pendencias_concluidas')::int;
  end loop;
  return jsonb_build_object('baixados', v_total, 'pendencias_concluidas', v_pendencias);
end $$;

revoke all on function rec_registrar_baixa(uuid, text, date, numeric, text) from public, anon;
grant execute on function rec_registrar_baixa(uuid, text, date, numeric, text) to authenticated;
revoke all on function rec_baixar_titulos(jsonb) from public, anon;
grant execute on function rec_baixar_titulos(jsonb) to authenticated;
