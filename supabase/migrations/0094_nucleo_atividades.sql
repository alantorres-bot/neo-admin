-- =========================================================
-- Neo Admin — 0094 NÚCLEO: ATIVIDADES E ACESSOS DA EQUIPE (Fase 3B da Central de Gestão)
-- Especificação: docs/modulos/administrativo-gestao.md, seção 5.9.
--
-- O que cada pessoa FEZ (atividades) e VIU (acessos) no Neo Admin, para a Central de Gestão.
--  - Atividades: não se mexe nas telas nem nas funções dos módulos. Um catálogo (`atividade_regras`) traduz o que a
--    `auditoria` já grava (e as inserções em `interacoes` e `anexos`, que não passam pela auditoria) em ações de
--    gestão ("Pagou a folha de 09/2026"). Um gatilho classifica cada linha nova; `atividades_reprocessar()` classifica
--    o histórico uma vez (idempotente).
--  - Autor: quem estava logado (`auditoria.usuario_id`). Quando a gravação veio de uma Edge Function a pedido de alguém
--    (service role, sem usuário), o autor vem da coluna `*_por` do próprio registro (`autor_coluna` da regra).
--    Sem pessoa por trás (sincronização, rotina agendada), não há atividade.
--  - Acessos: telas e registros abertos, gravados pelo servidor (proxy.ts) e agrupados a cada 30 minutos. Vêm
--    DESLIGADOS (`administrativo.gestao.registrar_acessos` = false): ligar só depois de comunicar a equipe. Guardados
--    por 12 meses (exceção documentada à regra de não apagar: acesso não é prova de ação).
--  - Quem vê: cada pessoa, o que é seu; quem tem `perfis.acompanha_equipe` (só o admin liga) e o admin geral, tudo.
-- =========================================================

-- 1) Quem acompanha a equipe ------------------------------------------------------------------------------------------
alter table perfis add column acompanha_equipe boolean not null default false;
comment on column perfis.acompanha_equipe is 'Vê as atividades e os acessos de todos na Central de Gestão. Só o admin geral liga (política perfis_alterar).';

create function pode_ver_atividades(p_usuario uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select usuario_ativo() and (
    p_usuario = auth.uid()
    or eh_admin_geral()
    or exists (select 1 from perfis where id = auth.uid() and acompanha_equipe and ativo));
$$;

-- 2) Parâmetros -------------------------------------------------------------------------------------------------------
insert into configuracoes (chave, valor, descricao) values
  ('administrativo.gestao.registrar_acessos', 'false', 'Central de Gestão: grava as telas e registros que cada pessoa abre. Ligar só depois de comunicar a equipe (LGPD).'),
  ('administrativo.gestao.acessos_agrupar_minutos', '30', 'Central de Gestão: aberturas da mesma tela pela mesma pessoa dentro de N minutos contam como um acesso.'),
  ('administrativo.gestao.acessos_reter_meses', '12', 'Central de Gestão: acessos mais antigos que N meses são apagados pela rotina diária.')
on conflict (chave) do nothing;

-- 3) Catálogo ---------------------------------------------------------------------------------------------------------
-- gatilho: insert   = linha nova (com `condicao` sobre a linha, ex.: {"tipo":"confirmacao"});
--          muda_para = numa alteração, `campo` passou a valer `valor` (e antes não valia; a criação usa `insert`);
--          preenche  = `campo` saiu de vazio para preenchido.
-- `descricao` e `link` aceitam {coluna}, {coluna|data} (dd/mm/aaaa), {coluna|mes} (mm/aaaa) e {coluna|moeda}.
create table atividade_regras (
  codigo text primary key,                -- ex.: rh.folha.pagou
  nome text not null,                     -- rótulo do tipo de ação nos relatórios ("Pagou a folha")
  area text references areas(codigo),     -- vazio: a área do módulo
  modulo text references modulos(codigo), -- vazio: o módulo vem da própria linha (coluna `modulo`, ex.: pendências)
  fonte text not null check (fonte in ('auditoria', 'interacoes', 'anexos')),
  tabela text not null,
  gatilho text not null check (gatilho in ('insert', 'muda_para', 'preenche')),
  campo text,
  valor text,
  condicao jsonb,
  autor_coluna text,
  descricao text not null,
  link text,
  ativa boolean not null default true,
  check (gatilho = 'insert' or campo is not null),
  check (gatilho <> 'muda_para' or valor is not null)
);
create index idx_atividade_regras_tabela on atividade_regras (fonte, tabela) where ativa;

-- 4) Atividades -------------------------------------------------------------------------------------------------------
create table atividades (
  id bigserial primary key,
  usuario_id uuid not null references perfis(id),
  em timestamptz not null,
  area text not null references areas(codigo),
  modulo text not null references modulos(codigo),
  codigo text not null references atividade_regras(codigo),
  descricao text not null,
  referencia_tabela text not null,
  referencia_id uuid,
  link text,
  origem text not null check (origem in ('direto', 'servico_a_pedido', 'historico')),
  fonte text not null check (fonte in ('auditoria', 'interacoes', 'anexos')),
  fonte_id text not null,
  unique (fonte, fonte_id, codigo)
);
create index idx_atividades_usuario on atividades (usuario_id, em desc);
create index idx_atividades_modulo on atividades (modulo, em desc);
create index idx_atividades_ref on atividades (referencia_tabela, referencia_id);
create index if not exists idx_auditoria_usuario on auditoria (usuario_id, em);

create trigger trg_atividades_sem_delete before delete on atividades for each row execute function fn_bloquear_delete();
create function fn_atividades_imutaveis() returns trigger language plpgsql as $$
begin
  raise exception 'Atividades são registro de prova: não podem ser alteradas.';
end $$;
create trigger trg_atividades_imutaveis before update on atividades for each row execute function fn_atividades_imutaveis();

-- 5) Classificação ----------------------------------------------------------------------------------------------------
-- Troca {coluna}, {coluna|data}, {coluna|mes} e {coluna|moeda} pelos valores da linha.
create function atividade_texto(p_modelo text, p_dados jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare
  v_saida text := p_modelo;
  v_marca text[];
  v_valor text;
begin
  if p_modelo is null then return null; end if;
  for v_marca in select regexp_matches(p_modelo, '\{([a-z0-9_]+)(\|[a-z]+)?\}', 'g') loop
    v_valor := p_dados ->> v_marca[1];
    if v_valor is not null and v_marca[2] = '|data' then
      v_valor := to_char(left(v_valor, 10)::date, 'DD/MM/YYYY');
    elsif v_valor is not null and v_marca[2] = '|mes' then
      v_valor := to_char(left(v_valor, 10)::date, 'MM/YYYY');
    elsif v_valor is not null and v_marca[2] = '|moeda' then
      v_valor := 'R$ ' || replace(replace(replace(to_char(v_valor::numeric, 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', '.');
    end if;
    v_saida := replace(v_saida, '{' || v_marca[1] || coalesce(v_marca[2], '') || '}', coalesce(v_valor, '?'));
  end loop;
  return v_saida;
end $$;

-- Classifica uma gravação e registra as atividades correspondentes (nenhuma, uma ou mais regras).
create function atividade_classificar(
  p_fonte text, p_tabela text, p_acao text, p_antes jsonb, p_depois jsonb, p_usuario uuid, p_em timestamptz,
  p_fonte_id text, p_origem text
) returns int
language plpgsql security definer set search_path = public as $$
declare
  r atividade_regras;
  v_autor uuid;
  v_n int := 0;
  v_ref uuid;
  v_modulo text;
  v_area text;
begin
  if p_depois is null then return 0; end if;
  for r in select * from atividade_regras where ativa and fonte = p_fonte and tabela = p_tabela loop
    continue when r.condicao is not null and not (p_depois @> r.condicao);
    continue when r.gatilho = 'insert' and p_acao <> 'INSERT';
    continue when r.gatilho = 'muda_para' and not (
      p_acao = 'UPDATE' and p_depois ->> r.campo = r.valor and (p_antes ->> r.campo) is distinct from r.valor);
    continue when r.gatilho = 'preenche' and not (
      p_acao = 'UPDATE' and (p_antes ->> r.campo) is null and (p_depois ->> r.campo) is not null);

    v_autor := coalesce(p_usuario, case when r.autor_coluna is not null then nullif(p_depois ->> r.autor_coluna, '')::uuid end);
    continue when v_autor is null;                                   -- sem pessoa por trás: não é atividade
    continue when not exists (select 1 from perfis where id = v_autor);
    v_ref := nullif(p_depois ->> 'id', '')::uuid;
    v_modulo := coalesce(r.modulo, p_depois ->> 'modulo');
    v_area := coalesce(r.area, (select m.area from modulos m where m.codigo = v_modulo));
    continue when v_modulo is null or v_area is null;

    -- Cada regra isolada: uma regra com defeito não impede as outras nem a gravação do módulo.
    begin
      insert into atividades (usuario_id, em, area, modulo, codigo, descricao, referencia_tabela, referencia_id, link, origem, fonte, fonte_id)
      values (v_autor, p_em, v_area, v_modulo, r.codigo, left(atividade_texto(r.descricao, p_depois), 500),
              case when p_tabela in ('interacoes', 'anexos') then coalesce(p_depois ->> 'referencia_tabela', p_tabela) else p_tabela end,
              case when p_tabela in ('interacoes', 'anexos') then nullif(p_depois ->> 'referencia_id', '')::uuid else v_ref end,
              atividade_texto(r.link, p_depois),
              case when p_origem = 'historico' then 'historico' when p_usuario is null then 'servico_a_pedido' else 'direto' end,
              p_fonte, p_fonte_id)
      on conflict (fonte, fonte_id, codigo) do nothing;
      if found then v_n := v_n + 1; end if;
    exception when others then
      raise warning 'Regra de atividade % falhou: %', r.codigo, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

-- Gatilhos: classificar nunca derruba a gravação do módulo (falha vira aviso no log do banco).
create function fn_atividades_da_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform atividade_classificar('auditoria', new.tabela, new.acao, new.antes, new.depois, new.usuario_id, new.em, new.id::text, 'direto');
  exception when others then
    raise warning 'Atividade não classificada (auditoria %): %', new.id, sqlerrm;
  end;
  return null;
end $$;
create trigger trg_atividades_auditoria after insert on auditoria for each row execute function fn_atividades_da_auditoria();

create function fn_atividades_de_interacoes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform atividade_classificar('interacoes', 'interacoes', 'INSERT', null, to_jsonb(new), new.usuario_id, new.criado_em, new.id::text, 'direto');
  exception when others then
    raise warning 'Atividade não classificada (interação %): %', new.id, sqlerrm;
  end;
  return null;
end $$;
create trigger trg_atividades_interacoes after insert on interacoes for each row execute function fn_atividades_de_interacoes();

create function fn_atividades_de_anexos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform atividade_classificar('anexos', 'anexos', 'INSERT', null, to_jsonb(new), new.enviado_por, new.enviado_em, new.id::text, 'direto');
  exception when others then
    raise warning 'Atividade não classificada (anexo %): %', new.id, sqlerrm;
  end;
  return null;
end $$;
create trigger trg_atividades_anexos after insert on anexos for each row execute function fn_atividades_de_anexos();

-- Histórico: classifica o que já está gravado (uma vez; rodar de novo não duplica). Só serviço ou admin geral.
-- Em produção: `select atividades_reprocessar();` depois de aplicar esta migration (ver docs/PUBLICACAO.md).
create function atividades_reprocessar() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int := 0;
  a record;
begin
  if auth.uid() is not null and not eh_admin_geral() then
    raise exception 'Somente o administrador geral reprocessa o histórico de atividades.';
  end if;
  for a in select x.* from auditoria x
            where x.tabela in (select distinct tabela from atividade_regras where ativa and fonte = 'auditoria')
            order by x.id loop
    v_n := v_n + atividade_classificar('auditoria', a.tabela, a.acao, a.antes, a.depois, a.usuario_id, a.em, a.id::text, 'historico');
  end loop;
  for a in select i.* from interacoes i order by i.criado_em loop
    v_n := v_n + atividade_classificar('interacoes', 'interacoes', 'INSERT', null, to_jsonb(a), a.usuario_id, a.criado_em, a.id::text, 'historico');
  end loop;
  for a in select x.* from anexos x order by x.enviado_em loop
    v_n := v_n + atividade_classificar('anexos', 'anexos', 'INSERT', null, to_jsonb(a), a.enviado_por, a.enviado_em, a.id::text, 'historico');
  end loop;
  return v_n;
end $$;

-- 6) Acessos ----------------------------------------------------------------------------------------------------------
create table acessos (
  id bigserial primary key,
  usuario_id uuid not null references perfis(id),
  rota text not null,
  area text references areas(codigo),
  modulo text references modulos(codigo),
  referencia_id uuid,
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  vezes int not null default 1
);
create index idx_acessos_usuario on acessos (usuario_id, ultimo_em desc);
create index idx_acessos_ultimo on acessos (ultimo_em);

-- Chamada pelo servidor (proxy.ts) em cada navegação de quem está logado. Não faz nada com o registro desligado.
create function registrar_acesso(p_rota text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  v_rota text := left(coalesce(p_rota, ''), 300);
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
  v_janela := coalesce((select (valor #>> '{}')::int from configuracoes where chave = 'administrativo.gestao.acessos_agrupar_minutos'), 30);

  v_partes := string_to_array(split_part(v_rota, '?', 1), '/');
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

-- Retenção: apaga acessos mais antigos que o prazo. Só serviço (rotina diária) ou admin geral.
create function acessos_limpar() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_meses int := coalesce((select (valor #>> '{}')::int from configuracoes where chave = 'administrativo.gestao.acessos_reter_meses'), 12);
  v_n int;
begin
  if auth.uid() is not null and not eh_admin_geral() then
    raise exception 'Somente o administrador geral limpa os acessos.';
  end if;
  delete from acessos where ultimo_em < now() - make_interval(months => v_meses);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Rotina diária da retenção (só onde há pg_cron; os testes em PGlite não têm).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('nucleo-acessos-retencao-diaria', '30 7 * * *', 'select public.acessos_limpar()');
  end if;
end $$;

-- 7) RLS: leitura por quem pode ver; ninguém grava diretamente (só as funções acima) -------------------------------
alter table atividade_regras enable row level security;
alter table atividades enable row level security;
alter table acessos enable row level security;
create policy atividade_regras_ler on atividade_regras for select to authenticated using (usuario_ativo());
create policy atividade_regras_admin on atividade_regras for all to authenticated using (eh_admin_geral()) with check (eh_admin_geral());
create policy atividades_ler on atividades for select to authenticated using (pode_ver_atividades(usuario_id));
create policy acessos_ler on acessos for select to authenticated using (pode_ver_atividades(usuario_id));
create trigger trg_aud_atividade_regras after insert or update or delete on atividade_regras for each row execute function fn_auditoria();

-- 8) Relatórios -------------------------------------------------------------------------------------------------------
-- Resumo por pessoa no período (datas de Cuiabá). Só pessoas que quem consulta pode ver. As pendências concluídas
-- vêm da própria tabela (concluído por, no prazo × depois do prazo, tempo até concluir).
create function atividades_resumo(p_de date, p_ate date)
returns table (usuario_id uuid, nome text, acoes int, dias_com_atividade int, por_tipo jsonb, concluidas int,
               concluidas_no_prazo int, concluidas_apos_prazo int, horas_ate_concluir numeric, ultimo_acesso timestamptz,
               ultima_atividade timestamptz)
language sql stable security definer set search_path = public as $$
  with pessoas as (
    select p.id, p.nome from perfis p where p.ativo and pode_ver_atividades(p.id)
  ),
  atv as (
    select a.* from atividades a join pessoas x on x.id = a.usuario_id
     where (a.em at time zone 'America/Cuiaba')::date between p_de and p_ate
  ),
  por_codigo as (
    select a.usuario_id, a.codigo, count(*)::int n from atv a group by 1, 2
  ),
  pend as (
    select pd.concluido_por usuario_id, count(*)::int n,
           count(*) filter (where pd.prazo is not null and (pd.concluido_em at time zone 'America/Cuiaba')::date <= pd.prazo)::int no_prazo,
           count(*) filter (where pd.prazo is not null and (pd.concluido_em at time zone 'America/Cuiaba')::date > pd.prazo)::int apos,
           round(avg(extract(epoch from pd.concluido_em - pd.criado_em) / 3600)::numeric, 1) horas
      from pendencias pd join pessoas x on x.id = pd.concluido_por
     where pd.status = 'concluida' and (pd.concluido_em at time zone 'America/Cuiaba')::date between p_de and p_ate
     group by 1
  )
  select x.id, x.nome,
         coalesce((select count(*)::int from atv a where a.usuario_id = x.id), 0),
         coalesce((select count(distinct (a.em at time zone 'America/Cuiaba')::date)::int from atv a where a.usuario_id = x.id), 0),
         coalesce((select jsonb_object_agg(c.codigo, c.n) from por_codigo c where c.usuario_id = x.id), '{}'::jsonb),
         coalesce(pd.n, 0), coalesce(pd.no_prazo, 0), coalesce(pd.apos, 0), pd.horas,
         (select max(ac.ultimo_em) from acessos ac where ac.usuario_id = x.id),
         (select max(a.em) from atividades a where a.usuario_id = x.id)
    from pessoas x left join pend pd on pd.usuario_id = x.id
   order by x.nome;
$$;

-- Linha do tempo: atividades e (opcional) acessos de uma pessoa, ou de um registro (processo), em ordem decrescente.
create function atividades_linha_do_tempo(p_usuario uuid default null, p_de date default null, p_ate date default null,
  p_acessos boolean default true, p_referencia uuid default null, p_modulo text default null)
returns table (tipo text, em timestamptz, usuario_id uuid, nome text, area text, modulo text, codigo text, acao text,
               descricao text, link text, origem text, vezes int, referencia_tabela text, referencia_id uuid)
language sql stable security invoker set search_path = public as $$
  select 'atividade', a.em, a.usuario_id, p.nome, a.area, a.modulo, a.codigo, r.nome, a.descricao, a.link, a.origem, 1,
         a.referencia_tabela, a.referencia_id
    from atividades a join perfis p on p.id = a.usuario_id join atividade_regras r on r.codigo = a.codigo
   where (p_usuario is null or a.usuario_id = p_usuario)
     and (p_referencia is null or a.referencia_id = p_referencia)
     and (p_modulo is null or a.modulo = p_modulo)
     and (p_de is null or (a.em at time zone 'America/Cuiaba')::date >= p_de)
     and (p_ate is null or (a.em at time zone 'America/Cuiaba')::date <= p_ate)
  union all
  select 'acesso', ac.ultimo_em, ac.usuario_id, p.nome, ac.area, ac.modulo, null, 'Acessou', ac.rota, ac.rota, null, ac.vezes,
         null, ac.referencia_id
    from acessos ac join perfis p on p.id = ac.usuario_id
   where p_acessos
     and (p_usuario is null or ac.usuario_id = p_usuario)
     and (p_referencia is null or ac.referencia_id = p_referencia)
     and (p_modulo is null or ac.modulo = p_modulo)
     and (p_de is null or (ac.ultimo_em at time zone 'America/Cuiaba')::date >= p_de)
     and (p_ate is null or (ac.ultimo_em at time zone 'America/Cuiaba')::date <= p_ate);
$$;

revoke all on function pode_ver_atividades(uuid) from public, anon;
revoke all on function atividade_texto(text, jsonb) from public, anon;
revoke all on function atividade_classificar(text, text, text, jsonb, jsonb, uuid, timestamptz, text, text) from public, anon, authenticated;
revoke all on function atividades_reprocessar() from public, anon;
revoke all on function registrar_acesso(text) from public, anon;
revoke all on function acessos_limpar() from public, anon;
revoke all on function atividades_resumo(date, date) from public, anon;
revoke all on function atividades_linha_do_tempo(uuid, date, date, boolean, uuid, text) from public, anon;
grant execute on function pode_ver_atividades(uuid) to authenticated, service_role;
grant execute on function atividade_texto(text, jsonb) to authenticated, service_role;
grant execute on function atividade_classificar(text, text, text, jsonb, jsonb, uuid, timestamptz, text, text) to service_role;
grant execute on function atividades_reprocessar() to authenticated, service_role;
grant execute on function registrar_acesso(text) to authenticated;
grant execute on function acessos_limpar() to authenticated, service_role;
grant execute on function atividades_resumo(date, date) to authenticated, service_role;
grant execute on function atividades_linha_do_tempo(uuid, date, date, boolean, uuid, text) to authenticated, service_role;
revoke insert, update, delete on atividades, acessos from authenticated, anon;

-- 9) CATÁLOGO INICIAL (seção 5.9) ---------------------------------------------------------------------------------------
-- Núcleo: pendências e tarefas da Central. Cada área registra as regras das próprias tabelas na sua faixa de migrations
-- (financeiro 0179, fiscal 0207, RH 0522): o núcleo não conhece as tabelas internas dos módulos.
insert into atividade_regras (codigo, nome, area, modulo, fonte, tabela, gatilho, campo, valor, condicao, autor_coluna, descricao, link) values
  ('nucleo.tarefa.criou', 'Criou tarefa', null, null, 'auditoria', 'pendencias', 'insert', null, null, '{"origem":"manual"}', 'criado_por',
   'Criou a tarefa "{titulo}"', '/gestao/{id}'),
  ('nucleo.pendencia.concluiu', 'Concluiu pendência', null, null, 'auditoria', 'pendencias', 'muda_para', 'status', 'concluida', null, 'concluido_por',
   'Concluiu "{titulo}"', '/gestao/{id}'),
  ('nucleo.tarefa.cancelou', 'Cancelou tarefa', null, null, 'auditoria', 'pendencias', 'muda_para', 'status', 'cancelada', '{"origem":"manual"}', null,
   'Cancelou a tarefa "{titulo}"', '/gestao/{id}'),
  ('nucleo.pendencia.bloqueou', 'Registrou bloqueio', null, null, 'auditoria', 'pendencias', 'preenche', 'bloqueada_em', null, null, 'bloqueada_por',
   'Bloqueou "{titulo}": {bloqueio_motivo}', '/gestao/{id}'),
  ('nucleo.pendencia.pediu_decisao', 'Pediu decisão do gestor', null, null, 'auditoria', 'pendencias', 'preenche', 'aguarda_gestor_em', null, null, 'aguarda_gestor_por',
   'Pediu decisão em "{titulo}": {aguarda_gestor_motivo}', '/gestao/{id}'),
  ('nucleo.pendencia.comentou', 'Comentou pendência', null, null, 'interacoes', 'interacoes', 'insert', null, null, '{"referencia_tabela":"pendencias","tipo":"comentario"}', null,
   'Comentou: {descricao}', '/gestao/{referencia_id}'),
  ('nucleo.pendencia.cobrou', 'Cobrou andamento', null, null, 'interacoes', 'interacoes', 'insert', null, null, '{"referencia_tabela":"pendencias","tipo":"cobranca_gestor"}', null,
   'Cobrou andamento: {descricao}', '/gestao/{referencia_id}'),
  ('nucleo.pendencia.decidiu', 'Respondeu decisão', null, null, 'interacoes', 'interacoes', 'insert', null, null, '{"referencia_tabela":"pendencias","tipo":"resposta_gestor"}', null,
   'Respondeu ao pedido de decisão: {descricao}', '/gestao/{referencia_id}');
