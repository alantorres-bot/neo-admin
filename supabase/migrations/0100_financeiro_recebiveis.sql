-- =========================================================
-- Neo Admin — 0100 FINANCEIRO / RECEBÍVEIS
-- Depende de 0001_nucleo.sql. Clientes = contrapartes; contatos, mensagens,
-- interações, anexos (PDF do boleto), pendências e importações vêm do núcleo.
-- =========================================================

create type rec_estagio as enum (
  'importado','aguardando_boleto','boleto_enviado','confirmado_cliente',
  'vencido','promessa','em_renegociacao','renegociado','pago','juridico','cancelado');
create type rec_status_acordo as enum ('simulacao','aguardando_aprovacao','aprovado','ativo','quitado','quebrado','cancelado');

-- Régua -----------------------------------------------------
create table rec_reguas (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativa boolean not null default true
);

create table rec_regua_marcos (
  id uuid primary key default gen_random_uuid(),
  regua_id uuid not null references rec_reguas(id) on delete cascade,
  dia_relativo int not null,              -- negativo = antes do vencimento
  acao text not null check (acao in ('envio_boleto','confirmacao','pendencia_contato','lembrete','cobranca','carta','notificacao','juridico')),
  canais canal[] not null,
  modelo_id uuid references modelos_mensagem(id),
  aprovacao nivel_acesso,                 -- null = automático; senão nível mínimo que aprova
  unique (regua_id, dia_relativo, acao)
);

-- Configuração do cliente no módulo --------------------------
create table rec_clientes_config (
  contraparte_id uuid primary key references contrapartes(id) on delete cascade,
  estrategico boolean not null default false,
  regua_id uuid references rec_reguas(id),
  observacoes text
);

create table rec_contratos (
  id uuid primary key default gen_random_uuid(),
  contraparte_id uuid not null references contrapartes(id),
  empresa_id uuid not null references empresas(id),
  numero text not null,
  tipo text check (tipo in ('venda','locacao','servico','outro')),
  multa_pct numeric(5,2) not null default 2.00,
  juros_mes_pct numeric(5,2) not null default 2.00,   -- confirmar contrato a contrato
  cedido boolean not null default false,
  cessionario text,
  unique (empresa_id, numero)
);

-- Acordos e títulos -------------------------------------------
create table rec_acordos (
  id uuid primary key default gen_random_uuid(),
  contraparte_id uuid not null references contrapartes(id),
  data_base date not null,
  saldo_original numeric(14,2) not null,
  encargos numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  valor_acordado numeric(14,2) not null,
  qtd_parcelas int not null check (qtd_parcelas > 0),
  dias_tolerancia_quebra int not null default 15,
  status rec_status_acordo not null default 'simulacao',
  aprovado_por uuid references perfis(id),
  aprovado_em timestamptz,
  criado_em timestamptz not null default now(),
  constraint aprovacao_registrada check (status in ('simulacao','aguardando_aprovacao','cancelado') or (aprovado_por is not null and aprovado_em is not null))
);

create table rec_titulos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  contraparte_id uuid not null references contrapartes(id),
  contrato_id uuid references rec_contratos(id),
  documento text not null,
  parcela text not null default '1',
  emissao date,
  vencimento date not null,
  valor numeric(14,2) not null check (valor > 0),
  estagio rec_estagio not null default 'importado',
  cedido boolean not null default false,
  contestado boolean not null default false,
  regua_pausada_ate date,
  data_pagamento date,
  valor_pago numeric(14,2),
  origem text not null default 'importacao' check (origem in ('importacao','manual','acordo')),
  acordo_origem_id uuid references rec_acordos(id),
  linha_digitavel varchar(60),            -- do boleto vigente (PDF em anexos)
  boleto_enviado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, documento, parcela),   -- chave de conciliação com o Consistem
  constraint pago_consistente check (estagio <> 'pago' or data_pagamento is not null)
);
create index idx_rec_titulos_aberto on rec_titulos (vencimento) where estagio not in ('pago','renegociado','cancelado');
create index idx_rec_titulos_cliente on rec_titulos (contraparte_id);

create table rec_acordo_titulos (
  acordo_id uuid references rec_acordos(id) on delete cascade,
  titulo_id uuid references rec_titulos(id),
  primary key (acordo_id, titulo_id)
);

create table rec_promessas (
  id uuid primary key default gen_random_uuid(),
  titulo_id uuid not null references rec_titulos(id) on delete cascade,
  data_prometida date not null,
  valor_prometido numeric(14,2),
  cumprida boolean,
  registrado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now()
);

create table rec_mensagem_titulos (          -- uma mensagem do núcleo pode cobrar vários títulos
  mensagem_id uuid references mensagens(id) on delete cascade,
  titulo_id uuid references rec_titulos(id),
  marco_id uuid references rec_regua_marcos(id),
  primary key (mensagem_id, titulo_id)
);

-- Gatilhos ----------------------------------------------------
create trigger trg_rec_titulos_atualizado before update on rec_titulos for each row execute function fn_atualizado_em();
create trigger trg_aud_rec_titulos after insert or update or delete on rec_titulos for each row execute function fn_auditoria();
create trigger trg_aud_rec_acordos after insert or update or delete on rec_acordos for each row execute function fn_auditoria();

-- View: valor atualizado e faixa de atraso ---------------------
-- multa fixa + juros simples pro rata die (juros_mes / 30 por dia)
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

-- RLS ----------------------------------------------------------
alter table rec_reguas enable row level security;
alter table rec_regua_marcos enable row level security;
alter table rec_clientes_config enable row level security;
alter table rec_contratos enable row level security;
alter table rec_acordos enable row level security;
alter table rec_titulos enable row level security;
alter table rec_acordo_titulos enable row level security;
alter table rec_promessas enable row level security;
alter table rec_mensagem_titulos enable row level security;

create policy rec_titulos_ler on rec_titulos for select to authenticated
  using (tem_acesso_area('financeiro'));
create policy rec_titulos_inserir on rec_titulos for insert to authenticated
  with check (tem_acesso_area('financeiro','operador'));
create policy rec_titulos_alterar on rec_titulos for update to authenticated
  using (tem_acesso_area('financeiro','operador')) with check (tem_acesso_area('financeiro','operador'));
-- Sem política de delete: títulos são cancelados, não excluídos.
-- Replicar o padrão nas demais tabelas rec_*; aprovar acordos exige 'gestor'.

insert into rec_reguas (nome) values ('Padrao');
