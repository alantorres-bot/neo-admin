-- =========================================================
-- Neo Admin — 0093 NÚCLEO: CENTRAL DE GESTÃO, AÇÕES (Fase 3)
-- Especificação: docs/modulos/administrativo-gestao.md (seções 5.7 e 9).
--
-- Criar e distribuir tarefas, mudar a situação, bloquear, pedir decisão ao gestor, comentar e ler o histórico.
-- As regras de quem pode o quê continuam no gatilho `fn_pendencias_regras` (0002 + 0092) e na RLS: as funções desta
-- migration que ALTERAM pendências são `security invoker` (valem a RLS e o gatilho de quem chama) e só juntam, numa
-- transação, a alteração e o comentário que a justifica. As de comentário e histórico são `security definer` porque
-- `interacoes` (comentário de quem é responsável fora da área) e `auditoria` (só admin lê) não abrem para todos: elas
-- conferem antes se a pessoa enxerga a pendência e devolvem só o que é daquela pendência.
-- =========================================================

-- 1) O responsável atualiza a própria pendência mesmo sem acesso à área do módulo (ex.: "Tarefas gerais" atribuída a
--    alguém do Fiscal). O gatilho continua limitando O QUE ele altera (situação, bloqueio, pedido de decisão).
create policy pendencias_alterar_proprias on pendencias for update to authenticated
  using (usuario_ativo() and responsavel_id = auth.uid())
  with check (usuario_ativo() and responsavel_id = auth.uid());

-- 2) Tarefa manual: título obrigatório e curto (as publicadas por módulo seguem como estão).
alter table pendencias add constraint ck_pendencias_manual_titulo
  check (origem <> 'manual' or (btrim(titulo) <> '' and length(titulo) <= 200));

-- 3) Histórico rápido por registro (a leitura do histórico de uma pendência filtra por tabela + registro).
create index if not exists idx_auditoria_registro on auditoria (tabela, registro_id);
create index if not exists idx_interacoes_ref on interacoes (referencia_tabela, referencia_id);

-- 4) Quem enxerga a pendência (mesma regra das políticas de leitura usadas pela Central).
create function pendencia_visivel(p pendencias) returns boolean
language sql stable security definer set search_path = public as $$
  select usuario_ativo()
     and (tem_acesso_modulo(p.modulo, 'consulta') or p.responsavel_id = auth.uid() or p.criado_por = auth.uid());
$$;

-- 5) Comentário (fica em `interacoes`: sem edição nem exclusão). Conta como movimentação da pendência.
--    Tipos: comentario, observacao (texto inicial da tarefa), cancelamento, cobranca_gestor e resposta_gestor (só gestor).
create function pendencia_comentar(p_id uuid, p_texto text, p_tipo text default 'comentario') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v pendencias;
  v_texto text := nullif(btrim(p_texto), '');
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Comentário exige um usuário.';
  end if;
  select * into v from pendencias where id = p_id;
  if not found or not pendencia_visivel(v) then
    raise exception 'Pendência não encontrada.';
  end if;
  -- Nível consulta é só leitura: comenta quem atua na área (operador ou acima), o responsável ou quem criou.
  if not (tem_acesso_modulo(v.modulo, 'operador') or v.responsavel_id = auth.uid() or v.criado_por = auth.uid()) then
    raise exception 'Somente quem atua na área, o responsável ou quem criou comenta a pendência.';
  end if;
  if v_texto is null then
    raise exception 'Escreva o comentário.';
  end if;
  if length(v_texto) > 4000 then
    raise exception 'O comentário pode ter até 4.000 caracteres.';
  end if;
  if p_tipo not in ('comentario', 'observacao', 'cancelamento', 'cobranca_gestor', 'resposta_gestor') then
    raise exception 'Tipo de comentário inválido.';
  end if;
  if p_tipo in ('cobranca_gestor', 'resposta_gestor') and not tem_acesso_modulo(v.modulo, 'gestor') then
    raise exception 'Somente o gestor da área cobra andamento ou responde ao pedido de decisão.';
  end if;

  insert into interacoes (modulo, contraparte_id, referencia_tabela, referencia_id, canal, tipo, descricao, usuario_id)
  values (v.modulo, v.contraparte_id, 'pendencias', p_id, 'interno', p_tipo, v_texto, auth.uid())
  returning id into v_id;
  -- O gatilho troca o valor pelo relógio do banco e confere as regras de quem chama.
  update pendencias set movimentado_em = now() where id = p_id;
  return v_id;
end $$;

-- 6) Histórico legível: eventos da auditoria (só os campos de andamento) + comentários, em ordem.
--    Reescrita de título/descrição sem pessoa por trás (sincronização) fica de fora.
create function pendencia_historico(p_id uuid)
returns table (em timestamptz, quem text, evento text, de text, para text, detalhe text)
language plpgsql stable security definer set search_path = public as $$
declare
  v pendencias;
begin
  select * into v from pendencias where id = p_id;
  if not found or not pendencia_visivel(v) then
    raise exception 'Pendência não encontrada.';
  end if;

  return query
  with aud as (
    select a.em, a.usuario_id, a.acao, a.antes, a.depois
      from auditoria a where a.tabela = 'pendencias' and a.registro_id = p_id
  ),
  eventos as (
    select a.em, a.usuario_id, 'criada'::text as evento, null::text as de, a.depois ->> 'titulo' as para,
           a.depois ->> 'origem' as detalhe
      from aud a where a.acao = 'INSERT'
    union all
    select a.em, a.usuario_id, c.campo, a.antes ->> c.campo, a.depois ->> c.campo,
           case c.campo
             when 'destaque_manual' then a.depois ->> 'destaque_motivo'
             when 'bloqueio_motivo' then a.depois ->> 'bloqueio_dependencia_id'
           end
      from aud a
     cross join (values ('status'), ('responsavel_id'), ('prazo'), ('criticidade'), ('bloqueio_motivo'),
                        ('aguarda_gestor_motivo'), ('destaque_manual'), ('precisa_distribuir'), ('categoria'),
                        ('titulo'), ('descricao')) as c(campo)
     where a.acao = 'UPDATE'
       and (a.antes -> c.campo) is distinct from (a.depois -> c.campo)
       and (a.usuario_id is not null or c.campo not in ('titulo', 'descricao'))
  )
  select e.em, coalesce(pf.nome, 'Sistema'), e.evento,
         case when e.evento = 'responsavel_id' then (select x.nome from perfis x where x.id = e.de::uuid) else e.de end,
         case when e.evento = 'responsavel_id' then (select x.nome from perfis x where x.id = e.para::uuid) else e.para end,
         e.detalhe
    from eventos e left join perfis pf on pf.id = e.usuario_id
  union all
  select i.criado_em, coalesce(pf.nome, 'Sistema'), 'comentario:' || i.tipo, null, i.descricao, null
    from interacoes i left join perfis pf on pf.id = i.usuario_id
   where i.referencia_tabela = 'pendencias' and i.referencia_id = p_id
  order by 1, 3;
end $$;

-- 7) Criar tarefa manual. Campos (jsonb): modulo, titulo, descricao, responsavel_id, prazo (aaaa-mm-dd), prioridade,
--    categoria, empresa_id, observacoes. Quem atribui a outra pessoa precisa ser gestor da área (o gatilho confere).
create function pendencia_criar(p_dados jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := gen_random_uuid();
  v_modulo text := nullif(btrim(p_dados ->> 'modulo'), '');
  v_titulo text := btrim(coalesce(p_dados ->> 'titulo', ''));
  v_resp uuid := nullif(p_dados ->> 'responsavel_id', '')::uuid;
  v_prazo date := nullif(p_dados ->> 'prazo', '')::date;
  v_obs text := nullif(btrim(p_dados ->> 'observacoes'), '');
begin
  if auth.uid() is null then
    raise exception 'Criar tarefa exige um usuário.';
  end if;
  if v_titulo = '' then
    raise exception 'Informe o título da tarefa.';
  end if;
  if length(v_titulo) > 200 then
    raise exception 'O título pode ter até 200 caracteres.';
  end if;
  if v_modulo is null or not exists (select 1 from modulos where codigo = v_modulo) then
    raise exception 'Escolha o módulo da tarefa.';
  end if;
  if not tem_acesso_modulo(v_modulo, 'operador') then
    raise exception 'Você não pode criar tarefas neste módulo.';
  end if;
  if v_resp is not null and not exists (select 1 from perfis where id = v_resp and ativo) then
    raise exception 'O responsável escolhido não existe ou está inativo.';
  end if;
  if v_prazo is not null and v_prazo < (now() at time zone 'America/Cuiaba')::date then
    raise exception 'O prazo não pode ser anterior a hoje.';
  end if;

  insert into pendencias (id, modulo, titulo, descricao, prazo, criticidade, responsavel_id, categoria, empresa_id, origem, link)
  values (v_id, v_modulo, v_titulo, nullif(btrim(p_dados ->> 'descricao'), ''), v_prazo,
          coalesce(nullif(p_dados ->> 'prioridade', ''), 'normal')::criticidade, v_resp,
          nullif(p_dados ->> 'categoria', ''), nullif(p_dados ->> 'empresa_id', '')::uuid, 'manual', '/gestao/' || v_id);
  if v_obs is not null then
    perform pendencia_comentar(v_id, v_obs, 'observacao');
  end if;
  return v_id;
end $$;

-- 8) Ações sobre a pendência. `p_dados`: texto (motivo/comentário), responsavel_id, dependencia_id, nivel, e os campos
--    de `alterar` (titulo, descricao, prazo, prioridade, categoria, precisa_distribuir: só os informados mudam).
--    Quem pode cada uma é decidido pela RLS e pelo gatilho (as mensagens de recusa vêm de lá).
create function pendencia_acao(p_id uuid, p_acao text, p_dados jsonb default '{}'::jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v pendencias;
  v_texto text := nullif(btrim(p_dados ->> 'texto'), '');
  v_aberta boolean;
  v_alvo uuid;
  v_dep pendencias;
begin
  if auth.uid() is null then
    raise exception 'Esta ação exige um usuário.';
  end if;
  select * into v from pendencias where id = p_id;
  if not found then
    raise exception 'Pendência não encontrada.';
  end if;
  v_aberta := v.status in ('aberta', 'em_andamento');

  if p_acao in ('comentar', 'cobrar') then
    if p_acao = 'cobrar' and not v_aberta then
      raise exception 'Pendência encerrada não recebe cobrança.';
    end if;
    perform pendencia_comentar(p_id, v_texto, case p_acao when 'cobrar' then 'cobranca_gestor' else 'comentario' end);
    return;
  end if;

  if p_acao not in ('reabrir') and not v_aberta then
    raise exception 'Pendência encerrada: reabra antes de alterar.';
  end if;

  case p_acao
    when 'iniciar' then
      if v.status <> 'aberta' then raise exception 'A pendência já está em andamento.'; end if;
      update pendencias set status = 'em_andamento' where id = p_id;
    when 'pausar' then
      if v.status <> 'em_andamento' then raise exception 'A pendência não está em andamento.'; end if;
      update pendencias set status = 'aberta' where id = p_id;
    when 'concluir' then
      update pendencias set status = 'concluida' where id = p_id;
    when 'cancelar' then
      if v_texto is null then raise exception 'Informe o motivo do cancelamento.'; end if;
      update pendencias set status = 'cancelada' where id = p_id;
    when 'reabrir' then
      if v_aberta then raise exception 'A pendência já está aberta.'; end if;
      update pendencias set status = 'aberta' where id = p_id;
    when 'assumir' then
      if v.responsavel_id is not null then raise exception 'A pendência já tem responsável.'; end if;
      update pendencias set responsavel_id = auth.uid() where id = p_id;
    when 'atribuir' then
      v_alvo := nullif(p_dados ->> 'responsavel_id', '')::uuid;
      if v_alvo is not null and not exists (select 1 from perfis where id = v_alvo and ativo) then
        raise exception 'O responsável escolhido não existe ou está inativo.';
      end if;
      update pendencias set responsavel_id = v_alvo where id = p_id;
    when 'alterar' then
      if p_dados ? 'titulo' and btrim(coalesce(p_dados ->> 'titulo', '')) = '' then
        raise exception 'Informe o título.';
      end if;
      update pendencias set
        titulo = case when p_dados ? 'titulo' then btrim(p_dados ->> 'titulo') else titulo end,
        descricao = case when p_dados ? 'descricao' then nullif(btrim(p_dados ->> 'descricao'), '') else descricao end,
        prazo = case when p_dados ? 'prazo' then nullif(p_dados ->> 'prazo', '')::date else prazo end,
        criticidade = case when p_dados ? 'prioridade' then (p_dados ->> 'prioridade')::criticidade else criticidade end,
        categoria = case when p_dados ? 'categoria' then nullif(p_dados ->> 'categoria', '') else categoria end,
        precisa_distribuir = case when p_dados ? 'precisa_distribuir' then (p_dados ->> 'precisa_distribuir')::boolean else precisa_distribuir end
       where id = p_id;
    when 'bloquear' then
      if v_texto is null then raise exception 'Informe o motivo do bloqueio.'; end if;
      v_alvo := nullif(p_dados ->> 'dependencia_id', '')::uuid;
      if v_alvo is not null then
        select * into v_dep from pendencias where id = v_alvo;   -- RLS: só uma pendência que a pessoa enxerga
        if not found or v_alvo = p_id or v_dep.status not in ('aberta', 'em_andamento') then
          raise exception 'A pendência indicada como dependência não existe, é esta mesma ou já está encerrada.';
        end if;
      end if;
      update pendencias set bloqueio_motivo = v_texto, bloqueio_dependencia_id = v_alvo where id = p_id;
    when 'desbloquear' then
      if v.bloqueio_motivo is null then raise exception 'A pendência não está bloqueada.'; end if;
      update pendencias set bloqueio_motivo = null where id = p_id;
    when 'pedir_decisao' then
      if v_texto is null then raise exception 'Escreva o que precisa ser decidido.'; end if;
      update pendencias set aguarda_gestor_motivo = v_texto where id = p_id;
    when 'responder_decisao' then
      if v.aguarda_gestor_motivo is null then raise exception 'Não há pedido de decisão nesta pendência.'; end if;
      if v_texto is null then raise exception 'Escreva a resposta ao pedido de decisão.'; end if;
      update pendencias set aguarda_gestor_motivo = null where id = p_id;
    when 'destacar' then
      if p_dados ->> 'nivel' is not null and v_texto is null then raise exception 'Informe o motivo do ajuste do destaque.'; end if;
      update pendencias set destaque_manual = nullif(p_dados ->> 'nivel', ''), destaque_motivo = v_texto where id = p_id;
    else
      raise exception 'Ação desconhecida: %', p_acao;
  end case;

  if not found then
    raise exception 'Você não tem permissão para alterar esta pendência.';
  end if;

  -- O comentário que acompanha a ação (motivo, resposta ou observação da conclusão/desbloqueio).
  if v_texto is not null and p_acao in ('cancelar', 'responder_decisao', 'concluir', 'desbloquear', 'reabrir', 'atribuir') then
    perform pendencia_comentar(p_id, v_texto,
      case p_acao when 'cancelar' then 'cancelamento' when 'responder_decisao' then 'resposta_gestor' else 'comentario' end);
  end if;
end $$;

revoke all on function pendencia_visivel(pendencias) from public, anon;
revoke all on function pendencia_comentar(uuid, text, text) from public, anon;
revoke all on function pendencia_historico(uuid) from public, anon;
revoke all on function pendencia_criar(jsonb) from public, anon;
revoke all on function pendencia_acao(uuid, text, jsonb) from public, anon;
grant execute on function pendencia_visivel(pendencias) to authenticated, service_role;
grant execute on function pendencia_comentar(uuid, text, text) to authenticated, service_role;
grant execute on function pendencia_historico(uuid) to authenticated, service_role;
grant execute on function pendencia_criar(jsonb) to authenticated, service_role;
grant execute on function pendencia_acao(uuid, text, jsonb) to authenticated, service_role;
