-- =========================================================
-- Neo Admin — 0092 NÚCLEO: CENTRAL DE GESTÃO (Fase 2)
-- Especificação: docs/modulos/administrativo-gestao.md (seções 5, 8 e 9).
--
-- A Central usa a própria tabela `pendencias` (não há segundo sistema de pendências). Esta migration:
--  1. cadastra o módulo "Tarefas gerais" (administrativo.gestao), inativo: só serve de módulo às tarefas sem módulo próprio;
--  2. cadastra os limites do destaque gerencial em `configuracoes` (valores propostos, a aprovar);
--  3. acrescenta à `pendencias` origem, autor, categoria, última movimentação humana, bloqueio, pedido de decisão ao
--     gestor, "precisa distribuir", impacto com fundamento, ajuste manual do destaque e chave de origem. Nada é removido
--     nem renomeado; os publicadores atuais continuam iguais;
--  4. estende o gatilho `fn_pendencias_regras` (as regras de antes ficam idênticas);
--  5. deixa o responsável e quem criou lerem a pendência mesmo sem acesso à área do módulo;
--  6. cria as funções de leitura da Central (`security invoker`: a RLS de quem chama vale em tudo).
--
-- O bloqueio NÃO é um status novo: os publicadores procuram pendências 'aberta'/'em_andamento' para não duplicar, e um
-- status 'bloqueada' faria cada sincronização criar outra igual. Bloqueada = marca (`bloqueada_em`) sobre o status atual.
-- =========================================================

-- 1) Módulo "Tarefas gerais" --------------------------------------------------------------------------------------------
insert into modulos (codigo, area, nome, ativo) values ('administrativo.gestao', 'administrativo', 'Tarefas gerais', false)
on conflict (codigo) do nothing;

-- 2) Parâmetros (dias corridos) -----------------------------------------------------------------------------------------
insert into configuracoes (chave, valor, descricao) values
  ('administrativo.gestao.dias_prazo_proximo', '3', 'Central de Gestão: "prazo próximo" quando faltam até N dias para o prazo.'),
  ('administrativo.gestao.dias_atraso_relevante', '5', 'Central de Gestão: atraso acima de N dias passa a exigir intervenção.'),
  ('administrativo.gestao.dias_bloqueio_relevante', '2', 'Central de Gestão: bloqueio há mais de N dias passa a exigir intervenção.'),
  ('administrativo.gestao.dias_sem_movimentacao', '5', 'Central de Gestão: pendência aberta sem movimentação humana há mais de N dias entra em acompanhamento.'),
  ('administrativo.gestao.itens_por_pagina', '50', 'Central de Gestão: linhas por página da fila consolidada.')
on conflict (chave) do nothing;

-- 3) Colunas novas ------------------------------------------------------------------------------------------------------
alter table pendencias
  add column origem text not null default 'modulo' check (origem in ('modulo', 'manual')),
  add column criado_por uuid references perfis(id),
  add column categoria text
    check (categoria in ('tarefa', 'conferencia', 'lancamento', 'entrega', 'cobranca', 'decisao', 'fechamento', 'outro')),
  add column movimentado_em timestamptz,
  add column bloqueada_em timestamptz,
  add column bloqueada_por uuid references perfis(id),
  add column bloqueio_motivo text,
  add column bloqueio_dependencia_id uuid references pendencias(id),
  add column aguarda_gestor_em timestamptz,
  add column aguarda_gestor_por uuid references perfis(id),
  add column aguarda_gestor_motivo text,
  add column precisa_distribuir boolean not null default false,
  add column impacto text check (impacto in ('financeiro', 'fiscal', 'operacional')),
  add column impacto_fundamento text,
  add column destaque_manual text check (destaque_manual in ('intervir', 'acompanhar', 'normal')),
  add column destaque_motivo text,
  add column destaque_por uuid references perfis(id),
  add column destaque_em timestamptz,
  add column chave_origem text;

comment on column pendencias.origem is 'modulo = publicada por um módulo; manual = criada por uma pessoa na Central.';
comment on column pendencias.movimentado_em is 'Última movimentação HUMANA (status, responsável, prazo, prioridade, bloqueio, decisão, destaque). Reescritas das sincronizações não contam.';
comment on column pendencias.chave_origem is 'Chave estável do registro de origem no módulo (contrato publicar_pendencia, Fase 6). Única entre as abertas do módulo.';
comment on column pendencias.criticidade is 'Prioridade da pendência (Crítica/Alta/Normal), informada pela origem ou pelo gestor. Não é o destaque gerencial, que é calculado.';

-- Linhas existentes: a última movimentação conhecida é a conclusão ou a criação. Sem auditoria aqui: é preenchimento
-- técnico de coluna nova, não alteração de negócio (evita milhares de linhas idênticas na auditoria).
alter table pendencias disable trigger trg_aud_pendencias;
alter table pendencias disable trigger trg_pendencias_regras;
update pendencias set movimentado_em = coalesce(concluido_em, criado_em);
alter table pendencias enable trigger trg_pendencias_regras;
alter table pendencias enable trigger trg_aud_pendencias;
alter table pendencias alter column movimentado_em set default now(), alter column movimentado_em set not null;

alter table pendencias
  add constraint ck_pendencias_bloqueio check (
    (bloqueada_em is null) = (bloqueio_motivo is null)
    and (bloqueio_motivo is null or btrim(bloqueio_motivo) <> '')
    and (bloqueio_dependencia_id is null or bloqueio_motivo is not null)
    and bloqueio_dependencia_id is distinct from id),
  add constraint ck_pendencias_aguarda_gestor check (
    (aguarda_gestor_em is null) = (aguarda_gestor_motivo is null)
    and (aguarda_gestor_motivo is null or btrim(aguarda_gestor_motivo) <> '')),
  add constraint ck_pendencias_impacto check (impacto is null or btrim(coalesce(impacto_fundamento, '')) <> ''),
  add constraint ck_pendencias_destaque check (
    (destaque_manual is null) = (destaque_em is null)
    and (destaque_manual is null or btrim(coalesce(destaque_motivo, '')) <> ''));

create unique index uq_pendencia_chave_origem on pendencias (modulo, chave_origem)
  where chave_origem is not null and status in ('aberta', 'em_andamento');
create index idx_pendencias_dependencia on pendencias (bloqueio_dependencia_id) where bloqueio_dependencia_id is not null;
create index idx_pendencias_modulo_abertas on pendencias (modulo, prazo) where status in ('aberta', 'em_andamento');

-- 4) Regras (gatilho) ---------------------------------------------------------------------------------------------------
-- Mantém as regras da 0002 e acrescenta:
--  - origem, criado_por e chave_origem não mudam depois de criados (criado_por é carimbado: o usuário não forja);
--  - categoria, "precisa distribuir", impacto e ajuste manual do destaque: só o gestor da área;
--  - bloquear/desbloquear: o responsável ou o gestor; o banco carimba quem e quando;
--  - pedir decisão ao gestor: o responsável ou o gestor; só o gestor responde (desliga a marca);
--  - cancelar tarefa MANUAL: o gestor ou quem criou (as pendências de módulo seguem a regra do módulo);
--  - movimentado_em: só ação humana atualiza; o usuário não escolhe o valor.
create or replace function fn_pendencias_regras() returns trigger language plpgsql as $$
declare
  v_eu uuid := auth.uid();
  v_gestor boolean;
begin
  -- Normaliza os textos das marcas (vazio = sem marca).
  new.bloqueio_motivo := nullif(btrim(new.bloqueio_motivo), '');
  new.aguarda_gestor_motivo := nullif(btrim(new.aguarda_gestor_motivo), '');
  new.destaque_motivo := nullif(btrim(new.destaque_motivo), '');
  new.impacto_fundamento := nullif(btrim(new.impacto_fundamento), '');

  if v_eu is null then
    -- Origem de serviço (Edge Function, pg_cron, migration): livre; só carimba o que falta.
    if new.status = 'concluida' and (tg_op = 'INSERT' or old.status <> 'concluida') then
      new.concluido_em := coalesce(new.concluido_em, now());
    end if;
    if tg_op = 'UPDATE' then
      new.origem := old.origem; new.criado_por := old.criado_por;
      new.movimentado_em := old.movimentado_em;   -- serviço não é movimentação humana
    end if;
    if new.bloqueio_motivo is null then
      new.bloqueada_em := null; new.bloqueada_por := null; new.bloqueio_dependencia_id := null;
    else
      new.bloqueada_em := coalesce(new.bloqueada_em, now());
    end if;
    if new.aguarda_gestor_motivo is null then
      new.aguarda_gestor_em := null; new.aguarda_gestor_por := null;
    else
      new.aguarda_gestor_em := coalesce(new.aguarda_gestor_em, now());
    end if;
    if new.destaque_manual is null then
      new.destaque_motivo := null; new.destaque_por := null; new.destaque_em := null;
    else
      new.destaque_em := coalesce(new.destaque_em, now());
    end if;
    return new;
  end if;

  v_gestor := tem_acesso_modulo(new.modulo, 'gestor');

  if tg_op = 'INSERT' then
    if not v_gestor and new.responsavel_id is not null and new.responsavel_id <> v_eu then
      raise exception 'Somente o gestor da área atribui pendência a outra pessoa.';
    end if;
    if not v_gestor and (new.precisa_distribuir or new.impacto is not null or new.destaque_manual is not null) then
      raise exception 'Somente o gestor da área marca "precisa distribuir", impacto ou ajuste do destaque.';
    end if;
    new.criado_por := v_eu;
    new.criado_em := now();
    new.movimentado_em := now();
    new.concluido_em := null; new.concluido_por := null;
    if new.status = 'concluida' then
      new.concluido_em := now(); new.concluido_por := v_eu;
    end if;
    if new.bloqueio_motivo is null then
      new.bloqueada_em := null; new.bloqueada_por := null; new.bloqueio_dependencia_id := null;
    else
      new.bloqueada_em := now(); new.bloqueada_por := v_eu;
    end if;
    if new.aguarda_gestor_motivo is null then
      new.aguarda_gestor_em := null; new.aguarda_gestor_por := null;
    else
      new.aguarda_gestor_em := now(); new.aguarda_gestor_por := v_eu;
    end if;
    if new.destaque_manual is null then
      new.destaque_motivo := null; new.destaque_por := null; new.destaque_em := null;
    else
      new.destaque_em := now(); new.destaque_por := v_eu;
    end if;
    return new;
  end if;

  -- UPDATE por usuário. Campos que ninguém altera depois de criados:
  new.origem := old.origem; new.criado_por := old.criado_por; new.chave_origem := old.chave_origem;

  if not v_gestor then
    if new.modulo is distinct from old.modulo or new.empresa_id is distinct from old.empresa_id
       or new.contraparte_id is distinct from old.contraparte_id or new.titulo is distinct from old.titulo
       or new.descricao is distinct from old.descricao or new.prazo is distinct from old.prazo
       or new.criticidade is distinct from old.criticidade
       or new.referencia_tabela is distinct from old.referencia_tabela
       or new.referencia_id is distinct from old.referencia_id or new.link is distinct from old.link
       or new.clickup_task_id is distinct from old.clickup_task_id or new.criado_em is distinct from old.criado_em
       or new.categoria is distinct from old.categoria or new.precisa_distribuir is distinct from old.precisa_distribuir
       or new.impacto is distinct from old.impacto or new.impacto_fundamento is distinct from old.impacto_fundamento then
      raise exception 'Somente o gestor da área altera os dados da pendência.';
    end if;
    if new.destaque_manual is distinct from old.destaque_manual or new.destaque_motivo is distinct from old.destaque_motivo then
      raise exception 'Somente o gestor da área ajusta o destaque da pendência.';
    end if;
    if new.responsavel_id is distinct from old.responsavel_id
       and not (old.responsavel_id is null and new.responsavel_id = v_eu) then
      raise exception 'Somente o gestor da área reatribui a pendência.';
    end if;
    if old.status in ('concluida', 'cancelada') and new.status is distinct from old.status then
      raise exception 'Pendência encerrada só é reaberta pelo gestor da área.';
    end if;
    if (new.bloqueio_motivo is distinct from old.bloqueio_motivo
        or new.bloqueio_dependencia_id is distinct from old.bloqueio_dependencia_id)
       and old.responsavel_id is distinct from v_eu then
      raise exception 'Somente o responsável ou o gestor da área bloqueia ou desbloqueia a pendência.';
    end if;
    if new.aguarda_gestor_motivo is distinct from old.aguarda_gestor_motivo then
      if new.aguarda_gestor_motivo is null then
        raise exception 'Somente o gestor da área responde ao pedido de decisão.';
      end if;
      if old.responsavel_id is distinct from v_eu then
        raise exception 'Somente o responsável pede decisão ao gestor.';
      end if;
    end if;
    if old.origem = 'manual' and new.status = 'cancelada' and old.status <> 'cancelada'
       and old.criado_por is distinct from v_eu then
      raise exception 'Somente o gestor da área ou quem criou cancela a tarefa.';
    end if;
  end if;

  if new.status = 'concluida' and old.status <> 'concluida' then
    new.concluido_em := now(); new.concluido_por := v_eu;
  elsif new.status = 'concluida' then
    new.concluido_em := old.concluido_em; new.concluido_por := old.concluido_por;
  else
    new.concluido_em := null; new.concluido_por := null;
  end if;

  -- Carimbos das marcas: quem ligou e quando (o usuário não escolhe).
  if new.bloqueio_motivo is null then
    new.bloqueada_em := null; new.bloqueada_por := null; new.bloqueio_dependencia_id := null;
  elsif old.bloqueio_motivo is null then
    new.bloqueada_em := now(); new.bloqueada_por := v_eu;
  else
    new.bloqueada_em := old.bloqueada_em; new.bloqueada_por := old.bloqueada_por;
  end if;
  if new.aguarda_gestor_motivo is null then
    new.aguarda_gestor_em := null; new.aguarda_gestor_por := null;
  elsif old.aguarda_gestor_motivo is null then
    new.aguarda_gestor_em := now(); new.aguarda_gestor_por := v_eu;
  else
    new.aguarda_gestor_em := old.aguarda_gestor_em; new.aguarda_gestor_por := old.aguarda_gestor_por;
  end if;
  if new.destaque_manual is null then
    new.destaque_motivo := null; new.destaque_por := null; new.destaque_em := null;
  elsif new.destaque_manual is distinct from old.destaque_manual or new.destaque_motivo is distinct from old.destaque_motivo then
    new.destaque_em := now(); new.destaque_por := v_eu;
  else
    new.destaque_em := old.destaque_em; new.destaque_por := old.destaque_por;
  end if;

  -- Movimentação humana: só o que muda o andamento (título e descrição não contam). Tocar em movimentado_em
  -- (ex.: um comentário, Fase 3) também conta, mas o valor é sempre o do relógio do banco.
  if new.status is distinct from old.status or new.responsavel_id is distinct from old.responsavel_id
     or new.prazo is distinct from old.prazo or new.criticidade is distinct from old.criticidade
     or new.bloqueio_motivo is distinct from old.bloqueio_motivo
     or new.bloqueio_dependencia_id is distinct from old.bloqueio_dependencia_id
     or new.aguarda_gestor_motivo is distinct from old.aguarda_gestor_motivo
     or new.destaque_manual is distinct from old.destaque_manual
     or new.precisa_distribuir is distinct from old.precisa_distribuir
     or new.movimentado_em is distinct from old.movimentado_em then
    new.movimentado_em := now();
  else
    new.movimentado_em := old.movimentado_em;
  end if;
  return new;
end $$;

-- 5) Leitura pelo responsável e por quem criou ---------------------------------------------------------------------------
-- Uma tarefa atribuída a alguém de outra área (ex.: "Tarefas gerais") precisa ser vista por quem vai executá-la.
create policy pendencias_ler_proprias on pendencias for select to authenticated
  using (usuario_ativo() and (responsavel_id = auth.uid() or criado_por = auth.uid()));

-- 6) Leitura da Central -------------------------------------------------------------------------------------------------

-- Limites vigentes (configuracoes), com os valores iniciais como reserva.
create function central_parametros() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'dias_prazo_proximo', coalesce((select (c.valor #>> '{}')::int from configuracoes c where c.chave = 'administrativo.gestao.dias_prazo_proximo'), 3),
    'dias_atraso_relevante', coalesce((select (c.valor #>> '{}')::int from configuracoes c where c.chave = 'administrativo.gestao.dias_atraso_relevante'), 5),
    'dias_bloqueio_relevante', coalesce((select (c.valor #>> '{}')::int from configuracoes c where c.chave = 'administrativo.gestao.dias_bloqueio_relevante'), 2),
    'dias_sem_movimentacao', coalesce((select (c.valor #>> '{}')::int from configuracoes c where c.chave = 'administrativo.gestao.dias_sem_movimentacao'), 5),
    'itens_por_pagina', coalesce((select (c.valor #>> '{}')::int from configuracoes c where c.chave = 'administrativo.gestao.itens_por_pagina'), 50));
$$;

-- Destaque gerencial (seção 5.3 da especificação). Fonte única: o indicador e a lista usam esta função.
-- Devolve {nivel, peso, precisa_distribuir, motivos:[{codigo, nivel, ...dados}]}; o texto é montado na tela.
-- Níveis: intervir (3) > avaliar (2) > acompanhar (1) > normal (0). `p_impede` = quantas pendências abertas
-- indicam esta como dependência do próprio bloqueio.
create function pendencia_destaque(p pendencias, p_hoje date, p_cfg jsonb, p_impede int default 0) returns jsonb
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

-- Pendências da Central, com o destaque calculado. `p_visao`:
--   'minhas' = minhas + as sem responsável dos módulos em que sou operador ou acima (como a Fila do dia);
--   'gestao' = as dos módulos em que sou gestor (admin_geral e gestor de todas as áreas: tudo) + as minhas.
-- `p_filtros` (todas as chaves opcionais): area, modulo, responsavel (uuid ou 'sem'), situacao (aberta, em_andamento,
-- bloqueada, aguarda_gestor, concluida, cancelada), prioridade, destaque, origem, prazo_de, prazo_ate (aaaa-mm-dd), busca,
-- recorte (atrasadas, hoje, intervir, aguarda_gestor, bloqueadas, distribuir) e id (uma pendência visível, qualquer status).
-- Sem situacao de encerramento, só pendências abertas. A RLS de quem chama vale (security invoker).
create function central_pendencias(p_visao text default 'minhas', p_filtros jsonb default '{}'::jsonb)
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
      join modulos m on m.codigo = p.modulo
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
       and (not p_filtros ? 'modulo' or p.modulo = p_filtros ->> 'modulo')
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
  select (b.p).id, (b.p).modulo, b.modulo_nome, b.area, b.area_nome, (b.p).titulo, (b.p).descricao, (b.p).prazo,
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

-- Indicadores (seção 5.4): sempre sobre as pendências ABERTAS da visão e dos filtros de cabeçalho. Cada recorte conta
-- a pendência uma vez; os recortes se sobrepõem e não devem ser somados (só `em_aberto` é total).
create function central_resumo(p_visao text default 'minhas', p_filtros jsonb default '{}'::jsonb)
returns table (em_aberto int, atrasadas int, vencem_hoje int, intervir int, aguarda_gestor int, bloqueadas int, distribuir int)
language sql stable security invoker set search_path = public as $$
  select count(*)::int,
         count(*) filter (where x.atrasada)::int,
         count(*) filter (where x.vence_hoje)::int,
         count(*) filter (where x.destaque = 'intervir')::int,
         count(*) filter (where x.aguarda_gestor)::int,
         count(*) filter (where x.bloqueada)::int,
         count(*) filter (where x.precisa_distribuir)::int
    from central_pendencias(p_visao, coalesce(p_filtros, '{}'::jsonb) - 'recorte' - 'situacao' - 'destaque' - 'id') x;
$$;

-- Acompanhamento da equipe (seção 7, bloco 3): por responsável, só com as pendências que quem consulta pode ver.
-- Sem nota, ranking ou rótulo: só contagens e a última movimentação.
create function central_equipe(p_filtros jsonb default '{}'::jsonb)
returns table (responsavel_id uuid, nome text, areas text, abertas int, atrasadas int, vencem_hoje int, bloqueadas int,
               aguarda_gestor int, ultima_movimentacao timestamptz)
language sql stable security invoker set search_path = public as $$
  select x.responsavel_id, max(x.responsavel_nome), string_agg(distinct x.area_nome, ', ' order by x.area_nome),
         count(*)::int,
         count(*) filter (where x.atrasada)::int,
         count(*) filter (where x.vence_hoje)::int,
         count(*) filter (where x.bloqueada)::int,
         count(*) filter (where x.aguarda_gestor)::int,
         (select max(y.movimentado_em) from pendencias y where y.responsavel_id = x.responsavel_id)
    from central_pendencias('gestao', coalesce(p_filtros, '{}'::jsonb) - 'recorte' - 'situacao' - 'destaque' - 'id' - 'responsavel') x
   where x.responsavel_id is not null
   group by x.responsavel_id
   order by max(x.responsavel_nome);
$$;

revoke all on function central_parametros() from public, anon;
revoke all on function pendencia_destaque(pendencias, date, jsonb, int) from public, anon;
revoke all on function central_pendencias(text, jsonb) from public, anon;
revoke all on function central_resumo(text, jsonb) from public, anon;
revoke all on function central_equipe(jsonb) from public, anon;
grant execute on function central_parametros() to authenticated, service_role;
grant execute on function pendencia_destaque(pendencias, date, jsonb, int) to authenticated, service_role;
grant execute on function central_pendencias(text, jsonb) to authenticated, service_role;
grant execute on function central_resumo(text, jsonb) to authenticated, service_role;
grant execute on function central_equipe(jsonb) to authenticated, service_role;
