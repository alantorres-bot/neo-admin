-- =========================================================
-- Neo Admin — 0097 NÚCLEO: CENTRAL DE GESTÃO, CONTRATO DE PUBLICAÇÃO (Fase 6)
-- Especificação: docs/modulos/administrativo-gestao.md, seção 5.10.
--
-- Como um módulo põe e tira pendências da Central, sem duplicar e sem ler tabelas de outro módulo:
--  - publicar_pendencia(jsonb): cria, ou atualiza a que está aberta com o mesmo `modulo + chave_origem` (o título pode
--    mudar sem duplicar). Nunca toca em tarefa manual; o responsável escolhido por uma pessoa não é sobrescrito.
--  - encerrar_pendencia / encerrar_pendencias_exceto: encerram só as publicadas pelo módulo (origem = 'modulo').
--  A publicação age como o próprio sistema (mesmo quando a rotina do módulo roda a pedido de uma pessoa): a pendência não
--  é uma ação daquela pessoa (não entra nas atividades dela, nem passa pelas regras de "quem pode" do gatilho). Por isso
--  só as funções dos módulos (e a service role) chamam estas funções; usuário logado não tem execução.
--  - modulo_exibicao: o módulo em que a pendência aparece na Central quando difere do módulo dono (ex.: as de cobrança
--    publicadas pelo Recebíveis aparecem em "Cobrança"). Permissões continuam pelo módulo dono.
--  - Destaque: prioridade alta/crítica sem prazo pede avaliação também nas pendências de módulo (antes, só nas manuais).
-- Os publicadores antigos continuam como estão e adotam o contrato quando forem revistos.
-- =========================================================

alter table pendencias add column modulo_exibicao text references modulos(codigo);
comment on column pendencias.modulo_exibicao is 'Módulo em que a pendência aparece na Central (vazio = o próprio módulo). As permissões seguem `modulo`.';

-- 1) Publicação ------------------------------------------------------------------------------------------------------
-- Campos: modulo e chave_origem (obrigatórios), titulo (obrigatório), descricao, prazo, prioridade, responsavel_id,
-- empresa_id, contraparte_id, referencia_tabela, referencia_id, link, categoria, precisa_distribuir, impacto,
-- impacto_fundamento, modulo_exibicao.
create function publicar_pendencia(p jsonb) returns uuid
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
  -- Publicação é do sistema, não da pessoa (ver o cabeçalho). Restaurado no fim.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  select id into v_id from pendencias
   where modulo = v_modulo and chave_origem = v_chave and status in ('aberta', 'em_andamento') and origem = 'modulo'
   for update;
  if found then
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
      categoria = nullif(p ->> 'categoria', ''),
      precisa_distribuir = coalesce((p ->> 'precisa_distribuir')::boolean, false),
      impacto = nullif(p ->> 'impacto', ''),
      impacto_fundamento = nullif(btrim(p ->> 'impacto_fundamento'), ''),
      modulo_exibicao = nullif(p ->> 'modulo_exibicao', '')
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

-- Encerra a pendência aberta de uma chave (concluida quando a ação foi feita; cancelada quando deixou de valer).
create function encerrar_pendencia(p_modulo text, p_chave text, p_status status_pendencia default 'concluida') returns int
language plpgsql security definer set search_path = public as $$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_n int;
begin
  if p_status not in ('concluida', 'cancelada') then
    raise exception 'encerrar_pendencia: o status deve ser concluida ou cancelada.';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  update pendencias set status = p_status
   where modulo = p_modulo and chave_origem = p_chave and origem = 'modulo' and status in ('aberta', 'em_andamento');
  get diagnostics v_n = row_count;
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_n;
end $$;

-- Para rotinas que recalculam a lista inteira: encerra as abertas do prefixo que não estão mais em `p_ativas`.
create function encerrar_pendencias_exceto(p_modulo text, p_prefixo text, p_ativas text[], p_status status_pendencia default 'cancelada') returns int
language plpgsql security definer set search_path = public as $$
declare
  v_chave text;
  v_n int := 0;
begin
  for v_chave in select chave_origem from pendencias
                  where modulo = p_modulo and origem = 'modulo' and status in ('aberta', 'em_andamento')
                    and chave_origem like p_prefixo || '%' and not (chave_origem = any (coalesce(p_ativas, '{}'))) loop
    v_n := v_n + encerrar_pendencia(p_modulo, v_chave, p_status);
  end loop;
  return v_n;
end $$;

revoke all on function publicar_pendencia(jsonb) from public, anon, authenticated;
revoke all on function encerrar_pendencia(text, text, status_pendencia) from public, anon, authenticated;
revoke all on function encerrar_pendencias_exceto(text, text, text[], status_pendencia) from public, anon, authenticated;
grant execute on function publicar_pendencia(jsonb) to service_role;
grant execute on function encerrar_pendencia(text, text, status_pendencia) to service_role;
grant execute on function encerrar_pendencias_exceto(text, text, text[], status_pendencia) to service_role;

-- 2) Destaque: prioridade alta/crítica sem prazo também nas pendências de módulo --------------------------------------
create or replace function pendencia_destaque(p pendencias, p_hoje date, p_cfg jsonb, p_impede int default 0) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_motivos jsonb := '[]'::jsonb;
  v_peso int := 0;
  v_dias int;
  v_prox int := coalesce((p_cfg ->> 'dias_prazo_proximo')::int, 3);
  v_atraso int := coalesce((p_cfg ->> 'dias_atraso_relevante')::int, 5);
  v_bloq int := coalesce((p_cfg ->> 'dias_bloqueio_relevante')::int, 2);
  v_mov int := coalesce((p_cfg ->> 'dias_sem_movimentacao')::int, 5);
  v_distribuir boolean := p.responsavel_id is null and (p.origem = 'manual' or p.precisa_distribuir);
  v_proximo boolean := p.prazo is not null and p.prazo <= p_hoje + v_prox;
  v_nivel text;
begin
  if p.status not in ('aberta', 'em_andamento') then
    return jsonb_build_object('nivel', 'normal', 'peso', 0, 'precisa_distribuir', false, 'motivos', '[]'::jsonb);
  end if;

  if p.aguarda_gestor_em is not null then
    v_motivos := v_motivos || jsonb_build_object('codigo', 'AGUARDA_GESTOR', 'nivel', 'intervir',
      'desde', ((p.aguarda_gestor_em at time zone 'America/Cuiaba')::date), 'motivo', p.aguarda_gestor_motivo);
    v_peso := greatest(v_peso, 3);
  end if;

  if p.prazo is not null then
    v_dias := p_hoje - p.prazo;                       -- > 0: dias de atraso
    if v_dias > 0 and (v_dias > v_atraso or p.criticidade = 'critica') then
      v_motivos := v_motivos || jsonb_build_object('codigo', 'ATRASO_RELEVANTE', 'nivel', 'intervir',
        'dias', v_dias, 'limite', v_atraso, 'prioridade_critica', p.criticidade = 'critica');
      v_peso := greatest(v_peso, 3);
    elsif v_dias > 0 then
      v_motivos := v_motivos || jsonb_build_object('codigo', 'ATRASO_SIMPLES', 'nivel', 'acompanhar', 'dias', v_dias);
      v_peso := greatest(v_peso, 1);
    elsif v_dias = 0 then
      v_motivos := v_motivos || jsonb_build_object('codigo', 'VENCE_HOJE', 'nivel', 'acompanhar');
      v_peso := greatest(v_peso, 1);
    elsif -v_dias <= v_prox then
      v_motivos := v_motivos || jsonb_build_object('codigo', 'PRAZO_PROXIMO', 'nivel', 'acompanhar',
        'dias', -v_dias, 'prazo', p.prazo);
      v_peso := greatest(v_peso, 1);
    end if;
  end if;

  if p.impacto is not null and v_proximo then
    v_motivos := v_motivos || jsonb_build_object('codigo', 'IMPACTO_REGISTRADO', 'nivel', 'intervir',
      'impacto', p.impacto, 'fundamento', p.impacto_fundamento, 'prazo', p.prazo);
    v_peso := greatest(v_peso, 3);
  end if;

  -- Impacto registrado, mas sem prazo: não há como dizer se é urgente. Pede avaliação em vez de classificar por suposição.
  if p.impacto is not null and p.prazo is null then
    v_motivos := v_motivos || jsonb_build_object('codigo', 'IMPACTO_SEM_PRAZO', 'nivel', 'avaliar',
      'impacto', p.impacto, 'fundamento', p.impacto_fundamento);
    v_peso := greatest(v_peso, 2);
  end if;

  if p.bloqueada_em is not null then
    v_dias := p_hoje - (p.bloqueada_em at time zone 'America/Cuiaba')::date;
    if v_dias > v_bloq then
      v_motivos := v_motivos || jsonb_build_object('codigo', 'BLOQUEIO_RELEVANTE', 'nivel', 'intervir',
        'dias', v_dias, 'limite', v_bloq, 'motivo', p.bloqueio_motivo);
      v_peso := greatest(v_peso, 3);
    else
      v_motivos := v_motivos || jsonb_build_object('codigo', 'BLOQUEADA', 'nivel', 'acompanhar',
        'dias', v_dias, 'motivo', p.bloqueio_motivo);
      v_peso := greatest(v_peso, 1);
    end if;
  end if;

  if coalesce(p_impede, 0) > 0 then
    v_motivos := v_motivos || jsonb_build_object('codigo', 'IMPEDE_OUTRA', 'nivel', 'intervir', 'quantidade', p_impede);
    v_peso := greatest(v_peso, 3);
  end if;

  if v_distribuir then
    if p.criticidade in ('alta', 'critica') or v_proximo then
      v_motivos := v_motivos || jsonb_build_object('codigo', 'PRECISA_DISTRIBUIR', 'nivel', 'intervir',
        'prioridade', p.criticidade, 'prazo', p.prazo);
      v_peso := greatest(v_peso, 3);
    else
      v_motivos := v_motivos || jsonb_build_object('codigo', 'PRECISA_DISTRIBUIR', 'nivel', 'acompanhar',
        'prioridade', p.criticidade, 'prazo', p.prazo);
      v_peso := greatest(v_peso, 1);
    end if;
  end if;

  v_dias := p_hoje - (p.movimentado_em at time zone 'America/Cuiaba')::date;
  if v_dias > v_mov then
    v_motivos := v_motivos || jsonb_build_object('codigo', 'SEM_MOVIMENTACAO', 'nivel', 'acompanhar',
      'dias', v_dias, 'limite', v_mov);
    v_peso := greatest(v_peso, 1);
  end if;

  -- Prioridade alta ou crítica sem prazo (tarefa manual ou publicada por módulo, ex.: vencimento a confirmar): avaliar.
  if p.prazo is null and p.criticidade in ('alta', 'critica') then
    v_motivos := v_motivos || jsonb_build_object('codigo', 'SEM_PRAZO_IMPORTANTE', 'nivel', 'avaliar', 'prioridade', p.criticidade);
    v_peso := greatest(v_peso, 2);
  end if;

  -- Ajuste manual do gestor: prevalece sobre o cálculo, que continua visível nos motivos.
  if p.destaque_manual is not null then
    v_motivos := v_motivos || jsonb_build_object('codigo', 'AJUSTE_MANUAL', 'nivel', p.destaque_manual,
      'motivo', p.destaque_motivo, 'por', p.destaque_por, 'em', p.destaque_em);
    v_peso := case p.destaque_manual when 'intervir' then 3 when 'acompanhar' then 1 else 0 end;
  end if;

  v_nivel := case v_peso when 3 then 'intervir' when 2 then 'avaliar' when 1 then 'acompanhar' else 'normal' end;
  return jsonb_build_object('nivel', v_nivel, 'peso', v_peso, 'precisa_distribuir', v_distribuir, 'motivos', v_motivos);
end $$;


-- 3) Central: módulo de exibição --------------------------------------------------------------------------------------
create or replace function central_pendencias(p_visao text default 'minhas', p_filtros jsonb default '{}'::jsonb)
returns table (
  id uuid, modulo text, modulo_nome text, area text, area_nome text, titulo text, descricao text, prazo date,
  prioridade criticidade, status status_pendencia, responsavel_id uuid, responsavel_nome text, contraparte_nome text,
  link text, origem text, categoria text, criado_em timestamptz, criado_por_nome text, movimentado_em timestamptz,
  concluido_em timestamptz, bloqueada boolean, bloqueada_em timestamptz, bloqueio_motivo text,
  aguarda_gestor boolean, aguarda_gestor_em timestamptz, aguarda_gestor_motivo text, impacto text, impacto_fundamento text,
  precisa_distribuir boolean, atrasada boolean, vence_hoje boolean, destaque text, peso int, motivos jsonb, calculado_em timestamptz)
language sql stable security invoker set search_path = public as $$
  with cfg as (
    select central_parametros() as c, (now() at time zone 'America/Cuiaba')::date as hoje, now() as agora
  ),
  base as (
    select p, m.nome as modulo_nome, m.area, a.nome as area_nome, cfg.hoje, cfg.agora,
           pendencia_destaque(p, cfg.hoje, cfg.c,
             (select count(*)::int from pendencias y
               where y.bloqueio_dependencia_id = p.id and y.status in ('aberta', 'em_andamento'))) as d
      from pendencias p
      join modulos m on m.codigo = coalesce(p.modulo_exibicao, p.modulo)
      join areas a on a.codigo = m.area
      cross join cfg
     where case
             when p_filtros ? 'id' then p.id = (p_filtros ->> 'id')::uuid
             when p_visao = 'gestao' then tem_acesso_modulo(p.modulo, 'gestor') or p.responsavel_id = auth.uid()
             else p.responsavel_id = auth.uid() or (p.responsavel_id is null and tem_acesso_modulo(p.modulo, 'operador'))
           end
       and (p_filtros ? 'id'
            or case when p_filtros ->> 'situacao' in ('concluida', 'cancelada') then p.status::text = p_filtros ->> 'situacao'
                    else p.status in ('aberta', 'em_andamento') end)
       and (not p_filtros ? 'area' or m.area = p_filtros ->> 'area')
       and (not p_filtros ? 'modulo' or coalesce(p.modulo_exibicao, p.modulo) = p_filtros ->> 'modulo')
       and (not p_filtros ? 'responsavel'
            or case when p_filtros ->> 'responsavel' = 'sem' then p.responsavel_id is null
                    else p.responsavel_id = (p_filtros ->> 'responsavel')::uuid end)
       and (not p_filtros ? 'situacao' or p_filtros ->> 'situacao' in ('concluida', 'cancelada')
            or (p_filtros ->> 'situacao' in ('aberta', 'em_andamento') and p.status::text = p_filtros ->> 'situacao')
            or (p_filtros ->> 'situacao' = 'bloqueada' and p.bloqueada_em is not null)
            or (p_filtros ->> 'situacao' = 'aguarda_gestor' and p.aguarda_gestor_em is not null))
       and (not p_filtros ? 'prioridade' or p.criticidade::text = p_filtros ->> 'prioridade')
       and (not p_filtros ? 'origem' or p.origem = p_filtros ->> 'origem')
       and (not p_filtros ? 'prazo_de' or p.prazo >= (p_filtros ->> 'prazo_de')::date)
       and (not p_filtros ? 'prazo_ate' or p.prazo <= (p_filtros ->> 'prazo_ate')::date)
  )
  select (b.p).id, coalesce((b.p).modulo_exibicao, (b.p).modulo), b.modulo_nome, b.area, b.area_nome, (b.p).titulo, (b.p).descricao, (b.p).prazo,
         (b.p).criticidade, (b.p).status, (b.p).responsavel_id, r.nome, c.nome, (b.p).link, (b.p).origem, (b.p).categoria,
         (b.p).criado_em, cp.nome, (b.p).movimentado_em, (b.p).concluido_em,
         (b.p).bloqueada_em is not null, (b.p).bloqueada_em, (b.p).bloqueio_motivo,
         (b.p).aguarda_gestor_em is not null, (b.p).aguarda_gestor_em, (b.p).aguarda_gestor_motivo,
         (b.p).impacto, (b.p).impacto_fundamento,
         (b.d ->> 'precisa_distribuir')::boolean,
         (b.p).status in ('aberta', 'em_andamento') and (b.p).prazo < b.hoje,
         (b.p).status in ('aberta', 'em_andamento') and (b.p).prazo = b.hoje,
         b.d ->> 'nivel', (b.d ->> 'peso')::int, b.d -> 'motivos', b.agora
    from base b
    left join perfis r on r.id = (b.p).responsavel_id
    left join perfis cp on cp.id = (b.p).criado_por
    left join contrapartes c on c.id = (b.p).contraparte_id
   where (not p_filtros ? 'destaque' or b.d ->> 'nivel' = p_filtros ->> 'destaque')
     and (not p_filtros ? 'busca'
          or (b.p).titulo ilike '%' || (p_filtros ->> 'busca') || '%'
          or (b.p).descricao ilike '%' || (p_filtros ->> 'busca') || '%'
          or c.nome ilike '%' || (p_filtros ->> 'busca') || '%')
     and (not p_filtros ? 'recorte'
          or (p_filtros ->> 'recorte' = 'atrasadas' and (b.p).prazo < b.hoje)
          or (p_filtros ->> 'recorte' = 'hoje' and (b.p).prazo = b.hoje)
          or (p_filtros ->> 'recorte' = 'intervir' and b.d ->> 'nivel' = 'intervir')
          or (p_filtros ->> 'recorte' = 'aguarda_gestor' and (b.p).aguarda_gestor_em is not null)
          or (p_filtros ->> 'recorte' = 'bloqueadas' and (b.p).bloqueada_em is not null)
          or (p_filtros ->> 'recorte' = 'distribuir' and (b.d ->> 'precisa_distribuir')::boolean));
$$;

