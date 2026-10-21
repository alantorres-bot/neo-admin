-- =========================================================
-- Neo Admin — 0517 RH/SST > Ponto: link do formulário aberto a qualquer pessoa (decisão de 21/10/2026)
-- O formulário de justificativas deixa de exigir login: o e-mail leva um link com chave secreta por lote
-- (/justificar-ponto/<chave>), que qualquer pessoa com o link abre e preenche.
--  - Setor: sai o líder usuário (lider_id/substituto_id); entram responsavel_nome, email e email_copia (qualquer endereço).
--  - Lote: chave (64 hex, aleatória), e quem enviou pelo link: nome digitado + IP + data/hora (a justificativa é prova).
--  - O link só mostra as ocorrências enquanto o lote está com o líder (enviado/devolvido); depois, só "enviado em … por …".
--  - Funções do link (anon e authenticated): rh_pt_link_lote e rh_pt_link_salvar, pela chave. Saem as funções do líder logado.
--  - Pendência do líder vira "Aguardando líder — …" do RH, sem responsável (o líder não é usuário).
-- =========================================================

-- 1) Saem as funções do líder logado -----------------------------------------------------------------------------------
drop function rh_pt_lotes_do_lider();
drop function rh_pt_ocorrencias_do_lider(uuid);
drop function rh_pt_justificar(uuid, jsonb);
drop function rh_pt_enviar_justificativas(uuid);
drop function rh_pt_eh_lider(uuid);
drop function rh_pt_pendencias_do_lider(uuid, text, date);
drop function rh_pt_salvar_setor(uuid, text, uuid, uuid, boolean);

-- 2) Setor: responsável e e-mails livres ---------------------------------------------------------------------------------
alter table rh_pt_setores add column responsavel_nome text, add column email text, add column email_copia text;
update rh_pt_setores s set responsavel_nome = (select nome from perfis where id = s.lider_id),
       email = (select email from perfis where id = s.lider_id), email_copia = (select email from perfis where id = s.substituto_id);
alter table rh_pt_setores alter column email set not null,
  add constraint rh_pt_setores_email_valido check (email ~ '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$'),
  add constraint rh_pt_setores_copia_valida check (email_copia is null or email_copia ~ '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+(\s*[,;]\s*[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+)*$');
alter table rh_pt_setores drop column lider_id, drop column substituto_id;
comment on table rh_pt_setores is 'Setores que recebem o relatório de inconsistências do ponto, com o responsável e os e-mails que recebem o link do formulário.';

-- 3) Lote: chave do link e quem enviou pelo link ------------------------------------------------------------------------
alter table rh_pt_lotes
  add column chave text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  add column justificado_nome text,
  add column justificado_ip text;
comment on column rh_pt_lotes.chave is 'Chave secreta do link público do formulário (/justificar-ponto/<chave>). Quem tem o link preenche.';

-- 4) Pendências: "Aguardando líder" (RH, sem responsável) --------------------------------------------------------------
create function rh_pt_pendencia_aguardando(p_lote uuid, p_descricao text, p_prazo date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_pt_abrir_pendencia(p_lote, 'Aguardando líder — ' || rh_pt_rotulo(p_lote), p_descricao, p_prazo, null, '/rh/ponto/lote/' || p_lote);
end $$;
revoke all on function rh_pt_pendencia_aguardando(uuid, text, date) from public, anon, authenticated;

update pendencias set status = 'cancelada'
 where modulo = 'rh.ponto' and titulo like 'Justificar ponto%' and status in ('aberta', 'em_andamento');
select rh_pt_pendencia_aguardando(id, 'O líder ainda não enviou as justificativas pelo link.', prazo) from rh_pt_lotes where status in ('enviado', 'devolvido');

-- 5) Setores (gestor) ----------------------------------------------------------------------------------------------------
create function rh_pt_salvar_setor(p_id uuid, p_nome text, p_responsavel text, p_email text, p_copia text, p_ativo boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
begin
  perform rh_exigir('gestor');
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome do setor.'; end if;
  if coalesce(trim(p_email), '') !~ '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$' then raise exception 'Informe um e-mail válido para o link.'; end if;
  if v_id is null then
    insert into rh_pt_setores (nome, responsavel_nome, email, email_copia, ativo)
    values (trim(p_nome), nullif(trim(p_responsavel), ''), lower(trim(p_email)), nullif(lower(trim(p_copia)), ''), coalesce(p_ativo, true)) returning id into v_id;
  else
    update rh_pt_setores set nome = trim(p_nome), responsavel_nome = nullif(trim(p_responsavel), ''), email = lower(trim(p_email)),
           email_copia = nullif(lower(trim(p_copia)), ''), ativo = coalesce(p_ativo, true) where id = v_id;
    if not found then raise exception 'Setor não encontrado.'; end if;
  end if;
  return v_id;
end $$;
revoke all on function rh_pt_salvar_setor(uuid, text, text, text, text, boolean) from public, anon;

-- 6) Envio, devolução e prazo com a pendência nova -----------------------------------------------------------------------
create or replace function rh_pt_registrar_rascunho(p_lote uuid, p_modo text, p_usuario uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  l rh_pt_lotes;
  v_prazo date := rh_somar_dias_uteis((now() at time zone 'America/Cuiaba')::date, rh_pt_prazo_dias());
begin
  if p_modo = 'envio' then
    l := rh_pt_lote_para(p_lote, array['importado']);
    update rh_pt_lotes set status = 'enviado', enviado_por = p_usuario, enviado_em = now(), prazo = v_prazo where id = p_lote;
    perform rh_pt_pendencia_aguardando(p_lote, 'E-mail com o link enviado ao líder; aguardando as justificativas.', v_prazo);
  elsif p_modo = 'lembrete' then
    l := rh_pt_lote_para(p_lote, array['enviado', 'devolvido']);
    update rh_pt_lotes set lembrete_em = now() where id = p_lote;
    perform rh_pt_encerrar_pendencias(p_lote, 'Cobrar líder', 'concluida');
  elsif p_modo = 'devolucao' then
    l := rh_pt_lote_para(p_lote, array['devolvido']);
  else
    raise exception 'Modo inválido.';
  end if;
end $$;
revoke all on function rh_pt_registrar_rascunho(uuid, text, uuid) from public, anon, authenticated;

create or replace function rh_pt_devolver(p_lote uuid, p_motivo text) returns void
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
  perform rh_pt_pendencia_aguardando(p_lote, 'Devolvido ao líder: ' || trim(p_motivo), v_prazo);
end $$;

create or replace function rh_pt_verificar_prazos() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  l record;
  v_n int := 0;
begin
  for l in select id, prazo from rh_pt_lotes where status in ('enviado', 'devolvido') and prazo < v_hoje loop
    update pendencias set criticidade = 'critica'
     where modulo = 'rh.ponto' and referencia_id = l.id and titulo like 'Aguardando líder%' and status in ('aberta', 'em_andamento');
    perform rh_pt_abrir_pendencia(l.id, 'Cobrar líder — ' || rh_pt_rotulo(l.id),
      'O prazo do líder venceu em ' || to_char(l.prazo, 'DD/MM/YYYY') || ': gerar o lembrete pelo Neo Admin.', v_hoje, null, '/rh/ponto/lote/' || l.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function rh_pt_verificar_prazos() from public, anon, authenticated;

-- 7) Link público ------------------------------------------------------------------------------------------------------------
-- O lote pela chave. As ocorrências (só o necessário: sem saldo do banco nem extras) vêm só enquanto o lote está com o líder.
create function rh_pt_link_lote(p_chave text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l rh_pt_lotes;
  v_setor text;
begin
  if p_chave is null or p_chave !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into l from rh_pt_lotes where chave = p_chave and status in ('enviado', 'devolvido', 'justificado', 'concluido');
  if l.id is null then return null; end if;
  select nome into v_setor from rh_pt_setores where id = l.setor_id;
  return jsonb_build_object(
    'setor', v_setor, 'periodo_inicio', l.periodo_inicio, 'periodo_fim', l.periodo_fim, 'status', l.status, 'prazo', l.prazo,
    'devolvido_motivo', case when l.status = 'devolvido' then l.devolvido_motivo end,
    'justificado_em', l.justificado_em, 'justificado_nome', l.justificado_nome,
    'ocorrencias', case when l.status in ('enviado', 'devolvido') then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'nome', o.nome, 'cargo', o.cargo, 'data', o.data, 'dia_semana', o.dia_semana, 'previsto', o.previsto,
               'marcacoes', o.marcacoes, 'falta', o.falta, 'falta_atraso_min', o.falta_atraso_min,
               'tipo', o.tipo, 'horario', o.horario, 'observacao', o.observacao) order by o.ordem)
        from rh_pt_ocorrencias o where o.lote_id = l.id), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- Grava as justificativas pela chave (pode salvar aos poucos). Com p_enviar: exige o nome de quem envia e todas justificadas
-- ("Outro" com observação); o lote vai para "justificado" e o RH ganha "Ajustar no Control iD".
-- p_itens: [{id, tipo, horario, observacao}]
create function rh_pt_link_salvar(p_chave text, p_itens jsonb, p_enviar boolean, p_nome text, p_ip text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l rh_pt_lotes;
  v_n int;
  v_falta int;
begin
  if p_chave is null or p_chave !~ '^[0-9a-f]{64}$' then raise exception 'Link inválido.'; end if;
  select * into l from rh_pt_lotes where chave = p_chave for update;
  if l.id is null then raise exception 'Link inválido.'; end if;
  if l.status not in ('enviado', 'devolvido') then raise exception 'Estas justificativas já foram enviadas ao RH. Se precisar mudar algo, fale com o RH.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 500 then raise exception 'Nada para salvar.'; end if;
  if exists (select 1 from jsonb_to_recordset(p_itens) as x(id uuid, tipo text, horario text, observacao text)
              where (x.tipo is not null and x.tipo not in ('esqueceu_bater', 'batida_indevida', 'saida_atraso', 'falta_injustificada', 'justificada', 'outro'))
                 or (nullif(trim(x.horario), '') is not null and trim(x.horario) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
                 or length(coalesce(x.observacao, '')) > 500) then
    raise exception 'Há justificativa, horário (use hh:mm) ou observação inválida.';
  end if;
  update rh_pt_ocorrencias o set tipo = x.tipo, horario = nullif(trim(x.horario), ''), observacao = nullif(trim(x.observacao), ''), justificado_em = now()
    from jsonb_to_recordset(p_itens) as x(id uuid, tipo text, horario text, observacao text)
   where o.id = x.id and o.lote_id = l.id
     and (o.tipo, o.horario, o.observacao) is distinct from (x.tipo, nullif(trim(x.horario), ''), nullif(trim(x.observacao), ''));
  get diagnostics v_n = row_count;
  if coalesce(p_enviar, false) then
    if length(coalesce(trim(p_nome), '')) < 3 then raise exception 'Informe o seu nome para enviar.'; end if;
    select count(*) into v_falta from rh_pt_ocorrencias where lote_id = l.id and (tipo is null or (tipo = 'outro' and coalesce(trim(observacao), '') = ''));
    if v_falta > 0 then raise exception 'Faltam % ocorrência(s) sem justificativa (ou "Outro" sem observação).', v_falta; end if;
    update rh_pt_lotes set status = 'justificado', justificado_em = now(), justificado_nome = left(trim(p_nome), 120), justificado_ip = left(p_ip, 60) where id = l.id;
    perform rh_pt_encerrar_pendencias(l.id, 'Aguardando líder', 'concluida');
    perform rh_pt_encerrar_pendencias(l.id, 'Cobrar líder', 'concluida');
    perform rh_pt_abrir_pendencia(l.id, 'Ajustar no Control iD — ' || rh_pt_rotulo(l.id),
      'O líder (' || left(trim(p_nome), 120) || ') justificou as inconsistências: ajustar no Control iD e marcar cada ocorrência.', null, null, '/rh/ponto/lote/' || l.id);
  end if;
  return jsonb_build_object('salvas', v_n, 'enviado', coalesce(p_enviar, false));
end $$;

revoke all on function rh_pt_link_lote(text) from public;
revoke all on function rh_pt_link_salvar(text, jsonb, boolean, text, text) from public;
grant execute on function rh_pt_link_lote(text) to anon, authenticated;
grant execute on function rh_pt_link_salvar(text, jsonb, boolean, text, text) to anon, authenticated;
