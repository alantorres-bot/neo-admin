-- =========================================================
-- Neo Admin — 0007 NÚCLEO: LOGIN COM GOOGLE
--  1. Nome do perfil também vem do Google (full_name / name)
--  2. Troca de senha pendente só prende sessão iniciada por senha (claim `amr` do JWT)
-- Como funciona o login: docs/LOGIN_GOOGLE.md
-- =========================================================

-- 1. NOME VINDO DO GOOGLE ---------------------------------------
-- `nome` (gravado pelo admin ao criar o usuário) continua tendo prioridade; o gatilho só roda na criação.
create or replace function fn_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_primeiro boolean;
begin
  perform pg_advisory_xact_lock(hashtext('neo_admin.primeiro_usuario'));
  v_primeiro := not exists (select 1 from perfis);

  insert into perfis (id, nome, email, admin_geral, deve_trocar_senha)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'nome', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1),
      'Usuário'),
    coalesce(new.email, ''),
    v_primeiro,
    not v_primeiro and coalesce((new.raw_app_meta_data ->> 'deve_trocar_senha')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- 2. TROCA PENDENTE SÓ PRENDE QUEM ENTROU POR SENHA ---------------
-- Quem entra pelo Google não tem senha a trocar. A senha temporária definida pelo admin continua inútil
-- até ser trocada, porque a sessão por senha segue bloqueada. Sem a claim `amr` (service role, token
-- antigo), vale a regra de antes: bloqueia. O gatilho trg_auth_senha_trocada (0005) fica como está.
create function sessao_por_oauth() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'amr') @> '[{"method":"oauth"}]'::jsonb, false);
$$;

create function acesso_liberado(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfis
    where id = p_id and ativo and (not deve_trocar_senha or sessao_por_oauth())
  );
$$;

create or replace function eh_admin_geral() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and admin_geral) and acesso_liberado(auth.uid());
$$;

create or replace function nivel_area(p_area text) returns nivel_acesso
language sql stable security definer set search_path = public as $$
  select case
    when eh_admin_geral() then 'administrador'::nivel_acesso
    when not acesso_liberado(auth.uid()) then 'sem_acesso'::nivel_acesso
    else coalesce((select pe.nivel from permissoes pe where pe.perfil_id = auth.uid() and pe.area = p_area), 'sem_acesso')
  end;
$$;

create or replace function usuario_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select acesso_liberado(auth.uid());
$$;

create or replace function tem_acesso_alguma_area(p_minimo nivel_acesso default 'consulta') returns boolean
language sql stable security definer set search_path = public as $$
  select eh_admin_geral()
      or (acesso_liberado(auth.uid())
          and exists (select 1 from permissoes pe where pe.perfil_id = auth.uid() and pe.nivel >= p_minimo));
$$;
