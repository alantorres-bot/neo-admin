-- =========================================================
-- Neo Admin — 0526 RH/SST > Portal do Líder
-- Especificação: docs/modulos/rh-portal-lider.md.
--  - O líder entra com a conta Google da empresa (usuário comum, SEM acesso à área RH) e vê só o(s) setor(es) que lidera
--    (rh_ld_lideres, mantido pelo gestor do RH). Isso muda a decisão da 0517 só para o portal: os links do Ponto e da
--    Bonificação continuam valendo, e o portal só os lista.
--  - Tudo o que o líder lê ou grava passa por funções security definer rh_ld_* que conferem a liderança. Sem salário,
--    sem dados bancários (LGPD).
--  - Pedidos (férias, função/salário, desligamento, atestado, contratação) numa tabela só: tipo + dados jsonb. Cada pedido
--    abre uma pendência do RH (módulo rh.portal_lider); o RH atende (em andamento, concluída ou recusada) com resposta.
--  - Nenhuma regra trabalhista calculada aqui (saldo de férias, dobra): o RH responde no pedido.
--  - Atestado: anexo no caminho rh.portal_lider/rh_ld_solicitacoes/<id>/…, só para o líder do setor do pedido.
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('rh.portal_lider', 'rh', 'Portal do Líder', true)
  on conflict (codigo) do update set ativo = true, nome = excluded.nome;

-- 1) Tabelas ---------------------------------------------------------------------------------------------------------------
create table rh_ld_lideres (
  id uuid primary key default gen_random_uuid(),
  setor_id uuid not null references rh_pt_setores(id),
  perfil_id uuid not null references perfis(id),
  criado_por uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (setor_id, perfil_id)
);
comment on table rh_ld_lideres is 'Quem lidera cada setor no Portal do Líder (usuário da plataforma). Uma pessoa pode liderar mais de um setor.';
create trigger trg_aud_rh_ld_lideres after insert or update or delete on rh_ld_lideres for each row execute function fn_auditoria();

create table rh_ld_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  setor_id uuid not null references rh_pt_setores(id),
  colaborador_id uuid references rh_colaboradores(id),
  tipo text not null check (tipo in ('ferias', 'funcao', 'desligamento', 'atestado', 'contratacao')),
  dados jsonb not null default '{}' check (jsonb_typeof(dados) = 'object' and length(dados::text) <= 4000),
  status text not null default 'enviada' check (status in ('enviada', 'em_andamento', 'concluida', 'recusada', 'cancelada')),
  resposta text,
  criado_por uuid not null references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  atendido_por uuid references perfis(id), atendido_em timestamptz,
  check ((tipo = 'contratacao') = (colaborador_id is null))
);
comment on table rh_ld_solicitacoes is 'Pedidos do líder ao RH pelo Portal do Líder. Não se apagam: mudam de status.';
create index idx_rh_ld_solicitacoes_setor on rh_ld_solicitacoes (setor_id, criado_em desc);
create trigger trg_rh_ld_solicitacoes_sem_delete before delete on rh_ld_solicitacoes for each row execute function fn_bloquear_delete();
create trigger trg_aud_rh_ld_solicitacoes after insert or update on rh_ld_solicitacoes for each row execute function fn_auditoria();

-- 2) Liderança -------------------------------------------------------------------------------------------------------------
create function rh_ld_lidera(p_setor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and acesso_liberado(auth.uid())
     and exists (select 1 from rh_ld_lideres l join rh_pt_setores s on s.id = l.setor_id and s.ativo
                  where l.setor_id = p_setor and l.perfil_id = auth.uid())
$$;
revoke all on function rh_ld_lidera(uuid) from public, anon;

alter table rh_ld_lideres enable row level security;
alter table rh_ld_solicitacoes enable row level security;
create policy rh_ld_lideres_ler on rh_ld_lideres for select to authenticated using (tem_acesso_area('rh'));
create policy rh_ld_solicitacoes_ler on rh_ld_solicitacoes for select to authenticated using (tem_acesso_area('rh') or rh_ld_lidera(setor_id));
-- Sem insert/update/delete direto: tudo pelas funções abaixo.

create function rh_ld_rotulo_tipo(p_tipo text) returns text
language sql immutable as $$
  select case p_tipo when 'ferias' then 'Férias' when 'funcao' then 'Alteração de função/salário' when 'desligamento' then 'Desligamento'
                     when 'atestado' then 'Atestado' when 'contratacao' then 'Contratação' else p_tipo end
$$;

-- Campos obrigatórios de cada tipo (o formulário valida o resto; aqui é a trava mínima).
create function rh_ld_campos_obrigatorios(p_tipo text) returns text[]
language sql immutable as $$
  select case p_tipo
    when 'ferias' then array['inicio', 'dias']
    when 'funcao' then array['funcao_nova', 'vigencia', 'motivo']
    when 'desligamento' then array['iniciativa', 'aviso', 'data', 'motivo']
    when 'atestado' then array['inicio', 'fim']
    when 'contratacao' then array['nome', 'cargo', 'salario', 'data_prevista']
  end
$$;

-- 3) RH ----------------------------------------------------------------------------------------------------------------------
-- Substitui os líderes do setor pela lista (vazia = ninguém).
create function rh_ld_definir_lideres(p_setor uuid, p_perfis uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rh_exigir('gestor');
  if not exists (select 1 from rh_pt_setores where id = p_setor) then raise exception 'Setor não encontrado.'; end if;
  if exists (select 1 from unnest(coalesce(p_perfis, '{}')) x(id) where not exists (select 1 from perfis p where p.id = x.id and p.ativo)) then
    raise exception 'Usuário não encontrado ou inativo.';
  end if;
  delete from rh_ld_lideres where setor_id = p_setor and perfil_id <> all (coalesce(p_perfis, '{}'));
  insert into rh_ld_lideres (setor_id, perfil_id) select p_setor, x from unnest(coalesce(p_perfis, '{}')) x on conflict do nothing;
end $$;

-- Atende o pedido: em_andamento, concluida ou recusada (recusa exige resposta). Mexe na pendência junto.
create function rh_ld_atender(p_id uuid, p_status text, p_resposta text) returns void
language plpgsql security definer set search_path = public as $$
declare
  s rh_ld_solicitacoes;
begin
  perform rh_exigir('operador');
  if p_status not in ('em_andamento', 'concluida', 'recusada') then raise exception 'Situação inválida.'; end if;
  if p_status = 'recusada' and coalesce(trim(p_resposta), '') = '' then raise exception 'Informe ao líder o motivo da recusa.'; end if;
  select * into s from rh_ld_solicitacoes where id = p_id for update;
  if s.id is null then raise exception 'Pedido não encontrado.'; end if;
  if s.status not in ('enviada', 'em_andamento') then raise exception 'Não é possível: o pedido está "%".', s.status; end if;
  update rh_ld_solicitacoes set status = p_status, resposta = coalesce(nullif(trim(p_resposta), ''), resposta),
         atendido_por = auth.uid(), atendido_em = now() where id = p_id;
  update pendencias set status = case p_status when 'em_andamento' then 'em_andamento' when 'concluida' then 'concluida' else 'cancelada' end::status_pendencia,
         concluido_em = case when p_status <> 'em_andamento' then now() end
   where modulo = 'rh.portal_lider' and referencia_tabela = 'rh_ld_solicitacoes' and referencia_id = p_id and status in ('aberta', 'em_andamento');
end $$;

revoke all on function rh_ld_definir_lideres(uuid, uuid[]) from public, anon;
revoke all on function rh_ld_atender(uuid, text, text) from public, anon;

-- 4) Líder -------------------------------------------------------------------------------------------------------------------
create function rh_ld_meus_setores() returns table (id uuid, nome text)
language sql stable security definer set search_path = public as $$
  select s.id, s.nome from rh_pt_setores s
   where s.ativo and acesso_liberado(auth.uid()) and exists (select 1 from rh_ld_lideres l where l.setor_id = s.id and l.perfil_id = auth.uid())
   order by s.nome
$$;

-- Equipe ativa do setor: nome, função, admissão e banco de horas. Sem salário nem dados bancários (LGPD).
create function rh_ld_equipe(p_setor uuid) returns table (
  id uuid, nome text, funcao text, data_admissao date, saldo_min int, vencido_min int, proximo_vencimento date
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not rh_ld_lidera(p_setor) then raise exception 'Você não é líder deste setor.'; end if;
  return query
    select c.id, c.nome, c.funcao, c.data_admissao, b.saldo_min, (coalesce(b.pagar_min, 0) + coalesce(b.descontar_min, 0))::int, b.proximo_vencimento
      from rh_bo_pessoas_do_setor(p_setor) c
      left join lateral (select * from rh_bh_saldos x where x.colaborador_id = c.id limit 1) b on true
     order by c.nome;
end $$;

-- Lotes do Ponto e da Bonificação que estão com o líder (o portal abre os links que já existem).
create function rh_ld_lotes_abertos(p_setor uuid) returns table (tipo text, id uuid, rotulo text, prazo date, chave text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not rh_ld_lidera(p_setor) then raise exception 'Você não é líder deste setor.'; end if;
  return query
    select 'ponto'::text, l.id, 'Ponto ' || to_char(l.periodo_inicio, 'DD/MM') || ' a ' || to_char(l.periodo_fim, 'DD/MM/YYYY'), l.prazo, l.chave
      from rh_pt_lotes l where l.setor_id = p_setor and l.status in ('enviado', 'devolvido')
    union all
    select 'bonificacao'::text, b.id, 'Bonificação ' || to_char(b.competencia, 'MM/YYYY'), null::date, b.chave
      from rh_bo_lotes b where b.setor_id = p_setor and b.status in ('enviado', 'devolvido')
    order by 4 nulls last, 3;
end $$;

create function rh_ld_solicitar(p_setor uuid, p_colaborador uuid, p_tipo text, p_dados jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_quem text;
  v_falta text;
begin
  if not rh_ld_lidera(p_setor) then raise exception 'Você não é líder deste setor.'; end if;
  if rh_ld_campos_obrigatorios(p_tipo) is null then raise exception 'Tipo de pedido inválido.'; end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' or length(p_dados::text) > 4000 then raise exception 'Dados do pedido inválidos.'; end if;
  select string_agg(k, ', ') into v_falta from unnest(rh_ld_campos_obrigatorios(p_tipo)) k where coalesce(trim(p_dados ->> k), '') = '';
  if v_falta is not null then raise exception 'Preencha: %.', v_falta; end if;
  if p_tipo = 'contratacao' then
    if p_colaborador is not null then raise exception 'Contratação não tem funcionário: informe o nome nos dados.'; end if;
    v_quem := trim(p_dados ->> 'nome');
  else
    select c.nome into v_quem from rh_bo_pessoas_do_setor(p_setor) c where c.id = p_colaborador;
    if v_quem is null then raise exception 'Funcionário não é do seu setor (ou está inativo).'; end if;
  end if;
  insert into rh_ld_solicitacoes (setor_id, colaborador_id, tipo, dados) values (p_setor, p_colaborador, p_tipo, p_dados) returning id into v_id;
  insert into pendencias (modulo, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
  values ('rh.portal_lider', 'Pedido do líder: ' || rh_ld_rotulo_tipo(p_tipo) || ' — ' || left(v_quem, 80) || ' (' || (select nome from rh_pt_setores where id = p_setor) || ')',
          'Enviado por ' || coalesce((select nome from perfis where id = auth.uid()), 'líder') || ' pelo Portal do Líder: conferir e responder.',
          (now() at time zone 'America/Cuiaba')::date, 'normal', 'rh_ld_solicitacoes', v_id, '/rh/portal_lider/' || v_id)
  on conflict do nothing;
  return v_id;
end $$;

-- Pedidos do setor com o nome da pessoa (o líder não lê rh_colaboradores).
create function rh_ld_pedidos(p_setor uuid) returns table (
  id uuid, tipo text, status text, dados jsonb, resposta text, pessoa text, criado_em timestamptz, atendido_em timestamptz, anexos int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not rh_ld_lidera(p_setor) then raise exception 'Você não é líder deste setor.'; end if;
  return query
    select s.id, s.tipo, s.status, s.dados, s.resposta, coalesce(c.nome, s.dados ->> 'nome'), s.criado_em, s.atendido_em,
           (select count(*)::int from anexos a where a.referencia_tabela = 'rh_ld_solicitacoes' and a.referencia_id = s.id)
      from rh_ld_solicitacoes s left join rh_colaboradores c on c.id = s.colaborador_id
     where s.setor_id = p_setor order by s.criado_em desc limit 200;
end $$;

-- O líder desiste do pedido enquanto o RH ainda não começou.
create function rh_ld_cancelar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s rh_ld_solicitacoes;
begin
  select * into s from rh_ld_solicitacoes where id = p_id for update;
  if s.id is null or not rh_ld_lidera(s.setor_id) then raise exception 'Pedido não encontrado.'; end if;
  if s.status <> 'enviada' then raise exception 'O RH já começou a tratar este pedido: fale com o RH.'; end if;
  update rh_ld_solicitacoes set status = 'cancelada' where id = p_id;
  update pendencias set status = 'cancelada'
   where modulo = 'rh.portal_lider' and referencia_tabela = 'rh_ld_solicitacoes' and referencia_id = p_id and status in ('aberta', 'em_andamento');
end $$;

revoke all on function rh_ld_meus_setores() from public, anon;
revoke all on function rh_ld_equipe(uuid) from public, anon;
revoke all on function rh_ld_lotes_abertos(uuid) from public, anon;
revoke all on function rh_ld_solicitar(uuid, uuid, text, jsonb) from public, anon;
revoke all on function rh_ld_cancelar(uuid) from public, anon;
revoke all on function rh_ld_pedidos(uuid) from public, anon;
grant execute on function rh_ld_lidera(uuid), rh_ld_meus_setores(), rh_ld_equipe(uuid), rh_ld_lotes_abertos(uuid),
  rh_ld_solicitar(uuid, uuid, text, jsonb), rh_ld_cancelar(uuid), rh_ld_pedidos(uuid) to authenticated;

-- 5) Anexo do pedido (atestado) ---------------------------------------------------------------------------------------------
-- O RH lê pelas políticas que já existem (tem_acesso_modulo). O líder envia e lê só no caminho de um pedido do seu setor.
create function rh_ld_pode_anexo(p_tabela text, p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_tabela = 'rh_ld_solicitacoes'
     and exists (select 1 from rh_ld_solicitacoes s where s.id::text = p_id and rh_ld_lidera(s.setor_id))
$$;
revoke all on function rh_ld_pode_anexo(text, text) from public, anon;
grant execute on function rh_ld_pode_anexo(text, text) to authenticated;

create policy anexos_ler_lider on anexos for select to authenticated
  using (modulo = 'rh.portal_lider' and rh_ld_pode_anexo(referencia_tabela, referencia_id::text));
create policy anexos_inserir_lider on anexos for insert to authenticated
  with check (modulo = 'rh.portal_lider' and enviado_por = auth.uid() and rh_ld_pode_anexo(referencia_tabela, referencia_id::text)
              and arquivo_path like 'rh.portal_lider/rh_ld_solicitacoes/' || referencia_id::text || '/%');
create policy anexos_storage_ler_lider on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = 'rh.portal_lider'
         and rh_ld_pode_anexo((storage.foldername(name))[2], (storage.foldername(name))[3]));
create policy anexos_storage_enviar_lider on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and (storage.foldername(name))[1] = 'rh.portal_lider'
              and rh_ld_pode_anexo((storage.foldername(name))[2], (storage.foldername(name))[3]));
