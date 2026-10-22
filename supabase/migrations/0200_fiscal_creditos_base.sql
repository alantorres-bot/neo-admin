-- =========================================================
-- Neo Admin — 0200 FISCAL > Créditos tributários (Fiscal Control): cadastros, papéis, créditos, razão e apuração
-- Especificação: docs/modulos/fiscal-creditos.md. Arquitetura e regras: docs/fiscal-control/ARCHITECTURE.md.
-- Decisões (22/10/2026):
--  - Cada crédito é uma "conta" com razão próprio (fis_movimentos). O saldo é sempre a soma do razão efetivo: o saldo inicial
--    de um mês é, por construção, o saldo final do mês anterior do MESMO crédito (mesma empresa, estabelecimento e tributo).
--    Não existe transporte automático entre créditos: só a transferência explícita, com fundamento e aprovação.
--  - O razão é imutável: correção por estorno (e, se for o caso, novo lançamento ligado ao original). Nada é apagado.
--  - Competência fechada (estabelecimento + tributo + mês) não recebe lançamento; corrigir exige reabrir (com motivo).
--    Lançar numa competência anterior marca as competências fechadas seguintes como "requer reconciliação".
--  - Regras tributárias (formas de utilização, prazos, documentos exigidos) são PARÂMETROS a validar pelo contador:
--    os valores iniciais vêm marcados como não validados. Nenhum prazo legal é presumido (prazo nulo = a definir).
--  - Papéis do módulo (leitor, analista, revisor, contador, administrador) saem do nível na área Fiscal; fis_membros
--    escolhe o papel entre os compatíveis com o nível e pode restringir as empresas visíveis.
-- Convenção do núcleo: auth.uid() nulo = origem de serviço (migration, script de demonstração, Edge Function).
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('fiscal.creditos', 'fiscal', 'Créditos tributários', true)
  on conflict (codigo) do update set ativo = true, nome = excluded.nome;

-- 1) PAPÉIS E ESCOPO --------------------------------------------------------------------------------------------------------
create type fis_papel as enum ('leitor', 'analista', 'revisor', 'contador', 'administrador');

create table fis_membros (
  perfil_id uuid primary key references perfis(id) on delete cascade,
  papel fis_papel not null,
  empresas uuid[],                                   -- nulo = todas as empresas; senão só estas
  atualizado_por uuid references perfis(id) default auth.uid(),
  atualizado_em timestamptz not null default now()
);
comment on table fis_membros is 'Fiscal Control: papel do usuário no módulo (dentro do permitido pelo nível na área Fiscal) e empresas visíveis.';
create trigger trg_aud_fis_membros after insert or update or delete on fis_membros for each row execute function fn_auditoria();

-- Nível mínimo na área Fiscal para cada papel.
create function fis_nivel_do_papel(p fis_papel) returns nivel_acesso
language sql immutable as $$
  select case p when 'leitor' then 'consulta' when 'analista' then 'operador' when 'revisor' then 'gestor'
                when 'contador' then 'gestor' else 'administrador' end::nivel_acesso
$$;

-- Papel efetivo do usuário logado (nulo = sem acesso). Sem membro cadastrado: deriva do nível na área.
create function fis_papel_atual() returns fis_papel
language plpgsql stable security definer set search_path = public as $$
declare
  v_nivel nivel_acesso := nivel_area('fiscal');
  v_escolhido fis_papel;
begin
  if v_nivel < 'consulta' then return null; end if;
  select papel into v_escolhido from fis_membros where perfil_id = auth.uid();
  if v_escolhido is not null and v_nivel >= fis_nivel_do_papel(v_escolhido) then return v_escolhido; end if;
  return case v_nivel when 'administrador' then 'administrador' when 'gestor' then 'revisor'
                      when 'operador' then 'analista' else 'leitor' end::fis_papel;
end $$;

-- A empresa está no escopo do usuário? (admin geral e membro sem lista: todas)
create function fis_empresa_permitida(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is null or eh_admin_geral()
      or coalesce((select p_empresa = any (m.empresas) or m.empresas is null from fis_membros m where m.perfil_id = auth.uid()), true)
$$;

-- Matriz de permissões (espelho em TS: lib/modulos/fiscal/creditos/permissoes.ts).
--   ler: todos | lancar: analista+ | validar/fechar/atribuir: revisor, contador, administrador
--   reabrir: revisor, administrador | parametrizar: administrador
create function fis_pode(p_acao text, p_empresa uuid default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_papel fis_papel;
begin
  if auth.uid() is null then return true; end if;           -- serviço
  v_papel := fis_papel_atual();
  if v_papel is null then return false; end if;
  if p_empresa is not null and not fis_empresa_permitida(p_empresa) then return false; end if;
  return case p_acao
    when 'ler' then true
    when 'lancar' then v_papel in ('analista', 'revisor', 'contador', 'administrador')
    when 'validar' then v_papel in ('revisor', 'contador', 'administrador')
    when 'fechar' then v_papel in ('revisor', 'contador', 'administrador')
    when 'atribuir' then v_papel in ('revisor', 'contador', 'administrador')
    when 'reabrir' then v_papel in ('revisor', 'administrador')
    when 'parametrizar' then v_papel = 'administrador'
    else false end;
end $$;

create function fis_exigir(p_acao text, p_empresa uuid default null) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not fis_pode(p_acao, p_empresa) then
    raise exception '%', case p_acao
      when 'lancar' then 'Somente analista fiscal, revisor, contador ou administrador faz lançamentos.'
      when 'validar' then 'Somente revisor, contador ou administrador aprova ou valida.'
      when 'fechar' then 'Somente revisor, contador ou administrador fecha ou reconcilia competências.'
      when 'atribuir' then 'Somente revisor, contador ou administrador atribui tarefas a outra pessoa.'
      when 'reabrir' then 'Somente revisor ou administrador reabre competências.'
      when 'parametrizar' then 'Somente o administrador altera os parâmetros fiscais.'
      else 'Sem acesso ao Fiscal Control.' end
      using errcode = 'P0001';
  end if;
end $$;

-- 2) CADASTROS ----------------------------------------------------------------------------------------------------------------
create table fis_estabelecimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  nome text not null,
  cnpj varchar(14) not null unique check (cnpj ~ '^[0-9]{14}$'),
  uf char(2) check (uf ~ '^[A-Z]{2}$'),
  inscricao_estadual text,
  matriz boolean not null default false,
  ativo boolean not null default true,
  ficticio boolean not null default false,
  criado_em timestamptz not null default now()
);
comment on table fis_estabelecimentos is 'Estabelecimentos (CNPJ completo) das empresas, para apuração por estabelecimento. A matriz recebe os tributos apurados de forma centralizada.';
create trigger trg_fis_estabelecimentos_sem_delete before delete on fis_estabelecimentos for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_estabelecimentos after insert or update on fis_estabelecimentos for each row execute function fn_auditoria();

create table fis_tributos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[A-Z0-9_]{2,20}$'),
  nome text not null,
  esfera text not null check (esfera in ('federal', 'estadual', 'municipal')),
  observacao text,
  ativo boolean not null default true
);
create trigger trg_fis_tributos_sem_delete before delete on fis_tributos for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_tributos after insert or update on fis_tributos for each row execute function fn_auditoria();

insert into fis_tributos (codigo, nome, esfera) values
  ('PIS', 'PIS/Pasep', 'federal'),
  ('COFINS', 'Cofins', 'federal'),
  ('ICMS', 'ICMS', 'estadual'),
  ('IPI', 'IPI', 'federal'),
  ('IRPJ', 'IRPJ', 'federal'),
  ('CSLL', 'CSLL', 'federal'),
  ('INSS', 'Contribuições previdenciárias (INSS)', 'federal'),
  ('OUTROS', 'Outros tributos', 'federal');

create table fis_tipos_documento (
  codigo text primary key check (codigo ~ '^[a-z0-9_]{2,40}$'),
  nome text not null,
  ativo boolean not null default true
);
insert into fis_tipos_documento (codigo, nome) values
  ('arquivo_apuracao', 'Arquivo de apuração'),
  ('arquivo_declaracao', 'Arquivo de declaração'),
  ('recibo_transmissao', 'Recibo de transmissão'),
  ('protocolo', 'Protocolo'),
  ('comprovante_compensacao', 'Comprovante de compensação'),
  ('pedido_restituicao', 'Pedido de restituição ou ressarcimento'),
  ('relatorio_erp', 'Relatório do ERP'),
  ('memoria_calculo', 'Memória de cálculo'),
  ('nota_fiscal', 'Nota fiscal'),
  ('planilha_conciliacao', 'Planilha de conciliação'),
  ('parecer', 'Parecer ou documento de suporte'),
  ('comprovante_pagamento', 'Comprovante de pagamento (DARF/DAR/GPS)'),
  ('decisao', 'Decisão administrativa ou judicial'),
  ('outro', 'Outro');

create table fis_categorias (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[A-Z0-9_]{2,40}$'),
  nome text not null,
  tributo_id uuid references fis_tributos(id),        -- nulo = qualquer tributo
  natureza text not null check (natureza in ('escritural', 'pagamento_indevido', 'saldo_negativo', 'retencao', 'judicial', 'administrativo', 'outro')),
  -- Formas de utilização permitidas pelos parâmetros cadastrados (validar com o contador):
  formas_utilizacao text[] not null default '{}'
    check (formas_utilizacao <@ array['deducao', 'compensacao', 'ressarcimento', 'restituicao', 'transferencia']),
  prazo_aproveitamento_meses int check (prazo_aproveitamento_meses between 1 and 600),   -- nulo = não parametrizado
  exige_processo boolean not null default false,
  documentos_exigidos text[] not null default '{}',
  regra_validada boolean not null default false,       -- o contador confirmou os parâmetros desta categoria
  regra_validada_por uuid references perfis(id),
  regra_validada_em timestamptz,
  observacao_legal text,                               -- fundamento informado pelo contador (o sistema não presume)
  ativo boolean not null default true
);
comment on table fis_categorias is 'Categorias de crédito com os parâmetros de aproveitamento. Valores iniciais NÃO validados: o contador confirma (regra_validada).';
create trigger trg_fis_categorias_sem_delete before delete on fis_categorias for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_categorias after insert or update on fis_categorias for each row execute function fn_auditoria();

insert into fis_categorias (codigo, nome, tributo_id, natureza, formas_utilizacao, documentos_exigidos, exige_processo) values
  ('ICMS_SALDO_CREDOR', 'Saldo credor de ICMS na apuração', (select id from fis_tributos where codigo = 'ICMS'), 'escritural', '{deducao}', '{memoria_calculo}', false),
  ('IPI_SALDO_CREDOR', 'Saldo credor de IPI na apuração', (select id from fis_tributos where codigo = 'IPI'), 'escritural', '{deducao}', '{memoria_calculo}', false),
  ('PIS_NAO_CUMULATIVO', 'Crédito de PIS (regime não cumulativo)', (select id from fis_tributos where codigo = 'PIS'), 'escritural', '{deducao}', '{memoria_calculo}', false),
  ('COFINS_NAO_CUMULATIVO', 'Crédito de Cofins (regime não cumulativo)', (select id from fis_tributos where codigo = 'COFINS'), 'escritural', '{deducao}', '{memoria_calculo}', false),
  ('PAGAMENTO_INDEVIDO', 'Pagamento indevido ou a maior', null, 'pagamento_indevido', '{compensacao,restituicao}', '{comprovante_pagamento,memoria_calculo}', false),
  ('SALDO_NEGATIVO_IRPJ', 'Saldo negativo de IRPJ', (select id from fis_tributos where codigo = 'IRPJ'), 'saldo_negativo', '{compensacao,restituicao}', '{memoria_calculo}', false),
  ('SALDO_NEGATIVO_CSLL', 'Saldo negativo de CSLL', (select id from fis_tributos where codigo = 'CSLL'), 'saldo_negativo', '{compensacao,restituicao}', '{memoria_calculo}', false),
  ('RETENCAO', 'Retenções tributárias sofridas', null, 'retencao', '{deducao}', '{memoria_calculo}', false),
  ('INSS_RESTITUICAO', 'Crédito previdenciário (INSS)', (select id from fis_tributos where codigo = 'INSS'), 'administrativo', '{compensacao}', '{memoria_calculo}', false),
  ('JUDICIAL', 'Crédito reconhecido em ação judicial', null, 'judicial', '{compensacao}', '{decisao,memoria_calculo}', true),
  ('OUTRO', 'Outro crédito (parametrizar)', null, 'outro', '{}', '{}', false);

create table fis_origens (
  codigo text primary key check (codigo ~ '^[a-z0-9_]{2,40}$'),
  nome text not null,
  ativo boolean not null default true
);
insert into fis_origens (codigo, nome) values
  ('apuracao_mensal', 'Apuração mensal (escrituração)'),
  ('escrituracao_extemporanea', 'Crédito extemporâneo / reconhecido de período anterior'),
  ('pagamento_indevido', 'Pagamento indevido ou a maior'),
  ('retencao_fonte', 'Retenção na fonte'),
  ('saldo_negativo', 'Saldo negativo de período'),
  ('decisao_judicial', 'Decisão judicial'),
  ('decisao_administrativa', 'Decisão administrativa'),
  ('implantacao_saldo', 'Implantação de saldo anterior ao sistema'),
  ('importacao_planilha', 'Importação de planilha'),
  ('outro', 'Outra origem');

-- Tipos de movimentação. A CLASSE define a coluna da apuração; o SINAL, se entra (+1) ou sai (−1). Estorno inverte o original.
create table fis_tipos_movimento (
  codigo text primary key check (codigo ~ '^[a-z0-9_]{2,40}$'),
  nome text not null,
  classe text not null check (classe in ('saldo_inicial', 'gerado', 'reconhecido', 'ajuste', 'utilizacao', 'compensacao', 'baixa', 'transferencia', 'estorno')),
  sinal smallint not null check (sinal in (-1, 0, 1)),
  forma text check (forma in ('deducao', 'compensacao', 'ressarcimento', 'restituicao', 'transferencia')),  -- exige a forma na categoria
  exige_aprovacao boolean not null default false,
  exige_protocolo boolean not null default false,
  sistema boolean not null default false,               -- tipos do sistema não mudam de classe/sinal
  ativo boolean not null default true,
  check ((classe = 'estorno') = (sinal = 0))
);
insert into fis_tipos_movimento (codigo, nome, classe, sinal, forma, exige_aprovacao, exige_protocolo, sistema) values
  ('saldo_inicial', 'Saldo inicial (implantação)', 'saldo_inicial', 1, null, true, false, true),
  ('credito_apurado', 'Crédito apurado no período', 'gerado', 1, null, false, false, true),
  ('credito_reconhecido', 'Crédito reconhecido (período anterior/decisão)', 'reconhecido', 1, null, false, false, true),
  ('ajuste_positivo', 'Ajuste positivo', 'ajuste', 1, null, true, false, true),
  ('atualizacao_monetaria', 'Atualização monetária (parametrizada)', 'ajuste', 1, null, true, false, true),
  ('ajuste_negativo', 'Ajuste negativo', 'ajuste', -1, null, true, false, true),
  ('utilizacao', 'Utilização (dedução na apuração)', 'utilizacao', -1, 'deducao', false, false, true),
  ('compensacao', 'Compensação (PER/DCOMP ou equivalente)', 'compensacao', -1, 'compensacao', false, false, true),
  ('ressarcimento', 'Ressarcimento', 'baixa', -1, 'ressarcimento', false, true, true),
  ('restituicao', 'Restituição', 'baixa', -1, 'restituicao', false, true, true),
  ('baixa', 'Baixa (glosa, prescrição, outros)', 'baixa', -1, null, true, false, true),
  ('transferencia_saida', 'Transferência autorizada (saída)', 'transferencia', -1, 'transferencia', true, false, true),
  ('transferencia_entrada', 'Transferência autorizada (entrada)', 'transferencia', 1, null, true, false, true),
  ('estorno', 'Estorno', 'estorno', 0, null, false, false, true);

create trigger trg_fis_tipos_movimento_sem_delete before delete on fis_tipos_movimento for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_tipos_movimento after insert or update on fis_tipos_movimento for each row execute function fn_auditoria();
create function fis_tipos_movimento_regras() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.sistema and (new.classe <> old.classe or new.sinal <> old.sinal or new.forma is distinct from old.forma or not new.sistema) then
    raise exception 'Tipo de movimentação do sistema não muda de classe, sinal ou forma.';
  end if;
  if tg_op = 'INSERT' and not new.sistema and new.classe in ('estorno', 'saldo_inicial') then
    raise exception 'Tipos novos não podem ser de estorno nem de saldo inicial.';
  end if;
  if tg_op = 'UPDATE' and new.sistema and not old.sistema then
    raise exception 'Tipo cadastrado pelo usuário não vira tipo do sistema.';
  end if;
  return new;
end $$;
create trigger trg_fis_tipos_movimento_regras before insert or update on fis_tipos_movimento for each row execute function fis_tipos_movimento_regras();

-- 3) CRÉDITOS -------------------------------------------------------------------------------------------------------------------
create type fis_validacao as enum ('pendente', 'em_analise', 'validado', 'rejeitado', 'contestado');
create sequence fis_creditos_numero;

create table fis_creditos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,                          -- CR-2026-00001
  empresa_id uuid not null references empresas(id),
  estabelecimento_id uuid not null references fis_estabelecimentos(id),
  tributo_id uuid not null references fis_tributos(id),
  categoria_id uuid not null references fis_categorias(id),
  origem text not null references fis_origens(codigo),
  competencia_origem date not null check (extract(day from competencia_origem) = 1),
  data_reconhecimento date,
  descricao text not null check (length(trim(descricao)) >= 3),
  numero_processo text,
  documento_ref text,                                   -- identificação do documento comprobatório (o arquivo vai em Documentos)
  valor_original numeric(14,2) not null check (valor_original > 0),
  valor_reconhecido numeric(14,2) check (valor_reconhecido >= 0 and valor_reconhecido <= valor_original),
  validacao fis_validacao not null default 'pendente',
  validado_por uuid references perfis(id),
  validado_em timestamptz,
  validacao_justificativa text,
  bloqueado boolean not null default false,
  bloqueio_motivo text,
  data_limite_aproveitamento date,
  responsavel_lancamento uuid references perfis(id) default auth.uid(),
  responsavel_id uuid references perfis(id),
  observacoes text,
  arquivado boolean not null default false,
  arquivado_em timestamptz,
  arquivado_por uuid references perfis(id),
  arquivado_motivo text,
  ficticio boolean not null default false,
  importacao_lote_id uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (not bloqueado or bloqueio_motivo is not null)
);
comment on table fis_creditos is 'Créditos tributários. O saldo nunca é digitado: vem do razão (fis_movimentos). Validação e disponibilidade são estados distintos.';
-- Duplicidade identificável: mesmo estabelecimento, tributo, categoria, origem, competência, valor e processo (não arquivado).
create unique index uq_fis_creditos_duplicidade on fis_creditos
  (estabelecimento_id, tributo_id, categoria_id, origem, competencia_origem, valor_original, coalesce(numero_processo, ''))
  where not arquivado;
create index idx_fis_creditos_empresa on fis_creditos (empresa_id, tributo_id);
create trigger trg_fis_creditos_atualizado before update on fis_creditos for each row execute function fn_atualizado_em();
create trigger trg_fis_creditos_sem_delete before delete on fis_creditos for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_creditos after insert or update on fis_creditos for each row execute function fn_auditoria();

-- Coerência: estabelecimento da empresa; categoria do tributo (ou genérica).
create function fis_creditos_coerencia() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from fis_estabelecimentos e where e.id = new.estabelecimento_id and e.empresa_id = new.empresa_id) then
    raise exception 'O estabelecimento não pertence à empresa informada.';
  end if;
  if exists (select 1 from fis_categorias c where c.id = new.categoria_id and c.tributo_id is not null and c.tributo_id <> new.tributo_id) then
    raise exception 'A categoria escolhida é de outro tributo.';
  end if;
  return new;
end $$;
create trigger trg_fis_creditos_coerencia before insert or update of empresa_id, estabelecimento_id, tributo_id, categoria_id on fis_creditos
  for each row execute function fis_creditos_coerencia();

-- 4) PERÍODOS (competência por estabelecimento e tributo) -------------------------------------------------------------------
create table fis_periodos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  estabelecimento_id uuid not null references fis_estabelecimentos(id),
  tributo_id uuid not null references fis_tributos(id),
  competencia date not null check (extract(day from competencia) = 1),
  status text not null default 'aberto' check (status in ('aberto', 'em_revisao', 'fechado')),
  requer_reconciliacao boolean not null default false,
  reconciliacao_motivo text,
  saldo_oficial numeric(14,2),                          -- saldo informado na apuração oficial (EFD, livro, PER/DCOMP…)
  saldo_oficial_fonte text,
  saldo_declarado numeric(14,2),                        -- saldo informado em declaração
  saldo_declarado_fonte text,
  diferenca_justificativa text,
  enviado_revisao_por uuid references perfis(id),
  enviado_revisao_em timestamptz,
  conferido_por uuid references perfis(id),
  fechado_por uuid references perfis(id),
  fechado_em timestamptz,
  snapshot jsonb,                                       -- valores congelados no fechamento
  reaberturas int not null default 0,
  ficticio boolean not null default false,
  unique (estabelecimento_id, tributo_id, competencia)
);
comment on table fis_periodos is 'Situação de cada competência (estabelecimento + tributo + mês): aberta, em revisão ou fechada, com saldo oficial para comparação.';
create trigger trg_fis_periodos_sem_delete before delete on fis_periodos for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_periodos after insert or update on fis_periodos for each row execute function fn_auditoria();

create table fis_periodos_eventos (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references fis_periodos(id),
  evento text not null check (evento in ('envio_revisao', 'fechamento', 'reabertura', 'reconciliacao', 'saldos_informados', 'marcado_reconciliar')),
  motivo text,
  dados jsonb,
  usuario_id uuid references perfis(id) default auth.uid(),
  em timestamptz not null default now()
);
create trigger trg_fis_periodos_eventos_imutavel before update or delete on fis_periodos_eventos for each row execute function fn_bloquear_alteracao();

create function fis_periodo_garantir(p_estab uuid, p_tributo uuid, p_comp date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from fis_periodos where estabelecimento_id = p_estab and tributo_id = p_tributo and competencia = p_comp;
  if v_id is null then
    insert into fis_periodos (empresa_id, estabelecimento_id, tributo_id, competencia)
    select e.empresa_id, p_estab, p_tributo, p_comp from fis_estabelecimentos e where e.id = p_estab
    on conflict (estabelecimento_id, tributo_id, competencia) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from fis_periodos where estabelecimento_id = p_estab and tributo_id = p_tributo and competencia = p_comp;
    end if;
  end if;
  return v_id;
end $$;
revoke all on function fis_periodo_garantir(uuid, uuid, date) from public, anon, authenticated;

-- 5) RAZÃO DE MOVIMENTAÇÕES ------------------------------------------------------------------------------------------------
create table fis_movimentos (
  id uuid primary key default gen_random_uuid(),
  numero bigserial unique,
  credito_id uuid not null references fis_creditos(id),
  empresa_id uuid not null references empresas(id),
  estabelecimento_id uuid not null references fis_estabelecimentos(id),
  tributo_id uuid not null references fis_tributos(id),
  tipo text not null references fis_tipos_movimento(codigo),
  classe text not null,                                -- classe efetiva (estorno herda a do original)
  natureza text not null check (natureza in ('entrada', 'saida')),  -- lado do original (estorno herda)
  valor numeric(14,2) not null check (valor > 0),
  valor_assinado numeric(14,2) not null,               -- efeito no saldo
  data date not null,
  competencia date not null check (extract(day from competencia) = 1),
  descricao text not null check (length(trim(descricao)) >= 3),
  documento_ref text,
  protocolo text,
  processo text,
  estorno_de uuid unique references fis_movimentos(id),
  corrige_id uuid references fis_movimentos(id),
  transferencia_id uuid,
  status text not null default 'efetivo' check (status in ('pendente', 'efetivo', 'rejeitado')),
  aprovado_por uuid references perfis(id),
  aprovado_em timestamptz,
  decisao_motivo text,
  estornado boolean not null default false,
  chave_idempotencia uuid unique,
  origem_registro text not null default 'manual' check (origem_registro in ('manual', 'importacao', 'sistema', 'demonstracao')),
  registrado_por uuid references perfis(id) default auth.uid(),
  registrado_em timestamptz not null default now(),
  check ((tipo = 'estorno') = (estorno_de is not null)),
  check (abs(valor_assinado) = valor)
);
comment on table fis_movimentos is 'Razão imutável dos créditos. Correção por estorno (e novo lançamento com corrige_id). Só efetivos contam no saldo.';
create index idx_fis_movimentos_credito on fis_movimentos (credito_id, competencia);
create index idx_fis_movimentos_chave on fis_movimentos (estabelecimento_id, tributo_id, competencia);
-- Duplicidade exata (mesmo crédito, tipo, competência, data, valor e protocolo) entre lançamentos vivos.
create unique index uq_fis_movimentos_duplicidade on fis_movimentos (credito_id, tipo, competencia, data, valor, coalesce(protocolo, ''))
  where tipo <> 'estorno' and not estornado and status <> 'rejeitado';
create trigger trg_fis_movimentos_sem_delete before delete on fis_movimentos for each row execute function fn_bloquear_delete();
create trigger trg_aud_fis_movimentos after insert or update on fis_movimentos for each row execute function fn_auditoria();

-- Imutável: só a decisão de um pendente e a marca de estornado mudam.
create function fis_movimentos_imutavel() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['status', 'aprovado_por', 'aprovado_em', 'decisao_motivo', 'estornado'])
     is distinct from (to_jsonb(old) - array['status', 'aprovado_por', 'aprovado_em', 'decisao_motivo', 'estornado']) then
    raise exception 'Movimentações são imutáveis: corrija por estorno.';
  end if;
  if new.status <> old.status and not (old.status = 'pendente' and new.status in ('efetivo', 'rejeitado')) then
    raise exception 'Só uma movimentação pendente pode ser aprovada ou rejeitada.';
  end if;
  if old.estornado and not new.estornado then
    raise exception 'Um estorno não pode ser desfeito.';
  end if;
  return new;
end $$;
create trigger trg_fis_movimentos_imutavel before update on fis_movimentos for each row execute function fis_movimentos_imutavel();

-- Competência fechada não recebe lançamento (nem aprovação de pendente).
create function fis_movimentos_periodo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if new.status <> 'efetivo' and new.status <> 'pendente' then return new; end if;
  if tg_op = 'UPDATE' and not (old.status = 'pendente' and new.status = 'efetivo') then return new; end if;
  perform fis_periodo_garantir(new.estabelecimento_id, new.tributo_id, new.competencia);
  select status into v_status from fis_periodos
   where estabelecimento_id = new.estabelecimento_id and tributo_id = new.tributo_id and competencia = new.competencia;
  if v_status = 'fechado' then
    raise exception 'A competência % está fechada para este estabelecimento e tributo. Para corrigir, reabra-a (com motivo) e feche de novo.',
      to_char(new.competencia, 'MM/YYYY');
  end if;
  return new;
end $$;
create trigger trg_fis_movimentos_periodo before insert or update of status on fis_movimentos for each row execute function fis_movimentos_periodo();

-- Lançamento efetivo numa competência anterior: as fechadas seguintes precisam de reconciliação.
create function fis_movimentos_reconciliar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'efetivo' or (tg_op = 'UPDATE' and old.status = 'efetivo') then return new; end if;
  with marcados as (
    update fis_periodos set requer_reconciliacao = true,
           reconciliacao_motivo = format('Movimentação nº %s em %s alterou o saldo transportado.', new.numero, to_char(new.competencia, 'MM/YYYY'))
     where estabelecimento_id = new.estabelecimento_id and tributo_id = new.tributo_id
       and competencia > new.competencia and status = 'fechado' and not requer_reconciliacao
    returning id
  )
  insert into fis_periodos_eventos (periodo_id, evento, motivo, dados)
  select id, 'marcado_reconciliar', format('Movimentação nº %s em competência anterior (%s).', new.numero, to_char(new.competencia, 'MM/YYYY')),
         jsonb_build_object('movimento_id', new.id) from marcados;
  return new;
end $$;
create trigger trg_fis_movimentos_reconciliar after insert or update of status on fis_movimentos for each row execute function fis_movimentos_reconciliar();

-- 6) SALDOS ---------------------------------------------------------------------------------------------------------------
-- Menor saldo acumulado a partir de p_comp (inclusive) se um débito de p_valor entrar em p_comp.
-- Considera os efetivos e, se pedido, os débitos pendentes (reserva).
create function fis_saldo_minimo_apos(p_credito uuid, p_comp date, p_reservar_pendentes boolean, p_ignorar uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  with m as (
    select competencia, valor_assinado from fis_movimentos
     where credito_id = p_credito and (p_ignorar is null or id <> p_ignorar)
       and (status = 'efetivo' or (p_reservar_pendentes and status = 'pendente' and valor_assinado < 0))
  ),
  base as (select coalesce(sum(valor_assinado), 0) v from m where competencia <= p_comp),
  depois as (
    select min(acum) v from (
      select competencia, sum(sum(valor_assinado)) over (order by competencia) acum from m group by competencia
    ) x where competencia > p_comp
  )
  select least((select v from base), coalesce((select v from depois), (select v from base)))
$$;
revoke all on function fis_saldo_minimo_apos(uuid, date, boolean, uuid) from public, anon;

-- Situação de cada crédito: totais por classe, saldo, pendências e disponibilidade (critérios cadastrados).
create view fis_creditos_saldos with (security_invoker = true) as
with m as (
  select credito_id,
    coalesce(sum(valor_assinado) filter (where status = 'efetivo'), 0) saldo,
    coalesce(sum(valor_assinado) filter (where status = 'efetivo' and classe in ('saldo_inicial', 'gerado', 'reconhecido')), 0) entradas,
    coalesce(sum(valor_assinado) filter (where status = 'efetivo' and classe = 'ajuste'), 0) ajustes,
    coalesce(-sum(valor_assinado) filter (where status = 'efetivo' and classe = 'utilizacao'), 0) utilizado,
    coalesce(-sum(valor_assinado) filter (where status = 'efetivo' and classe = 'compensacao'), 0) compensado,
    coalesce(-sum(valor_assinado) filter (where status = 'efetivo' and classe = 'baixa'), 0) baixado,
    coalesce(sum(valor_assinado) filter (where status = 'efetivo' and classe = 'transferencia'), 0) transferido,
    coalesce(-sum(valor_assinado) filter (where status = 'pendente' and valor_assinado < 0), 0) pendente_saida,
    coalesce(sum(valor_assinado) filter (where status = 'pendente' and valor_assinado > 0), 0) pendente_entrada,
    count(*) filter (where status = 'pendente') pendentes
  from fis_movimentos group by credito_id
)
select c.id, c.codigo, c.empresa_id, c.estabelecimento_id, c.tributo_id, c.categoria_id, c.origem, c.competencia_origem, c.data_reconhecimento,
       c.descricao, c.numero_processo, c.documento_ref, c.valor_original, c.valor_reconhecido, c.validacao, c.validado_por, c.validado_em,
       c.bloqueado, c.bloqueio_motivo, c.data_limite_aproveitamento, c.responsavel_lancamento, c.responsavel_id, c.observacoes,
       c.arquivado, c.ficticio, c.criado_em,
       coalesce(m.saldo, 0)::numeric(14,2) saldo,
       coalesce(m.entradas, 0)::numeric(14,2) entradas,
       coalesce(m.ajustes, 0)::numeric(14,2) ajustes,
       coalesce(m.utilizado, 0)::numeric(14,2) utilizado,
       coalesce(m.compensado, 0)::numeric(14,2) compensado,
       coalesce(m.baixado, 0)::numeric(14,2) baixado,
       coalesce(m.transferido, 0)::numeric(14,2) transferido,
       coalesce(m.pendente_saida, 0)::numeric(14,2) pendente_saida,
       coalesce(m.pendente_entrada, 0)::numeric(14,2) pendente_entrada,
       coalesce(m.pendentes, 0)::int pendentes,
       case
         when c.arquivado then 'arquivado'
         when c.validacao = 'rejeitado' then 'rejeitado'
         when c.validacao = 'contestado' then 'contestado'
         when c.validacao <> 'validado' then 'pendente_validacao'
         when c.bloqueado then 'bloqueado'
         when c.data_limite_aproveitamento is not null and c.data_limite_aproveitamento < (now() at time zone 'America/Cuiaba')::date then 'prazo_expirado'
         when coalesce(m.saldo, 0) <= 0 then 'esgotado'
         else 'disponivel'
       end disponibilidade,
       case
         when not c.arquivado and c.validacao = 'validado' and not c.bloqueado
          and (c.data_limite_aproveitamento is null or c.data_limite_aproveitamento >= (now() at time zone 'America/Cuiaba')::date)
         then greatest(coalesce(m.saldo, 0) - coalesce(m.pendente_saida, 0), 0)
         else 0
       end::numeric(14,2) saldo_disponivel
  from fis_creditos c left join m on m.credito_id = c.id;

-- 7) APURAÇÃO (uma fonte só; espelho em TS: lib/modulos/fiscal/creditos/apuracao.ts) -------------------------------------
-- Por crédito e competência: saldo inicial (transportado + implantação do mês, que também sai em "implantado"), entradas,
-- ajustes, saídas e saldo final.
-- Saldo final = saldo inicial + gerado + reconhecido + ajustes(+) − ajustes(−) − utilizado − compensado − baixado
--               + transferências recebidas − transferências enviadas. Estornos entram na coluna do lançamento original.
create function fis_apuracao(p_inicio date, p_fim date, p_empresa uuid default null, p_estabelecimento uuid default null, p_tributo uuid default null)
returns table (
  credito_id uuid, empresa_id uuid, estabelecimento_id uuid, tributo_id uuid, competencia date,
  saldo_inicial numeric, implantado numeric, gerado numeric, reconhecido numeric, ajustes_positivos numeric, ajustes_negativos numeric,
  utilizado numeric, compensado numeric, baixado numeric, transferido_entrada numeric, transferido_saida numeric,
  saldo_final numeric, pendentes int
)
language sql stable set search_path = public as $$
  with cred as (
    select c.id, c.empresa_id, c.estabelecimento_id, c.tributo_id, c.competencia_origem from fis_creditos c
     where (p_empresa is null or c.empresa_id = p_empresa)
       and (p_estabelecimento is null or c.estabelecimento_id = p_estabelecimento)
       and (p_tributo is null or c.tributo_id = p_tributo)
  ),
  mov as (
    select m.* from fis_movimentos m join cred on cred.id = m.credito_id where m.competencia <= p_fim
  ),
  inicio as (
    select cred.id, least(cred.competencia_origem, coalesce(min(mov.competencia), cred.competencia_origem)) primeira
      from cred left join mov on mov.credito_id = cred.id group by cred.id, cred.competencia_origem
  ),
  anterior as (
    select credito_id, sum(valor_assinado) v from mov where status = 'efetivo' and competencia < p_inicio group by credito_id
  ),
  mes as (
    select credito_id, competencia,
      coalesce(sum(valor_assinado) filter (where status = 'efetivo'), 0) total,
      coalesce(sum(valor_assinado) filter (where status = 'efetivo' and classe = 'saldo_inicial'), 0) implantacao,
      coalesce(sum(valor_assinado) filter (where status = 'efetivo' and classe = 'gerado'), 0) gerado,
      coalesce(sum(valor_assinado) filter (where status = 'efetivo' and classe = 'reconhecido'), 0) reconhecido,
      coalesce(sum(valor_assinado) filter (where status = 'efetivo' and classe = 'ajuste' and natureza = 'entrada'), 0) aj_pos,
      coalesce(-sum(valor_assinado) filter (where status = 'efetivo' and classe = 'ajuste' and natureza = 'saida'), 0) aj_neg,
      coalesce(-sum(valor_assinado) filter (where status = 'efetivo' and classe = 'utilizacao'), 0) utilizado,
      coalesce(-sum(valor_assinado) filter (where status = 'efetivo' and classe = 'compensacao'), 0) compensado,
      coalesce(-sum(valor_assinado) filter (where status = 'efetivo' and classe = 'baixa'), 0) baixado,
      coalesce(sum(valor_assinado) filter (where status = 'efetivo' and classe = 'transferencia' and natureza = 'entrada'), 0) tr_ent,
      coalesce(-sum(valor_assinado) filter (where status = 'efetivo' and classe = 'transferencia' and natureza = 'saida'), 0) tr_sai,
      count(*) filter (where status = 'pendente')::int pendentes
    from mov where competencia >= p_inicio group by credito_id, competencia
  ),
  grade as (
    select cred.*, g::date competencia
      from cred join inicio on inicio.id = cred.id
      cross join generate_series(date_trunc('month', p_inicio)::date, date_trunc('month', p_fim)::date, interval '1 month') g
     where g::date >= inicio.primeira
  ),
  linhas as (
    select grade.id credito_id, grade.empresa_id, grade.estabelecimento_id, grade.tributo_id, grade.competencia,
           coalesce(anterior.v, 0) + coalesce(sum(coalesce(mes.total, 0)) over (partition by grade.id order by grade.competencia), 0) saldo_final,
           coalesce(mes.total, 0) total, coalesce(mes.implantacao, 0) implantacao, coalesce(mes.gerado, 0) gerado,
           coalesce(mes.reconhecido, 0) reconhecido, coalesce(mes.aj_pos, 0) aj_pos, coalesce(mes.aj_neg, 0) aj_neg,
           coalesce(mes.utilizado, 0) utilizado, coalesce(mes.compensado, 0) compensado, coalesce(mes.baixado, 0) baixado,
           coalesce(mes.tr_ent, 0) tr_ent, coalesce(mes.tr_sai, 0) tr_sai, coalesce(mes.pendentes, 0) pendentes
      from grade
      left join anterior on anterior.credito_id = grade.id
      left join mes on mes.credito_id = grade.id and mes.competencia = grade.competencia
  )
  select credito_id, empresa_id, estabelecimento_id, tributo_id, competencia,
         (saldo_final - total + implantacao)::numeric(14,2), implantacao::numeric(14,2), gerado::numeric(14,2), reconhecido::numeric(14,2), aj_pos::numeric(14,2), aj_neg::numeric(14,2),
         utilizado::numeric(14,2), compensado::numeric(14,2), baixado::numeric(14,2), tr_ent::numeric(14,2), tr_sai::numeric(14,2),
         saldo_final::numeric(14,2), pendentes
    from linhas
   order by estabelecimento_id, tributo_id, credito_id, competencia
$$;

-- Totais de uma competência (estabelecimento + tributo), para fechamento e comparação.
create function fis_apuracao_chave(p_estab uuid, p_tributo uuid, p_comp date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'saldo_inicial', coalesce(sum(saldo_inicial), 0), 'implantado', coalesce(sum(implantado), 0), 'gerado', coalesce(sum(gerado), 0), 'reconhecido', coalesce(sum(reconhecido), 0),
    'ajustes_positivos', coalesce(sum(ajustes_positivos), 0), 'ajustes_negativos', coalesce(sum(ajustes_negativos), 0),
    'utilizado', coalesce(sum(utilizado), 0), 'compensado', coalesce(sum(compensado), 0), 'baixado', coalesce(sum(baixado), 0),
    'transferido_entrada', coalesce(sum(transferido_entrada), 0), 'transferido_saida', coalesce(sum(transferido_saida), 0),
    'saldo_final', coalesce(sum(saldo_final), 0), 'pendentes', coalesce(sum(pendentes), 0), 'creditos', count(*),
    'por_credito', coalesce(jsonb_agg(jsonb_build_object('credito_id', credito_id, 'saldo_inicial', saldo_inicial, 'saldo_final', saldo_final)), '[]'::jsonb))
  from fis_apuracao(p_comp, p_comp, null, p_estab, p_tributo)
$$;

-- 8) RLS ------------------------------------------------------------------------------------------------------------------------
alter table fis_membros enable row level security;
alter table fis_estabelecimentos enable row level security;
alter table fis_tributos enable row level security;
alter table fis_tipos_documento enable row level security;
alter table fis_categorias enable row level security;
alter table fis_origens enable row level security;
alter table fis_tipos_movimento enable row level security;
alter table fis_creditos enable row level security;
alter table fis_periodos enable row level security;
alter table fis_periodos_eventos enable row level security;
alter table fis_movimentos enable row level security;

create policy fis_membros_ler on fis_membros for select to authenticated using (perfil_id = auth.uid() or fis_pode('parametrizar'));
create policy fis_estabelecimentos_ler on fis_estabelecimentos for select to authenticated using (fis_pode('ler', empresa_id));
create policy fis_tributos_ler on fis_tributos for select to authenticated using (fis_pode('ler'));
create policy fis_tipos_documento_ler on fis_tipos_documento for select to authenticated using (fis_pode('ler'));
create policy fis_categorias_ler on fis_categorias for select to authenticated using (fis_pode('ler'));
create policy fis_origens_ler on fis_origens for select to authenticated using (fis_pode('ler'));
create policy fis_tipos_movimento_ler on fis_tipos_movimento for select to authenticated using (fis_pode('ler'));
create policy fis_creditos_ler on fis_creditos for select to authenticated using (fis_pode('ler', empresa_id));
create policy fis_periodos_ler on fis_periodos for select to authenticated using (fis_pode('ler', empresa_id));
create policy fis_periodos_eventos_ler on fis_periodos_eventos for select to authenticated
  using (exists (select 1 from fis_periodos p where p.id = periodo_id));
create policy fis_movimentos_ler on fis_movimentos for select to authenticated using (fis_pode('ler', empresa_id));
-- Escrita somente pelas funções fis_* (security definer), que conferem papel, escopo e regras.
