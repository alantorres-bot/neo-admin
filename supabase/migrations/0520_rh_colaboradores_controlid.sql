-- =========================================================
-- Neo Admin — 0520 RH/SST > Colaboradores: cadastro único com o Control iD / RHiD
-- Decisões de 21/10/2026: o cadastro de funcionários do Control iD (RHiD) é importado em Colaboradores e une, numa linha só,
-- o nº de fornecedor (Consistem), a matrícula da folha (escritório) e o nº RHiD (ponto).
--  - Só completa o que está vazio (RHiD, CPF, departamento, cargo, admissão); fornecedor e matrícula nunca vêm do Control iD.
--  - Quem não existe no cadastro é incluído sem nº de fornecedor e sem VT ("completar cadastro"): por isso o nº de fornecedor
--    deixa de ser obrigatório no banco, e a folha passa a ignorar quem está sem ele.
--  - O setor passa a ser do colaborador: setor do RH > Ponto com o mesmo nome do departamento (sem acento e caixa). O Banco de
--    horas usa esse setor; sai o setor escolhido no próprio Banco de horas (rh_bh_pessoas.setor_id).
-- =========================================================

-- 1) Cadastro ------------------------------------------------------------------------------------------------------------------
alter table rh_colaboradores alter column cod_fornecedor drop not null;
alter table rh_colaboradores
  add column id_rhid text unique check (id_rhid ~ '^\d{1,9}$'),
  add column departamento text,
  add column data_admissao date;
comment on column rh_colaboradores.cod_fornecedor is 'Nº do fornecedor no Consistem. Vazio = cadastro incompleto (incluído pelo Control iD): não entra na folha nem no VT até o RH completar.';
comment on column rh_colaboradores.id_rhid is 'Nº do funcionário no Control iD / RHiD (id_funcionario; o mesmo "Id" dos CSVs de banco de horas).';
comment on column rh_colaboradores.departamento is 'Departamento no Control iD; o setor do colaborador é o setor do RH > Ponto com o mesmo nome.';

-- Nome de setor/departamento comparável: sem acento, maiúsculas, espaços simples.
create function rh_chave_setor(p text) returns text
language sql immutable as $$
  select nullif(trim(regexp_replace(upper(translate(coalesce(p, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g')), '')
$$;

-- 2) Importação (o casamento é feito na tela; aqui só se grava, sempre sem sobrescrever) --------------------------------------
-- p_atualizar: [{id, id_rhid, cpf, departamento, funcao, data_admissao}]
-- p_incluir:   [{nome, cpf, id_rhid, empregador, departamento, funcao, data_admissao}]
create function rh_col_importar_controlid(p_atualizar jsonb, p_incluir jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_atu int; v_inc int;
begin
  perform rh_exigir('operador');
  update rh_colaboradores c set
    id_rhid = coalesce(c.id_rhid, case when not exists (select 1 from rh_colaboradores o where o.id_rhid = x.id_rhid and o.id <> c.id) then x.id_rhid end),
    cpf = coalesce(c.cpf, case when not exists (select 1 from rh_colaboradores o where o.cpf = x.cpf and o.id <> c.id) then x.cpf end),
    departamento = coalesce(c.departamento, nullif(trim(x.departamento), '')),
    funcao = coalesce(c.funcao, nullif(upper(trim(x.funcao)), '')),
    data_admissao = coalesce(c.data_admissao, x.data_admissao),
    atualizado_por = auth.uid()
    from jsonb_to_recordset(coalesce(p_atualizar, '[]')) as x(id uuid, id_rhid text, cpf text, departamento text, funcao text, data_admissao date)
   where c.id = x.id
     and ((c.id_rhid is null and x.id_rhid is not null) or (c.cpf is null and x.cpf is not null) or (c.departamento is null and nullif(trim(x.departamento), '') is not null)
          or (c.funcao is null and nullif(trim(x.funcao), '') is not null) or (c.data_admissao is null and x.data_admissao is not null));
  get diagnostics v_atu = row_count;

  insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, cpf, id_rhid, departamento, funcao, data_admissao, recebe_vt, tarifa, ativo, observacao, atualizado_por)
  select (select k.empresa_id from rh_colaboradores k where k.empregador = x.empregador group by k.empresa_id order by count(*) desc limit 1),
         x.empregador, null, upper(trim(x.nome)), x.cpf, x.id_rhid, nullif(trim(x.departamento), ''), nullif(upper(trim(x.funcao)), ''), x.data_admissao,
         false, null, true,
         'Incluído pelo cadastro do Control iD em ' || to_char(now() at time zone 'America/Cuiaba', 'DD/MM/YYYY') || ': completar nº de fornecedor (Consistem) e matrícula da folha.',
         auth.uid()
    from jsonb_to_recordset(coalesce(p_incluir, '[]')) as x(nome text, cpf text, id_rhid text, empregador text, departamento text, funcao text, data_admissao date)
   where not exists (select 1 from rh_colaboradores k where k.id_rhid = x.id_rhid or k.cpf = x.cpf)
     and exists (select 1 from rh_colaboradores k where k.empregador = x.empregador);
  get diagnostics v_inc = row_count;

  -- liga as pessoas do Banco de horas ao cadastro (CPF ou nº RHiD = "Id" do CSV)
  update rh_bh_pessoas p set colaborador_id = c.id
    from rh_colaboradores c
   where p.colaborador_id is null and (regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') = p.cpf or c.id_rhid = p.id_controlid);
  return jsonb_build_object('atualizados', v_atu, 'incluidos', v_inc);
end $$;
revoke all on function rh_col_importar_controlid(jsonb, jsonb) from public, anon;

-- Pessoa nova no Banco de horas já nasce ligada ao cadastro (CPF ou nº RHiD).
create function rh_bh_pessoa_vincular() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.colaborador_id is null then
    select c.id into new.colaborador_id from rh_colaboradores c
     where regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') = new.cpf or c.id_rhid = new.id_controlid
     order by (regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') = new.cpf) desc limit 1;
  end if;
  return new;
end $$;
create trigger trg_rh_bh_pessoa_vincular before insert or update on rh_bh_pessoas for each row execute function rh_bh_pessoa_vincular();

-- 3) Setor do colaborador no Banco de horas ------------------------------------------------------------------------------
-- os setores escolhidos no Banco de horas viram departamento do colaborador (quando ele ainda não tem)
update rh_colaboradores c set departamento = s.nome
  from rh_bh_pessoas p join rh_pt_setores s on s.id = p.setor_id
 where p.colaborador_id = c.id and c.departamento is null;

drop view rh_bh_saldos;
drop function rh_bh_definir_setor(uuid, uuid);
drop function rh_bh_definir_setores(jsonb);
alter table rh_bh_pessoas drop column setor_id;

create view rh_bh_saldos with (security_invoker = true) as
with par as (select rh_bh_param('aviso_dias')::int aviso, rh_bh_param('limite_negativo_min')::int limite, (now() at time zone 'America/Cuiaba')::date hoje),
a as (select * from rh_bh_aberto)
select p.id pessoa_id, p.nome, p.cpf,
       (select s.id from rh_colaboradores c join rh_pt_setores s on s.ativo and rh_chave_setor(s.nome) = rh_chave_setor(c.departamento)
         where c.id = p.colaborador_id limit 1) setor_id,
       p.colaborador_id, p.saldo_controlid_min, p.saldo_em,
       coalesce((select sum(a.sinal * a.restante) from a where a.pessoa_id = p.id), 0)::int saldo_min,
       coalesce((select sum(a.restante) from a where a.pessoa_id = p.id and a.sinal = 1 and a.vencimento < par.hoje), 0)::int pagar_min,
       coalesce((select sum(a.restante) from a where a.pessoa_id = p.id and a.sinal = -1 and a.vencimento < par.hoje), 0)::int descontar_min,
       coalesce((select sum(a.restante) from a where a.pessoa_id = p.id and a.sinal = 1 and a.vencimento between par.hoje and par.hoje + par.aviso), 0)::int folgar_min,
       coalesce((select sum(a.restante) from a where a.pessoa_id = p.id and a.sinal = -1 and a.vencimento between par.hoje and par.hoje + par.aviso), 0)::int repor_min,
       (select min(a.vencimento) from a where a.pessoa_id = p.id and a.vencimento >= par.hoje) proximo_vencimento,
       par.limite limite_negativo_min
  from rh_bh_pessoas p cross join par;

create or replace function rh_bh_emitir_fechamento(p_competencia date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_corte date := (date_trunc('month', p_competencia) + interval '24 days')::date;
  v_ultimo date;
  v_id uuid;
begin
  perform rh_exigir('operador');
  if exists (select 1 from rh_bh_fechamentos where competencia = v_comp and status not in ('cancelado', 'devolvido')) then
    raise exception 'O fechamento de % já foi emitido.', to_char(v_comp, 'MM/YYYY');
  end if;
  select max(data) into v_ultimo from rh_bh_movimentos;
  if v_ultimo is null or v_ultimo < v_corte then
    raise exception 'Importe antes o CSV do Control iD até %: os dados vão só até %.', to_char(v_corte, 'DD/MM/YYYY'), coalesce(to_char(v_ultimo, 'DD/MM/YYYY'), 'nenhum dia');
  end if;
  insert into rh_bh_fechamentos (competencia) values (v_comp) returning id into v_id;
  insert into rh_bh_fechamento_itens (fechamento_id, pessoa_id, nome, cpf, setor, pagar_min, descontar_min, ciclos)
  select v_id, p.id, p.nome, p.cpf, s.nome,
         coalesce(sum(a.restante) filter (where a.sinal = 1), 0), coalesce(sum(a.restante) filter (where a.sinal = -1), 0),
         string_agg(distinct to_char(rh_bh_fim_ciclo(a.data), 'MM/YYYY'), ', ')
    from rh_bh_aberto a join rh_bh_pessoas p on p.id = a.pessoa_id left join rh_bh_saldos sl on sl.pessoa_id = p.id left join rh_pt_setores s on s.id = sl.setor_id
   where a.vencimento <= v_corte
   group by p.id, p.nome, p.cpf, s.nome;
  perform rh_bh_atualizar_pendencias();
  return v_id;
end $$;

-- 4) Folha: quem está sem nº de fornecedor (cadastro incompleto) fica de fora -------------------------------------------------
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
   where c.cod_fornecedor is not null   -- sem nº de fornecedor (cadastro incompleto) não entra na folha
     and (c.ativo or exists (select 1 from rh_fp_recibos r where r.competencia = v_comp and r.colaborador_id = c.id and not r.cancelado));
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
   where i.competencia_id = p_id and k.id = i.colaborador_id and k.cod_fornecedor is not null
     and (i.empresa_id, i.empregador, i.cod_fornecedor, i.matricula_escritorio, i.nome, i.cpf, i.agencia, i.conta)
         is distinct from (k.empresa_id, k.empregador, k.cod_fornecedor, k.matricula_escritorio, k.nome, k.cpf, k.agencia, k.conta);
  get diagnostics v_atu = row_count;
  insert into rh_fp_itens (competencia_id, colaborador_id, empresa_id, empregador, cod_fornecedor, matricula_escritorio, nome, cpf, agencia, conta,
                           forma_pagamento, atualizado_por)
  select p_id, k.id, k.empresa_id, k.empregador, k.cod_fornecedor, k.matricula_escritorio, k.nome, k.cpf, k.agencia, k.conta, k.forma_pagamento, auth.uid()
    from rh_colaboradores k
   where k.cod_fornecedor is not null
     and (k.ativo or exists (select 1 from rh_fp_recibos r where r.competencia = c.competencia and r.colaborador_id = k.id and not r.cancelado))
     and not exists (select 1 from rh_fp_itens i where i.competencia_id = p_id and i.colaborador_id = k.id);
  get diagnostics v_inc = row_count;
  perform rh_fp_somar_recibos_do_mes(p_id);
  return jsonb_build_object('atualizados', v_atu, 'incluidos', v_inc);
end $$;

select rh_bh_atualizar_pendencias();
