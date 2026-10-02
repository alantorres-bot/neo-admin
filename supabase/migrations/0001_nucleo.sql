-- =========================================================
-- Neo Admin — 0001 NÚCLEO COMUM
-- Usado por todos os módulos. Testar em projeto de teste antes de produção.
-- =========================================================

-- 1. TIPOS ------------------------------------------------
create type nivel_acesso as enum ('sem_acesso','consulta','operador','gestor','administrador');
create type canal as enum ('email','whatsapp','telefone','interno');
create type status_mensagem as enum ('rascunho','aguardando_aprovacao','aprovada','enviada','falhou','respondida','descartada');
create type criticidade as enum ('critica','alta','normal');
create type status_pendencia as enum ('aberta','em_andamento','concluida','cancelada');
create type tipo_contraparte as enum ('cliente','fornecedor','orgao_publico','tribunal','escritorio','banco','colaborador','outro');

-- 2. ÁREAS, MÓDULOS E USUÁRIOS ----------------------------
create table areas (
  codigo text primary key,          -- financeiro, fiscal, contratos, juridico, rh, administrativo
  nome text not null,
  sensivel boolean not null default false,
  ordem int not null default 0
);

create table modulos (
  codigo text primary key,          -- financeiro.recebiveis, fiscal.parcelamentos ...
  area text not null references areas(codigo),
  nome text not null,
  ativo boolean not null default false
);

create table perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null,
  admin_geral boolean not null default false,
  ativo boolean not null default true
);

create table permissoes (
  perfil_id uuid references perfis(id) on delete cascade,
  area text references areas(codigo) on delete cascade,
  nivel nivel_acesso not null default 'sem_acesso',
  primary key (perfil_id, area)
);

create table configuracoes (
  chave text primary key,           -- global: 'modo_rascunho'; módulo: 'financeiro.recebiveis.xxx'
  valor jsonb not null,
  descricao text
);

-- 3. CADASTROS COMPARTILHADOS -----------------------------
create table empresas (
  id uuid primary key default gen_random_uuid(),
  razao_social text not null,
  nome_curto text not null,
  cnpj varchar(18) unique,
  ativa boolean not null default true
);

create table contrapartes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  documento varchar(18),            -- CNPJ/CPF
  tipos tipo_contraparte[] not null default '{outro}',
  codigo_erp text,                  -- código no Consistem
  observacoes text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index uq_contrapartes_documento on contrapartes (documento) where documento is not null;

create table contatos (
  id uuid primary key default gen_random_uuid(),
  contraparte_id uuid not null references contrapartes(id) on delete cascade,
  nome text not null,
  funcao text,                      -- financeiro, compras, jurídico ...
  email text,
  whatsapp varchar(20),             -- +5565999999999
  canal_preferido canal default 'email',
  finalidades text[] not null default '{}',  -- ex.: {boleto,cobranca,contrato}
  ativo boolean not null default true
);

-- 4. FUNÇÕES DE ACESSO (usadas nas RLS de todos os módulos)
create function eh_admin_geral() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and admin_geral and ativo);
$$;

create function nivel_area(p_area text) returns nivel_acesso
language sql stable security definer set search_path = public as $$
  select case when eh_admin_geral() then 'administrador'::nivel_acesso
    else coalesce((select pe.nivel from permissoes pe join perfis p on p.id = pe.perfil_id
                   where pe.perfil_id = auth.uid() and pe.area = p_area and p.ativo), 'sem_acesso') end;
$$;

create function tem_acesso_area(p_area text, p_minimo nivel_acesso default 'consulta') returns boolean
language sql stable security definer set search_path = public as $$
  select nivel_area(p_area) >= p_minimo;
$$;

-- 5. PENDÊNCIAS (Fila do dia) -----------------------------
create table pendencias (
  id uuid primary key default gen_random_uuid(),
  modulo text not null references modulos(codigo),
  empresa_id uuid references empresas(id),
  contraparte_id uuid references contrapartes(id),
  titulo text not null,
  descricao text,
  prazo date,
  criticidade criticidade not null default 'normal',
  status status_pendencia not null default 'aberta',
  responsavel_id uuid references perfis(id),
  referencia_tabela text,           -- registro de origem no módulo
  referencia_id uuid,
  link text,                        -- rota interna para resolver
  clickup_task_id text,
  criado_em timestamptz not null default now(),
  concluido_em timestamptz,
  concluido_por uuid references perfis(id)
);
create index idx_pendencias_abertas on pendencias (responsavel_id, prazo) where status in ('aberta','em_andamento');
create unique index uq_pendencia_origem on pendencias (modulo, referencia_tabela, referencia_id, titulo)
  where status in ('aberta','em_andamento');

-- 6. ANEXOS -----------------------------------------------
create table anexos (
  id uuid primary key default gen_random_uuid(),
  modulo text not null references modulos(codigo),
  referencia_tabela text not null,
  referencia_id uuid not null,
  arquivo_path text not null,       -- Supabase Storage
  nome_arquivo text not null,
  tipo text,                        -- boleto, comprovante, contrato, guia, notificacao ...
  enviado_por uuid references perfis(id) default auth.uid(),
  enviado_em timestamptz not null default now()
);
create index idx_anexos_ref on anexos (referencia_tabela, referencia_id);

-- 7. COMUNICAÇÃO ------------------------------------------
create table modelos_mensagem (
  id uuid primary key default gen_random_uuid(),
  modulo text not null references modulos(codigo),
  nome text not null,
  canal canal not null,
  assunto text,
  corpo text not null,              -- variáveis entre chaves: {contraparte} {valor} ...
  whatsapp_template text,           -- nome do modelo aprovado na Meta
  ativo boolean not null default true
);

create table mensagens (
  id uuid primary key default gen_random_uuid(),
  modulo text not null references modulos(codigo),
  contraparte_id uuid references contrapartes(id),
  contato_id uuid references contatos(id),
  modelo_id uuid references modelos_mensagem(id),
  canal canal not null,
  destinatario text not null,
  assunto text,
  corpo text not null,
  status status_mensagem not null default 'rascunho',
  aprovado_por uuid references perfis(id),
  aprovado_em timestamptz,
  enviado_em timestamptz,
  id_externo text,                  -- id do Gmail/WhatsApp
  erro text,
  criado_em timestamptz not null default now()
);

create table interacoes (
  id uuid primary key default gen_random_uuid(),
  modulo text not null references modulos(codigo),
  contraparte_id uuid references contrapartes(id),
  referencia_tabela text,
  referencia_id uuid,
  canal canal not null,
  tipo text not null,               -- ligacao, resposta, confirmacao, contestacao, observacao ...
  descricao text,
  usuario_id uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now()
);

-- 8. IMPORTAÇÕES ------------------------------------------
create table importacoes (
  id uuid primary key default gen_random_uuid(),
  modulo text not null references modulos(codigo),
  tipo text not null,               -- ex.: 'titulos_abertos', 'titulos_pagos'
  arquivo text,
  mapeamento jsonb,                 -- colunas do arquivo -> campos
  linhas_novas int, linhas_alteradas int, linhas_baixadas int, linhas_divergentes int,
  usuario_id uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now()
);

-- 9. AUDITORIA E GATILHOS GENÉRICOS -----------------------
create table auditoria (
  id bigserial primary key,
  tabela text not null,
  registro_id uuid,
  acao text not null,
  antes jsonb,
  depois jsonb,
  usuario_id uuid default auth.uid(),
  em timestamptz not null default now()
);

create function fn_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into auditoria (tabela, registro_id, acao, antes) values (tg_table_name, old.id, tg_op, to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    insert into auditoria (tabela, registro_id, acao, antes, depois) values (tg_table_name, new.id, tg_op, to_jsonb(old), to_jsonb(new));
  else
    insert into auditoria (tabela, registro_id, acao, depois) values (tg_table_name, new.id, tg_op, to_jsonb(new));
  end if;
  return new;
end $$;

create function fn_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;

create function fn_bloquear_delete() returns trigger language plpgsql as $$
begin
  raise exception 'Registros de % não podem ser excluídos; altere o status.', tg_table_name;
end $$;

create trigger trg_mensagens_sem_delete before delete on mensagens for each row execute function fn_bloquear_delete();
create trigger trg_aud_mensagens after insert or update on mensagens for each row execute function fn_auditoria();
create trigger trg_aud_permissoes after insert or update or delete on permissoes for each row execute function fn_auditoria();

-- 10. RLS -------------------------------------------------
-- Ativa em tudo. Políticas por área criadas na Fase 0 usando tem_acesso_area().
alter table areas enable row level security;
alter table modulos enable row level security;
alter table perfis enable row level security;
alter table permissoes enable row level security;
alter table configuracoes enable row level security;
alter table empresas enable row level security;
alter table contrapartes enable row level security;
alter table contatos enable row level security;
alter table pendencias enable row level security;
alter table anexos enable row level security;
alter table modelos_mensagem enable row level security;
alter table mensagens enable row level security;
alter table interacoes enable row level security;
alter table importacoes enable row level security;
alter table auditoria enable row level security;

-- 11. DADOS INICIAIS --------------------------------------
insert into areas (codigo, nome, sensivel, ordem) values
  ('financeiro','Financeiro', false, 1),
  ('fiscal','Fiscal/Tributário', false, 2),
  ('contratos','Contratos', false, 3),
  ('juridico','Jurídico', true, 4),
  ('rh','RH/SST', true, 5),
  ('administrativo','Administrativo geral', false, 6);

insert into modulos (codigo, area, nome, ativo) values
  ('financeiro.recebiveis','financeiro','Recebíveis', true),
  ('financeiro.pagar_cartao','financeiro','Contas a pagar e cartão', false),
  ('financeiro.conciliacao','financeiro','Conciliação bancária', false),
  ('financeiro.comissoes','financeiro','Comissões', false),
  ('financeiro.fluxo_caixa','financeiro','Fluxo de caixa', false),
  ('fiscal.parcelamentos','fiscal','Parcelamentos', false),
  ('fiscal.entradas','fiscal','Análise de entradas', false),
  ('fiscal.notificacoes','fiscal','Notificações e guias', false),
  ('contratos.contratos','contratos','Contratos de venda/locação', false),
  ('contratos.rem_ret','contratos','Remessas e retornos', false),
  ('contratos.cessoes','contratos','Cessões de crédito', false),
  ('juridico.processos','juridico','Processos e prazos', false),
  ('juridico.notificacoes','juridico','Notificações extrajudiciais', false),
  ('rh.folha','rh','Rotinas de folha', false),
  ('rh.epis','rh','EPIs', false),
  ('administrativo.pops','administrativo','POPs', false);

insert into configuracoes (chave, valor, descricao) values
  ('modo_rascunho', 'true', 'Toda comunicação externa sai como rascunho para revisão'),
  ('horario_envio', '{"inicio":"08:00","fim":"18:00","fuso":"America/Cuiaba","dias_uteis":true}', 'Janela de envio');
