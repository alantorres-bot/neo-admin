-- =========================================================
-- Neo Admin — 0502 RH/SST > Vale-transporte: competências mensais (Fase B)
-- O mês a mês que substitui as abas da planilha "Vale Transporte - Cuiabá <ano>.xlsx". Especificação:
-- docs/modulos/rh-vale-transporte.md, regras 1 a 10.
--
-- 1) Calendário (seg–sex, sem feriados): dias úteis, último dia útil, prazos da competência, rótulo do mês.
-- 2) rh_vt_competencias: um registro por mês do VT (competência = M+1, paga no último dia útil de M).
--    Fluxo aberta → enviada (operador) → aprovada (gestor) → paga. Não se apaga; reabrir só o gestor, com motivo.
-- 3) rh_vt_itens: uma linha por pessoa no mês, com a FOTO do cadastro e as ocorrências (faltas, atestados, extras,
--    férias e afastamento por período, abatimento em dias e/ou R$, sem VT no mês). O cálculo é feito AQUI, no gatilho
--    (rh_vt_calcular_item); lib/modulos/rh/vale-transporte/calculo.ts é o espelho para a tela.
-- 4) Funções do fluxo (security definer, permissão conferida dentro): abrir, atualizar do cadastro, salvar itens,
--    dias úteis, enviar, aprovar, reabrir, PIX pago, arquivo do BB gerado, paga.
-- 5) Pendências na Fila do dia (fechar, aprovar, pagar) e rotina diária (pg_cron) que lembra de fechar o mês.
-- =========================================================

-- 1) Calendário -----------------------------------------------------------------
create function rh_vt_dias_uteis_entre(p_inicio date, p_fim date) returns int
language sql immutable as $$
  select coalesce(count(*)::int, 0) from generate_series(p_inicio, p_fim, interval '1 day') d where extract(isodow from d) < 6
$$;

create function rh_vt_ultimo_dia_util(p_mes date) returns date
language sql immutable as $$
  select max(d)::date from generate_series(date_trunc('month', p_mes), date_trunc('month', p_mes) + interval '1 month' - interval '1 day', interval '1 day') d
   where extract(isodow from d) < 6
$$;

-- Volta p_n dias úteis a partir de p_data (que não conta).
create function rh_vt_voltar_dias_uteis(p_data date, p_n int) returns date
language plpgsql immutable as $$
declare
  v date := p_data;
  i int := 0;
begin
  while i < p_n loop
    v := v - 1;
    if extract(isodow from v) < 6 then i := i + 1; end if;
  end loop;
  return v;
end $$;

-- Dias úteis do período (férias, afastamento) que caem dentro do mês da competência.
create function rh_vt_dias_periodo(p_inicio date, p_fim date, p_competencia date) returns int
language sql immutable as $$
  select case when p_inicio is null or p_fim is null or p_fim < p_inicio then 0
              else rh_vt_dias_uteis_entre(greatest(p_inicio, date_trunc('month', p_competencia)::date),
                                          least(p_fim, (date_trunc('month', p_competencia) + interval '1 month' - interval '1 day')::date)) end
$$;

create function rh_vt_rotulo_mes(p_competencia date) returns text
language sql immutable as $$
  select (array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'])[extract(month from p_competencia)::int]
         || '/' || extract(year from p_competencia)::int
$$;

-- 2) Competências -------------------------------------------------------------------
create table rh_vt_competencias (
  id uuid primary key default gen_random_uuid(),
  competencia date not null unique check (extract(day from competencia) = 1),   -- mês do VT (1º dia)
  dias_uteis_padrao int not null check (dias_uteis_padrao between 0 and 31),
  data_pagamento date not null,                       -- último dia útil do mês anterior
  prazo_fechamento date not null,                     -- 2 dias úteis antes do pagamento
  status text not null default 'aberta' check (status in ('aberta', 'enviada', 'aprovada', 'paga')),
  importada boolean not null default false,           -- veio da planilha (histórico); só consulta
  observacao text,
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  enviada_por uuid references perfis(id), enviada_em timestamptz,
  aprovada_por uuid references perfis(id), aprovada_em timestamptz,
  paga_por uuid references perfis(id), paga_em timestamptz,
  reaberta_por uuid references perfis(id), reaberta_em timestamptz, reaberta_motivo text,
  arquivo_bb_gerado_por uuid references perfis(id), arquivo_bb_gerado_em timestamptz,
  atualizado_em timestamptz not null default now()
);
comment on table rh_vt_competencias is 'Vale-transporte do mês (competência = mês do VT, paga no último dia útil do mês anterior). Fluxo aberta → enviada → aprovada → paga.';
create trigger trg_rh_vt_comp_atualizado before update on rh_vt_competencias for each row execute function fn_atualizado_em();
create trigger trg_rh_vt_comp_sem_delete before delete on rh_vt_competencias for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_vt_comp after insert or update on rh_vt_competencias for each row execute function fn_auditoria();

-- 3) Itens ---------------------------------------------------------------------------
create table rh_vt_itens (
  id uuid primary key default gen_random_uuid(),
  competencia_id uuid not null references rh_vt_competencias(id),
  colaborador_id uuid not null references rh_vt_colaboradores(id),
  -- foto do cadastro
  empresa_id uuid not null references empresas(id),
  empregador text not null,
  cod_fornecedor text not null,
  nome text not null,
  cpf varchar(14),
  agencia text,
  conta text,
  forma_pagamento text not null check (forma_pagamento in ('fopag', 'pix_neo_formas', 'pix_neo_servicos')),   -- pode mudar no mês
  tarifa numeric(14,2) check (tarifa > 0),
  valor_fixo numeric(14,2) check (valor_fixo > 0),
  passagens_dia int not null check (passagens_dia between 1 and 8),
  -- ocorrências
  dias_uteis int not null check (dias_uteis between 0 and 31),
  faltas int not null default 0 check (faltas between 0 and 31),
  atestados int not null default 0 check (atestados between 0 and 31),
  extras int not null default 0 check (extras between 0 and 31),
  ferias_inicio date, ferias_fim date,
  afastamento_inicio date, afastamento_fim date,
  abat_dias int not null default 0 check (abat_dias between 0 and 31),
  abat_valor numeric(14,2) not null default 0 check (abat_valor >= 0),
  abat_motivo text,
  sem_vt boolean not null default false,
  sem_vt_motivo text,
  observacao text,
  -- calculados (gatilho)
  dias_ferias int not null default 0,
  dias_afastamento int not null default 0,
  dias_pagos int not null default 0,
  valor numeric(14,2) not null default 0,
  -- pagamento PIX
  pix_pago_por uuid references perfis(id), pix_pago_em timestamptz,
  importado boolean not null default false,
  atualizado_por uuid references perfis(id),
  atualizado_em timestamptz not null default now(),
  unique (competencia_id, colaborador_id),
  check (tarifa is not null or valor_fixo is not null),
  check ((ferias_inicio is null) = (ferias_fim is null) and (ferias_fim is null or ferias_fim >= ferias_inicio)),
  check ((afastamento_inicio is null) = (afastamento_fim is null) and (afastamento_fim is null or afastamento_fim >= afastamento_inicio)),
  check ((abat_dias = 0 and abat_valor = 0) or coalesce(trim(abat_motivo), '') <> ''),
  check (not sem_vt or coalesce(trim(sem_vt_motivo), '') <> '')
);
comment on table rh_vt_itens is 'Uma pessoa no VT do mês: foto do cadastro, ocorrências e o valor calculado pelo gatilho (rh_vt_calcular_item).';
create index idx_rh_vt_itens_colaborador on rh_vt_itens (colaborador_id);

-- Regras 2 e 3 (espelho: lib/modulos/rh/vale-transporte/calculo.ts).
create function rh_vt_calcular_item() returns trigger
language plpgsql as $$
declare
  v_competencia date;
  v_bruto numeric;
begin
  select competencia into v_competencia from rh_vt_competencias where id = new.competencia_id;
  new.dias_ferias := rh_vt_dias_periodo(new.ferias_inicio, new.ferias_fim, v_competencia);
  new.dias_afastamento := rh_vt_dias_periodo(new.afastamento_inicio, new.afastamento_fim, v_competencia);
  if new.sem_vt then
    new.dias_pagos := 0;
    new.valor := 0;
  else
    new.dias_pagos := greatest(0, new.dias_uteis - new.faltas - new.atestados - new.dias_ferias - new.dias_afastamento - new.abat_dias + new.extras);
    if new.valor_fixo is not null then
      v_bruto := case when new.dias_uteis > 0 then round(new.valor_fixo * new.dias_pagos / new.dias_uteis, 2) else 0 end;
    else
      v_bruto := new.dias_pagos * new.passagens_dia * new.tarifa;
    end if;
    new.valor := greatest(0, round(v_bruto - new.abat_valor, 2));
  end if;
  new.atualizado_em := now();
  return new;
end $$;
create trigger trg_rh_vt_itens_calcular before insert or update on rh_vt_itens for each row execute function rh_vt_calcular_item();

-- Mês fora de "aberta": só o pagamento PIX muda.
create function rh_vt_item_regras() returns trigger
language plpgsql as $$
declare
  v_status text;
begin
  select status into v_status from rh_vt_competencias where id = new.competencia_id;
  if tg_op = 'UPDATE' and v_status <> 'aberta'
     and (to_jsonb(new) - array['pix_pago_por', 'pix_pago_em', 'atualizado_em', 'atualizado_por'])
         is distinct from (to_jsonb(old) - array['pix_pago_por', 'pix_pago_em', 'atualizado_em', 'atualizado_por']) then
    raise exception 'O VT deste mês não está aberto; para alterar, o gestor precisa reabrir.';
  end if;
  if tg_op = 'INSERT' and v_status <> 'aberta' then
    raise exception 'O VT deste mês não está aberto.';
  end if;
  return new;
end $$;
create trigger trg_rh_vt_itens_regras before insert or update on rh_vt_itens for each row execute function rh_vt_item_regras();
create trigger trg_rh_vt_itens_sem_delete before delete on rh_vt_itens for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_vt_itens after insert or update on rh_vt_itens for each row execute function fn_auditoria();

alter table rh_vt_competencias enable row level security;
alter table rh_vt_itens enable row level security;
create policy rh_vt_comp_ler on rh_vt_competencias for select to authenticated using (tem_acesso_area('rh'));
create policy rh_vt_itens_ler on rh_vt_itens for select to authenticated using (tem_acesso_area('rh'));
-- Sem insert/update/delete direto: tudo pelas funções abaixo.

-- 4) Pendências -----------------------------------------------------------------------
create function rh_vt_abrir_pendencia(p_competencia uuid, p_titulo text, p_descricao text, p_prazo date) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
begin
  insert into pendencias (modulo, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
  select 'rh.vale_transporte', p_titulo, p_descricao, p_prazo,
         case when p_prazo <= v_hoje + 2 then 'alta'::criticidade else 'normal'::criticidade end,
         'rh_vt_competencias', p_competencia,
         case when p_competencia is null then '/rh/vale_transporte/meses' else '/rh/vale_transporte/mes/' || p_competencia end
   where not exists (select 1 from pendencias where modulo = 'rh.vale_transporte' and titulo = p_titulo and status in ('aberta', 'em_andamento'));
end $$;

create function rh_vt_encerrar_pendencia(p_titulo text, p_status status_pendencia) returns void
language plpgsql security definer set search_path = public as $$
begin
  update pendencias set status = p_status, concluido_em = case when p_status = 'concluida' then now() else concluido_em end
   where modulo = 'rh.vale_transporte' and titulo = p_titulo and status in ('aberta', 'em_andamento');
end $$;
revoke all on function rh_vt_abrir_pendencia(uuid, text, text, date) from public, anon, authenticated;
revoke all on function rh_vt_encerrar_pendencia(text, status_pendencia) from public, anon, authenticated;

-- 5) Fluxo ------------------------------------------------------------------------------
create function rh_vt_exigir(p_nivel nivel_acesso) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('rh', p_nivel) then
    raise exception 'Somente % do RH (ou acima) pode fazer isso no vale-transporte.', p_nivel;
  end if;
end $$;

create function rh_vt_competencia_para(p_id uuid, p_status text[]) returns rh_vt_competencias
language plpgsql security definer set search_path = public as $$
declare
  c rh_vt_competencias;
begin
  select * into c from rh_vt_competencias where id = p_id for update;
  if c.id is null then raise exception 'Mês do VT não encontrado.'; end if;
  if c.importada then raise exception 'Mês importado da planilha: só consulta.'; end if;
  if not (c.status = any (p_status)) then
    raise exception 'O VT de % está "%"; esta ação não vale nessa situação.', rh_vt_rotulo_mes(c.competencia), c.status;
  end if;
  return c;
end $$;
revoke all on function rh_vt_competencia_para(uuid, text[]) from public, anon, authenticated;

-- Abre o mês com todos os colaboradores ativos.
create function rh_vt_abrir_competencia(p_competencia date, p_dias_uteis int) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_pag date := rh_vt_ultimo_dia_util((v_comp - interval '1 month')::date);
  v_id uuid;
begin
  perform rh_vt_exigir('operador');
  if p_dias_uteis is null or p_dias_uteis not between 0 and 31 then
    raise exception 'Informe os dias úteis do mês (0 a 31).';
  end if;
  if exists (select 1 from rh_vt_competencias where competencia = v_comp) then
    raise exception 'O VT de % já foi aberto.', rh_vt_rotulo_mes(v_comp);
  end if;
  insert into rh_vt_competencias (competencia, dias_uteis_padrao, data_pagamento, prazo_fechamento)
  values (v_comp, p_dias_uteis, v_pag, rh_vt_voltar_dias_uteis(v_pag, 2))
  returning id into v_id;
  insert into rh_vt_itens (competencia_id, colaborador_id, empresa_id, empregador, cod_fornecedor, nome, cpf, agencia, conta, forma_pagamento,
                           tarifa, valor_fixo, passagens_dia, dias_uteis, atualizado_por)
  select v_id, c.id, c.empresa_id, c.empregador, c.cod_fornecedor, c.nome, c.cpf, c.agencia, c.conta, c.forma_pagamento,
         c.tarifa, c.valor_fixo, c.passagens_dia, p_dias_uteis, auth.uid()
    from rh_vt_colaboradores c where c.ativo;
  perform rh_vt_abrir_pendencia(v_id, 'Fechar VT de ' || rh_vt_rotulo_mes(v_comp),
    'Lançar faltas, atestados, extras, férias e abatimentos e enviar para aprovação.', rh_vt_voltar_dias_uteis(v_pag, 2));
  update pendencias set referencia_id = v_id, link = '/rh/vale_transporte/mes/' || v_id
   where modulo = 'rh.vale_transporte' and titulo = 'Fechar VT de ' || rh_vt_rotulo_mes(v_comp) and status in ('aberta', 'em_andamento');
  return v_id;
end $$;

-- Traz para o mês aberto o que mudou no cadastro: dados das pessoas, quem entrou (ativos) e quem saiu (sem VT).
-- Ocorrências já digitadas são mantidas. Devolve {atualizados, incluidos, desativados}.
create function rh_vt_atualizar_do_cadastro(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c rh_vt_competencias;
  v_atu int; v_inc int; v_des int;
begin
  perform rh_vt_exigir('operador');
  c := rh_vt_competencia_para(p_id, array['aberta']);
  update rh_vt_itens i set empresa_id = k.empresa_id, empregador = k.empregador, cod_fornecedor = k.cod_fornecedor, nome = k.nome, cpf = k.cpf,
         agencia = k.agencia, conta = k.conta, tarifa = k.tarifa, valor_fixo = k.valor_fixo, passagens_dia = k.passagens_dia, atualizado_por = auth.uid()
    from rh_vt_colaboradores k
   where i.competencia_id = p_id and k.id = i.colaborador_id and k.ativo
     and (i.empresa_id, i.empregador, i.cod_fornecedor, i.nome, i.cpf, i.agencia, i.conta, i.tarifa, i.valor_fixo, i.passagens_dia)
         is distinct from (k.empresa_id, k.empregador, k.cod_fornecedor, k.nome, k.cpf, k.agencia, k.conta, k.tarifa, k.valor_fixo, k.passagens_dia);
  get diagnostics v_atu = row_count;
  insert into rh_vt_itens (competencia_id, colaborador_id, empresa_id, empregador, cod_fornecedor, nome, cpf, agencia, conta, forma_pagamento,
                           tarifa, valor_fixo, passagens_dia, dias_uteis, atualizado_por)
  select p_id, k.id, k.empresa_id, k.empregador, k.cod_fornecedor, k.nome, k.cpf, k.agencia, k.conta, k.forma_pagamento,
         k.tarifa, k.valor_fixo, k.passagens_dia, c.dias_uteis_padrao, auth.uid()
    from rh_vt_colaboradores k
   where k.ativo and not exists (select 1 from rh_vt_itens i where i.competencia_id = p_id and i.colaborador_id = k.id);
  get diagnostics v_inc = row_count;
  update rh_vt_itens i set sem_vt = true, sem_vt_motivo = 'Desativado no cadastro', atualizado_por = auth.uid()
    from rh_vt_colaboradores k
   where i.competencia_id = p_id and k.id = i.colaborador_id and not k.ativo and not i.sem_vt;
  get diagnostics v_des = row_count;
  return jsonb_build_object('atualizados', v_atu, 'incluidos', v_inc, 'desativados', v_des);
end $$;

-- Muda os dias úteis do mês; as pessoas que estavam no padrão antigo acompanham.
create function rh_vt_definir_dias_uteis(p_id uuid, p_dias int) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_vt_competencias;
begin
  perform rh_vt_exigir('operador');
  c := rh_vt_competencia_para(p_id, array['aberta']);
  if p_dias is null or p_dias not between 0 and 31 then raise exception 'Dias úteis: de 0 a 31.'; end if;
  update rh_vt_itens set dias_uteis = p_dias, atualizado_por = auth.uid() where competencia_id = p_id and dias_uteis = c.dias_uteis_padrao;
  update rh_vt_competencias set dias_uteis_padrao = p_dias where id = p_id;
end $$;

-- Grava as ocorrências digitadas na grade (lote). p_itens: [{id, forma_pagamento, dias_uteis, faltas, atestados, extras,
-- ferias_inicio, ferias_fim, afastamento_inicio, afastamento_fim, abat_dias, abat_valor, abat_motivo, sem_vt, sem_vt_motivo, observacao}]
create function rh_vt_salvar_itens(p_id uuid, p_itens jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  c rh_vt_competencias;
  v_n int;
begin
  perform rh_vt_exigir('operador');
  c := rh_vt_competencia_para(p_id, array['aberta']);
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Nada para salvar.'; end if;
  update rh_vt_itens i set
    forma_pagamento = coalesce(x.forma_pagamento, i.forma_pagamento),
    dias_uteis = coalesce(x.dias_uteis, i.dias_uteis), faltas = coalesce(x.faltas, 0), atestados = coalesce(x.atestados, 0), extras = coalesce(x.extras, 0),
    ferias_inicio = x.ferias_inicio, ferias_fim = x.ferias_fim, afastamento_inicio = x.afastamento_inicio, afastamento_fim = x.afastamento_fim,
    abat_dias = coalesce(x.abat_dias, 0), abat_valor = round(coalesce(x.abat_valor, 0), 2), abat_motivo = nullif(trim(x.abat_motivo), ''),
    sem_vt = coalesce(x.sem_vt, false), sem_vt_motivo = nullif(trim(x.sem_vt_motivo), ''), observacao = nullif(trim(x.observacao), ''),
    atualizado_por = auth.uid()
    from jsonb_to_recordset(p_itens) as x(id uuid, forma_pagamento text, dias_uteis int, faltas int, atestados int, extras int,
         ferias_inicio date, ferias_fim date, afastamento_inicio date, afastamento_fim date, abat_dias int, abat_valor numeric,
         abat_motivo text, sem_vt boolean, sem_vt_motivo text, observacao text)
   where i.id = x.id and i.competencia_id = p_id;
  get diagnostics v_n = row_count;
  if v_n <> jsonb_array_length(p_itens) then raise exception 'Algumas linhas não pertencem a este mês; recarregue a página.'; end if;
  return v_n;
end $$;

create function rh_vt_enviar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_vt_competencias;
  v_faltando text;
begin
  perform rh_vt_exigir('operador');
  c := rh_vt_competencia_para(p_id, array['aberta']);
  select string_agg(cod_fornecedor || ' ' || nome, ', ' order by nome) into v_faltando
    from rh_vt_itens where competencia_id = p_id and forma_pagamento = 'fopag' and valor > 0 and (cpf is null or agencia is null or conta is null);
  if v_faltando is not null then
    raise exception 'FOPAG sem CPF, agência ou conta (não entram no arquivo do BB): %. Complete o cadastro e use "Atualizar do cadastro", ou mude a forma de pagamento.', v_faltando;
  end if;
  update rh_vt_competencias set status = 'enviada', enviada_por = auth.uid(), enviada_em = now() where id = p_id;
  perform rh_vt_encerrar_pendencia('Fechar VT de ' || rh_vt_rotulo_mes(c.competencia), 'concluida');
  perform rh_vt_abrir_pendencia(p_id, 'Aprovar VT de ' || rh_vt_rotulo_mes(c.competencia), 'Conferir e aprovar o VT do mês (gestor).', c.data_pagamento);
end $$;

create function rh_vt_aprovar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_vt_competencias;
begin
  perform rh_vt_exigir('gestor');
  c := rh_vt_competencia_para(p_id, array['enviada']);
  update rh_vt_competencias set status = 'aprovada', aprovada_por = auth.uid(), aprovada_em = now() where id = p_id;
  perform rh_vt_encerrar_pendencia('Aprovar VT de ' || rh_vt_rotulo_mes(c.competencia), 'concluida');
  perform rh_vt_abrir_pendencia(p_id, 'Pagar VT de ' || rh_vt_rotulo_mes(c.competencia),
    'Gerar o arquivo do BB (FOPAG), pagar os PIX e lançar os títulos no Consistem.', c.data_pagamento);
end $$;

create function rh_vt_reabrir(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_vt_competencias;
begin
  perform rh_vt_exigir('gestor');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo para reabrir.'; end if;
  c := rh_vt_competencia_para(p_id, array['enviada', 'aprovada', 'paga']);
  update rh_vt_competencias set status = 'aberta', reaberta_por = auth.uid(), reaberta_em = now(), reaberta_motivo = trim(p_motivo),
         arquivo_bb_gerado_por = null, arquivo_bb_gerado_em = null, paga_por = null, paga_em = null where id = p_id;
  perform rh_vt_encerrar_pendencia('Aprovar VT de ' || rh_vt_rotulo_mes(c.competencia), 'cancelada');
  perform rh_vt_encerrar_pendencia('Pagar VT de ' || rh_vt_rotulo_mes(c.competencia), 'cancelada');
  perform rh_vt_abrir_pendencia(p_id, 'Fechar VT de ' || rh_vt_rotulo_mes(c.competencia), 'Reaberto: ' || trim(p_motivo), c.prazo_fechamento);
end $$;

create function rh_vt_marcar_pix(p_id uuid, p_itens uuid[], p_pago boolean) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  perform rh_vt_exigir('operador');
  perform rh_vt_competencia_para(p_id, array['aprovada']);
  update rh_vt_itens set pix_pago_por = case when p_pago then auth.uid() end, pix_pago_em = case when p_pago then now() end
   where competencia_id = p_id and id = any (p_itens) and forma_pagamento <> 'fopag' and valor > 0;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function rh_vt_registrar_arquivo_bb(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_vt_exigir('gestor');
  perform rh_vt_competencia_para(p_id, array['aprovada', 'paga']);
  update rh_vt_competencias set arquivo_bb_gerado_por = auth.uid(), arquivo_bb_gerado_em = now() where id = p_id;
end $$;

create function rh_vt_marcar_paga(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c rh_vt_competencias;
  v_pix int;
begin
  perform rh_vt_exigir('operador');
  c := rh_vt_competencia_para(p_id, array['aprovada']);
  if c.arquivo_bb_gerado_em is null and exists (select 1 from rh_vt_itens where competencia_id = p_id and forma_pagamento = 'fopag' and valor > 0) then
    raise exception 'Gere o arquivo do BB (FOPAG) antes de marcar o mês como pago.';
  end if;
  select count(*) into v_pix from rh_vt_itens where competencia_id = p_id and forma_pagamento <> 'fopag' and valor > 0 and pix_pago_em is null;
  if v_pix > 0 then raise exception 'Ainda há % PIX sem marcação de pago.', v_pix; end if;
  update rh_vt_competencias set status = 'paga', paga_por = auth.uid(), paga_em = now() where id = p_id;
  perform rh_vt_encerrar_pendencia('Pagar VT de ' || rh_vt_rotulo_mes(c.competencia), 'concluida');
end $$;

revoke all on function rh_vt_exigir(nivel_acesso) from public, anon;
revoke all on function rh_vt_abrir_competencia(date, int) from public, anon;
revoke all on function rh_vt_atualizar_do_cadastro(uuid) from public, anon;
revoke all on function rh_vt_definir_dias_uteis(uuid, int) from public, anon;
revoke all on function rh_vt_salvar_itens(uuid, jsonb) from public, anon;
revoke all on function rh_vt_enviar(uuid) from public, anon;
revoke all on function rh_vt_aprovar(uuid) from public, anon;
revoke all on function rh_vt_reabrir(uuid, text) from public, anon;
revoke all on function rh_vt_marcar_pix(uuid, uuid[], boolean) from public, anon;
revoke all on function rh_vt_registrar_arquivo_bb(uuid) from public, anon;
revoke all on function rh_vt_marcar_paga(uuid) from public, anon;

-- 6) Rotina diária: lembra de fechar o VT do mês seguinte a partir de 7 dias úteis antes do prazo -----------------
create function rh_vt_rotina_diaria() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_comp date := (date_trunc('month', v_hoje) + interval '1 month')::date;
  v_pag date := rh_vt_ultimo_dia_util(date_trunc('month', v_hoje)::date);
  v_prazo date := rh_vt_voltar_dias_uteis(v_pag, 2);
  v_id uuid;
begin
  if v_hoje < rh_vt_voltar_dias_uteis(v_prazo, 7) or v_hoje > v_pag then return; end if;
  select id into v_id from rh_vt_competencias where competencia = v_comp;
  if v_id is not null and exists (select 1 from rh_vt_competencias where id = v_id and status <> 'aberta') then return; end if;
  perform rh_vt_abrir_pendencia(v_id, 'Fechar VT de ' || rh_vt_rotulo_mes(v_comp),
    case when v_id is null then 'Abrir o mês no Neo Admin, lançar as ocorrências e enviar para aprovação.'
         else 'Lançar faltas, atestados, extras, férias e abatimentos e enviar para aprovação.' end, v_prazo);
end $$;
revoke all on function rh_vt_rotina_diaria() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('rh-vt-rotina-diaria', '0 11 * * *', 'select public.rh_vt_rotina_diaria()');
  end if;
end $$;
