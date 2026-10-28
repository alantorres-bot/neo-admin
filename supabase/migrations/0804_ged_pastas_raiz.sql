-- =========================================================
-- Neo Admin — 0804 GED A1a: cadastro persistente das pastas-raiz (especificação 5.2, 5.11.1, 5.11.2, seções 8 e 9)
--
--  - Só as duas raízes confirmadas em 25/10/2026 (seção 2.2): elaboração = 02 - CONTRATOS; dossiê = 01 - CLIENTES. A ALUTEC fica
--    fora. Outra raiz exige migration (check da tabela).
--  - Proteção por coluna (GED PENDENTE 17, mecanismo aprovado na A0): nenhum acesso direto de anon/authenticated à tabela; leitura só
--    pela projeção ged_raizes() (colunas autorizadas, linhas de ged_pode_ler_raiz); gravação só por funções que conferem o admin geral.
--  - Trava da elaboração (5.11.1): finalidade elaboracao => área e operação contratos, sem areas_leitura. Check na tabela: nem a
--    função de configuração nem o admin geral mudam isso.
--  - PENDENTE 14 (nível mínimo na elaboração) em aberto: ged_pode_ler_raiz exige `operador` em Contratos, o mais restritivo das
--    duas opções, até a decisão. PENDENTE 2 (áreas do dossiê) em aberto: o admin geral informa as áreas no cadastro; sem padrão.
--  - PENDENTE 13 (efêmera): a tabela não tem a coluna `verificacao`; nada da árvore é gravado. Ativar exige verificação `ok` auditada.
--  - Auditoria explícita nas funções (sem trigger: page_token e indexada_em serão reescritos pela indexação, 5.3).
-- =========================================================

create table ged_pastas_raiz (
  id uuid primary key default gen_random_uuid(),
  drive_id text not null unique,
  drive_compartilhado_id text,
  nome text not null check (btrim(nome) <> ''),
  finalidade text not null check (finalidade in ('elaboracao', 'dossie_cliente', 'tematica')),
  area text not null references areas(codigo),
  areas_leitura text[] not null default '{}',
  area_operacao text not null references areas(codigo),
  situacao text not null default 'em_verificacao' check (situacao in ('em_verificacao', 'ativa', 'inativa')),
  verificada_por uuid references perfis(id),
  verificada_em timestamptz,
  page_token text,                                                  -- A1b (indexação)
  indexada_em timestamptz,
  reconciliada_em timestamptz,
  criada_por uuid not null references perfis(id),
  criada_em timestamptz not null default now(),
  -- Raízes confirmadas (2.2), cada uma com a sua finalidade.
  constraint ged_pastas_raiz_confirmadas check (
    (drive_id = '1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR' and finalidade = 'elaboracao')
    or (drive_id = '1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak' and finalidade = 'dossie_cliente')),
  -- 5.11.1: trava da elaboração.
  constraint ged_pastas_raiz_elaboracao_travada check (
    finalidade <> 'elaboracao' or (area = 'contratos' and area_operacao = 'contratos' and cardinality(areas_leitura) = 0))
);
alter table ged_pastas_raiz enable row level security;                -- sem políticas: só as funções abaixo
revoke all on ged_pastas_raiz from anon, authenticated;
create trigger trg_ged_pastas_raiz_sem_delete before delete on ged_pastas_raiz for each row execute function fn_bloquear_delete();

create function fn_ged_pastas_raiz_imutavel() returns trigger language plpgsql as $$
begin
  if new.drive_id is distinct from old.drive_id or new.finalidade is distinct from old.finalidade
     or new.criada_por is distinct from old.criada_por or new.criada_em is distinct from old.criada_em then
    raise exception 'ged:raiz_imutavel';
  end if;
  return new;
end $$;
create trigger trg_ged_pastas_raiz_imutavel before update on ged_pastas_raiz for each row execute function fn_ged_pastas_raiz_imutavel();

-- Áreas válidas: dona e operação têm FK; as de leitura são conferidas aqui (sem repetir a dona).
create function ged_areas_validas(p_area text, p_areas_leitura text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from unnest(coalesce(p_areas_leitura, '{}')) a
                      where a is null or a = p_area or not exists (select 1 from areas where codigo = a))
     and cardinality(coalesce(p_areas_leitura, '{}')) = (select count(distinct a) from unnest(coalesce(p_areas_leitura, '{}')) a);
$$;
revoke all on function ged_areas_validas(text, text[]) from public, anon, authenticated, service_role;

-- 5.11.2: a função de acesso usada por todas as políticas do GED.
create function ged_pode_ler_raiz(p_raiz uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select eh_admin_geral() or exists (
    select 1 from ged_pastas_raiz r
     where r.id = p_raiz
       and case when r.finalidade = 'elaboracao' then tem_acesso_area('contratos', 'operador')   -- PENDENTE 14: o mais restritivo
                else tem_acesso_area(r.area) or exists (select 1 from unnest(r.areas_leitura) a where tem_acesso_area(a)) end);
$$;
revoke all on function ged_pode_ler_raiz(uuid) from public, anon, authenticated, service_role;
grant execute on function ged_pode_ler_raiz(uuid) to authenticated;

-- Projeção (seção 9): só id, nome, finalidade, áreas e situação, das raízes que a pessoa lê. page_token e datas técnicas nunca saem.
create function ged_raizes()
returns table (id uuid, nome text, finalidade text, area text, areas_leitura text[], area_operacao text, situacao text)
language sql stable security definer set search_path = public as $$
  select r.id, r.nome, r.finalidade, r.area, r.areas_leitura, r.area_operacao, r.situacao
    from ged_pastas_raiz r
   where ged_pode_ler_raiz(r.id)
   order by r.finalidade, r.nome;
$$;
revoke all on function ged_raizes() from public, anon, authenticated, service_role;
grant execute on function ged_raizes() to authenticated;

-- Cadastro (Edge Function, depois do files.get com a conta conectada, 5.2.2): nasce em_verificacao. A finalidade vem do ID (2.2).
create function ged_cadastrar_raiz(p_perfil uuid, p_drive_id text, p_nome text, p_drive_compartilhado_id text,
                                   p_area text, p_areas_leitura text[], p_area_operacao text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_finalidade text;
  v_id uuid;
begin
  if not ged_perfil_admin(p_perfil) then
    raise exception 'ged:sem_permissao';
  end if;
  v_finalidade := case p_drive_id when '1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR' then 'elaboracao'
                                  when '1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak' then 'dossie_cliente' end;
  if v_finalidade is null then
    raise exception 'ged:raiz_invalida';
  end if;
  if v_finalidade = 'elaboracao' and (p_area is distinct from 'contratos' or p_area_operacao is distinct from 'contratos'
                                      or cardinality(coalesce(p_areas_leitura, '{}')) > 0) then
    raise exception 'ged:raiz_travada';
  end if;
  if p_area is null or p_area_operacao is null or not ged_areas_validas(p_area, p_areas_leitura)
     or not exists (select 1 from areas where codigo = p_area) or not exists (select 1 from areas where codigo = p_area_operacao) then
    raise exception 'ged:area_invalida';
  end if;
  if exists (select 1 from ged_pastas_raiz where drive_id = p_drive_id) then
    raise exception 'ged:raiz_existente';
  end if;
  insert into ged_pastas_raiz (drive_id, drive_compartilhado_id, nome, finalidade, area, areas_leitura, area_operacao, criada_por)
  values (p_drive_id, nullif(btrim(p_drive_compartilhado_id), ''), btrim(p_nome), v_finalidade, p_area,
          coalesce(p_areas_leitura, '{}'), p_area_operacao, p_perfil)
  returning id into v_id;
  insert into auditoria (tabela, registro_id, acao, depois, usuario_id)
  values ('ged_pastas_raiz', v_id, 'cadastrou', jsonb_build_object('drive_id', p_drive_id, 'finalidade', v_finalidade, 'area', p_area,
          'areas_leitura', coalesce(p_areas_leitura, '{}'), 'area_operacao', p_area_operacao), p_perfil);
  return v_id;
end $$;
revoke all on function ged_cadastrar_raiz(uuid, text, text, text, text, text[], text) from public, anon, authenticated, service_role;
grant execute on function ged_cadastrar_raiz(uuid, text, text, text, text, text[], text) to service_role;

-- Áreas (admin geral logado). A elaboração é recusada aqui e pelo check da tabela (5.11.1).
create function ged_definir_areas_raiz(p_raiz uuid, p_area text, p_areas_leitura text[], p_area_operacao text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r ged_pastas_raiz%rowtype;
begin
  if not eh_admin_geral() then
    raise exception 'ged:sem_permissao';
  end if;
  select * into r from ged_pastas_raiz where id = p_raiz for update;
  if not found then
    raise exception 'ged:nao_encontrada';
  end if;
  if r.finalidade = 'elaboracao' then
    raise exception 'ged:raiz_travada';
  end if;
  if p_area is null or p_area_operacao is null or not ged_areas_validas(p_area, p_areas_leitura)
     or not exists (select 1 from areas where codigo = p_area) or not exists (select 1 from areas where codigo = p_area_operacao) then
    raise exception 'ged:area_invalida';
  end if;
  update ged_pastas_raiz set area = p_area, areas_leitura = coalesce(p_areas_leitura, '{}'), area_operacao = p_area_operacao
   where id = p_raiz;
  insert into auditoria (tabela, registro_id, acao, antes, depois, usuario_id)
  values ('ged_pastas_raiz', p_raiz, 'definiu_areas',
          jsonb_build_object('area', r.area, 'areas_leitura', r.areas_leitura, 'area_operacao', r.area_operacao),
          jsonb_build_object('area', p_area, 'areas_leitura', coalesce(p_areas_leitura, '{}'), 'area_operacao', p_area_operacao),
          auth.uid());
end $$;
revoke all on function ged_definir_areas_raiz(uuid, text, text[], text) from public, anon, authenticated, service_role;
grant execute on function ged_definir_areas_raiz(uuid, text, text[], text) to authenticated;

-- Situação (8.1): em_verificacao -> ativa (exige verificação `ok` auditada da mesma pasta, 5.2.4); ativa <-> inativa.
create function ged_definir_situacao_raiz(p_raiz uuid, p_situacao text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r ged_pastas_raiz%rowtype;
begin
  if not eh_admin_geral() then
    raise exception 'ged:sem_permissao';
  end if;
  select * into r from ged_pastas_raiz where id = p_raiz for update;
  if not found then
    raise exception 'ged:nao_encontrada';
  end if;
  if not ((r.situacao in ('em_verificacao', 'inativa') and p_situacao = 'ativa') or (r.situacao = 'ativa' and p_situacao = 'inativa')) then
    raise exception 'ged:transicao_invalida';
  end if;
  if r.situacao = 'em_verificacao' and not exists (
       select 1 from auditoria a where a.tabela = 'ged_conexao' and a.acao = 'verificou_raiz'
          and a.depois ->> 'raiz' = r.drive_id and a.depois ->> 'resultado' = 'ok') then
    raise exception 'ged:sem_verificacao';
  end if;
  update ged_pastas_raiz
     set situacao = p_situacao,
         verificada_por = case when r.situacao = 'em_verificacao' then auth.uid() else verificada_por end,
         verificada_em = case when r.situacao = 'em_verificacao' then now() else verificada_em end
   where id = p_raiz;
  insert into auditoria (tabela, registro_id, acao, antes, depois, usuario_id)
  values ('ged_pastas_raiz', p_raiz, 'mudou_situacao', jsonb_build_object('situacao', r.situacao),
          jsonb_build_object('situacao', p_situacao), auth.uid());
end $$;
revoke all on function ged_definir_situacao_raiz(uuid, text) from public, anon, authenticated, service_role;
grant execute on function ged_definir_situacao_raiz(uuid, text) to authenticated;
