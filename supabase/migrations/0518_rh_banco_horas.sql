-- =========================================================
-- Neo Admin — 0518 RH/SST > Banco de horas: saldo e vencimento
-- O RH importa o CSV de banco de horas do Control iD (geral, um por ciclo ou quinzena); o Neo Admin calcula o saldo dos últimos
-- 6 meses, o que vence e o que venceu, avisa o RH e o líder do setor e aponta o vencido para pagar na folha.
-- Especificação: docs/modulos/rh-banco-horas.md. Decisões de 21/10/2026:
--  - Ciclo de 26 a 25 (o da folha). Crédito vence no fim do ciclo em que nasceu + 6 meses (10/05 → 25/11).
--  - Débitos e pagamentos na folha consomem o crédito mais antigo primeiro.
--  - Só conta o que nasceu a partir do "início da conta" (parâmetro); o saldo anterior é ignorado.
--  - Aviso 30 dias antes; saldo negativo abaixo de −10:00 alerta. Nada é descontado ou pago sozinho.
-- Pessoa pelo CPF (o PIS do CSV não é guardado). O CSV não traz setor: o RH escolhe o setor de cada pessoa uma vez (Saldos).
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('rh.banco_horas', 'rh', 'Banco de horas', true)
  on conflict (codigo) do update set ativo = true, nome = excluded.nome;
insert into configuracoes (chave, valor, descricao) values
  ('rh.banco_horas.inicio', '"2026-04-26"'::jsonb, 'RH > Banco de horas: só contam movimentos a partir desta data (início de ciclo, dia 26); o saldo anterior é ignorado.'),
  ('rh.banco_horas.validade_meses', '6'::jsonb, 'RH > Banco de horas: meses, depois do fim do ciclo de origem, até o crédito vencer.'),
  ('rh.banco_horas.aviso_dias', '30'::jsonb, 'RH > Banco de horas: dias de antecedência do aviso de crédito vencendo.'),
  ('rh.banco_horas.limite_negativo_min', '600'::jsonb, 'RH > Banco de horas: saldo negativo (em minutos) a partir do qual há alerta.')
  on conflict (chave) do nothing;

-- 1) Ciclo e parâmetros ----------------------------------------------------------------------------------------------------
-- Fim do ciclo (dia 25) que contém a data: até o dia 25, o do mês; do 26 em diante, o do mês seguinte.
create function rh_bh_fim_ciclo(p_data date) returns date
language sql immutable as $$
  select (date_trunc('month', p_data)::date + case when extract(day from p_data) > 25 then interval '1 month' else interval '0' end + interval '24 days')::date
$$;

create function rh_bh_vencimento(p_data date, p_meses int) returns date
language sql immutable as $$
  select (rh_bh_fim_ciclo(p_data) + make_interval(months => p_meses))::date
$$;

create function rh_bh_param(p_nome text) returns text
language sql stable security definer set search_path = public as $$
  select valor #>> '{}' from configuracoes where chave = 'rh.banco_horas.' || p_nome
$$;

-- 2) Tabelas -------------------------------------------------------------------------------------------------------------------
create table rh_bh_pessoas (
  id uuid primary key default gen_random_uuid(),
  cpf text not null unique check (cpf ~ '^[0-9]{11}$'),
  nome text not null,
  id_controlid text,
  colaborador_id uuid references rh_colaboradores(id),
  setor_id uuid references rh_pt_setores(id),            -- escolhido pelo RH (nulo = sem setor: só o RH é avisado)
  saldo_controlid_min int,                                 -- último saldo do Control iD (null = sem banco)
  saldo_em date,
  atualizado_em timestamptz not null default now()
);
comment on table rh_bh_pessoas is 'Pessoas do banco de horas (Control iD), pelo CPF; o setor é escolhido pelo RH; o último saldo do Control iD vem da importação.';
create trigger trg_rh_bh_pessoas_atualizado before update on rh_bh_pessoas for each row execute function fn_atualizado_em();
create trigger trg_rh_bh_pessoas_sem_delete before delete on rh_bh_pessoas for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_bh_pessoas after insert or update on rh_bh_pessoas for each row execute function fn_auditoria();

create table rh_bh_importacoes (
  id uuid primary key default gen_random_uuid(),
  periodo_inicio date not null,
  periodo_fim date not null check (periodo_fim >= periodo_inicio),
  arquivo_nome text not null,
  pessoas int not null,
  movimentos int not null,
  importado_por uuid references perfis(id) default auth.uid(),
  importado_em timestamptz not null default now()
);
create trigger trg_rh_bh_importacoes_sem_delete before delete on rh_bh_importacoes for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_bh_importacoes after insert on rh_bh_importacoes for each row execute function fn_auditoria();

create table rh_bh_movimentos (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references rh_bh_pessoas(id),
  data date not null,
  positivo_min int not null default 0 check (positivo_min >= 0),
  negativo_min int not null default 0 check (negativo_min >= 0),
  importacao_id uuid not null references rh_bh_importacoes(id),
  unique (pessoa_id, data)
);
comment on table rh_bh_movimentos is 'Crédito (positivo) e débito (negativo) do banco de horas por pessoa e dia, do Control iD. Reimportar atualiza o dia (a auditoria guarda o anterior).';
create trigger trg_rh_bh_movimentos_sem_delete before delete on rh_bh_movimentos for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_bh_movimentos after insert or update on rh_bh_movimentos for each row execute function fn_auditoria();

create table rh_bh_pagamentos (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references rh_bh_pessoas(id),
  minutos int not null check (minutos > 0),
  competencia date not null check (extract(day from competencia) = 1),   -- folha em que foi pago
  observacao text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  cancelado_por uuid references perfis(id), cancelado_em timestamptz, cancelado_motivo text
);
comment on table rh_bh_pagamentos is 'Horas vencidas do banco pagas na folha: consomem os créditos mais antigos. Cancelamento com motivo (nada é apagado).';
create trigger trg_rh_bh_pagamentos_sem_delete before delete on rh_bh_pagamentos for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_bh_pagamentos after insert or update on rh_bh_pagamentos for each row execute function fn_auditoria();

alter table rh_bh_pessoas enable row level security;
alter table rh_bh_importacoes enable row level security;
alter table rh_bh_movimentos enable row level security;
alter table rh_bh_pagamentos enable row level security;
create policy rh_bh_pessoas_ler on rh_bh_pessoas for select to authenticated using (tem_acesso_area('rh'));
create policy rh_bh_importacoes_ler on rh_bh_importacoes for select to authenticated using (tem_acesso_area('rh'));
create policy rh_bh_movimentos_ler on rh_bh_movimentos for select to authenticated using (tem_acesso_area('rh'));
create policy rh_bh_pagamentos_ler on rh_bh_pagamentos for select to authenticated using (tem_acesso_area('rh'));
-- Sem insert/update/delete direto: tudo pelas funções abaixo.

-- 3) Cálculo (uma fonte só; espelho em TS: lib/modulos/rh/banco-horas/modulo.ts, creditosEmAberto) -------------------------
-- Crédito em aberto de cada dia, pela regra "o mais antigo primeiro": restante = clamp(créditos acumulados − (débitos + pagos), 0, crédito).
create view rh_bh_creditos with (security_invoker = true) as
with par as (select rh_bh_param('inicio')::date inicio, rh_bh_param('validade_meses')::int validade),
m as (select mv.* from rh_bh_movimentos mv, par where mv.data >= par.inicio),
deb as (select pessoa_id, sum(negativo_min) deb from m group by pessoa_id),
pg as (select pessoa_id, sum(minutos) pago from rh_bh_pagamentos where cancelado_em is null group by pessoa_id),
c as (select pessoa_id, data, positivo_min credito, sum(positivo_min) over (partition by pessoa_id order by data) acumulado from m where positivo_min > 0)
select c.pessoa_id, c.data, c.credito,
       least(c.credito, greatest(0, c.acumulado - coalesce(deb.deb, 0) - coalesce(pg.pago, 0)))::int restante,
       rh_bh_vencimento(c.data, par.validade) vencimento
  from c cross join par left join deb using (pessoa_id) left join pg using (pessoa_id);

-- Situação por pessoa: saldo do Neo Admin (desde o início), vencido a pagar, vencendo no aviso e próximo vencimento.
create view rh_bh_saldos with (security_invoker = true) as
with par as (select rh_bh_param('inicio')::date inicio, rh_bh_param('aviso_dias')::int aviso, rh_bh_param('limite_negativo_min')::int limite,
                    (now() at time zone 'America/Cuiaba')::date hoje)
select p.id pessoa_id, p.nome, p.cpf, p.setor_id, p.colaborador_id, p.saldo_controlid_min, p.saldo_em,
       (coalesce((select sum(positivo_min - negativo_min) from rh_bh_movimentos mv where mv.pessoa_id = p.id and mv.data >= par.inicio), 0)
        - coalesce((select sum(minutos) from rh_bh_pagamentos g where g.pessoa_id = p.id and g.cancelado_em is null), 0))::int saldo_min,
       coalesce((select sum(restante) from rh_bh_creditos c where c.pessoa_id = p.id and c.vencimento < par.hoje), 0)::int vencido_min,
       coalesce((select sum(restante) from rh_bh_creditos c where c.pessoa_id = p.id and c.vencimento between par.hoje and par.hoje + par.aviso), 0)::int vencendo_min,
       (select min(vencimento) from rh_bh_creditos c where c.pessoa_id = p.id and c.restante > 0 and c.vencimento >= par.hoje) proximo_vencimento,
       par.limite limite_negativo_min
  from rh_bh_pessoas p cross join par;

-- 4) Pendências --------------------------------------------------------------------------------------------------------------
-- Abre a pendência se não houver outra aberta com o mesmo título (a origem pode ser nula: "sem setor").
create function rh_bh_abrir_pendencia(p_titulo text, p_descricao text, p_prazo date, p_criticidade criticidade, p_tabela text, p_id uuid, p_link text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into pendencias (modulo, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
  select 'rh.banco_horas', p_titulo, p_descricao, p_prazo, p_criticidade, p_tabela, p_id, p_link
   where not exists (select 1 from pendencias where modulo = 'rh.banco_horas' and titulo = p_titulo and status in ('aberta', 'em_andamento'));
end $$;
revoke all on function rh_bh_abrir_pendencia(text, text, date, criticidade, text, uuid, text) from public, anon, authenticated;

-- Abre o que falta e encerra o que não vale mais: "vencendo" por setor e data, "a pagar na folha" e "negativo" por pessoa.
create function rh_bh_atualizar_pendencias() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_desejadas text[] := '{}';
  r record;
  v_titulo text;
begin
  for r in select s.setor_id, coalesce(t.nome, 'sem setor') setor, min(s.proximo_vencimento) venc, count(*) pessoas
             from rh_bh_saldos s left join rh_pt_setores t on t.id = s.setor_id where s.vencendo_min > 0 group by s.setor_id, t.nome loop
    v_titulo := 'Banco de horas vencendo — ' || r.setor || ' (' || to_char(r.venc, 'DD/MM/YYYY') || ')';
    v_desejadas := v_desejadas || v_titulo;
    perform rh_bh_abrir_pendencia(v_titulo, r.pessoas || ' pessoa(s) com crédito vencendo: programar a compensação com o líder (botão "E-mail ao líder").',
            r.venc, case when r.venc <= v_hoje + 7 then 'critica'::criticidade else 'alta'::criticidade end,
            case when r.setor_id is not null then 'rh_pt_setores' end, r.setor_id, '/rh/banco_horas');
    -- só o job (sem usuário) muda a criticidade de pendência existente (fn_pendencias_regras)
    if auth.uid() is null and r.venc <= v_hoje + 7 then
      update pendencias set criticidade = 'critica' where modulo = 'rh.banco_horas' and titulo = v_titulo and status in ('aberta', 'em_andamento');
    end if;
  end loop;
  for r in select pessoa_id, nome, vencido_min, saldo_min, limite_negativo_min from rh_bh_saldos where vencido_min > 0 or saldo_min < -limite_negativo_min loop
    if r.vencido_min > 0 then
      v_titulo := 'Banco de horas a pagar na folha — ' || r.nome;
      v_desejadas := v_desejadas || v_titulo;
      perform rh_bh_abrir_pendencia(v_titulo, 'Crédito vencido sem compensação: incluir na folha e marcar "Pago na folha".', v_hoje, 'alta', 'rh_bh_pessoas', r.pessoa_id, '/rh/banco_horas/pagar');
    end if;
    if r.saldo_min < -r.limite_negativo_min then
      v_titulo := 'Banco negativo — ' || r.nome;
      v_desejadas := v_desejadas || v_titulo;
      perform rh_bh_abrir_pendencia(v_titulo, 'Saldo do banco de horas abaixo do limite: combinar compensação ou desconto.', null, 'normal', 'rh_bh_pessoas', r.pessoa_id, '/rh/banco_horas/pessoa/' || r.pessoa_id);
    end if;
  end loop;
  update pendencias set status = 'concluida', concluido_em = now()
   where modulo = 'rh.banco_horas' and status in ('aberta', 'em_andamento') and not (titulo = any (v_desejadas));
end $$;
revoke all on function rh_bh_atualizar_pendencias() from public, anon, authenticated;

-- 5) Importação --------------------------------------------------------------------------------------------------------------
-- p_pessoas: [{cpf, nome, id_controlid, saldo_controlid_min, saldo_em, movimentos: [{data, positivo_min, negativo_min}]}]
-- Os dias do período sem movimento no arquivo ficam zerados (reimportação corrige); pessoa casa com o cadastro pelo CPF.
create function rh_bh_importar(p_inicio date, p_fim date, p_arquivo text, p_pessoas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_imp uuid;
  v_mov int;
begin
  perform rh_exigir('operador');
  if p_pessoas is null or jsonb_typeof(p_pessoas) <> 'array' or jsonb_array_length(p_pessoas) = 0 then raise exception 'O arquivo não tem pessoas.'; end if;
  if p_fim < p_inicio then raise exception 'Período inválido.'; end if;

  create temporary table tmp_bh on commit drop as
    select x.cpf, x.nome, x.id_controlid, x.saldo_controlid_min, x.saldo_em, coalesce(x.movimentos, '[]'::jsonb) movimentos
      from jsonb_to_recordset(p_pessoas) as x(cpf text, nome text, id_controlid text, saldo_controlid_min int, saldo_em date, movimentos jsonb);
  if exists (select 1 from tmp_bh where cpf !~ '^[0-9]{11}$' or coalesce(trim(nome), '') = '') then raise exception 'Há pessoa sem CPF ou nome válido.'; end if;

  insert into rh_bh_importacoes (periodo_inicio, periodo_fim, arquivo_nome, pessoas, movimentos)
  values (p_inicio, p_fim, p_arquivo, (select count(*) from tmp_bh), (select coalesce(sum(jsonb_array_length(movimentos)), 0) from tmp_bh))
  returning id into v_imp;

  insert into rh_bh_pessoas (cpf, nome, id_controlid, saldo_controlid_min, saldo_em, colaborador_id)
  select t.cpf, trim(t.nome), t.id_controlid, t.saldo_controlid_min, t.saldo_em,
         (select c.id from rh_colaboradores c where regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') = t.cpf limit 1)
    from tmp_bh t
  on conflict (cpf) do update set
    nome = excluded.nome, id_controlid = excluded.id_controlid,
    saldo_controlid_min = case when excluded.saldo_em >= coalesce(rh_bh_pessoas.saldo_em, excluded.saldo_em) then excluded.saldo_controlid_min else rh_bh_pessoas.saldo_controlid_min end,
    saldo_em = greatest(rh_bh_pessoas.saldo_em, excluded.saldo_em),
    colaborador_id = coalesce(rh_bh_pessoas.colaborador_id, excluded.colaborador_id);

  -- dias do período que já tinham movimento e não vieram no arquivo: zerados
  update rh_bh_movimentos mv set positivo_min = 0, negativo_min = 0, importacao_id = v_imp
    from rh_bh_pessoas p join tmp_bh t on t.cpf = p.cpf
   where mv.pessoa_id = p.id and mv.data between p_inicio and p_fim and (mv.positivo_min > 0 or mv.negativo_min > 0)
     and not exists (select 1 from jsonb_to_recordset(t.movimentos) as x(data date, positivo_min int, negativo_min int) where x.data = mv.data);

  insert into rh_bh_movimentos (pessoa_id, data, positivo_min, negativo_min, importacao_id)
  select p.id, x.data, coalesce(x.positivo_min, 0), coalesce(x.negativo_min, 0), v_imp
    from tmp_bh t join rh_bh_pessoas p on p.cpf = t.cpf
    cross join lateral jsonb_to_recordset(t.movimentos) as x(data date, positivo_min int, negativo_min int)
   where x.data between p_inicio and p_fim
  on conflict (pessoa_id, data) do update set positivo_min = excluded.positivo_min, negativo_min = excluded.negativo_min, importacao_id = excluded.importacao_id
   where (rh_bh_movimentos.positivo_min, rh_bh_movimentos.negativo_min) is distinct from (excluded.positivo_min, excluded.negativo_min);
  get diagnostics v_mov = row_count;

  perform rh_bh_atualizar_pendencias();
  return jsonb_build_object('importacao', v_imp, 'pessoas', (select count(*) from tmp_bh), 'movimentos_gravados', v_mov);
end $$;

-- Setor da pessoa (para o e-mail ao líder), escolhido pelo RH; nulo = sem setor.
create function rh_bh_definir_setor(p_pessoa uuid, p_setor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('operador');
  if p_setor is not null and not exists (select 1 from rh_pt_setores where id = p_setor) then raise exception 'Setor não encontrado.'; end if;
  update rh_bh_pessoas set setor_id = p_setor where id = p_pessoa;
  if not found then raise exception 'Pessoa não encontrada no banco de horas.'; end if;
  perform rh_bh_atualizar_pendencias();
end $$;

-- Setor em lote pelo departamento do cadastro do Control iD (a tela casa departamento com setor pelo nome).
-- p_itens: [{cpf, setor}]. Só atualiza pessoas que já estão no banco de horas.
create function rh_bh_definir_setores(p_itens jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  perform rh_exigir('operador');
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Nada para aplicar.'; end if;
  update rh_bh_pessoas p set setor_id = x.setor
    from jsonb_to_recordset(p_itens) as x(cpf text, setor uuid)
   where p.cpf = x.cpf and exists (select 1 from rh_pt_setores s where s.id = x.setor) and p.setor_id is distinct from x.setor;
  get diagnostics v_n = row_count;
  perform rh_bh_atualizar_pendencias();
  return v_n;
end $$;

-- 6) Pagamento na folha, parâmetros e job -------------------------------------------------------------------------------
create function rh_bh_registrar_pagamento(p_pessoa uuid, p_minutos int, p_competencia date, p_observacao text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_vencido int;
  v_id uuid;
begin
  perform rh_exigir('operador');
  select vencido_min into v_vencido from rh_bh_saldos where pessoa_id = p_pessoa;
  if v_vencido is null then raise exception 'Pessoa não encontrada no banco de horas.'; end if;
  if p_minutos is null or p_minutos <= 0 then raise exception 'Informe as horas pagas.'; end if;
  if p_minutos > v_vencido then raise exception 'Só há %:% vencido a pagar.', v_vencido / 60, lpad((v_vencido % 60)::text, 2, '0'); end if;
  insert into rh_bh_pagamentos (pessoa_id, minutos, competencia, observacao)
  values (p_pessoa, p_minutos, date_trunc('month', p_competencia)::date, nullif(trim(p_observacao), '')) returning id into v_id;
  perform rh_bh_atualizar_pendencias();
  return v_id;
end $$;

create function rh_bh_cancelar_pagamento(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('gestor');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  update rh_bh_pagamentos set cancelado_por = auth.uid(), cancelado_em = now(), cancelado_motivo = trim(p_motivo) where id = p_id and cancelado_em is null;
  if not found then raise exception 'Pagamento não encontrado ou já cancelado.'; end if;
  perform rh_bh_atualizar_pendencias();
end $$;

create function rh_bh_salvar_parametros(p_inicio date, p_validade int, p_aviso int, p_limite int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('gestor');
  if p_inicio is null or extract(day from p_inicio) <> 26 then raise exception 'O início da conta tem de ser um início de ciclo (dia 26).'; end if;
  if p_validade is null or p_validade not between 1 and 24 then raise exception 'Validade de 1 a 24 meses.'; end if;
  if p_aviso is null or p_aviso not between 1 and 120 then raise exception 'Aviso de 1 a 120 dias.'; end if;
  if p_limite is null or p_limite < 0 then raise exception 'Limite negativo inválido.'; end if;
  update configuracoes set valor = to_jsonb(p_inicio::text) where chave = 'rh.banco_horas.inicio';
  update configuracoes set valor = to_jsonb(p_validade) where chave = 'rh.banco_horas.validade_meses';
  update configuracoes set valor = to_jsonb(p_aviso) where chave = 'rh.banco_horas.aviso_dias';
  update configuracoes set valor = to_jsonb(p_limite) where chave = 'rh.banco_horas.limite_negativo_min';
  perform rh_bh_atualizar_pendencias();
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('rh-banco-horas-pendencias', '30 10 * * *', 'select public.rh_bh_atualizar_pendencias()');   -- 06h30 em Cuiabá
  end if;
end $$;

revoke all on function rh_bh_param(text) from public, anon;
revoke all on function rh_bh_importar(date, date, text, jsonb) from public, anon;
revoke all on function rh_bh_definir_setor(uuid, uuid) from public, anon;
revoke all on function rh_bh_definir_setores(jsonb) from public, anon;
revoke all on function rh_bh_registrar_pagamento(uuid, int, date, text) from public, anon;
revoke all on function rh_bh_cancelar_pagamento(uuid, text) from public, anon;
revoke all on function rh_bh_salvar_parametros(date, int, int, int) from public, anon;
