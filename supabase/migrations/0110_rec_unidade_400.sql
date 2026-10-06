-- =========================================================
-- Neo Admin — 0110 Regra da unidade: Filial Contagem = documento que começa com 400
-- A 0109 usava "começa com 4" e classificou o documento 453 (Matriz) como Filial. A coluna é calculada, então é recriada com
-- a regra certa (e a view, que guarda a lista de colunas da época em que foi criada).
-- =========================================================

drop view rec_vw_titulos;
drop index if exists idx_rec_titulos_unidade;
alter table rec_titulos drop column unidade;
alter table rec_titulos
  add column unidade text generated always as (case when documento like '400%' then 'contagem' else 'matriz' end) stored;
create index idx_rec_titulos_unidade on rec_titulos (unidade) where estagio not in ('pago','renegociado','cancelado');

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
