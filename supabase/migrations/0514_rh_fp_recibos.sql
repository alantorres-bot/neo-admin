-- =========================================================
-- Neo Admin — 0514 RH/SST > Folha de pagamento: recibos de pagamento avulsos
-- Padroniza os recibos que o RH fazia à mão em .xls (pasta AVULSO): recorrentes (modelo por pessoa), compra de férias (um recibo
-- por mês), início antes do registro e eventuais. O avulso da folha do mês passa a ser a SOMA dos recibos da pessoa (não se
-- digita mais na grade). Especificação: docs/modulos/rh-folha.md, capítulo "Recibos avulsos" (decisões de 15/10/2026).
--
-- O cálculo de cada linha é feito pelo app (lib/modulos/rh/folha/recibos.ts, testado); o banco guarda as linhas, confere que o
-- total é a soma delas e mantém o avulso da folha.
-- =========================================================

-- 1) Cadastro: dados para os recibos --------------------------------------------------------------------------------------------
alter table rh_colaboradores
  add column salario numeric(14,2) check (salario > 0),
  add column funcao text,
  add column insalubridade_pct int not null default 0 check (insalubridade_pct in (0, 10, 20, 40)),
  add column adicional_noturno_pct int not null default 0 check (adicional_noturno_pct between 0 and 100);

create function rh_salvar_dados_recibo(p_colaborador uuid, p_salario numeric, p_funcao text, p_insalubridade int, p_noturno int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('operador');
  update rh_colaboradores set salario = round(p_salario, 2), funcao = nullif(upper(trim(p_funcao)), ''),
         insalubridade_pct = coalesce(p_insalubridade, 0), adicional_noturno_pct = coalesce(p_noturno, 0), atualizado_por = auth.uid()
   where id = p_colaborador;
  if not found then raise exception 'Colaborador não encontrado.'; end if;
end $$;
revoke all on function rh_salvar_dados_recibo(uuid, numeric, text, int, int) from public, anon;

-- 2) Parâmetros com vigência ---------------------------------------------------------------------------------------------------
create table rh_parametros (
  chave text not null check (chave in ('assiduidade_mensal', 'salario_minimo')),
  vigente_desde date not null check (extract(day from vigente_desde) = 1),
  valor numeric(14,2) not null check (valor > 0),
  atualizado_por uuid references perfis(id) default auth.uid(),
  atualizado_em timestamptz not null default now(),
  primary key (chave, vigente_desde)
);
comment on table rh_parametros is 'Valores do RH com vigência: assiduidade mensal da CCT e salário mínimo (base da insalubridade).';
insert into rh_parametros (chave, vigente_desde, valor, atualizado_por) values
  ('assiduidade_mensal', '2026-01-01', 120.00, null), ('assiduidade_mensal', '2026-06-01', 185.00, null), ('salario_minimo', '2026-01-01', 1621.00, null);
create trigger trg_aud_rh_parametros after insert or update on rh_parametros for each row execute function fn_auditoria();
alter table rh_parametros enable row level security;
create policy rh_parametros_ler on rh_parametros for select to authenticated using (tem_acesso_area('rh'));

create function rh_salvar_parametro(p_chave text, p_vigente_desde date, p_valor numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('gestor');
  insert into rh_parametros (chave, vigente_desde, valor) values (p_chave, date_trunc('month', p_vigente_desde)::date, round(p_valor, 2))
  on conflict (chave, vigente_desde) do update set valor = excluded.valor, atualizado_por = auth.uid(), atualizado_em = now();
end $$;
revoke all on function rh_salvar_parametro(text, date, numeric) from public, anon;

-- 3) Rubricas -------------------------------------------------------------------------------------------------------------------
create table rh_fp_rubricas (
  codigo text primary key check (codigo ~ '^[a-z0-9_]{2,40}$'),
  descricao text not null,
  natureza text not null check (natureza in ('provento', 'desconto')),
  forma text not null check (forma in ('dias', 'horas', 'mensal_proporcional', 'pct_salario_dias', 'pct_base_dias', 'fracao_salario', 'valor')),
  parametro text check (parametro in ('assiduidade_mensal', 'salario_minimo')),
  pct_campo text check (pct_campo in ('insalubridade_pct', 'adicional_noturno_pct')),
  ordem int not null default 100,
  ativo boolean not null default true,
  check ((forma in ('mensal_proporcional', 'pct_base_dias')) = (parametro is not null)),
  check ((forma in ('pct_salario_dias', 'pct_base_dias')) = (pct_campo is not null))
);
comment on table rh_fp_rubricas is 'Catálogo das rubricas dos recibos avulsos e a forma de cálculo de cada uma.';
insert into rh_fp_rubricas (codigo, descricao, natureza, forma, parametro, pct_campo, ordem) values
  ('dias_normais', 'DIAS NORMAIS', 'provento', 'dias', null, null, 10),
  ('horas_normais', 'HORAS NORMAIS', 'provento', 'horas', null, null, 11),
  ('salario_ferias', 'SALÁRIO - FÉRIAS', 'provento', 'dias', null, null, 12),
  ('salario_por_fora', 'SALÁRIO - POR FORA', 'provento', 'dias', null, null, 13),
  ('ferias_por_fora', 'FÉRIAS - POR FORA', 'provento', 'dias', null, null, 14),
  ('terco_ferias', '1/3 FÉRIAS', 'provento', 'fracao_salario', null, null, 15),
  ('assiduidade', 'ASSIDUIDADE CCT', 'provento', 'mensal_proporcional', 'assiduidade_mensal', null, 20),
  ('insalubridade', 'INSALUBRIDADE', 'provento', 'pct_base_dias', 'salario_minimo', 'insalubridade_pct', 21),
  ('adicional_noturno', 'ADICIONAL NOTURNO', 'provento', 'pct_salario_dias', null, 'adicional_noturno_pct', 22),
  ('bonificacao_producao', 'BONIFICAÇÃO POR PRODUÇÃO', 'provento', 'fracao_salario', null, null, 30),
  ('bonificacao_lideranca', 'BONIFICAÇÃO DE LIDERANÇA', 'provento', 'valor', null, null, 31),
  ('gratificacao', 'GRATIFICAÇÕES', 'provento', 'valor', null, null, 32),
  ('diferenca_salario', 'DIFERENÇA DE SALÁRIO', 'provento', 'valor', null, null, 33),
  ('reembolso_irrf', 'REEMBOLSO PARC. IRRF', 'provento', 'valor', null, null, 34),
  ('outros_proventos', 'OUTROS PROVENTOS', 'provento', 'valor', null, null, 39),
  ('vale_transporte', 'VALE TRANSPORTE', 'desconto', 'valor', null, null, 50),
  ('desconto_lote', 'PARCELA LOTE', 'desconto', 'valor', null, null, 51),
  ('outros_descontos', 'OUTROS DESCONTOS', 'desconto', 'valor', null, null, 59);
create trigger trg_aud_rh_fp_rubricas after insert or update on rh_fp_rubricas for each row execute function fn_auditoria();
alter table rh_fp_rubricas enable row level security;
create policy rh_fp_rubricas_ler on rh_fp_rubricas for select to authenticated using (tem_acesso_area('rh'));

create function rh_fp_salvar_rubrica(p_codigo text, p_descricao text, p_natureza text, p_forma text, p_parametro text, p_pct_campo text, p_ordem int, p_ativo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('gestor');
  insert into rh_fp_rubricas (codigo, descricao, natureza, forma, parametro, pct_campo, ordem, ativo)
  values (lower(trim(p_codigo)), upper(trim(p_descricao)), p_natureza, p_forma, nullif(p_parametro, ''), nullif(p_pct_campo, ''), coalesce(p_ordem, 100), coalesce(p_ativo, true))
  on conflict (codigo) do update set descricao = excluded.descricao, natureza = excluded.natureza, forma = excluded.forma,
    parametro = excluded.parametro, pct_campo = excluded.pct_campo, ordem = excluded.ordem, ativo = excluded.ativo;
end $$;
revoke all on function rh_fp_salvar_rubrica(text, text, text, text, text, text, int, boolean) from public, anon;

-- 4) Recibos ---------------------------------------------------------------------------------------------------------------------
create table rh_fp_recibos (
  id uuid primary key default gen_random_uuid(),
  competencia date not null check (extract(day from competencia) = 1),
  colaborador_id uuid not null references rh_colaboradores(id),
  tipo text not null check (tipo in ('recorrente', 'compra_ferias', 'inicio_antes_registro', 'eventual')),
  -- foto dos dados da pessoa usados no cálculo
  salario numeric(14,2),
  insalubridade_pct int not null default 0,
  adicional_noturno_pct int not null default 0,
  funcao text,
  periodo_inicio date, periodo_fim date,
  mensagem text,
  proventos numeric(14,2) not null,
  descontos numeric(14,2) not null,
  total numeric(14,2) not null check (total >= 0),
  cancelado boolean not null default false,
  cancelado_motivo text, cancelado_por uuid references perfis(id), cancelado_em timestamptz,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  check (total = proventos - descontos),
  check ((periodo_inicio is null) = (periodo_fim is null) and (periodo_fim is null or periodo_fim >= periodo_inicio)),
  check (not cancelado or coalesce(trim(cancelado_motivo), '') <> '')
);
comment on table rh_fp_recibos is 'Recibos de pagamento avulsos (fora da folha do escritório). O total entra no avulso da folha do mês da pessoa.';
create index idx_rh_fp_recibos_comp on rh_fp_recibos (competencia, colaborador_id) where not cancelado;

create table rh_fp_recibo_linhas (
  id uuid primary key default gen_random_uuid(),
  recibo_id uuid not null references rh_fp_recibos(id),
  ordem int not null,
  rubrica text not null references rh_fp_rubricas(codigo),
  descricao text not null,
  natureza text not null check (natureza in ('provento', 'desconto')),
  referencia numeric(12,4) not null default 0,
  valor numeric(14,2) not null check (valor >= 0)
);
create index idx_rh_fp_recibo_linhas on rh_fp_recibo_linhas (recibo_id, ordem);

create table rh_fp_recibo_modelos (
  colaborador_id uuid primary key references rh_colaboradores(id),
  linhas jsonb not null check (jsonb_typeof(linhas) = 'array' and jsonb_array_length(linhas) > 0),   -- [{rubrica, referencia, valor?}]
  ativo boolean not null default true,
  atualizado_por uuid references perfis(id) default auth.uid(),
  atualizado_em timestamptz not null default now()
);
comment on table rh_fp_recibo_modelos is 'Recibo recorrente de cada pessoa (rubricas e referências); gerado ao abrir a folha do mês.';

create trigger trg_rh_fp_recibos_sem_delete before delete on rh_fp_recibos for each row execute function fn_bloquear_delete();
create trigger trg_rh_fp_recibo_linhas_sem_delete before delete on rh_fp_recibo_linhas for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_fp_recibos after insert or update on rh_fp_recibos for each row execute function fn_auditoria();
create trigger trg_aud_rh_fp_recibo_modelos after insert or update on rh_fp_recibo_modelos for each row execute function fn_auditoria();
alter table rh_fp_recibos enable row level security;
alter table rh_fp_recibo_linhas enable row level security;
alter table rh_fp_recibo_modelos enable row level security;
create policy rh_fp_recibos_ler on rh_fp_recibos for select to authenticated using (tem_acesso_area('rh'));
create policy rh_fp_recibo_linhas_ler on rh_fp_recibo_linhas for select to authenticated using (tem_acesso_area('rh'));
create policy rh_fp_recibo_modelos_ler on rh_fp_recibo_modelos for select to authenticated using (tem_acesso_area('rh'));

-- 5) Avulso da folha = soma dos recibos ------------------------------------------------------------------------------------------
create function rh_fp_recalcular_avulso(p_competencia date, p_colaborador uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_motivo text;
begin
  select coalesce(sum(r.total), 0),
         string_agg(case r.tipo when 'recorrente' then 'recorrente' when 'compra_ferias' then 'compra de férias' when 'inicio_antes_registro' then 'início antes do registro' else 'eventual' end
                    || case when r.periodo_inicio is not null then ' ' || to_char(r.periodo_inicio, 'DD/MM') || '–' || to_char(r.periodo_fim, 'DD/MM') else '' end, '; ' order by r.criado_em)
    into v_total, v_motivo
    from rh_fp_recibos r where r.competencia = p_competencia and r.colaborador_id = p_colaborador and not r.cancelado;
  update rh_fp_itens i set avulso = v_total, avulso_motivo = case when v_total > 0 then 'Recibo(s): ' || v_motivo end, atualizado_por = auth.uid()
    from rh_fp_competencias c
   where c.id = i.competencia_id and c.competencia = p_competencia and c.status = 'aberta' and i.colaborador_id = p_colaborador
     and (i.avulso, i.avulso_motivo) is distinct from (v_total, case when v_total > 0 then 'Recibo(s): ' || v_motivo end);
end $$;
revoke all on function rh_fp_recalcular_avulso(date, uuid) from public, anon, authenticated;

-- Grava um recibo (p_linhas: [{rubrica, descricao, referencia, valor}] já calculadas pelo app). p_substitui: recibo que este
-- substitui (é cancelado com o motivo "Substituído"). A folha do mês, se já existir, tem de estar aberta e com a pessoa.
create function rh_fp_gravar_recibo(p_competencia date, p_colaborador uuid, p_tipo text, p_salario numeric, p_insalubridade int, p_noturno int,
                                    p_funcao text, p_inicio date, p_fim date, p_mensagem text, p_linhas jsonb, p_substitui uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_mes rh_fp_competencias;
  v_id uuid;
  v_prov numeric; v_desc numeric;
begin
  perform rh_exigir('operador');
  if not exists (select 1 from rh_colaboradores where id = p_colaborador) then raise exception 'Colaborador não encontrado.'; end if;
  select * into v_mes from rh_fp_competencias where competencia = v_comp;
  if v_mes.id is not null and v_mes.status <> 'aberta' then
    raise exception 'A folha de % não está aberta; para mudar recibos, o gestor precisa reabrir.', rh_vt_rotulo_mes(v_comp);
  end if;
  if v_mes.id is not null and not exists (select 1 from rh_fp_itens where competencia_id = v_mes.id and colaborador_id = p_colaborador) then
    raise exception 'A pessoa não está na folha de %; use "Atualizar do cadastro" na folha.', rh_vt_rotulo_mes(v_comp);
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then raise exception 'O recibo não tem linhas.'; end if;
  if exists (select 1 from jsonb_to_recordset(p_linhas) as x(rubrica text) left join rh_fp_rubricas r on r.codigo = x.rubrica where r.codigo is null) then
    raise exception 'Rubrica desconhecida no recibo.';
  end if;
  select coalesce(sum(x.valor) filter (where r.natureza = 'provento'), 0), coalesce(sum(x.valor) filter (where r.natureza = 'desconto'), 0)
    into v_prov, v_desc
    from jsonb_to_recordset(p_linhas) as x(rubrica text, valor numeric) join rh_fp_rubricas r on r.codigo = x.rubrica;
  if v_prov - v_desc < 0 then raise exception 'Os descontos passam dos proventos: o recibo ficaria negativo.'; end if;
  if p_substitui is not null then
    update rh_fp_recibos set cancelado = true, cancelado_motivo = 'Substituído por um novo recibo', cancelado_por = auth.uid(), cancelado_em = now()
     where id = p_substitui and not cancelado and colaborador_id = p_colaborador;
    if not found then raise exception 'O recibo a substituir não existe ou já foi cancelado.'; end if;
  end if;
  insert into rh_fp_recibos (competencia, colaborador_id, tipo, salario, insalubridade_pct, adicional_noturno_pct, funcao, periodo_inicio, periodo_fim, mensagem, proventos, descontos, total)
  values (v_comp, p_colaborador, p_tipo, round(p_salario, 2), coalesce(p_insalubridade, 0), coalesce(p_noturno, 0), nullif(trim(p_funcao), ''),
          p_inicio, p_fim, nullif(trim(p_mensagem), ''), round(v_prov, 2), round(v_desc, 2), round(v_prov - v_desc, 2))
  returning id into v_id;
  insert into rh_fp_recibo_linhas (recibo_id, ordem, rubrica, descricao, natureza, referencia, valor)
  select v_id, x.ord, x.rubrica, coalesce(nullif(trim(x.descricao), ''), r.descricao), r.natureza, coalesce(x.referencia, 0), round(x.valor, 2)
    from rows from (jsonb_to_recordset(p_linhas) as (rubrica text, descricao text, referencia numeric, valor numeric)) with ordinality as x(rubrica, descricao, referencia, valor, ord)
    join rh_fp_rubricas r on r.codigo = x.rubrica;
  perform rh_fp_recalcular_avulso(v_comp, p_colaborador);
  return v_id;
end $$;
revoke all on function rh_fp_gravar_recibo(date, uuid, text, numeric, int, int, text, date, date, text, jsonb, uuid) from public, anon;

create function rh_fp_cancelar_recibo(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r rh_fp_recibos;
begin
  perform rh_exigir('operador');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into r from rh_fp_recibos where id = p_id for update;
  if r.id is null or r.cancelado then raise exception 'Recibo não encontrado ou já cancelado.'; end if;
  if exists (select 1 from rh_fp_competencias where competencia = r.competencia and status <> 'aberta') then
    raise exception 'A folha de % não está aberta; para cancelar o recibo, o gestor precisa reabrir.', rh_vt_rotulo_mes(r.competencia);
  end if;
  update rh_fp_recibos set cancelado = true, cancelado_motivo = trim(p_motivo), cancelado_por = auth.uid(), cancelado_em = now() where id = p_id;
  perform rh_fp_recalcular_avulso(r.competencia, r.colaborador_id);
end $$;
revoke all on function rh_fp_cancelar_recibo(uuid, text) from public, anon;

create function rh_fp_salvar_modelo(p_colaborador uuid, p_linhas jsonb, p_ativo boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('operador');
  if exists (select 1 from jsonb_to_recordset(p_linhas) as x(rubrica text) left join rh_fp_rubricas r on r.codigo = x.rubrica where r.codigo is null) then
    raise exception 'Rubrica desconhecida no modelo.';
  end if;
  insert into rh_fp_recibo_modelos (colaborador_id, linhas, ativo) values (p_colaborador, p_linhas, coalesce(p_ativo, true))
  on conflict (colaborador_id) do update set linhas = excluded.linhas, ativo = excluded.ativo, atualizado_por = auth.uid(), atualizado_em = now();
end $$;
revoke all on function rh_fp_salvar_modelo(uuid, jsonb, boolean) from public, anon;

-- 6) A folha: avulso não se digita mais; ao abrir o mês e ao incluir pessoas, soma os recibos já feitos ---------------------------
create or replace function rh_fp_salvar_itens(p_id uuid, p_itens jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_n int;
begin
  perform rh_exigir('operador');
  c := rh_fp_competencia_para(p_id, array['aberta']);
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Nada para salvar.'; end if;
  update rh_fp_itens i set
    forma_pagamento = coalesce(x.forma_pagamento, i.forma_pagamento),
    liquido = round(coalesce(x.liquido, 0), 2), ferias_acrescimos = round(coalesce(x.ferias_acrescimos, 0), 2),
    decimo_terceiro = round(coalesce(x.decimo_terceiro, 0), 2),
    observacao = nullif(trim(x.observacao), ''), atualizado_por = auth.uid()   -- avulso vem dos recibos (0514)
    from jsonb_to_recordset(p_itens) as x(id uuid, forma_pagamento text, liquido numeric, ferias_acrescimos numeric, decimo_terceiro numeric, observacao text)
   where i.id = x.id and i.competencia_id = p_id;
  get diagnostics v_n = row_count;
  if v_n <> jsonb_array_length(p_itens) then raise exception 'Algumas linhas não pertencem a este mês; recarregue a página.'; end if;
  return v_n;
end $$;

create function rh_fp_somar_recibos_do_mes(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  k uuid;
begin
  select * into c from rh_fp_competencias where id = p_id;
  for k in select distinct colaborador_id from rh_fp_recibos where competencia = c.competencia and not cancelado loop
    perform rh_fp_recalcular_avulso(c.competencia, k);
  end loop;
end $$;
revoke all on function rh_fp_somar_recibos_do_mes(uuid) from public, anon, authenticated;

create or replace function rh_fp_abrir_competencia(p_competencia date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_pag date := rh_enesimo_dia_util((v_comp + interval '1 month')::date, 5);
  v_id uuid;
begin
  perform rh_exigir('operador');
  if exists (select 1 from rh_fp_competencias where competencia = v_comp) then
    raise exception 'A folha de % já foi aberta.', rh_vt_rotulo_mes(v_comp);
  end if;
  insert into rh_fp_competencias (competencia, data_pagamento) values (v_comp, v_pag) returning id into v_id;
  -- ativos + quem já tem recibo para este mês (ex.: compra de férias que cruzou o mês)
  insert into rh_fp_itens (competencia_id, colaborador_id, empresa_id, empregador, cod_fornecedor, matricula_escritorio, nome, cpf, agencia, conta,
                           forma_pagamento, atualizado_por)
  select v_id, c.id, c.empresa_id, c.empregador, c.cod_fornecedor, c.matricula_escritorio, c.nome, c.cpf, c.agencia, c.conta, c.forma_pagamento, auth.uid()
    from rh_colaboradores c
   where c.ativo or exists (select 1 from rh_fp_recibos r where r.competencia = v_comp and r.colaborador_id = c.id and not r.cancelado);
  perform rh_fp_somar_recibos_do_mes(v_id);
  perform rh_fp_abrir_pendencia(v_id, 'Fechar folha de ' || rh_vt_rotulo_mes(v_comp),
    'Lançar líquidos, férias/acréscimos e 13º, conferir os recibos avulsos e marcar a folha como conferida.', v_pag);
  return v_id;
end $$;

create or replace function rh_fp_atualizar_do_cadastro(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_atu int; v_inc int;
begin
  perform rh_exigir('operador');
  c := rh_fp_competencia_para(p_id, array['aberta']);
  update rh_fp_itens i set empresa_id = k.empresa_id, empregador = k.empregador, cod_fornecedor = k.cod_fornecedor, matricula_escritorio = k.matricula_escritorio,
         nome = k.nome, cpf = k.cpf, agencia = k.agencia, conta = k.conta, atualizado_por = auth.uid()
    from rh_colaboradores k
   where i.competencia_id = p_id and k.id = i.colaborador_id
     and (i.empresa_id, i.empregador, i.cod_fornecedor, i.matricula_escritorio, i.nome, i.cpf, i.agencia, i.conta)
         is distinct from (k.empresa_id, k.empregador, k.cod_fornecedor, k.matricula_escritorio, k.nome, k.cpf, k.agencia, k.conta);
  get diagnostics v_atu = row_count;
  insert into rh_fp_itens (competencia_id, colaborador_id, empresa_id, empregador, cod_fornecedor, matricula_escritorio, nome, cpf, agencia, conta,
                           forma_pagamento, atualizado_por)
  select p_id, k.id, k.empresa_id, k.empregador, k.cod_fornecedor, k.matricula_escritorio, k.nome, k.cpf, k.agencia, k.conta, k.forma_pagamento, auth.uid()
    from rh_colaboradores k
   where (k.ativo or exists (select 1 from rh_fp_recibos r where r.competencia = c.competencia and r.colaborador_id = k.id and not r.cancelado))
     and not exists (select 1 from rh_fp_itens i where i.competencia_id = p_id and i.colaborador_id = k.id);
  get diagnostics v_inc = row_count;
  perform rh_fp_somar_recibos_do_mes(p_id);
  return jsonb_build_object('atualizados', v_atu, 'incluidos', v_inc);
end $$;
