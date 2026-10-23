-- =========================================================
-- Neo Admin — 0099 NÚCLEO: CENTRAL DE GESTÃO, REVISÃO DE SEGURANÇA (Fase 8)
-- Correções encontradas na revisão final das migrations 0092 a 0098 (docs/modulos/administrativo-gestao.md, seção 14):
--  1) pendência não muda de módulo sem o gestor dos dois módulos (o gatilho da 0092 avaliava o módulo NOVO);
--  2) usuário não grava chave_origem (bloqueava a publicação do módulo); o ClickUp e o "onde aparece" na inclusão
--     ficam com o gestor; responsável de pendência de módulo precisa ter a área (operador ou acima);
--  3) a pendência "Avaliar sugestão" não copia o texto da sugestão e só os avaliadores a tratam;
--  4) o autor não forja quem avaliou a sugestão;
--  5) publicar de novo não apaga categoria, impacto e "precisa distribuir" registrados pelo gestor;
--  6) aviso de área sensível (RH, Jurídico) vai ao canal da gestão sem título nem motivo; a fila reserva o aviso
--     antes de enviar (envio agendado e "Enviar agora" ao mesmo tempo não duplicam);
--  7) registro de acessos grava só o caminho da tela (sem a busca) e tem limite por minuto.
-- =========================================================

-- 1 e 2) Guarda das pendências (roda antes de trg_pendencias_regras, por ordem alfabética) -------------------------------
create function fn_pendencias_guarda() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  v_area text;
begin
  if v_eu is null then return new; end if;   -- serviço (Edge Function, pg_cron, publicar_pendencia): livre
  select area into v_area from modulos where codigo = new.modulo;

  if tg_op = 'INSERT' then
    -- A chave de origem é do módulo (publicar_pendencia); a pessoa não grava uma chave que travaria a publicação.
    new.chave_origem := null;
    if not tem_acesso_modulo(new.modulo, 'gestor') then
      if new.clickup_enviar then
        raise exception 'Somente o gestor da área marca a pendência para o ClickUp.';
      end if;
      if new.modulo_exibicao is not null and split_part(new.modulo_exibicao, '.', 1) is distinct from v_area then
        raise exception 'Somente o gestor da área escolhe onde a pendência aparece.';
      end if;
    end if;
  else
    if new.modulo is distinct from old.modulo
       and not (tem_acesso_modulo(old.modulo, 'gestor') and tem_acesso_modulo(new.modulo, 'gestor')) then
      raise exception 'Somente quem é gestor nos dois módulos muda a pendência de módulo.';
    end if;
    if new.modulo_exibicao is distinct from old.modulo_exibicao and not tem_acesso_modulo(old.modulo, 'gestor') then
      raise exception 'Somente o gestor da área escolhe onde a pendência aparece.';
    end if;
    if old.chave_origem like 'sugestao:%' and not pode_avaliar_sugestoes() then
      raise exception 'Somente os avaliadores de sugestões tratam esta pendência.';
    end if;
  end if;

  -- Responsável escolhido por outra pessoa: precisa ter a área (Tarefas gerais vale para qualquer pessoa ativa).
  if new.responsavel_id is not null and new.responsavel_id <> v_eu
     and (tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id)
     and new.modulo <> 'administrativo.gestao'
     and not exists (select 1 from perfis p
                       left join permissoes pe on pe.perfil_id = p.id and pe.area = v_area
                      where p.id = new.responsavel_id and p.ativo and (p.admin_geral or pe.nivel >= 'operador')) then
    raise exception 'A pessoa escolhida não tem acesso à área desta pendência (operador ou acima).';
  end if;
  return new;
end $$;
create trigger trg_pendencias_guarda before insert or update on pendencias
  for each row execute function fn_pendencias_guarda();

-- ClickUp: a permissão é a do módulo atual da pendência, não a do módulo para onde ela iria.
create or replace function fn_pendencias_clickup_regras() returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and new.clickup_enviar is distinct from old.clickup_enviar and not tem_acesso_modulo(old.modulo, 'gestor') then
    raise exception 'Somente o gestor da área marca a pendência para o ClickUp.';
  end if;
  return new;
end $$;

-- 3) "Avaliar sugestão": criada pelo sistema, sem o texto da melhoria (que é só do autor e dos avaliadores) --------------
create or replace function fn_sugestoes_pendencia() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if tg_op = 'INSERT' then
    -- A pendência é do sistema (como em publicar_pendencia): sem a pessoa na sessão, a chave de origem é mantida.
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    insert into pendencias (modulo, titulo, categoria, referencia_tabela, referencia_id, link, chave_origem)
    values ('administrativo.gestao', format('Avaliar sugestão nº %s: %s', new.numero, new.titulo),
            'decisao', 'sugestoes', new.id, '/gestao/sugestoes/' || new.id, 'sugestao:' || new.id)
    on conflict do nothing;
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  elsif new.status in ('aprovada', 'nao_aprovada', 'em_desenvolvimento', 'concluida') and old.status in ('nova', 'em_avaliacao') then
    update pendencias set status = 'concluida'
     where modulo = 'administrativo.gestao' and chave_origem = 'sugestao:' || new.id and status in ('aberta', 'em_andamento');
  elsif new.status = 'em_avaliacao' and old.status = 'nova' then
    update pendencias set status = 'em_andamento'
     where modulo = 'administrativo.gestao' and chave_origem = 'sugestao:' || new.id and status = 'aberta';
  end if;
  return null;
end $$;

-- Pendências já criadas: retira o texto copiado (preenchimento técnico, como na 0092).
alter table pendencias disable trigger trg_aud_pendencias;
alter table pendencias disable trigger trg_pendencias_regras;
update pendencias set descricao = null where modulo = 'administrativo.gestao' and chave_origem like 'sugestao:%' and descricao is not null;
alter table pendencias enable trigger trg_pendencias_regras;
alter table pendencias enable trigger trg_aud_pendencias;

-- 4) Sugestões: o autor não grava quem avaliou nem quando -------------------------------------------------------------
create or replace function fn_sugestoes_regras() returns trigger
language plpgsql set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  v_avaliador boolean := pode_avaliar_sugestoes();
begin
  new.justificativa := nullif(btrim(new.justificativa), '');
  new.problema := nullif(btrim(new.problema), '');
  new.como_hoje := nullif(btrim(new.como_hoje), '');
  new.resultado_esperado := nullif(btrim(new.resultado_esperado), '');
  new.titulo := btrim(new.titulo);
  new.melhoria := btrim(new.melhoria);

  if tg_op = 'INSERT' then
    if v_eu is not null then
      new.autor_id := v_eu;
    end if;
    new.status := 'nova'; new.prioridade := null; new.justificativa := null;
    new.avaliada_por := null; new.avaliada_em := null; new.pendencia_id := null;
    new.criado_em := now(); new.atualizado_em := now();
    return new;
  end if;

  new.autor_id := old.autor_id; new.criado_em := old.criado_em;
  new.atualizado_em := now();

  if v_eu is not null and not v_avaliador then
    if old.autor_id <> v_eu then
      raise exception 'Somente o autor ou um avaliador altera a sugestão.';
    end if;
    if old.status <> 'nova' then
      raise exception 'A sugestão já está em avaliação: o conteúdo não muda mais. Use um comentário.';
    end if;
    if new.status is distinct from old.status or new.prioridade is distinct from old.prioridade
       or new.justificativa is distinct from old.justificativa or new.pendencia_id is distinct from old.pendencia_id then
      raise exception 'Somente um avaliador muda a situação, a prioridade ou a decisão da sugestão.';
    end if;
    new.avaliada_por := old.avaliada_por; new.avaliada_em := old.avaliada_em;
    return new;
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'nova' and new.status in ('em_avaliacao', 'aprovada', 'nao_aprovada'))
         or (old.status = 'em_avaliacao' and new.status in ('aprovada', 'nao_aprovada'))
         or (old.status = 'aprovada' and new.status in ('em_desenvolvimento', 'nao_aprovada'))
         or (old.status = 'nao_aprovada' and new.status = 'em_avaliacao')
         or (old.status = 'em_desenvolvimento' and new.status in ('concluida', 'aprovada'))
         or (old.status = 'concluida' and new.status = 'em_desenvolvimento')) then
      raise exception 'Mudança de situação não permitida: de % para %.', old.status, new.status;
    end if;
    if new.status in ('aprovada', 'nao_aprovada') and new.justificativa is null then
      raise exception 'Escreva a justificativa da decisão.';
    end if;
    if new.status in ('aprovada', 'nao_aprovada') then
      new.avaliada_por := coalesce(v_eu, new.avaliada_por); new.avaliada_em := now();
    end if;
  end if;
  if new.status not in ('aprovada', 'nao_aprovada') and new.status is not distinct from old.status then
    new.avaliada_por := old.avaliada_por; new.avaliada_em := old.avaliada_em;
  end if;
  return new;
end $$;

-- 5) Publicar de novo: campos opcionais só mudam quando o módulo os informa -------------------------------------------
create or replace function publicar_pendencia(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_modulo text := nullif(btrim(p ->> 'modulo'), '');
  v_chave text := nullif(btrim(p ->> 'chave_origem'), '');
  v_titulo text := left(nullif(btrim(p ->> 'titulo'), ''), 300);
  v_id uuid;
begin
  if v_modulo is null or v_chave is null or v_titulo is null then
    raise exception 'publicar_pendencia: informe modulo, chave_origem e titulo.';
  end if;
  -- Publicação é do sistema, não da pessoa (ver a 0097). Restaurado no fim.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  select id into v_id from pendencias
   where modulo = v_modulo and chave_origem = v_chave and status in ('aberta', 'em_andamento') and origem = 'modulo'
   for update;
  if found then
    -- Categoria, "precisa distribuir", impacto e "onde aparece" podem ter sido registrados pelo gestor: só mudam
    -- quando o módulo manda a chave no jsonb.
    update pendencias set
      titulo = v_titulo,
      descricao = nullif(btrim(p ->> 'descricao'), ''),
      prazo = nullif(p ->> 'prazo', '')::date,
      criticidade = coalesce(nullif(p ->> 'prioridade', ''), 'normal')::criticidade,
      responsavel_id = coalesce(responsavel_id, nullif(p ->> 'responsavel_id', '')::uuid),
      empresa_id = coalesce(nullif(p ->> 'empresa_id', '')::uuid, empresa_id),
      contraparte_id = coalesce(nullif(p ->> 'contraparte_id', '')::uuid, contraparte_id),
      referencia_tabela = coalesce(nullif(p ->> 'referencia_tabela', ''), referencia_tabela),
      referencia_id = coalesce(nullif(p ->> 'referencia_id', '')::uuid, referencia_id),
      link = coalesce(nullif(p ->> 'link', ''), link),
      categoria = case when p ? 'categoria' then nullif(p ->> 'categoria', '') else categoria end,
      precisa_distribuir = case when p ? 'precisa_distribuir' then coalesce((p ->> 'precisa_distribuir')::boolean, false) else precisa_distribuir end,
      impacto = case when p ? 'impacto' then nullif(p ->> 'impacto', '') else impacto end,
      impacto_fundamento = case when p ? 'impacto' then nullif(btrim(p ->> 'impacto_fundamento'), '') else impacto_fundamento end,
      modulo_exibicao = case when p ? 'modulo_exibicao' then nullif(p ->> 'modulo_exibicao', '') else modulo_exibicao end
     where id = v_id;
  else
    insert into pendencias (modulo, chave_origem, origem, titulo, descricao, prazo, criticidade, responsavel_id, empresa_id,
                            contraparte_id, referencia_tabela, referencia_id, link, categoria, precisa_distribuir, impacto,
                            impacto_fundamento, modulo_exibicao)
    values (v_modulo, v_chave, 'modulo', v_titulo, nullif(btrim(p ->> 'descricao'), ''), nullif(p ->> 'prazo', '')::date,
            coalesce(nullif(p ->> 'prioridade', ''), 'normal')::criticidade, nullif(p ->> 'responsavel_id', '')::uuid,
            nullif(p ->> 'empresa_id', '')::uuid, nullif(p ->> 'contraparte_id', '')::uuid, nullif(p ->> 'referencia_tabela', ''),
            nullif(p ->> 'referencia_id', '')::uuid, nullif(p ->> 'link', ''), nullif(p ->> 'categoria', ''),
            coalesce((p ->> 'precisa_distribuir')::boolean, false), nullif(p ->> 'impacto', ''),
            nullif(btrim(p ->> 'impacto_fundamento'), ''), nullif(p ->> 'modulo_exibicao', ''))
    returning id into v_id;
  end if;

  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_id;
end $$;

-- 6) Avisos: área sensível sem detalhes no canal; reserva antes de enviar ------------------------------------------------
create or replace function fn_central_avisos_pendencia() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_sensivel boolean;
  v_area_nome text;
begin
  begin
    -- Atribuição: recebeu uma pendência de outra pessoa (quem assume para si não recebe aviso). Vai por mensagem
    -- direta a quem tem acesso à pendência.
    if new.responsavel_id is not null and new.status in ('aberta', 'em_andamento')
       and (tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id)
       and new.responsavel_id is distinct from auth.uid() then
      perform central_enfileirar('atribuicao', format('atribuicao:%s:%s:%s', new.id, new.responsavel_id, to_char(now(), 'YYYYMMDDHH24MI')),
        new.responsavel_id, new.id,
        format('Você recebeu a pendência "%s"%s.', new.titulo, case when new.prazo is not null then ' com prazo ' || to_char(new.prazo, 'DD/MM/YYYY') else '' end),
        '/gestao/' || new.id);
    end if;
    -- Pedido de decisão: avisa o canal da gestão (uma vez por pedido). RH e Jurídico: só a área e o link (regra 6).
    if new.aguarda_gestor_em is not null and (tg_op = 'INSERT' or old.aguarda_gestor_em is null) then
      select a.sensivel, a.nome into v_sensivel, v_area_nome
        from modulos m join areas a on a.codigo = m.area where m.codigo = new.modulo;
      perform central_enfileirar('aguarda_gestor', format('decisao:%s:%s', new.id, extract(epoch from new.aguarda_gestor_em)::bigint),
        null, new.id,
        case when coalesce(v_sensivel, false)
             then format('Pedido de decisão numa pendência de %s (detalhes no Neo Admin).', v_area_nome)
             else format('Pedido de decisão em "%s": %s', new.titulo, new.aguarda_gestor_motivo) end,
        '/gestao/' || new.id);
    end if;
  exception when others then
    raise warning 'Aviso da pendência % não enfileirado: %', new.id, sqlerrm;
  end;
  return null;
end $$;

alter table notificacoes drop constraint notificacoes_status_check;
alter table notificacoes add constraint notificacoes_status_check
  check (status in ('pendente', 'enviando', 'enviada', 'falhou', 'ignorada'));
alter table notificacoes add column reservado_em timestamptz;
comment on column notificacoes.reservado_em is 'Quando o envio reservou o aviso (status enviando). Reserva com mais de 10 minutos volta para a fila.';

-- Reserva um lote para envio (só a Edge Function, com a service role). Dois envios ao mesmo tempo não pegam o mesmo aviso.
create function central_reservar_avisos(p_limite int default 50, p_max_tentativas int default 3)
returns setof notificacoes
language sql security definer set search_path = public as $$
  update notificacoes n set status = 'enviando', reservado_em = now()
   where n.id in (select id from notificacoes
                   where (status = 'pendente' or (status = 'enviando' and reservado_em < now() - interval '10 minutes'))
                     and tentativas < p_max_tentativas
                   order by criado_em
                   limit greatest(1, least(coalesce(p_limite, 50), 200))
                   for update skip locked)
  returning n.*;
$$;
revoke all on function central_reservar_avisos(int, int) from public, anon, authenticated;
grant execute on function central_reservar_avisos(int, int) to service_role;

-- 7) Acessos: só o caminho da tela (a busca pode ter nome, CPF ou CNPJ) e no máximo 60 registros por minuto --------------
create or replace function registrar_acesso(p_rota text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  v_rota text := left(split_part(coalesce(p_rota, ''), '?', 1), 300);
  v_partes text[];
  v_modulo text;
  v_area text;
  v_ref uuid;
  v_janela int;
begin
  if v_eu is null or not usuario_ativo() or v_rota = '' or left(v_rota, 1) <> '/' then return; end if;
  if coalesce((select (valor #>> '{}')::boolean from configuracoes where chave = 'administrativo.gestao.registrar_acessos'), false) is not true then
    return;
  end if;
  if (select count(*) from acessos where usuario_id = v_eu and ultimo_em > now() - interval '1 minute') >= 60 then
    return;
  end if;
  v_janela := coalesce((select (valor #>> '{}')::int from configuracoes where chave = 'administrativo.gestao.acessos_agrupar_minutos'), 30);

  v_partes := string_to_array(v_rota, '/');
  select codigo, area into v_modulo, v_area from modulos where codigo = v_partes[2] || '.' || v_partes[3];
  if v_area is null then
    select codigo into v_area from areas where codigo = v_partes[2];
  end if;
  if v_partes[2] = 'gestao' then v_modulo := 'administrativo.gestao'; v_area := 'administrativo'; end if;
  select (m[1])::uuid into v_ref
    from regexp_matches(v_rota, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'gi') as m limit 1;

  update acessos set ultimo_em = now(), vezes = vezes + 1
   where id = (select id from acessos where usuario_id = v_eu and rota = v_rota
                 and ultimo_em > now() - make_interval(mins => v_janela) order by ultimo_em desc limit 1);
  if not found then
    insert into acessos (usuario_id, rota, area, modulo, referencia_id) values (v_eu, v_rota, v_area, v_modulo, v_ref);
  end if;
end $$;
