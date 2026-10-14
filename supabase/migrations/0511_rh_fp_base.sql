-- =========================================================
-- Neo Admin — 0511 RH/SST > Folha de pagamento: mês, pagamento e avulsos (Fase F2)
-- Fechamento mensal da folha de Cuiabá (substitui a planilha "FOLHA PGTO CBA - <MÊS>-<ANO>.xlsx"). Especificação:
-- docs/modulos/rh-folha.md, regras 2 a 9.
--
-- 1) Módulo rh.folha ativo (rota /rh/folha). Calendário: n-ésimo dia útil (pagamento = 5º dia útil do mês seguinte).
-- 2) rh_fp_competencias: um registro por mês (as três empresas juntas; cada linha tem a empresa empregadora).
--    Fluxo aberta → conferida (operador) → aprovada (gestor) → paga. As conferências automáticas (F3) entram depois como condição
--    para "conferida"; nesta fase o operador confere à mão.
-- 3) rh_fp_itens: uma linha por pessoa no mês, com a FOTO do cadastro único (rh_colaboradores) e os valores por natureza:
--    líquido (salário), férias/acréscimos, 13º e avulso (com motivo). Valor a pagar = soma (coluna gerada).
-- 4) Funções do fluxo (security definer, permissão conferida dentro), pendências na Fila do dia. Sem exclusão; auditoria.
-- =========================================================

-- 1) Módulo e calendário ---------------------------------------------------------------------------------------------------
update modulos set ativo = true, nome = 'Folha de pagamento' where codigo = 'rh.folha';
insert into modulos (codigo, area, nome, ativo) values ('rh.folha', 'rh', 'Folha de pagamento', true) on conflict (codigo) do nothing;

-- n-ésimo dia útil (segunda a sexta, sem feriados) do mês.
create function rh_enesimo_dia_util(p_mes date, p_n int) returns date
language sql immutable as $$
  select d::date from generate_series(date_trunc('month', p_mes), date_trunc('month', p_mes) + interval '1 month' - interval '1 day', interval '1 day') d
   where extract(isodow from d) < 6 order by d offset greatest(p_n, 1) - 1 limit 1
$$;

-- Permissão na área RH (genérica; o VT tem a sua, rh_vt_exigir).
create function rh_exigir(p_nivel nivel_acesso) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('rh', p_nivel) then
    raise exception 'Somente % do RH (ou acima) pode fazer isso na folha de pagamento.', p_nivel;
  end if;
end $$;
revoke all on function rh_exigir(nivel_acesso) from public, anon;

-- 2) Mês -------------------------------------------------------------------------------------------------------------------------
create table rh_fp_competencias (
  id uuid primary key default gen_random_uuid(),
  competencia date not null unique check (extract(day from competencia) = 1),   -- mês da folha (1º dia)
  data_pagamento date not null,                       -- 5º dia útil do mês seguinte
  status text not null default 'aberta' check (status in ('aberta', 'conferida', 'aprovada', 'paga')),
  observacao text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  conferida_por uuid references perfis(id), conferida_em timestamptz,
  aprovada_por uuid references perfis(id), aprovada_em timestamptz,
  paga_por uuid references perfis(id), paga_em timestamptz,
  reaberta_por uuid references perfis(id), reaberta_em timestamptz, reaberta_motivo text,
  arquivo_bb_gerado_por uuid references perfis(id), arquivo_bb_gerado_em timestamptz,
  atualizado_em timestamptz not null default now()
);
comment on table rh_fp_competencias is 'Fechamento da folha do mês (as três empresas). Fluxo aberta → conferida → aprovada → paga; pago no 5º dia útil do mês seguinte.';
create trigger trg_rh_fp_comp_atualizado before update on rh_fp_competencias for each row execute function fn_atualizado_em();
create trigger trg_rh_fp_comp_sem_delete before delete on rh_fp_competencias for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_fp_comp after insert or update on rh_fp_competencias for each row execute function fn_auditoria();

-- 3) Pessoas no mês ------------------------------------------------------------------------------------------------------------
create table rh_fp_itens (
  id uuid primary key default gen_random_uuid(),
  competencia_id uuid not null references rh_fp_competencias(id),
  colaborador_id uuid not null references rh_colaboradores(id),
  -- foto do cadastro
  empresa_id uuid not null references empresas(id),
  empregador text not null,
  cod_fornecedor text not null,
  matricula_escritorio text,
  nome text not null,
  cpf varchar(14),
  agencia text,
  conta text,
  forma_pagamento text not null check (forma_pagamento in ('fopag', 'pix_neo_formas', 'pix_neo_servicos')),   -- pode mudar no mês
  -- valores por natureza
  liquido numeric(14,2) not null default 0 check (liquido >= 0),                       -- salário líquido (folha do escritório)
  ferias_acrescimos numeric(14,2) not null default 0 check (ferias_acrescimos >= 0),   -- férias e acréscimos (folha do escritório)
  decimo_terceiro numeric(14,2) not null default 0 check (decimo_terceiro >= 0),       -- 13º do mês (folha do escritório)
  avulso numeric(14,2) not null default 0 check (avulso >= 0),                         -- fora da folha do escritório
  avulso_motivo text,
  observacao text,
  valor numeric(14,2) generated always as (liquido + ferias_acrescimos + decimo_terceiro + avulso) stored,
  pix_pago_por uuid references perfis(id), pix_pago_em timestamptz,
  atualizado_por uuid references perfis(id),
  atualizado_em timestamptz not null default now(),
  unique (competencia_id, colaborador_id),
  check (avulso = 0 or coalesce(trim(avulso_motivo), '') <> '')
);
comment on table rh_fp_itens is 'Uma pessoa na folha do mês: foto do cadastro, valores por natureza (líquido, férias/acréscimos, 13º, avulso) e o valor a pagar.';
create index idx_rh_fp_itens_colaborador on rh_fp_itens (colaborador_id);

-- Mês fora de "aberta": só o pagamento PIX muda.
create function rh_fp_item_regras() returns trigger
language plpgsql as $$
declare
  v_status text;
begin
  select status into v_status from rh_fp_competencias where id = new.competencia_id;
  if tg_op = 'INSERT' and v_status <> 'aberta' then
    raise exception 'A folha deste mês não está aberta.';
  end if;
  if tg_op = 'UPDATE' and v_status <> 'aberta'
     -- "valor" é coluna gerada: num gatilho BEFORE ela ainda não foi calculada (fica de fora da comparação)
     and (to_jsonb(new) - array['pix_pago_por', 'pix_pago_em', 'atualizado_em', 'atualizado_por', 'valor'])
         is distinct from (to_jsonb(old) - array['pix_pago_por', 'pix_pago_em', 'atualizado_em', 'atualizado_por', 'valor']) then
    raise exception 'A folha deste mês não está aberta; para alterar, o gestor precisa reabrir.';
  end if;
  new.atualizado_em := now();
  return new;
end $$;
create trigger trg_rh_fp_itens_regras before insert or update on rh_fp_itens for each row execute function rh_fp_item_regras();
create trigger trg_rh_fp_itens_sem_delete before delete on rh_fp_itens for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_fp_itens after insert or update on rh_fp_itens for each row execute function fn_auditoria();

alter table rh_fp_competencias enable row level security;
alter table rh_fp_itens enable row level security;
create policy rh_fp_comp_ler on rh_fp_competencias for select to authenticated using (tem_acesso_area('rh'));
create policy rh_fp_itens_ler on rh_fp_itens for select to authenticated using (tem_acesso_area('rh'));
-- Sem insert/update/delete direto: tudo pelas funções abaixo.

-- 4) Pendências --------------------------------------------------------------------------------------------------------------
create function rh_fp_abrir_pendencia(p_competencia uuid, p_titulo text, p_descricao text, p_prazo date) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
begin
  insert into pendencias (modulo, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
  select 'rh.folha', p_titulo, p_descricao, p_prazo,
         case when p_prazo <= v_hoje + 2 then 'alta'::criticidade else 'normal'::criticidade end,
         'rh_fp_competencias', p_competencia, '/rh/folha/mes/' || p_competencia
   where not exists (select 1 from pendencias where modulo = 'rh.folha' and titulo = p_titulo and status in ('aberta', 'em_andamento'));
end $$;

create function rh_fp_encerrar_pendencia(p_titulo text, p_status status_pendencia) returns void
language plpgsql security definer set search_path = public as $$
begin
  update pendencias set status = p_status, concluido_em = case when p_status = 'concluida' then now() else concluido_em end
   where modulo = 'rh.folha' and titulo = p_titulo and status in ('aberta', 'em_andamento');
end $$;
revoke all on function rh_fp_abrir_pendencia(uuid, text, text, date) from public, anon, authenticated;
revoke all on function rh_fp_encerrar_pendencia(text, status_pendencia) from public, anon, authenticated;

-- 5) Fluxo ------------------------------------------------------------------------------------------------------------------------
create function rh_fp_competencia_para(p_id uuid, p_status text[]) returns rh_fp_competencias
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
begin
  select * into c from rh_fp_competencias where id = p_id for update;
  if c.id is null then raise exception 'Mês da folha não encontrado.'; end if;
  if not (c.status = any (p_status)) then
    raise exception 'A folha de % está "%"; esta ação não vale nessa situação.', rh_vt_rotulo_mes(c.competencia), c.status;
  end if;
  return c;
end $$;
revoke all on function rh_fp_competencia_para(uuid, text[]) from public, anon, authenticated;

-- Abre o mês com todos os colaboradores ativos (valores zerados, para lançar).
create function rh_fp_abrir_competencia(p_competencia date) returns uuid
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
  insert into rh_fp_itens (competencia_id, colaborador_id, empresa_id, empregador, cod_fornecedor, matricula_escritorio, nome, cpf, agencia, conta,
                           forma_pagamento, atualizado_por)
  select v_id, c.id, c.empresa_id, c.empregador, c.cod_fornecedor, c.matricula_escritorio, c.nome, c.cpf, c.agencia, c.conta, c.forma_pagamento, auth.uid()
    from rh_colaboradores c where c.ativo;
  perform rh_fp_abrir_pendencia(v_id, 'Fechar folha de ' || rh_vt_rotulo_mes(v_comp),
    'Lançar líquidos, férias/acréscimos, 13º e avulsos e marcar a folha como conferida.', v_pag);
  return v_id;
end $$;

-- Traz para o mês aberto o que mudou no cadastro: dados das pessoas e quem entrou. Valores já lançados ficam.
create function rh_fp_atualizar_do_cadastro(p_id uuid) returns jsonb
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
   where k.ativo and not exists (select 1 from rh_fp_itens i where i.competencia_id = p_id and i.colaborador_id = k.id);
  get diagnostics v_inc = row_count;
  return jsonb_build_object('atualizados', v_atu, 'incluidos', v_inc);
end $$;

-- Grava a grade (lote). p_itens: [{id, forma_pagamento, liquido, ferias_acrescimos, decimo_terceiro, avulso, avulso_motivo, observacao}]
create function rh_fp_salvar_itens(p_id uuid, p_itens jsonb) returns int
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
    decimo_terceiro = round(coalesce(x.decimo_terceiro, 0), 2), avulso = round(coalesce(x.avulso, 0), 2),
    avulso_motivo = nullif(trim(x.avulso_motivo), ''), observacao = nullif(trim(x.observacao), ''), atualizado_por = auth.uid()
    from jsonb_to_recordset(p_itens) as x(id uuid, forma_pagamento text, liquido numeric, ferias_acrescimos numeric, decimo_terceiro numeric,
         avulso numeric, avulso_motivo text, observacao text)
   where i.id = x.id and i.competencia_id = p_id;
  get diagnostics v_n = row_count;
  if v_n <> jsonb_array_length(p_itens) then raise exception 'Algumas linhas não pertencem a este mês; recarregue a página.'; end if;
  return v_n;
end $$;

create function rh_fp_conferir(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_faltando text;
begin
  perform rh_exigir('operador');
  c := rh_fp_competencia_para(p_id, array['aberta']);
  if not exists (select 1 from rh_fp_itens where competencia_id = p_id and valor > 0) then
    raise exception 'Nenhum valor lançado na folha de %.', rh_vt_rotulo_mes(c.competencia);
  end if;
  select string_agg(cod_fornecedor || ' ' || nome, ', ' order by nome) into v_faltando
    from rh_fp_itens where competencia_id = p_id and forma_pagamento = 'fopag' and valor > 0 and (cpf is null or agencia is null or conta is null);
  if v_faltando is not null then
    raise exception 'FOPAG sem CPF, agência ou conta (não entram no arquivo do BB): %. Complete o cadastro e use "Atualizar do cadastro", ou mude a forma de pagamento.', v_faltando;
  end if;
  update rh_fp_competencias set status = 'conferida', conferida_por = auth.uid(), conferida_em = now() where id = p_id;
  perform rh_fp_encerrar_pendencia('Fechar folha de ' || rh_vt_rotulo_mes(c.competencia), 'concluida');
  perform rh_fp_abrir_pendencia(p_id, 'Aprovar folha de ' || rh_vt_rotulo_mes(c.competencia), 'Conferir e aprovar a folha do mês (gestor).', c.data_pagamento);
end $$;

create function rh_fp_aprovar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
begin
  perform rh_exigir('gestor');
  c := rh_fp_competencia_para(p_id, array['conferida']);
  update rh_fp_competencias set status = 'aprovada', aprovada_por = auth.uid(), aprovada_em = now() where id = p_id;
  perform rh_fp_encerrar_pendencia('Aprovar folha de ' || rh_vt_rotulo_mes(c.competencia), 'concluida');
  perform rh_fp_abrir_pendencia(p_id, 'Pagar folha de ' || rh_vt_rotulo_mes(c.competencia), 'Gerar o arquivo do BB (FOPAG) e pagar os PIX.', c.data_pagamento);
end $$;

create function rh_fp_reabrir(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
begin
  perform rh_exigir('gestor');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo para reabrir.'; end if;
  c := rh_fp_competencia_para(p_id, array['conferida', 'aprovada', 'paga']);
  update rh_fp_competencias set status = 'aberta', reaberta_por = auth.uid(), reaberta_em = now(), reaberta_motivo = trim(p_motivo),
         arquivo_bb_gerado_por = null, arquivo_bb_gerado_em = null, paga_por = null, paga_em = null where id = p_id;
  perform rh_fp_encerrar_pendencia('Aprovar folha de ' || rh_vt_rotulo_mes(c.competencia), 'cancelada');
  perform rh_fp_encerrar_pendencia('Pagar folha de ' || rh_vt_rotulo_mes(c.competencia), 'cancelada');
  perform rh_fp_abrir_pendencia(p_id, 'Fechar folha de ' || rh_vt_rotulo_mes(c.competencia), 'Reaberta: ' || trim(p_motivo), c.data_pagamento);
end $$;

create function rh_fp_marcar_pix(p_id uuid, p_itens uuid[], p_pago boolean) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  perform rh_exigir('operador');
  perform rh_fp_competencia_para(p_id, array['aprovada']);
  update rh_fp_itens set pix_pago_por = case when p_pago then auth.uid() end, pix_pago_em = case when p_pago then now() end
   where competencia_id = p_id and id = any (p_itens) and forma_pagamento <> 'fopag' and valor > 0;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function rh_fp_registrar_arquivo_bb(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('gestor');
  perform rh_fp_competencia_para(p_id, array['aprovada', 'paga']);
  update rh_fp_competencias set arquivo_bb_gerado_por = auth.uid(), arquivo_bb_gerado_em = now() where id = p_id;
end $$;

create function rh_fp_marcar_paga(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_fp_competencias;
  v_pix int;
begin
  perform rh_exigir('operador');
  c := rh_fp_competencia_para(p_id, array['aprovada']);
  if c.arquivo_bb_gerado_em is null and exists (select 1 from rh_fp_itens where competencia_id = p_id and forma_pagamento = 'fopag' and valor > 0) then
    raise exception 'Gere o arquivo do BB (FOPAG) antes de marcar a folha como paga.';
  end if;
  select count(*) into v_pix from rh_fp_itens where competencia_id = p_id and forma_pagamento <> 'fopag' and valor > 0 and pix_pago_em is null;
  if v_pix > 0 then raise exception 'Ainda há % PIX sem marcação de pago.', v_pix; end if;
  update rh_fp_competencias set status = 'paga', paga_por = auth.uid(), paga_em = now() where id = p_id;
  perform rh_fp_encerrar_pendencia('Pagar folha de ' || rh_vt_rotulo_mes(c.competencia), 'concluida');
end $$;

revoke all on function rh_fp_abrir_competencia(date) from public, anon;
revoke all on function rh_fp_atualizar_do_cadastro(uuid) from public, anon;
revoke all on function rh_fp_salvar_itens(uuid, jsonb) from public, anon;
revoke all on function rh_fp_conferir(uuid) from public, anon;
revoke all on function rh_fp_aprovar(uuid) from public, anon;
revoke all on function rh_fp_reabrir(uuid, text) from public, anon;
revoke all on function rh_fp_marcar_pix(uuid, uuid[], boolean) from public, anon;
revoke all on function rh_fp_registrar_arquivo_bb(uuid) from public, anon;
revoke all on function rh_fp_marcar_paga(uuid) from public, anon;
