-- =========================================================
-- Neo Admin — 0516 RH/SST > Ponto: inconsistências por quinzena
-- A cada quinzena (26 a 11 e 12 a 25) o RH importa o relatório "Inconsistências" do Control iD de cada setor; o líder do
-- setor justifica cada ocorrência num formulário (link no e-mail, login Google) e o RH ajusta no Control iD e marca.
-- Especificação: docs/modulos/rh-ponto.md.
--
-- 1) Módulo rh.ponto (rota /rh/ponto). Prazo do líder em dias úteis (configuracoes 'rh.ponto.prazo_dias_uteis', padrão 1).
-- 2) rh_pt_setores: setor com líder titular e substituto (perfis). O líder NÃO ganha a área RH (sensível: salários): tudo
--    o que ele faz passa por funções security definer que conferem se ele é titular ou substituto do setor do lote.
--    nivel_area()/tem_acesso_modulo() não mudam (não mexe no usuário restrito da 0152).
-- 3) rh_pt_lotes (setor × período) e rh_pt_ocorrencias (um dia de uma pessoa). Fluxo:
--    importado → enviado → (devolvido → enviado de novo pelo líder) → justificado → concluido; cancelado (gestor, com motivo).
--    Reimportar o mesmo setor e período só enquanto "importado": o lote anterior é cancelado ("substituído"), nada é apagado.
-- 4) Pendências: líder "Justificar ponto" (responsavel_id = líder; prazo); RH "Cobrar líder" (job diário quando vence) e
--    "Ajustar no Control iD" (quando o líder envia).
-- =========================================================

-- 1) Módulo e prazo ---------------------------------------------------------------------------------------------------------
insert into modulos (codigo, area, nome, ativo) values ('rh.ponto', 'rh', 'Ponto', true)
  on conflict (codigo) do update set ativo = true, nome = excluded.nome;
insert into configuracoes (chave, valor, descricao) values
  ('rh.ponto.prazo_dias_uteis', '1'::jsonb, 'RH > Ponto: dias úteis que o líder tem para justificar as inconsistências, contados do envio.')
  on conflict (chave) do nothing;

-- Soma n dias úteis (segunda a sexta, sem feriados) a uma data (que não conta).
create function rh_somar_dias_uteis(p_data date, p_n int) returns date
language sql immutable as $$
  select d::date from generate_series(p_data + 1, p_data + 7 + greatest(p_n, 1) * 2, interval '1 day') d
   where extract(isodow from d) < 6 order by d offset greatest(p_n, 1) - 1 limit 1
$$;

create function rh_pt_prazo_dias() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (valor #>> '{}')::int from configuracoes where chave = 'rh.ponto.prazo_dias_uteis'), 1)
$$;

-- 2) Setores ----------------------------------------------------------------------------------------------------------------
create table rh_pt_setores (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique check (trim(nome) <> ''),
  lider_id uuid not null references perfis(id),
  substituto_id uuid references perfis(id),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (substituto_id is distinct from lider_id)
);
comment on table rh_pt_setores is 'Setores que recebem o relatório de inconsistências do ponto, com o líder (titular e substituto) que justifica.';
create trigger trg_rh_pt_setores_atualizado before update on rh_pt_setores for each row execute function fn_atualizado_em();
create trigger trg_rh_pt_setores_sem_delete before delete on rh_pt_setores for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_pt_setores after insert or update on rh_pt_setores for each row execute function fn_auditoria();

-- 3) Lotes e ocorrências -------------------------------------------------------------------------------------------------
create table rh_pt_lotes (
  id uuid primary key default gen_random_uuid(),
  setor_id uuid not null references rh_pt_setores(id),
  periodo_inicio date not null,
  periodo_fim date not null check (periodo_fim >= periodo_inicio),
  status text not null default 'importado' check (status in ('importado', 'enviado', 'devolvido', 'justificado', 'concluido', 'cancelado')),
  arquivo_nome text not null,
  prazo date,                                         -- do líder (enviado / devolvido)
  importado_por uuid references perfis(id) default auth.uid(),
  importado_em timestamptz not null default now(),
  enviado_por uuid references perfis(id), enviado_em timestamptz,
  lembrete_em timestamptz,
  devolvido_por uuid references perfis(id), devolvido_em timestamptz, devolvido_motivo text,
  justificado_por uuid references perfis(id), justificado_em timestamptz,
  concluido_em timestamptz,
  cancelado_por uuid references perfis(id), cancelado_em timestamptz, cancelado_motivo text,
  atualizado_em timestamptz not null default now()
);
comment on table rh_pt_lotes is 'Relatório de inconsistências do Control iD de um setor e período (quinzena), com o fluxo líder → RH.';
create unique index uq_rh_pt_lote_periodo on rh_pt_lotes (setor_id, periodo_inicio, periodo_fim) where status <> 'cancelado';
create trigger trg_rh_pt_lotes_atualizado before update on rh_pt_lotes for each row execute function fn_atualizado_em();
create trigger trg_rh_pt_lotes_sem_delete before delete on rh_pt_lotes for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_pt_lotes after insert or update on rh_pt_lotes for each row execute function fn_auditoria();

create table rh_pt_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references rh_pt_lotes(id),
  ordem int not null,
  colaborador_id uuid references rh_colaboradores(id),   -- nulo = "sem cadastro" (o RH vincula)
  nome text not null,
  matricula text,
  cargo text,
  data date not null,
  dia_semana text not null,
  previsto text not null default '',
  marcacoes text[] not null default '{}',
  falta boolean not null default false,
  falta_atraso_min int not null default 0,
  total_normais_min int,
  extras_min int not null default 0,                    -- só o RH vê
  banco_saldo_min int,                                  -- só o RH vê
  -- justificativa do líder
  tipo text check (tipo in ('esqueceu_bater', 'batida_indevida', 'saida_atraso', 'falta_injustificada', 'justificada', 'outro')),
  horario text check (horario ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  observacao text,
  justificado_por uuid references perfis(id), justificado_em timestamptz,
  -- ajuste no Control iD (RH)
  ajustado_por uuid references perfis(id), ajustado_em timestamptz,
  unique (lote_id, ordem)
);
comment on table rh_pt_ocorrencias is 'Um dia de uma pessoa no relatório de inconsistências: o que o Control iD apontou, a justificativa do líder e o ajuste do RH.';
create index idx_rh_pt_ocorrencias_lote on rh_pt_ocorrencias (lote_id);
create trigger trg_rh_pt_ocorrencias_sem_delete before delete on rh_pt_ocorrencias for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_pt_ocorrencias after insert or update on rh_pt_ocorrencias for each row execute function fn_auditoria();

alter table rh_pt_setores enable row level security;
alter table rh_pt_lotes enable row level security;
alter table rh_pt_ocorrencias enable row level security;
create policy rh_pt_setores_ler on rh_pt_setores for select to authenticated using (tem_acesso_area('rh'));
create policy rh_pt_lotes_ler on rh_pt_lotes for select to authenticated using (tem_acesso_area('rh'));
create policy rh_pt_ocorrencias_ler on rh_pt_ocorrencias for select to authenticated using (tem_acesso_area('rh'));
-- Sem insert/update/delete direto: tudo pelas funções abaixo. O líder não lê as tabelas: só pelas funções rh_pt_*_do_lider.

-- 4) Pendências --------------------------------------------------------------------------------------------------------------
create function rh_pt_rotulo(p_lote uuid) returns text
language sql stable security definer set search_path = public as $$
  select s.nome || ' ' || to_char(l.periodo_inicio, 'DD/MM') || ' a ' || to_char(l.periodo_fim, 'DD/MM/YYYY')
    from rh_pt_lotes l join rh_pt_setores s on s.id = l.setor_id where l.id = p_lote
$$;

create function rh_pt_abrir_pendencia(p_lote uuid, p_titulo text, p_descricao text, p_prazo date, p_responsavel uuid, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
begin
  insert into pendencias (modulo, titulo, descricao, prazo, criticidade, responsavel_id, referencia_tabela, referencia_id, link)
  values ('rh.ponto', p_titulo, p_descricao, p_prazo,
          case when p_prazo is not null and p_prazo < v_hoje then 'critica'::criticidade when p_prazo is not null and p_prazo <= v_hoje + 1 then 'alta'::criticidade else 'normal'::criticidade end,
          p_responsavel, 'rh_pt_lotes', p_lote, p_link)
  on conflict do nothing;
end $$;

-- Encerra as pendências do lote cujo título começa com p_prefixo ("Justificar ponto", "Cobrar líder", "Ajustar no Control iD").
create function rh_pt_encerrar_pendencias(p_lote uuid, p_prefixo text, p_status status_pendencia) returns void
language plpgsql security definer set search_path = public as $$
begin
  update pendencias set status = p_status, concluido_em = case when p_status = 'concluida' then now() else concluido_em end
   where modulo = 'rh.ponto' and referencia_tabela = 'rh_pt_lotes' and referencia_id = p_lote
     and titulo like p_prefixo || '%' and status in ('aberta', 'em_andamento');
end $$;

-- Pendência do líder: uma para o titular e outra para o substituto (o título difere: índice único por origem e título).
create function rh_pt_pendencias_do_lider(p_lote uuid, p_descricao text, p_prazo date) returns void
language plpgsql security definer set search_path = public as $$
declare
  s rh_pt_setores;
  v_rotulo text := rh_pt_rotulo(p_lote);
begin
  select s2.* into s from rh_pt_setores s2 join rh_pt_lotes l on l.setor_id = s2.id where l.id = p_lote;
  perform rh_pt_abrir_pendencia(p_lote, 'Justificar ponto — ' || v_rotulo, p_descricao, p_prazo, s.lider_id, '/ponto/justificar/' || p_lote);
  if s.substituto_id is not null then
    perform rh_pt_abrir_pendencia(p_lote, 'Justificar ponto — ' || v_rotulo || ' (substituto)', p_descricao, p_prazo, s.substituto_id, '/ponto/justificar/' || p_lote);
  end if;
end $$;

revoke all on function rh_pt_rotulo(uuid) from public, anon, authenticated;
revoke all on function rh_pt_abrir_pendencia(uuid, text, text, date, uuid, text) from public, anon, authenticated;
revoke all on function rh_pt_encerrar_pendencias(uuid, text, status_pendencia) from public, anon, authenticated;
revoke all on function rh_pt_pendencias_do_lider(uuid, text, date) from public, anon, authenticated;

-- 5) RH: setores e prazo (gestor) -----------------------------------------------------------------------------------------
create function rh_pt_salvar_setor(p_id uuid, p_nome text, p_lider uuid, p_substituto uuid, p_ativo boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
begin
  perform rh_exigir('gestor');
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome do setor.'; end if;
  if p_lider is null then raise exception 'Escolha o líder do setor.'; end if;
  if p_lider = p_substituto then raise exception 'O substituto tem de ser outra pessoa.'; end if;
  if exists (select 1 from perfis where id in (p_lider, p_substituto) and not ativo) then raise exception 'Líder ou substituto com a conta desativada.'; end if;
  if v_id is null then
    insert into rh_pt_setores (nome, lider_id, substituto_id, ativo) values (trim(p_nome), p_lider, p_substituto, coalesce(p_ativo, true)) returning id into v_id;
  else
    update rh_pt_setores set nome = trim(p_nome), lider_id = p_lider, substituto_id = p_substituto, ativo = coalesce(p_ativo, true) where id = v_id;
    if not found then raise exception 'Setor não encontrado.'; end if;
  end if;
  return v_id;
end $$;

create function rh_pt_salvar_prazo(p_dias int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('gestor');
  if p_dias is null or p_dias < 1 or p_dias > 10 then raise exception 'O prazo do líder vai de 1 a 10 dias úteis.'; end if;
  update configuracoes set valor = to_jsonb(p_dias) where chave = 'rh.ponto.prazo_dias_uteis';
end $$;

-- 6) RH: lote --------------------------------------------------------------------------------------------------------------
create function rh_pt_lote_para(p_id uuid, p_status text[]) returns rh_pt_lotes
language plpgsql security definer set search_path = public as $$
declare
  l rh_pt_lotes;
begin
  select * into l from rh_pt_lotes where id = p_id for update;
  if l.id is null then raise exception 'Lote do ponto não encontrado.'; end if;
  if not (l.status = any (p_status)) then
    raise exception 'O lote % está "%"; esta ação não vale nessa situação.', rh_pt_rotulo(p_id), l.status;
  end if;
  return l;
end $$;
revoke all on function rh_pt_lote_para(uuid, text[]) from public, anon, authenticated;

-- Grava o relatório lido. p_ocorrencias: [{ordem, colaborador_id, nome, matricula, cargo, data, dia_semana, previsto, marcacoes[],
-- falta, falta_atraso_min, total_normais_min, extras_min, banco_saldo_min}]. Mesmo setor e período ainda "importado": substitui.
create function rh_pt_importar(p_setor uuid, p_inicio date, p_fim date, p_arquivo text, p_ocorrencias jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_anterior rh_pt_lotes;
  v_id uuid;
begin
  perform rh_exigir('operador');
  if not exists (select 1 from rh_pt_setores where id = p_setor and ativo) then raise exception 'Setor não encontrado ou inativo.'; end if;
  if p_ocorrencias is null or jsonb_typeof(p_ocorrencias) <> 'array' or jsonb_array_length(p_ocorrencias) = 0 then
    raise exception 'O relatório não tem ocorrências.';
  end if;
  select * into v_anterior from rh_pt_lotes where setor_id = p_setor and periodo_inicio = p_inicio and periodo_fim = p_fim and status <> 'cancelado' for update;
  if v_anterior.id is not null then
    if v_anterior.status <> 'importado' then
      raise exception 'O lote % já foi enviado ao líder (situação "%"): para importar de novo, o gestor cancela o lote anterior.', rh_pt_rotulo(v_anterior.id), v_anterior.status;
    end if;
    update rh_pt_lotes set status = 'cancelado', cancelado_por = auth.uid(), cancelado_em = now(), cancelado_motivo = 'Substituído por nova importação.' where id = v_anterior.id;
  end if;
  insert into rh_pt_lotes (setor_id, periodo_inicio, periodo_fim, arquivo_nome) values (p_setor, p_inicio, p_fim, p_arquivo) returning id into v_id;
  insert into rh_pt_ocorrencias (lote_id, ordem, colaborador_id, nome, matricula, cargo, data, dia_semana, previsto, marcacoes, falta,
                                 falta_atraso_min, total_normais_min, extras_min, banco_saldo_min)
  select v_id, x.ordem, x.colaborador_id, x.nome, x.matricula, x.cargo, x.data, x.dia_semana, coalesce(x.previsto, ''),
         coalesce(array(select jsonb_array_elements_text(x.marcacoes)), '{}'), coalesce(x.falta, false),
         coalesce(x.falta_atraso_min, 0), x.total_normais_min, coalesce(x.extras_min, 0), x.banco_saldo_min
    from jsonb_to_recordset(p_ocorrencias) as x(ordem int, colaborador_id uuid, nome text, matricula text, cargo text, data date, dia_semana text,
         previsto text, marcacoes jsonb, falta boolean, falta_atraso_min int, total_normais_min int, extras_min int, banco_saldo_min int);
  return v_id;
end $$;

create function rh_pt_vincular_colaborador(p_ocorrencia uuid, p_colaborador uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  o rh_pt_ocorrencias;
  v_n int;
begin
  perform rh_exigir('operador');
  select * into o from rh_pt_ocorrencias where id = p_ocorrencia;
  if o.id is null then raise exception 'Ocorrência não encontrada.'; end if;
  perform rh_pt_lote_para(o.lote_id, array['importado', 'enviado', 'devolvido', 'justificado']);
  if p_colaborador is not null and not exists (select 1 from rh_colaboradores where id = p_colaborador) then raise exception 'Colaborador não encontrado.'; end if;
  -- todas as ocorrências da mesma pessoa no lote
  update rh_pt_ocorrencias set colaborador_id = p_colaborador where lote_id = o.lote_id and nome = o.nome;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Chamada pela Edge Function rh-ponto-rascunho-gmail (service role) depois de criar o rascunho no Gmail de quem enviou.
-- p_modo 'envio': importado → enviado, prazo do líder e pendências dele; 'lembrete' e 'devolucao': só registra.
create function rh_pt_registrar_rascunho(p_lote uuid, p_modo text, p_usuario uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  l rh_pt_lotes;
  v_prazo date := rh_somar_dias_uteis((now() at time zone 'America/Cuiaba')::date, rh_pt_prazo_dias());
begin
  if p_modo = 'envio' then
    l := rh_pt_lote_para(p_lote, array['importado']);
    update rh_pt_lotes set status = 'enviado', enviado_por = p_usuario, enviado_em = now(), prazo = v_prazo where id = p_lote;
    perform rh_pt_pendencias_do_lider(p_lote, 'Escolher a justificativa de cada ocorrência do ponto e clicar em "Enviar justificativas".', v_prazo);
  elsif p_modo = 'lembrete' then
    l := rh_pt_lote_para(p_lote, array['enviado', 'devolvido']);
    update rh_pt_lotes set lembrete_em = now() where id = p_lote;
    perform rh_pt_encerrar_pendencias(p_lote, 'Cobrar líder', 'concluida');
  elsif p_modo = 'devolucao' then
    -- a pendência do líder nasce aqui (service role): o operador do RH não atribui pendência a outra pessoa (fn_pendencias_regras)
    l := rh_pt_lote_para(p_lote, array['devolvido']);
    perform rh_pt_pendencias_do_lider(p_lote, 'Devolvido pelo RH: ' || l.devolvido_motivo, l.prazo);
  else
    raise exception 'Modo inválido.';
  end if;
end $$;
revoke all on function rh_pt_registrar_rascunho(uuid, text, uuid) from public, anon, authenticated;

-- Devolve ao líder (justificado → devolvido), com motivo e novo prazo. A tela gera em seguida o rascunho da devolução, que
-- abre de novo a pendência do líder (rh_pt_registrar_rascunho 'devolucao').
create function rh_pt_devolver(p_lote uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_prazo date := rh_somar_dias_uteis((now() at time zone 'America/Cuiaba')::date, rh_pt_prazo_dias());
begin
  perform rh_exigir('operador');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da devolução.'; end if;
  perform rh_pt_lote_para(p_lote, array['justificado']);
  if exists (select 1 from rh_pt_ocorrencias where lote_id = p_lote and ajustado_em is not null) then
    raise exception 'Há ocorrências já marcadas como ajustadas no Control iD: desmarque-as antes de devolver.';
  end if;
  update rh_pt_lotes set status = 'devolvido', devolvido_por = auth.uid(), devolvido_em = now(), devolvido_motivo = trim(p_motivo), prazo = v_prazo where id = p_lote;
  perform rh_pt_encerrar_pendencias(p_lote, 'Ajustar no Control iD', 'cancelada');
end $$;

-- Marca (ou desmarca) ocorrências como ajustadas no Control iD. Todas marcadas → lote concluído.
create function rh_pt_marcar_ajustado(p_lote uuid, p_ocorrencias uuid[], p_ajustado boolean) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  perform rh_exigir('operador');
  perform rh_pt_lote_para(p_lote, array['justificado']);
  update rh_pt_ocorrencias set ajustado_por = case when p_ajustado then auth.uid() end, ajustado_em = case when p_ajustado then now() end
   where lote_id = p_lote and id = any (p_ocorrencias) and (ajustado_em is null) = p_ajustado;
  get diagnostics v_n = row_count;
  if not exists (select 1 from rh_pt_ocorrencias where lote_id = p_lote and ajustado_em is null) then
    update rh_pt_lotes set status = 'concluido', concluido_em = now() where id = p_lote;
    perform rh_pt_encerrar_pendencias(p_lote, 'Ajustar no Control iD', 'concluida');
  end if;
  return v_n;
end $$;

create function rh_pt_cancelar(p_lote uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('gestor');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  perform rh_pt_lote_para(p_lote, array['importado', 'enviado', 'devolvido', 'justificado']);
  update rh_pt_lotes set status = 'cancelado', cancelado_por = auth.uid(), cancelado_em = now(), cancelado_motivo = trim(p_motivo) where id = p_lote;
  perform rh_pt_encerrar_pendencias(p_lote, '', 'cancelada');
end $$;

-- 7) Líder ------------------------------------------------------------------------------------------------------------------
create function rh_pt_eh_lider(p_lote uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select acesso_liberado(auth.uid()) and exists (
    select 1 from rh_pt_lotes l join rh_pt_setores s on s.id = l.setor_id
     where l.id = p_lote and auth.uid() in (s.lider_id, s.substituto_id))
$$;

-- Lotes dos setores em que a pessoa é líder (titular ou substituto), a partir do envio.
create function rh_pt_lotes_do_lider() returns table (
  id uuid, setor text, periodo_inicio date, periodo_fim date, status text, prazo date, devolvido_motivo text,
  justificado_em timestamptz, ocorrencias int, justificadas int)
language sql stable security definer set search_path = public as $$
  select l.id, s.nome, l.periodo_inicio, l.periodo_fim, l.status, l.prazo, l.devolvido_motivo, l.justificado_em,
         (select count(*)::int from rh_pt_ocorrencias o where o.lote_id = l.id),
         (select count(*)::int from rh_pt_ocorrencias o where o.lote_id = l.id and o.tipo is not null)
    from rh_pt_lotes l join rh_pt_setores s on s.id = l.setor_id
   where acesso_liberado(auth.uid()) and auth.uid() in (s.lider_id, s.substituto_id)
     and l.status in ('enviado', 'devolvido', 'justificado', 'concluido')
   order by l.periodo_inicio desc
$$;

-- Ocorrências do lote para o formulário: só o necessário (sem saldo do banco nem extras).
create function rh_pt_ocorrencias_do_lider(p_lote uuid) returns table (
  id uuid, ordem int, nome text, cargo text, data date, dia_semana text, previsto text, marcacoes text[], falta boolean, falta_atraso_min int,
  tipo text, horario text, observacao text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not rh_pt_eh_lider(p_lote) then raise exception 'Este lote não é de um setor em que você é líder.'; end if;
  return query
    select o.id, o.ordem, o.nome, o.cargo, o.data, o.dia_semana, o.previsto, o.marcacoes, o.falta, o.falta_atraso_min, o.tipo, o.horario, o.observacao
      from rh_pt_ocorrencias o join rh_pt_lotes l on l.id = o.lote_id
     where o.lote_id = p_lote and l.status in ('enviado', 'devolvido', 'justificado', 'concluido')
     order by o.ordem;
end $$;

-- Grava as justificativas (rascunho do líder; pode salvar aos poucos). p_itens: [{id, tipo, horario, observacao}]
create function rh_pt_justificar(p_lote uuid, p_itens jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if not rh_pt_eh_lider(p_lote) then raise exception 'Este lote não é de um setor em que você é líder.'; end if;
  perform rh_pt_lote_para(p_lote, array['enviado', 'devolvido']);
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Nada para salvar.'; end if;
  update rh_pt_ocorrencias o set tipo = x.tipo, horario = nullif(trim(x.horario), ''), observacao = nullif(trim(x.observacao), ''),
         justificado_por = auth.uid(), justificado_em = now()
    from jsonb_to_recordset(p_itens) as x(id uuid, tipo text, horario text, observacao text)
   where o.id = x.id and o.lote_id = p_lote
     and (o.tipo, o.horario, o.observacao) is distinct from (x.tipo, nullif(trim(x.horario), ''), nullif(trim(x.observacao), ''));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Envia: tudo justificado ("Outro" com observação) → justificado; pendências do líder e "Cobrar líder" encerradas; RH ajusta.
create function rh_pt_enviar_justificativas(p_lote uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_falta int;
begin
  if not rh_pt_eh_lider(p_lote) then raise exception 'Este lote não é de um setor em que você é líder.'; end if;
  perform rh_pt_lote_para(p_lote, array['enviado', 'devolvido']);
  select count(*) into v_falta from rh_pt_ocorrencias where lote_id = p_lote and (tipo is null or (tipo = 'outro' and coalesce(trim(observacao), '') = ''));
  if v_falta > 0 then raise exception 'Faltam % ocorrência(s) sem justificativa (ou "Outro" sem observação).', v_falta; end if;
  update rh_pt_lotes set status = 'justificado', justificado_por = auth.uid(), justificado_em = now() where id = p_lote;
  perform rh_pt_encerrar_pendencias(p_lote, 'Justificar ponto', 'concluida');
  perform rh_pt_encerrar_pendencias(p_lote, 'Cobrar líder', 'concluida');
  perform rh_pt_abrir_pendencia(p_lote, 'Ajustar no Control iD — ' || rh_pt_rotulo(p_lote),
    'O líder justificou as inconsistências: ajustar no Control iD e marcar cada ocorrência.', null, null, '/rh/ponto/lote/' || p_lote);
end $$;

-- 8) Prazo vencido (job diário): pendência do líder fica crítica e o RH ganha "Cobrar líder" ------------------------------
create function rh_pt_verificar_prazos() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  l record;
  v_n int := 0;
begin
  for l in select id, prazo from rh_pt_lotes where status in ('enviado', 'devolvido') and prazo < v_hoje loop
    update pendencias set criticidade = 'critica'
     where modulo = 'rh.ponto' and referencia_id = l.id and titulo like 'Justificar ponto%' and status in ('aberta', 'em_andamento');
    perform rh_pt_abrir_pendencia(l.id, 'Cobrar líder — ' || rh_pt_rotulo(l.id),
      'O prazo do líder venceu em ' || to_char(l.prazo, 'DD/MM/YYYY') || ': gerar o lembrete pelo Neo Admin.', v_hoje, null, '/rh/ponto/lote/' || l.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function rh_pt_verificar_prazos() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 07h e 13h em Cuiabá (UTC-4), dias úteis
    perform cron.schedule('rh-ponto-verificar-prazos', '0 11,17 * * 1-5', 'select public.rh_pt_verificar_prazos()');
  end if;
end $$;

revoke all on function rh_somar_dias_uteis(date, int) from public, anon;
revoke all on function rh_pt_prazo_dias() from public, anon;
revoke all on function rh_pt_salvar_setor(uuid, text, uuid, uuid, boolean) from public, anon;
revoke all on function rh_pt_salvar_prazo(int) from public, anon;
revoke all on function rh_pt_importar(uuid, date, date, text, jsonb) from public, anon;
revoke all on function rh_pt_vincular_colaborador(uuid, uuid) from public, anon;
revoke all on function rh_pt_devolver(uuid, text) from public, anon;
revoke all on function rh_pt_marcar_ajustado(uuid, uuid[], boolean) from public, anon;
revoke all on function rh_pt_cancelar(uuid, text) from public, anon;
revoke all on function rh_pt_eh_lider(uuid) from public, anon;
revoke all on function rh_pt_lotes_do_lider() from public, anon;
revoke all on function rh_pt_ocorrencias_do_lider(uuid) from public, anon;
revoke all on function rh_pt_justificar(uuid, jsonb) from public, anon;
revoke all on function rh_pt_enviar_justificativas(uuid) from public, anon;
