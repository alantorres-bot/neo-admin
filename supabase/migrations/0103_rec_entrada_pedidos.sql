-- =========================================================
-- Neo Admin — 0103 Entrada do título pela NF/pedido (Etapa 1a)
-- O título do Consistem nasce da NF de saída (duplicata). A sincronização passa a guardar de qual NF veio
-- (e quais pedidos ela atende) e, para títulos novos a partir da data de início da esteira, abre a pendência
-- "Anexar boleto". Vínculo provado com dados reais (docs/modulos/financeiro-recebiveis.md, seção 13).
-- =========================================================

-- NF de saída que originou títulos em aberto. Só entram as NFs ligadas a algum título (não todas as NFs do ERP).
-- Uma NF pode atender vários pedidos (faturamento agrupado): `pedidos` é uma lista.
create table rec_notas_saida (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  nota text not null,                       -- número da NF, sem zeros à esquerda
  serie text not null default '',
  chave_acesso varchar(44),                 -- chave da NF-e (44 dígitos)
  cod_cliente text,                         -- código do cliente no Consistem
  valor_total numeric(14,2),
  data_emissao date,
  pedidos text[] not null default '{}',
  visto_em timestamptz not null default now(),
  unique (empresa_id, nota, serie)
);
create unique index uq_rec_notas_saida_chave on rec_notas_saida (chave_acesso) where chave_acesso is not null;

alter table rec_titulos
  add column nota_fiscal text,              -- nº da NF de origem (vazio nos lançamentos que não vêm de NF)
  add column chave_nfe varchar(44),
  add column cod_portador text,             -- 91 carteira, 237 Bradesco, 998 AKF (antecipado)
  add column tipo_cobranca text,
  add column nota_saida_id uuid references rec_notas_saida(id),
  add column entrou_esteira_em timestamptz; -- quando entrou na esteira (nulo = título anterior à esteira)
create index idx_rec_titulos_nota on rec_titulos (nota_saida_id);
create index idx_rec_titulos_aguardando_boleto on rec_titulos (vencimento) where estagio = 'aguardando_boleto';

-- RLS: quem tem acesso ao Financeiro lê; só a sincronização (service role) grava.
alter table rec_notas_saida enable row level security;
create policy rec_notas_saida_ler on rec_notas_saida for select to authenticated
  using (tem_acesso_area('financeiro'));

-- A view `select t.*` guarda as colunas da época em que foi criada: recriar para enxergar as novas.
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

-- Data a partir da qual título novo abre pendência de boleto. Títulos já existentes nunca abrem.
-- No projeto de produção, ajuste para o dia da virada (update configuracoes ... where chave = ...).
insert into configuracoes (chave, valor, descricao) values
  ('financeiro.recebiveis.esteira_a_partir_de', '"2026-10-06"', 'Data (aaaa-mm-dd, Cuiabá) a partir da qual título novo do Consistem entra na esteira e abre a pendência "Anexar boleto".')
on conflict (chave) do nothing;
