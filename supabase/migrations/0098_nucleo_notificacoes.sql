-- =========================================================
-- Neo Admin — 0098 NÚCLEO: NOTIFICAÇÕES (SLACK) E CLICKUP (Central de Gestão, Fase 7)
-- Especificação: docs/modulos/administrativo-gestao.md, seções 6.1 e 6.2.
--
-- NADA SAI SOZINHO: o envio exige `administrativo.gestao.notificacoes_ligadas` = true (começa false) E o evento ligado
-- em `administrativo.gestao.notificacoes_eventos` (todos começam false). Testes nunca enviam.
--  - Fila `notificacoes`: cada aviso tem uma chave contra duplicidade (a mesma pendência não gera o mesmo aviso de novo),
--    destinatário, tentativas, resultado e erro. A Edge Function `nucleo-notificacoes-enviar` (Slack, segredo
--    SLACK_BOT_TOKEN, o mesmo do Contas a pagar) envia o que estiver pendente.
--  - Eventos: atribuicao (a pessoa recebeu uma pendência), prazo_proximo e atraso (lembretes automáticos, uma vez por
--    prazo), aguarda_gestor (no canal da gestão), cobranca_gestor (só quando o gestor clica em "Cobrar andamento") e
--    resumo_diario (canal da gestão, no horário configurado, fuso de Cuiabá).
--  - Quem recebe no Slack: `perfis.slack_usuario_id` (o admin preenche); sem ele, o aviso fica "ignorado" com o motivo.
--  - ClickUp: só pendências marcadas `clickup_enviar` (o gestor marca) e as tarefas de implementação de sugestões. Ida só:
--    `clickup_task_id` guarda o vínculo; mudança no ClickUp não encerra pendência (não há regra para isso).
-- =========================================================

-- 1) Cadastros ----------------------------------------------------------------------------------------------------------
alter table perfis add column slack_usuario_id text check (slack_usuario_id ~ '^[UW][A-Z0-9]{6,}$');
comment on column perfis.slack_usuario_id is 'ID do usuário no Slack (ex.: U01ABCDEF): destinatário dos avisos da Central. Só o admin preenche.';
alter table pendencias add column clickup_enviar boolean not null default false;
comment on column pendencias.clickup_enviar is 'Gestor marcou para criar a tarefa no ClickUp (ida só; vínculo em clickup_task_id).';

insert into configuracoes (chave, valor, descricao) values
  ('administrativo.gestao.notificacoes_ligadas', 'false', 'Central de Gestão: interruptor geral do envio de avisos pelo Slack. Desligado, nada é enviado.'),
  ('administrativo.gestao.notificacoes_eventos',
   '{"atribuicao": false, "prazo_proximo": false, "atraso": false, "aguarda_gestor": false, "cobranca_gestor": false, "resumo_diario": false}',
   'Central de Gestão: quais eventos geram aviso no Slack.'),
  ('administrativo.gestao.slack_canal_gestao', 'null', 'Central de Gestão: ID do canal do Slack para o resumo diário e os pedidos de decisão (ex.: C0123ABCD).'),
  ('administrativo.gestao.resumo_horario', '"07:30"', 'Central de Gestão: horário do resumo diário (hh:mm, fuso de Cuiabá).'),
  ('administrativo.gestao.url_base', '"https://neo-admin-474748357673.southamerica-east1.run.app"', 'Endereço do Neo Admin usado nos links dos avisos.'),
  ('administrativo.gestao.clickup_lista_id', 'null', 'Central de Gestão: ID da lista do ClickUp que recebe as tarefas marcadas "enviar ao ClickUp".')
on conflict (chave) do nothing;

-- 2) Fila de notificações ----------------------------------------------------------------------------------------------
create table notificacoes (
  id bigserial primary key,
  evento text not null check (evento in ('atribuicao', 'prazo_proximo', 'atraso', 'aguarda_gestor', 'cobranca_gestor', 'resumo_diario')),
  canal text not null default 'slack' check (canal in ('slack')),
  destinatario_id uuid references perfis(id),           -- pessoa (DM); nulo = canal da gestão
  pendencia_id uuid references pendencias(id),
  chave text not null unique,                           -- contra duplicidade
  texto text not null,
  link text,
  status text not null default 'pendente' check (status in ('pendente', 'enviada', 'falhou', 'ignorada')),
  motivo text,                                          -- por que foi ignorada, ou o erro do envio
  tentativas int not null default 0,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  id_externo text                                       -- ts da mensagem no Slack
);
create index idx_notificacoes_pendentes on notificacoes (criado_em) where status in ('pendente', 'falhou');
create index idx_notificacoes_destinatario on notificacoes (destinatario_id, criado_em desc);
create trigger trg_notificacoes_sem_delete before delete on notificacoes for each row execute function fn_bloquear_delete();
alter table notificacoes enable row level security;
-- Leitura: o admin vê tudo; cada pessoa, os avisos dirigidos a ela. Gravação: só as funções abaixo e a Edge Function.
create policy notificacoes_ler on notificacoes for select to authenticated
  using (eh_admin_geral() or (usuario_ativo() and destinatario_id = auth.uid()));
revoke insert, update, delete on notificacoes from authenticated, anon;

create function central_evento_ligado(p_evento text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (valor ->> p_evento)::boolean from configuracoes where chave = 'administrativo.gestao.notificacoes_eventos'), false);
$$;

-- Enfileira um aviso (uma vez por chave). Só enfileira evento ligado; o envio ainda depende do interruptor geral.
create function central_enfileirar(p_evento text, p_chave text, p_destinatario uuid, p_pendencia uuid, p_texto text, p_link text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not central_evento_ligado(p_evento) then return false; end if;
  insert into notificacoes (evento, destinatario_id, pendencia_id, chave, texto, link)
  values (p_evento, p_destinatario, p_pendencia, p_chave, left(p_texto, 3000), p_link)
  on conflict (chave) do nothing;
  return found;
end $$;

-- 3) Eventos de pendência ----------------------------------------------------------------------------------------------
create function fn_central_avisos_pendencia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    -- Atribuição: recebeu uma pendência de outra pessoa (quem assume para si não recebe aviso).
    if new.responsavel_id is not null and new.status in ('aberta', 'em_andamento')
       and (tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id)
       and new.responsavel_id is distinct from auth.uid() then
      perform central_enfileirar('atribuicao', format('atribuicao:%s:%s:%s', new.id, new.responsavel_id, to_char(now(), 'YYYYMMDDHH24MI')),
        new.responsavel_id, new.id,
        format('Você recebeu a pendência "%s"%s.', new.titulo, case when new.prazo is not null then ' com prazo ' || to_char(new.prazo, 'DD/MM/YYYY') else '' end),
        '/gestao/' || new.id);
    end if;
    -- Pedido de decisão: avisa o canal da gestão (uma vez por pedido).
    if new.aguarda_gestor_em is not null and (tg_op = 'INSERT' or old.aguarda_gestor_em is null) then
      perform central_enfileirar('aguarda_gestor', format('decisao:%s:%s', new.id, extract(epoch from new.aguarda_gestor_em)::bigint),
        null, new.id, format('Pedido de decisão em "%s": %s', new.titulo, new.aguarda_gestor_motivo), '/gestao/' || new.id);
    end if;
  exception when others then
    raise warning 'Aviso da pendência % não enfileirado: %', new.id, sqlerrm;
  end;
  return null;
end $$;
create trigger trg_central_avisos_pendencia after insert or update of responsavel_id, aguarda_gestor_motivo on pendencias
  for each row execute function fn_central_avisos_pendencia();

-- Cobrança do gestor: cada clique em "Cobrar andamento" vira um aviso ao responsável (ação explícita do gestor).
create function fn_central_avisos_cobranca() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v pendencias;
begin
  if new.referencia_tabela <> 'pendencias' or new.tipo <> 'cobranca_gestor' then return null; end if;
  begin
    select * into v from pendencias where id = new.referencia_id;
    if v.responsavel_id is not null then
      perform central_enfileirar('cobranca_gestor', 'cobranca:' || new.id, v.responsavel_id, v.id,
        format('%s cobrou andamento de "%s": %s', coalesce((select nome from perfis where id = new.usuario_id), 'O gestor'), v.titulo, new.descricao),
        '/gestao/' || v.id);
    end if;
  exception when others then
    raise warning 'Aviso de cobrança % não enfileirado: %', new.id, sqlerrm;
  end;
  return null;
end $$;
create trigger trg_central_avisos_cobranca after insert on interacoes for each row execute function fn_central_avisos_cobranca();

-- 4) Rotina (a cada 15 minutos): lembretes de prazo e atraso (uma vez por prazo) e o resumo diário (uma vez por dia,
--    a partir do horário configurado). Devolve quantos avisos novos enfileirou.
create function central_avisos_rotina() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_agora time := (now() at time zone 'America/Cuiaba')::time;
  v_cfg jsonb := central_parametros();
  v_horario time := coalesce((select (valor #>> '{}')::time from configuracoes where chave = 'administrativo.gestao.resumo_horario'), '07:30');
  v_n int := 0;
  p record;
  r record;
begin
  if auth.uid() is not null and not eh_admin_geral() then
    raise exception 'Somente o administrador geral roda a rotina de avisos.';
  end if;
  for p in select * from pendencias where status in ('aberta', 'em_andamento') and responsavel_id is not null and prazo is not null loop
    if p.prazo >= v_hoje and p.prazo <= v_hoje + (v_cfg ->> 'dias_prazo_proximo')::int then
      if central_enfileirar('prazo_proximo', format('prazo:%s:%s', p.id, p.prazo), p.responsavel_id, p.id,
           format('Lembrete: "%s" vence %s.', p.titulo, case when p.prazo = v_hoje then 'hoje' else 'em ' || to_char(p.prazo, 'DD/MM/YYYY') end),
           '/gestao/' || p.id) then v_n := v_n + 1; end if;
    elsif p.prazo < v_hoje then
      if central_enfileirar('atraso', format('atraso:%s:%s', p.id, p.prazo), p.responsavel_id, p.id,
           format('"%s" está atrasada desde %s.', p.titulo, to_char(p.prazo, 'DD/MM/YYYY')), '/gestao/' || p.id) then v_n := v_n + 1; end if;
    end if;
  end loop;

  if v_agora >= v_horario and central_evento_ligado('resumo_diario')
     and not exists (select 1 from notificacoes where chave = 'resumo:' || v_hoje) then
    select count(*) filter (where true) as abertas,
           count(*) filter (where prazo < v_hoje) as atrasadas,
           count(*) filter (where prazo = v_hoje) as hoje,
           count(*) filter (where bloqueada_em is not null) as bloqueadas,
           count(*) filter (where aguarda_gestor_em is not null) as decisoes,
           count(*) filter (where responsavel_id is null and (origem = 'manual' or precisa_distribuir)) as distribuir,
           count(*) filter (where (pendencia_destaque(x, v_hoje, v_cfg) ->> 'nivel') = 'intervir') as intervir
      into r from pendencias x where status in ('aberta', 'em_andamento');
    if central_enfileirar('resumo_diario', 'resumo:' || v_hoje, null, null,
         format(E'Central de Gestão — %s\n• Exigem intervenção: %s\n• Atrasadas: %s · Vencem hoje: %s\n• Aguardando decisão: %s · Bloqueadas: %s · Precisam distribuir: %s\n• Em aberto (total): %s',
                to_char(v_hoje, 'DD/MM/YYYY'), r.intervir, r.atrasadas, r.hoje, r.decisoes, r.bloqueadas, r.distribuir, r.abertas),
         '/gestao') then v_n := v_n + 1; end if;
  end if;
  return v_n;
end $$;

-- 5) Envio: a Edge Function lê, marca o resultado; o banco só a chama quando o interruptor geral está ligado -----------
create function central_notificacoes_ligadas() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (valor #>> '{}')::boolean from configuracoes where chave = 'administrativo.gestao.notificacoes_ligadas'), false);
$$;

create function central_chamar_envios() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_segredo text;
  v_req bigint;
begin
  perform central_avisos_rotina();
  if not central_notificacoes_ligadas() then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notificacoes_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'notificacoes_segredo';
  if v_url is null or v_segredo is null then
    raise warning 'Envio de avisos sem configuração: faltam notificacoes_url e/ou notificacoes_segredo no Vault.';
    return null;
  end if;
  select net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-notificacoes-segredo', v_segredo),
                       body := '{"acao":"enviar"}'::jsonb, timeout_milliseconds := 60000) into v_req;

  -- ClickUp (opcional): só se a URL da função estiver no Vault.
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'clickup_url';
  if v_url is not null then
    perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-notificacoes-segredo', v_segredo),
                          body := '{"acao":"enviar"}'::jsonb, timeout_milliseconds := 60000);
  end if;
  return v_req;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('nucleo-avisos-15min', '*/15 * * * *', 'select public.central_chamar_envios()');
  end if;
end $$;

-- 6) ClickUp: só o gestor marca; nada sincroniza de volta --------------------------------------------------------------
create function fn_pendencias_clickup_regras() returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and new.clickup_enviar is distinct from old.clickup_enviar and not tem_acesso_modulo(new.modulo, 'gestor') then
    raise exception 'Somente o gestor da área marca a pendência para o ClickUp.';
  end if;
  return new;
end $$;
create trigger trg_pendencias_clickup_regras before update of clickup_enviar on pendencias
  for each row execute function fn_pendencias_clickup_regras();

-- A tarefa de implementação de uma sugestão vai para o ClickUp (planejamento de desenvolvimento, seção 6.2).
create function fn_sugestoes_tarefa_clickup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pendencia_id is not null and new.pendencia_id is distinct from old.pendencia_id then
    update pendencias set clickup_enviar = true where id = new.pendencia_id;
  end if;
  return null;
end $$;
create trigger trg_sugestoes_tarefa_clickup after update of pendencia_id on sugestoes for each row execute function fn_sugestoes_tarefa_clickup();

-- Parâmetros (só admin geral): interruptor, eventos, canal, horário, endereço e lista do ClickUp.
create function central_salvar_notificacoes(p jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_eventos jsonb;
  v_chave text;
begin
  if not eh_admin_geral() then raise exception 'Somente o administrador geral configura os avisos.'; end if;
  if p ? 'ligadas' then
    update configuracoes set valor = to_jsonb(coalesce((p ->> 'ligadas')::boolean, false)) where chave = 'administrativo.gestao.notificacoes_ligadas';
  end if;
  if p ? 'eventos' then
    v_eventos := '{}'::jsonb;
    for v_chave in select unnest(array['atribuicao', 'prazo_proximo', 'atraso', 'aguarda_gestor', 'cobranca_gestor', 'resumo_diario']) loop
      v_eventos := v_eventos || jsonb_build_object(v_chave, coalesce((p -> 'eventos' ->> v_chave)::boolean, false));
    end loop;
    update configuracoes set valor = v_eventos where chave = 'administrativo.gestao.notificacoes_eventos';
  end if;
  if p ? 'canal' then
    if nullif(p ->> 'canal', '') is not null and (p ->> 'canal') !~ '^[CG][A-Z0-9]{6,}$' then
      raise exception 'ID do canal do Slack inválido (ex.: C0123ABCD).';
    end if;
    update configuracoes set valor = coalesce(to_jsonb(nullif(p ->> 'canal', '')), 'null'::jsonb) where chave = 'administrativo.gestao.slack_canal_gestao';
  end if;
  if p ? 'horario' then
    if (p ->> 'horario') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Horário inválido (hh:mm).'; end if;
    update configuracoes set valor = to_jsonb(p ->> 'horario') where chave = 'administrativo.gestao.resumo_horario';
  end if;
  if p ? 'clickup_lista' then
    if nullif(p ->> 'clickup_lista', '') is not null and (p ->> 'clickup_lista') !~ '^[0-9]{4,}$' then
      raise exception 'ID da lista do ClickUp inválido (só números).';
    end if;
    update configuracoes set valor = coalesce(to_jsonb(nullif(p ->> 'clickup_lista', '')), 'null'::jsonb) where chave = 'administrativo.gestao.clickup_lista_id';
  end if;
end $$;

revoke all on function central_evento_ligado(text) from public, anon;
revoke all on function central_enfileirar(text, text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function central_avisos_rotina() from public, anon;
revoke all on function central_notificacoes_ligadas() from public, anon;
revoke all on function central_chamar_envios() from public, anon, authenticated;
revoke all on function central_salvar_notificacoes(jsonb) from public, anon;
grant execute on function central_evento_ligado(text) to authenticated, service_role;
grant execute on function central_enfileirar(text, text, uuid, uuid, text, text) to service_role;
grant execute on function central_avisos_rotina() to authenticated, service_role;
grant execute on function central_notificacoes_ligadas() to authenticated, service_role;
grant execute on function central_salvar_notificacoes(jsonb) to authenticated;
