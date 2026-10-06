-- =========================================================
-- Neo Admin — 0116 Forma de pagamento do título: boleto ou transferência
-- Alguns clientes pagam por transferência (PIX/TED), sem boleto. A forma é marcada título a título (padrão: boleto):
--  - rec_titulos.forma_pagamento ('boleto' | 'transferencia'); a sincronização com o Consistem não mexe nela.
--  - rec_definir_forma_pagamento(): troca a forma de vários títulos numa transação (registra no histórico).
--  - rec_marcar_dados_enviados(): como o envio do boleto, mas para transferência: o que se envia são os dados de pagamento da
--    empresa (empresas.dados_pagamento, texto livre cadastrado em Configurações; nunca no código). Não exige boleto.
--  - rec_marcar_boleto_enviado() passa a recusar título de transferência.
--  - Modelos de mensagem "Dados para pagamento" (e-mail e WhatsApp).
-- A pendência "Anexar boleto" acaba quando nenhuma parcela da NF precisa mais de boleto (aguardando boleto E forma boleto).
-- =========================================================

alter table rec_titulos
  add column forma_pagamento text not null default 'boleto' check (forma_pagamento in ('boleto', 'transferencia'));

alter table empresas add column dados_pagamento text;

-- Mesmo corpo da 0110 + a coluna nova (a view guarda a lista de colunas da época em que foi criada).
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

-- Conclui a pendência "Anexar boleto" de cada NF (ou título avulso) sem parcela que ainda precise de boleto --------------------
create function rec_concluir_pendencias_anexar_boleto(p_ids uuid[]) returns int
language plpgsql security invoker set search_path = public as $$
declare
  r record;
  v_total int := 0;
  v_n int;
begin
  for r in
    select distinct t.nota_saida_id, case when t.nota_saida_id is null then t.id else null end as titulo_id
      from rec_titulos t where t.id = any(p_ids)
  loop
    if not exists (
      select 1 from rec_titulos x
       where x.estagio = 'aguardando_boleto' and x.forma_pagamento = 'boleto'
         and ((r.nota_saida_id is not null and x.nota_saida_id = r.nota_saida_id) or (r.nota_saida_id is null and x.id = r.titulo_id))
    ) then
      update pendencias set status = 'concluida'
       where modulo = 'financeiro.recebiveis'
         and referencia_tabela = case when r.nota_saida_id is null then 'rec_titulos' else 'rec_notas_saida' end
         and referencia_id = coalesce(r.nota_saida_id, r.titulo_id)
         and titulo like 'Anexar boleto%'
         and status in ('aberta', 'em_andamento');
      get diagnostics v_n = row_count;
      v_total := v_total + v_n;
    end if;
  end loop;
  return v_total;
end $$;
revoke all on function rec_concluir_pendencias_anexar_boleto(uuid[]) from public, anon;
grant execute on function rec_concluir_pendencias_anexar_boleto(uuid[]) to authenticated;

-- Trocar a forma de pagamento ---------------------------------------------------------------------------------------
create function rec_definir_forma_pagamento(p_titulos uuid[], p_forma text)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_abertos int;
  v_alterados int;
  v_certos int;
  v_pendencias int;
begin
  if p_forma not in ('boleto', 'transferencia') then
    raise exception 'Forma de pagamento inválida.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_titulos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos um título.';
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'No máximo 100 títulos de uma vez.';
  end if;

  select count(*) into v_abertos from rec_titulos
   where id = any(v_ids) and estagio not in ('pago', 'renegociado', 'cancelado');
  if v_abertos <> cardinality(v_ids) then
    raise exception 'Algum título já está encerrado (ou você não tem acesso a ele).';
  end if;

  update rec_titulos set forma_pagamento = p_forma where id = any(v_ids) and forma_pagamento <> p_forma;
  get diagnostics v_alterados = row_count;
  -- A RLS esconde (e não altera) o que a pessoa não pode mexer: se algum título não ficou na forma pedida, é falta de permissão.
  select count(*) into v_certos from rec_titulos where id = any(v_ids) and forma_pagamento = p_forma;
  if v_certos <> cardinality(v_ids) then
    raise exception 'Você não tem permissão para alterar a forma de pagamento (é preciso ser operador do Financeiro).';
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, 'interno', 'forma_pagamento',
         case when p_forma = 'transferencia' then 'Forma de pagamento: transferência (PIX/TED), sem boleto.' else 'Forma de pagamento: boleto.' end, auth.uid()
    from rec_titulos t where t.id = any(v_ids);

  v_pendencias := rec_concluir_pendencias_anexar_boleto(v_ids);
  return jsonb_build_object('titulos', cardinality(v_ids), 'alterados', v_alterados, 'pendencias_concluidas', v_pendencias);
end $$;
revoke all on function rec_definir_forma_pagamento(uuid[], text) from public, anon;
grant execute on function rec_definir_forma_pagamento(uuid[], text) to authenticated;

-- Envio do boleto: recusa título de transferência (0115 + a forma) ---------------------------------------------------------
create or replace function rec_marcar_boleto_enviado(p_titulos uuid[], p_canal canal, p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_validos int;
  v_transferencia int;
  v_sem_boleto int;
  v_atualizados int;
  v_pendencias int;
begin
  select array_agg(distinct x) into v_ids from unnest(p_titulos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos uma parcela.';
  end if;

  select count(*), count(*) filter (where forma_pagamento = 'transferencia') into v_validos, v_transferencia from rec_titulos
   where id = any(v_ids) and estagio in ('aguardando_boleto', 'importado', 'boleto_enviado', 'confirmado_cliente', 'vencido', 'promessa');
  if v_validos <> cardinality(v_ids) then
    raise exception 'Uma das parcelas já está encerrada, em renegociação ou no jurídico (ou você não tem acesso a ela).';
  end if;
  if v_transferencia > 0 then
    raise exception 'Uma das parcelas é paga por transferência: registre o envio dos dados de pagamento, não do boleto.';
  end if;

  select count(*) into v_sem_boleto from rec_titulos t
   where t.id = any(v_ids)
     and not exists (select 1 from anexos a where a.referencia_tabela = 'rec_titulos' and a.referencia_id = t.id and a.tipo = 'boleto');
  if v_sem_boleto > 0 then
    raise exception 'Anexe o boleto de cada parcela marcada antes de marcar como enviado.';
  end if;

  update rec_titulos
     set estagio = case when estagio in ('aguardando_boleto', 'importado') then 'boleto_enviado'::rec_estagio else estagio end,
         boleto_enviado_em = now()
   where id = any(v_ids)
     and estagio in ('aguardando_boleto', 'importado', 'boleto_enviado', 'confirmado_cliente', 'vencido', 'promessa');
  get diagnostics v_atualizados = row_count;
  if v_atualizados <> cardinality(v_ids) then
    raise exception 'Você não tem permissão para marcar este envio (é preciso ser operador do Financeiro).';
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, p_canal, 'boleto_enviado', p_descricao, auth.uid()
    from rec_titulos t where t.id = any(v_ids);

  v_pendencias := rec_concluir_pendencias_anexar_boleto(v_ids);
  return jsonb_build_object('parcelas', v_atualizados, 'pendencias_concluidas', v_pendencias);
end $$;

-- Envio dos dados de pagamento (transferência) -----------------------------------------------------------------------------
create function rec_marcar_dados_enviados(p_titulos uuid[], p_canal canal, p_descricao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_validos int;
  v_boleto int;
  v_atualizados int;
begin
  select array_agg(distinct x) into v_ids from unnest(p_titulos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos uma parcela.';
  end if;

  select count(*), count(*) filter (where forma_pagamento = 'boleto') into v_validos, v_boleto from rec_titulos
   where id = any(v_ids) and estagio in ('aguardando_boleto', 'importado', 'boleto_enviado', 'confirmado_cliente', 'vencido', 'promessa');
  if v_validos <> cardinality(v_ids) then
    raise exception 'Uma das parcelas já está encerrada, em renegociação ou no jurídico (ou você não tem acesso a ela).';
  end if;
  if v_boleto > 0 then
    raise exception 'Uma das parcelas é paga por boleto: registre o envio do boleto, não dos dados de pagamento.';
  end if;

  update rec_titulos
     set estagio = case when estagio in ('aguardando_boleto', 'importado') then 'boleto_enviado'::rec_estagio else estagio end,
         boleto_enviado_em = now()
   where id = any(v_ids)
     and estagio in ('aguardando_boleto', 'importado', 'boleto_enviado', 'confirmado_cliente', 'vencido', 'promessa');
  get diagnostics v_atualizados = row_count;
  if v_atualizados <> cardinality(v_ids) then
    raise exception 'Você não tem permissão para marcar este envio (é preciso ser operador do Financeiro).';
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  select 'financeiro.recebiveis', t.contraparte_id, 'rec_titulos', t.id, p_canal, 'dados_enviados', p_descricao, auth.uid()
    from rec_titulos t where t.id = any(v_ids);

  return jsonb_build_object('parcelas', v_atualizados);
end $$;
revoke all on function rec_marcar_dados_enviados(uuid[], canal, text) from public, anon;
grant execute on function rec_marcar_dados_enviados(uuid[], canal, text) to authenticated;

-- Modelos de mensagem ---------------------------------------------------------------------------------------------------
insert into modelos_mensagem (modulo, nome, canal, assunto, corpo)
select 'financeiro.recebiveis', 'Dados para pagamento — e-mail', 'email', 'Dados para pagamento — {referencia} — Neo Formas',
$corpo$Olá, {contato}!

Seguem os dados para o pagamento referente à {referencia}, emitida pela Neo Formas:

{parcelas}

Dados para transferência:
{dados_pagamento}

Depois do pagamento, pedimos que nos envie o comprovante. Em caso de dúvida, é só nos avisar.

Atenciosamente,$corpo$
where not exists (select 1 from modelos_mensagem where modulo = 'financeiro.recebiveis' and nome = 'Dados para pagamento — e-mail');

insert into modelos_mensagem (modulo, nome, canal, assunto, corpo)
select 'financeiro.recebiveis', 'Dados para pagamento — WhatsApp', 'whatsapp', null,
$corpo$Olá, {contato}! Aqui é do Financeiro da Neo Formas. Seguem os dados para o pagamento referente à {referencia}:

{parcelas}

{dados_pagamento}

Depois do pagamento, nos envie o comprovante, por favor.$corpo$
where not exists (select 1 from modelos_mensagem where modulo = 'financeiro.recebiveis' and nome = 'Dados para pagamento — WhatsApp');
