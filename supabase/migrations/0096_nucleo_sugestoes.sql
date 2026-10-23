-- =========================================================
-- Neo Admin — 0096 NÚCLEO: SUGESTÕES DE MELHORIA (Central de Gestão, Fase 5)
-- Especificação: docs/modulos/administrativo-gestao.md, seção 5.8.
--
-- Qualquer pessoa com alguma área sugere uma melhoria. Todos veem número, título, área, módulo, situação e a decisão;
-- o conteúdo completo (problema, como é hoje, resultado esperado, comentários, autor) fica com o autor e os avaliadores
-- (admin geral ou gestor da área Administrativo). Aprovar não muda nada no sistema: a melhoria segue o fluxo normal de
-- especificação, construção, testes e validação.
-- Comentários ficam em tabela própria (não em `interacoes`, cuja leitura depende do módulo: o autor pode não ter acesso
-- ao módulo da sugestão). Nada é apagado; o histórico das decisões vem da `auditoria`.
-- =========================================================

-- 1) Quem avalia ---------------------------------------------------------------------------------------------------------
create function pode_avaliar_sugestoes() returns boolean
language sql stable security definer set search_path = public as $$
  select eh_admin_geral() or tem_acesso_area('administrativo', 'gestor');
$$;

-- 2) Sugestões ---------------------------------------------------------------------------------------------------------
create table sugestoes (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  titulo text not null check (btrim(titulo) <> '' and length(titulo) <= 150),
  area text not null references areas(codigo),
  modulo text references modulos(codigo),
  problema text check (length(problema) <= 4000),
  como_hoje text check (length(como_hoje) <= 4000),
  melhoria text not null check (btrim(melhoria) <> '' and length(melhoria) <= 4000),
  resultado_esperado text check (length(resultado_esperado) <= 4000),
  status text not null default 'nova'
    check (status in ('nova', 'em_avaliacao', 'aprovada', 'nao_aprovada', 'em_desenvolvimento', 'concluida')),
  prioridade text check (prioridade in ('alta', 'normal', 'baixa')),
  justificativa text check (length(justificativa) <= 4000),
  avaliada_por uuid references perfis(id),
  avaliada_em timestamptz,
  pendencia_id uuid references pendencias(id),     -- tarefa de implementação
  autor_id uuid not null references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index idx_sugestoes_status on sugestoes (status, criado_em desc);
create index idx_sugestoes_autor on sugestoes (autor_id);

create table sugestoes_comentarios (
  id uuid primary key default gen_random_uuid(),
  sugestao_id uuid not null references sugestoes(id),
  autor_id uuid not null references perfis(id) default auth.uid(),
  texto text not null check (btrim(texto) <> '' and length(texto) <= 4000),
  criado_em timestamptz not null default now()
);
create index idx_sugestoes_comentarios on sugestoes_comentarios (sugestao_id, criado_em);

-- 3) Regras ------------------------------------------------------------------------------------------------------------
-- Transições permitidas (só avaliador): nova → em_avaliacao | aprovada | nao_aprovada;
-- em_avaliacao → aprovada | nao_aprovada; aprovada → em_desenvolvimento | nao_aprovada;
-- nao_aprovada → em_avaliacao (reconsiderar); em_desenvolvimento → concluida | aprovada; concluida → em_desenvolvimento.
-- Aprovar e não aprovar exigem justificativa. O autor só corrige o conteúdo enquanto a sugestão está "nova".
create function fn_sugestoes_regras() returns trigger
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
create trigger trg_sugestoes_regras before insert or update on sugestoes for each row execute function fn_sugestoes_regras();
create trigger trg_sugestoes_sem_delete before delete on sugestoes for each row execute function fn_bloquear_delete();
create trigger trg_aud_sugestoes after insert or update on sugestoes for each row execute function fn_auditoria();
create trigger trg_sugestoes_comentarios_sem_delete before delete on sugestoes_comentarios for each row execute function fn_bloquear_delete();
create function fn_sugestoes_comentarios_imutaveis() returns trigger language plpgsql as $$
begin
  raise exception 'Comentários não podem ser alterados.';
end $$;
create trigger trg_sugestoes_comentarios_imutaveis before update on sugestoes_comentarios
  for each row execute function fn_sugestoes_comentarios_imutaveis();

-- 4) Na Central: sugestão nova gera "Avaliar sugestão nº N" (Tarefas gerais), encerrada quando a sugestão é decidida.
create function fn_sugestoes_pendencia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into pendencias (modulo, titulo, descricao, categoria, referencia_tabela, referencia_id, link, chave_origem)
    values ('administrativo.gestao', format('Avaliar sugestão nº %s: %s', new.numero, new.titulo), left(new.melhoria, 500),
            'decisao', 'sugestoes', new.id, '/gestao/sugestoes/' || new.id, 'sugestao:' || new.id)
    on conflict do nothing;
  elsif new.status in ('aprovada', 'nao_aprovada', 'em_desenvolvimento', 'concluida') and old.status in ('nova', 'em_avaliacao') then
    update pendencias set status = 'concluida'
     where modulo = 'administrativo.gestao' and chave_origem = 'sugestao:' || new.id and status in ('aberta', 'em_andamento');
  elsif new.status = 'em_avaliacao' and old.status = 'nova' then
    update pendencias set status = 'em_andamento'
     where modulo = 'administrativo.gestao' and chave_origem = 'sugestao:' || new.id and status = 'aberta';
  end if;
  return null;
end $$;
create trigger trg_sugestoes_pendencia after insert or update of status on sugestoes for each row execute function fn_sugestoes_pendencia();

-- 5) RLS -----------------------------------------------------------------------------------------------------------------
alter table sugestoes enable row level security;
alter table sugestoes_comentarios enable row level security;
create policy sugestoes_ler on sugestoes for select to authenticated
  using (usuario_ativo() and (autor_id = auth.uid() or pode_avaliar_sugestoes()));
create policy sugestoes_inserir on sugestoes for insert to authenticated
  with check (tem_acesso_alguma_area('consulta') and autor_id = auth.uid());
create policy sugestoes_alterar on sugestoes for update to authenticated
  using (usuario_ativo() and (autor_id = auth.uid() or pode_avaliar_sugestoes()))
  with check (usuario_ativo() and (autor_id = auth.uid() or pode_avaliar_sugestoes()));
create policy sugestoes_comentarios_ler on sugestoes_comentarios for select to authenticated
  using (exists (select 1 from sugestoes s where s.id = sugestao_id));      -- herda a leitura da sugestão
create policy sugestoes_comentarios_inserir on sugestoes_comentarios for insert to authenticated
  with check (autor_id = auth.uid() and exists (select 1 from sugestoes s where s.id = sugestao_id));

-- 6) Lista pública: só os campos que todos podem ver -------------------------------------------------------------------
create function sugestoes_publicas()
returns table (id uuid, numero bigint, titulo text, area text, area_nome text, modulo text, modulo_nome text, status text,
               prioridade text, justificativa text, criado_em timestamptz, avaliada_em timestamptz, minha boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.numero, s.titulo, s.area, a.nome, s.modulo, m.nome, s.status, s.prioridade,
         case when s.status in ('aprovada', 'nao_aprovada', 'em_desenvolvimento', 'concluida') then s.justificativa end,
         s.criado_em, s.avaliada_em, s.autor_id = auth.uid()
    from sugestoes s join areas a on a.codigo = s.area left join modulos m on m.codigo = s.modulo
   where tem_acesso_alguma_area('consulta')
   order by s.numero desc;
$$;

-- 7) Histórico (situações, da auditoria) e comentários: autor e avaliadores --------------------------------------------
create function sugestao_historico(p_id uuid)
returns table (em timestamptz, quem text, evento text, de text, para text, texto text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from sugestoes s where s.id = p_id and usuario_ativo() and (s.autor_id = auth.uid() or pode_avaliar_sugestoes())) then
    raise exception 'Sugestão não encontrada.';
  end if;
  return query
  select a.em, coalesce(p.nome, 'Sistema'),
         case when a.acao = 'INSERT' then 'enviada' else 'situacao' end,
         a.antes ->> 'status', a.depois ->> 'status',
         case when a.acao = 'UPDATE' and (a.depois ->> 'status') in ('aprovada', 'nao_aprovada') then a.depois ->> 'justificativa' end
    from auditoria a left join perfis p on p.id = a.usuario_id
   where a.tabela = 'sugestoes' and a.registro_id = p_id
     and (a.acao = 'INSERT' or (a.antes ->> 'status') is distinct from (a.depois ->> 'status'))
  union all
  select c.criado_em, coalesce(p.nome, '—'), 'comentario', null, null, c.texto
    from sugestoes_comentarios c left join perfis p on p.id = c.autor_id
   where c.sugestao_id = p_id
  order by 1;
end $$;

-- 8) Tarefa de implementação: o avaliador cria uma tarefa manual ligada à sugestão aprovada ----------------------------
create function sugestao_criar_tarefa(p_id uuid, p_responsavel uuid default null, p_prazo date default null) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  s sugestoes;
  v_tarefa uuid;
begin
  if not pode_avaliar_sugestoes() then
    raise exception 'Somente um avaliador cria a tarefa de implementação.';
  end if;
  select * into s from sugestoes where id = p_id;
  if not found then raise exception 'Sugestão não encontrada.'; end if;
  if s.status not in ('aprovada', 'em_desenvolvimento') then
    raise exception 'Só sugestão aprovada ou em desenvolvimento recebe tarefa de implementação.';
  end if;
  if s.pendencia_id is not null and exists (select 1 from pendencias where id = s.pendencia_id and status in ('aberta', 'em_andamento')) then
    raise exception 'Esta sugestão já tem uma tarefa de implementação aberta.';
  end if;
  v_tarefa := pendencia_criar(jsonb_build_object(
    'modulo', 'administrativo.gestao', 'titulo', left(format('Implementar sugestão nº %s: %s', s.numero, s.titulo), 200),
    'descricao', s.melhoria, 'responsavel_id', p_responsavel, 'prazo', p_prazo,
    'prioridade', case s.prioridade when 'alta' then 'alta' else 'normal' end, 'categoria', 'tarefa',
    'observacoes', format('Sugestão nº %s: /gestao/sugestoes/%s', s.numero, s.id)));
  update sugestoes set pendencia_id = v_tarefa where id = p_id;
  return v_tarefa;
end $$;

revoke all on function pode_avaliar_sugestoes() from public, anon;
revoke all on function sugestoes_publicas() from public, anon;
revoke all on function sugestao_historico(uuid) from public, anon;
revoke all on function sugestao_criar_tarefa(uuid, uuid, date) from public, anon;
grant execute on function pode_avaliar_sugestoes() to authenticated, service_role;
grant execute on function sugestoes_publicas() to authenticated, service_role;
grant execute on function sugestao_historico(uuid) to authenticated, service_role;
grant execute on function sugestao_criar_tarefa(uuid, uuid, date) to authenticated;
revoke delete on sugestoes, sugestoes_comentarios from authenticated, anon;

-- 9) Atividades (catálogo do núcleo, 0094) -----------------------------------------------------------------------------
insert into atividade_regras (codigo, nome, area, modulo, fonte, tabela, gatilho, campo, valor, condicao, autor_coluna, descricao, link) values
  ('nucleo.sugestao.enviou', 'Enviou sugestão de melhoria', 'administrativo', 'administrativo.gestao', 'auditoria', 'sugestoes', 'insert', null, null, null, 'autor_id',
   'Enviou a sugestão nº {numero}: {titulo}', '/gestao/sugestoes/{id}'),
  ('nucleo.sugestao.aprovou', 'Aprovou sugestão', 'administrativo', 'administrativo.gestao', 'auditoria', 'sugestoes', 'muda_para', 'status', 'aprovada', null, 'avaliada_por',
   'Aprovou a sugestão nº {numero}: {titulo}', '/gestao/sugestoes/{id}'),
  ('nucleo.sugestao.nao_aprovou', 'Não aprovou sugestão', 'administrativo', 'administrativo.gestao', 'auditoria', 'sugestoes', 'muda_para', 'status', 'nao_aprovada', null, 'avaliada_por',
   'Não aprovou a sugestão nº {numero}: {titulo}', '/gestao/sugestoes/{id}'),
  ('nucleo.sugestao.concluiu', 'Concluiu sugestão', 'administrativo', 'administrativo.gestao', 'auditoria', 'sugestoes', 'muda_para', 'status', 'concluida', null, null,
   'Marcou como concluída a sugestão nº {numero}: {titulo}', '/gestao/sugestoes/{id}')
on conflict (codigo) do nothing;
