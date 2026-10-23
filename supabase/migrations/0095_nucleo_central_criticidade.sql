-- =========================================================
-- Neo Admin — 0095 NÚCLEO: CENTRAL DE GESTÃO, CRITICIDADE E PRIORIZAÇÃO (Fase 4)
-- Especificação: docs/modulos/administrativo-gestao.md, seções 5.3 a 5.6.
--  1. Destaque: impacto registrado SEM prazo passa a "Avaliar" (antes não gerava motivo nenhum).
--  2. Ações: "alterar" aceita impacto (financeiro/fiscal/operacional) com fundamento obrigatório (só o gestor: gatilho).
--  3. Limites do destaque: gravados por `central_salvar_parametros` (só admin geral), com faixa validada e o registro de
--     quem aprovou e quando (`administrativo.gestao.limites_aprovados`).
--  4. `central_por_area`: áreas e módulos que precisam de atenção (mesmas regras e mesma RLS da Central).
-- As funções 1 e 2 são recriadas por inteiro; o restante do comportamento é o mesmo das migrations 0092 e 0093.
-- =========================================================

-- 1) Destaque gerencial ------------------------------------------------------------------------------------------------
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

  if p.origem = 'manual' and p.prazo is null and p.criticidade in ('alta', 'critica') then
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


-- 2) Ações sobre a pendência -------------------------------------------------------------------------------------------
create or replace function pendencia_acao(p_id uuid, p_acao text, p_dados jsonb default '{}'::jsonb) returns void
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
      if nullif(p_dados ->> 'impacto', '') is not null and btrim(coalesce(p_dados ->> 'impacto_fundamento', '')) = '' then
        raise exception 'Escreva o fundamento do impacto: o que pode acontecer e por quê.';
      end if;
      update pendencias set
        titulo = case when p_dados ? 'titulo' then btrim(p_dados ->> 'titulo') else titulo end,
        descricao = case when p_dados ? 'descricao' then nullif(btrim(p_dados ->> 'descricao'), '') else descricao end,
        prazo = case when p_dados ? 'prazo' then nullif(p_dados ->> 'prazo', '')::date else prazo end,
        criticidade = case when p_dados ? 'prioridade' then (p_dados ->> 'prioridade')::criticidade else criticidade end,
        categoria = case when p_dados ? 'categoria' then nullif(p_dados ->> 'categoria', '') else categoria end,
        precisa_distribuir = case when p_dados ? 'precisa_distribuir' then (p_dados ->> 'precisa_distribuir')::boolean else precisa_distribuir end,
        impacto = case when p_dados ? 'impacto' then nullif(p_dados ->> 'impacto', '') else impacto end,
        impacto_fundamento = case when p_dados ? 'impacto'
                                  then case when nullif(p_dados ->> 'impacto', '') is null then null else btrim(p_dados ->> 'impacto_fundamento') end
                                  else impacto_fundamento end
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


-- 3) Limites do destaque -----------------------------------------------------------------------------------------------
-- Faixas aceitas: prazo próximo 0–30, atraso relevante 1–90, bloqueio relevante 0–30, sem movimentação 1–90, itens por
-- página 10–200. `p_aprovar` = registrar que os valores foram aprovados (quem e quando), mesmo sem mudar nenhum.
create function central_salvar_parametros(p_valores jsonb, p_aprovar boolean default true) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_faixa constant jsonb := '{"dias_prazo_proximo":[0,30],"dias_atraso_relevante":[1,90],"dias_bloqueio_relevante":[0,30],"dias_sem_movimentacao":[1,90],"itens_por_pagina":[10,200]}';
  v_chave text;
  v_valor int;
  v_nome text;
begin
  if not eh_admin_geral() then
    raise exception 'Somente o administrador geral altera os limites da Central de Gestão.';
  end if;
  for v_chave in select jsonb_object_keys(coalesce(p_valores, '{}'::jsonb)) loop
    if not v_faixa ? v_chave then
      raise exception 'Parâmetro desconhecido: %', v_chave;
    end if;
    begin
      v_valor := (p_valores ->> v_chave)::int;
    exception when others then
      raise exception 'Valor inválido para %: informe um número inteiro.', v_chave;
    end;
    if v_valor is null or v_valor < (v_faixa -> v_chave ->> 0)::int or v_valor > (v_faixa -> v_chave ->> 1)::int then
      raise exception 'Valor fora da faixa para % (de % a %).', v_chave, v_faixa -> v_chave ->> 0, v_faixa -> v_chave ->> 1;
    end if;
    update configuracoes set valor = to_jsonb(v_valor) where chave = 'administrativo.gestao.' || v_chave;
    if not found then
      raise exception 'Parâmetro % não encontrado: aplique a migration 0092.', v_chave;
    end if;
  end loop;
  if p_aprovar then
    select nome into v_nome from perfis where id = auth.uid();
    insert into configuracoes (chave, valor, descricao)
    values ('administrativo.gestao.limites_aprovados',
            jsonb_build_object('por', coalesce(v_nome, 'administrador'), 'em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                               'valores', central_parametros()),
            'Central de Gestão: quem aprovou por último os limites do destaque, quando e com quais valores.')
    on conflict (chave) do update set valor = excluded.valor;
  end if;
  return central_parametros();
end $$;

-- 4) Áreas e módulos que precisam de atenção ---------------------------------------------------------------------------
create function central_por_area(p_visao text default 'gestao', p_filtros jsonb default '{}'::jsonb)
returns table (area text, area_nome text, modulo text, modulo_nome text, abertas int, atrasadas int, intervir int,
               avaliar int, bloqueadas int, aguarda_gestor int, distribuir int)
language sql stable security invoker set search_path = public as $$
  select x.area, max(x.area_nome), x.modulo, max(x.modulo_nome), count(*)::int,
         count(*) filter (where x.atrasada)::int,
         count(*) filter (where x.destaque = 'intervir')::int,
         count(*) filter (where x.destaque = 'avaliar')::int,
         count(*) filter (where x.bloqueada)::int,
         count(*) filter (where x.aguarda_gestor)::int,
         count(*) filter (where x.precisa_distribuir)::int
    from central_pendencias(p_visao, coalesce(p_filtros, '{}'::jsonb) - 'recorte' - 'situacao' - 'destaque' - 'id') x
   group by x.area, x.modulo
   order by count(*) filter (where x.destaque = 'intervir') desc, count(*) filter (where x.atrasada) desc, max(x.area_nome), max(x.modulo_nome);
$$;

revoke all on function central_salvar_parametros(jsonb, boolean) from public, anon;
revoke all on function central_por_area(text, jsonb) from public, anon;
grant execute on function central_salvar_parametros(jsonb, boolean) to authenticated;
grant execute on function central_por_area(text, jsonb) to authenticated, service_role;
