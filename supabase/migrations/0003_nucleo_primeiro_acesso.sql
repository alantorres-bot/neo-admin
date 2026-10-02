-- =========================================================
-- Neo Admin — 0003 NÚCLEO: PERFIL NO PRIMEIRO ACESSO
-- Todo usuário criado no Supabase Auth ganha um registro em `perfis`.
-- O primeiro usuário do sistema vira admin_geral; os demais entram sem
-- nenhuma permissão (sem_acesso em todas as áreas) até o admin liberar.
-- Recomendado: desativar o cadastro público (Auth > Sign In / Providers >
-- "Allow new users to sign up") e convidar usuários pela tela de Configurações.
-- =========================================================

create function fn_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_primeiro boolean;
begin
  -- serializa cadastros simultâneos: só um deles enxerga `perfis` vazia
  perform pg_advisory_xact_lock(hashtext('neo_admin.primeiro_usuario'));
  v_primeiro := not exists (select 1 from perfis);

  insert into perfis (id, nome, email, admin_geral)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(coalesce(new.email, ''), '@', 1), 'Usuário'),
    coalesce(new.email, ''),
    v_primeiro
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger trg_auth_novo_usuario after insert on auth.users
  for each row execute function fn_novo_usuario();
