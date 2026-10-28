-- =========================================================
-- Neo Admin — 0801 GED: conexão com o Google Drive (fase A0-conexão)
-- Plano de referência: docs/auditoria/PLANO_FASE_A0_GED_2026-10-24.md (versão consolidada, com a revisão de segurança).
-- ATENÇÃO: depende da aprovação da revisão 4 do GED (GED-P3, GED-P17) e da autorização expressa da fase A0. Não aplicar antes.
--
--  - Conta corporativa DEDICADA (administrativo.ged.conta), OAuth com PKCE S256, escopo só drive.readonly.
--  - ged_conexao e ged_conexao_estados: RLS sem políticas + revoke all. Ninguém lê direto; o admin vê só a projeção.
--  - Refresh token só no Vault (vault.secrets); a tabela guarda o id. Segredo e linha gravados na mesma transação.
--  - Auditoria SANEADA gravada pelas funções (sem segredo_id, google_sub, token, state, code_verifier). O fn_auditoria
--    genérico NÃO é usado aqui: copiaria a linha inteira para a auditoria, que o admin geral lê.
--  - Toda função: security definer, revoke de public/anon/authenticated (e de service_role onde ela não precisa) e grant só ao
--    papel necessário: o Supabase dá execute a anon, authenticated e service_role em toda função nova; revogar de public não basta.
--  - D-REV (revogar no Google ao desconectar) e D-TROCA (trocar de conta exige desconectar antes) seguem a RECOMENDAÇÃO
--    do plano; a decisão formal é do responsável. D-REV fica em administrativo.ged.revogar_no_google.
--  - Nenhuma chamada à Drive API nesta fase; nada de indexação.
-- =========================================================

insert into modulos (codigo, area, nome, ativo) values ('administrativo.ged', 'administrativo', 'Central de Documentos', false)
on conflict (codigo) do nothing;

insert into configuracoes (chave, valor, descricao) values
  ('administrativo.ged.conta', 'null',
   'E-mail da conta corporativa dedicada do GED (GED-P3). Só ela conclui a conexão com o Drive. Vazio = conexão bloqueada.'),
  ('administrativo.ged.revogar_no_google', 'true',
   'Ao desconectar o Drive do GED, revogar também o acesso no Google (D-REV: recomendação técnica; decisão formal pendente).')
on conflict (chave) do nothing;

-- 1) Tabelas ---------------------------------------------------------------------------------------------------------------
create table ged_conexao (
  id uuid primary key default gen_random_uuid(),
  unica boolean not null default true unique check (unica),          -- uma linha só
  email text not null,
  google_sub text not null,                                         -- identificador estável da conta Google
  segredo_id uuid,                                                  -- vault.secrets.id; nulo depois de desconectar
  escopos text[] not null,
  conectado_em timestamptz not null default now(),
  conectado_por uuid not null references perfis(id),
  desconectado_em timestamptz,
  desconectado_por uuid references perfis(id),
  revogacao_remota text check (revogacao_remota in ('ok', 'falhou', 'nao_tentada')),
  ultimo_erro text check (ultimo_erro in ('invalid_grant', 'escopo_divergente', 'conta_divergente', 'identidade_invalida',
                                          'token_ausente', 'http', 'recusado')),
  ultimo_erro_em timestamptz
);
alter table ged_conexao enable row level security;                  -- sem políticas: só as funções abaixo
revoke all on ged_conexao from anon, authenticated;
create trigger trg_ged_conexao_sem_delete before delete on ged_conexao for each row execute function fn_bloquear_delete();

create table ged_conexao_estados (
  state text primary key,
  perfil_id uuid not null references perfis(id),
  destino text not null check (destino ~ '^/(?!/)[a-z0-9_-]+(/[a-z0-9_-]+)*$'),   -- só caminho relativo do app
  code_verifier text not null,                                      -- PKCE: nunca sai do servidor
  criado_em timestamptz not null default now(),
  consumido_em timestamptz,                                         -- marcado ANTES da troca do código
  concluido_em timestamptz
);
alter table ged_conexao_estados enable row level security;
revoke all on ged_conexao_estados from anon, authenticated;

-- 2) Auxiliares internas (sem grant: só as funções security definer abaixo as chamam) -----------------------------------------
-- Perfil ainda pode conectar? Conferido pelo id (a Edge Function não tem auth.uid()); acesso_liberado = ativo e sem troca de senha pendente.
create function ged_perfil_admin(p_perfil uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = p_perfil and admin_geral) and acesso_liberado(p_perfil);
$$;
revoke all on function ged_perfil_admin(uuid) from public, anon, authenticated, service_role;

create function ged_conta_configurada() returns text
language sql stable security definer set search_path = public as $$
  select nullif(lower(btrim(valor #>> '{}')), '') from configuracoes where chave = 'administrativo.ged.conta';
$$;
revoke all on function ged_conta_configurada() from public, anon, authenticated, service_role;

-- 3) Início (admin logado) ----------------------------------------------------------------------------------------------------
create function ged_iniciar_conexao(p_destino text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_state text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_verifier text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not eh_admin_geral() then
    raise exception 'Só o administrador geral conecta o Drive do GED.';
  end if;
  if p_destino is null or p_destino !~ '^/(?!/)[a-z0-9_-]+(/[a-z0-9_-]+)*$' then
    raise exception 'Destino inválido.';
  end if;
  if ged_conta_configurada() is null then
    raise exception 'Configure a conta do GED (administrativo.ged.conta) antes de conectar.';
  end if;
  delete from ged_conexao_estados where criado_em < now() - interval '1 day';
  if (select count(*) from ged_conexao_estados
       where perfil_id = auth.uid() and consumido_em is null and criado_em > now() - interval '15 minutes') >= 5 then
    raise exception 'Muitas tentativas de conexão em andamento. Aguarde alguns minutos.';
  end if;
  insert into ged_conexao_estados (state, perfil_id, destino, code_verifier) values (v_state, auth.uid(), p_destino, v_verifier);
  return v_state;
end $$;
revoke all on function ged_iniciar_conexao(text) from public, anon, authenticated, service_role;
grant execute on function ged_iniciar_conexao(text) to authenticated;

-- 4) Ida ao Google (Edge Function): estado válido, sem consumir --------------------------------------------------------------
create function ged_validar_estado(p_state text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code_verifier', e.code_verifier, 'destino', e.destino, 'conta', ged_conta_configurada())
    from ged_conexao_estados e
   where e.state = p_state and e.consumido_em is null and e.criado_em > now() - interval '15 minutes'
     and ged_perfil_admin(e.perfil_id) and ged_conta_configurada() is not null;
$$;
revoke all on function ged_validar_estado(text) from public, anon, authenticated;
grant execute on function ged_validar_estado(text) to service_role;

-- 5) Volta do Google (Edge Function): consumo ATÔMICO, antes de trocar o código --------------------------------------------
create function ged_consumir_estado(p_state text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e ged_conexao_estados%rowtype;
begin
  update ged_conexao_estados set consumido_em = now()
   where state = p_state and consumido_em is null and criado_em > now() - interval '15 minutes'
  returning * into e;
  if not found or not ged_perfil_admin(e.perfil_id) or ged_conta_configurada() is null then
    return null;
  end if;
  return jsonb_build_object('code_verifier', e.code_verifier, 'destino', e.destino, 'conta', ged_conta_configurada());
end $$;
revoke all on function ged_consumir_estado(text) from public, anon, authenticated;
grant execute on function ged_consumir_estado(text) to service_role;

-- 6) Conclusão (Edge Function, depois de conferir identidade e escopos): Vault + linha + auditoria numa transação ----------
-- Mensagens no formato 'ged:<codigo>', sem e-mail, id nem valor recebido (a Edge Function só repassa o código).
create function ged_concluir_conexao(p_state text, p_email text, p_sub text, p_escopos text[], p_refresh_token text) returns text
language plpgsql security definer set search_path = public as $$
declare
  e ged_conexao_estados%rowtype;
  c ged_conexao%rowtype;
  v_segredo uuid;
  v_acao text := 'conectou';
  v_existe boolean;
  v_escopo_drive constant text := 'https://www.googleapis.com/auth/drive.readonly';
begin
  select * into e from ged_conexao_estados where state = p_state for update;
  if not found or e.consumido_em is null or e.concluido_em is not null or e.consumido_em < now() - interval '2 minutes' then
    raise exception 'ged:estado_invalido';
  end if;
  if not ged_perfil_admin(e.perfil_id) then
    raise exception 'ged:sem_permissao';
  end if;
  if ged_conta_configurada() is null or lower(btrim(coalesce(p_email, ''))) <> ged_conta_configurada() then
    raise exception 'ged:conta_divergente';
  end if;
  if coalesce(btrim(p_sub), '') = '' then
    raise exception 'ged:identidade_invalida';
  end if;
  if p_escopos is null or not (v_escopo_drive = any (p_escopos))
     or exists (select 1 from unnest(p_escopos) s
                 where s not in ('openid', 'email', 'https://www.googleapis.com/auth/userinfo.email', v_escopo_drive)) then
    raise exception 'ged:escopo_divergente';
  end if;
  if coalesce(p_refresh_token, '') = '' then
    raise exception 'ged:token_ausente';
  end if;

  select * into c from ged_conexao where unica for update;
  v_existe := found;                                               -- FOUND muda no update abaixo
  -- D-TROCA (recomendação): outra conta Google com conexão ativa só depois de desconectar.
  if v_existe and c.desconectado_em is null and c.google_sub <> p_sub then
    raise exception 'ged:conta_divergente';
  end if;

  update ged_conexao_estados set concluido_em = now() where state = p_state;

  if v_existe and c.segredo_id is not null and exists (select 1 from vault.secrets where id = c.segredo_id) then
    perform vault.update_secret(c.segredo_id, p_refresh_token);
    v_segredo := c.segredo_id;
    v_acao := case when c.desconectado_em is null then 'substituiu' else 'conectou' end;
  else
    v_segredo := vault.create_secret(p_refresh_token, 'ged_drive_refresh_' || replace(gen_random_uuid()::text, '-', ''),
                                     'Refresh token do Drive do GED (drive.readonly)');
  end if;

  if v_existe then
    update ged_conexao set email = lower(btrim(p_email)), google_sub = p_sub, segredo_id = v_segredo, escopos = p_escopos,
                           conectado_em = now(), conectado_por = e.perfil_id, desconectado_em = null, desconectado_por = null,
                           revogacao_remota = null, ultimo_erro = null, ultimo_erro_em = null
     where id = c.id;
  else
    insert into ged_conexao (email, google_sub, segredo_id, escopos, conectado_por)
    values (lower(btrim(p_email)), p_sub, v_segredo, p_escopos, e.perfil_id)
    returning * into c;
  end if;

  insert into auditoria (tabela, registro_id, acao, depois, usuario_id)
  values ('ged_conexao', c.id, v_acao, jsonb_build_object('email', lower(btrim(p_email)), 'escopos', p_escopos), e.perfil_id);
  return e.destino;
end $$;
revoke all on function ged_concluir_conexao(text, text, text, text[], text) from public, anon, authenticated;
grant execute on function ged_concluir_conexao(text, text, text, text[], text) to service_role;

-- 7) Erros (Edge Function e fases seguintes): só códigos da lista --------------------------------------------------------------
create function ged_registrar_erro_conexao(p_codigo text, p_state text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_perfil uuid;
begin
  if p_codigo is null or p_codigo not in ('invalid_grant', 'escopo_divergente', 'conta_divergente', 'identidade_invalida',
                                           'token_ausente', 'http', 'recusado') then
    raise exception 'ged:codigo_invalido';
  end if;
  select perfil_id into v_perfil from ged_conexao_estados where state = p_state;
  update ged_conexao set ultimo_erro = p_codigo, ultimo_erro_em = now() where unica returning id into v_id;
  insert into auditoria (tabela, registro_id, acao, depois, usuario_id)
  values ('ged_conexao', v_id, 'erro', jsonb_build_object('codigo', p_codigo), v_perfil);
end $$;
revoke all on function ged_registrar_erro_conexao(text, text) from public, anon, authenticated;
grant execute on function ged_registrar_erro_conexao(text, text) to service_role;

-- 8) Token para as fases seguintes (verificação, indexação) e para a revogação ---------------------------------------------
-- plpgsql (como gmail_refresh_token, 0153): corpo não é validado na criação, então a migration roda sem o Vault (testes).
create function ged_refresh_token() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return (select jsonb_build_object('refresh_token', s.decrypted_secret)
            from ged_conexao g join vault.decrypted_secrets s on s.id = g.segredo_id
           where g.desconectado_em is null);
end $$;
revoke all on function ged_refresh_token() from public, anon, authenticated;
grant execute on function ged_refresh_token() to service_role;

-- 9) Situação para a tela (só o admin geral recebe linha; nunca segredo_id, google_sub ou token) -------------------------------
create function ged_situacao_conexao()
returns table (email text, escopos text[], conectado_em timestamptz, desconectado_em timestamptz, revogacao_remota text,
               ultimo_erro text, ultimo_erro_em timestamptz, situacao text)
language sql stable security definer set search_path = public as $$
  select g.email, g.escopos, g.conectado_em, g.desconectado_em, g.revogacao_remota, g.ultimo_erro, g.ultimo_erro_em,
         case when g.desconectado_em is not null then 'desconectada'
              when g.ultimo_erro is not null then 'com_erro'
              else 'conectada' end
    from ged_conexao g
   where eh_admin_geral();
$$;
revoke all on function ged_situacao_conexao() from public, anon, authenticated, service_role;
grant execute on function ged_situacao_conexao() to authenticated;

-- 10) Desconexão ---------------------------------------------------------------------------------------------------------------
-- A Edge Function confere o JWT do chamador por esta função (o admin logado) antes de revogar e desconectar.
create function ged_perfil_admin_atual() returns uuid
language sql stable security definer set search_path = public as $$
  select case when eh_admin_geral() then auth.uid() end;
$$;
revoke all on function ged_perfil_admin_atual() from public, anon, authenticated, service_role;
grant execute on function ged_perfil_admin_atual() to authenticated;

-- Idempotente: sem conexão ativa, não faz nada. Apaga o segredo, preserva o registro e audita.
create function ged_desconectar(p_perfil uuid, p_revogacao text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c ged_conexao%rowtype;
begin
  if not ged_perfil_admin(p_perfil) then
    raise exception 'ged:sem_permissao';
  end if;
  if p_revogacao is null or p_revogacao not in ('ok', 'falhou', 'nao_tentada') then
    raise exception 'ged:codigo_invalido';
  end if;
  select * into c from ged_conexao where unica and desconectado_em is null for update;
  if not found then
    return;
  end if;
  if c.segredo_id is not null then
    delete from vault.secrets where id = c.segredo_id;
  end if;
  update ged_conexao set segredo_id = null, desconectado_em = now(), desconectado_por = p_perfil, revogacao_remota = p_revogacao
   where id = c.id;
  insert into auditoria (tabela, registro_id, acao, depois, usuario_id)
  values ('ged_conexao', c.id, 'desconectou', jsonb_build_object('email', c.email, 'revogacao_remota', p_revogacao), p_perfil);
end $$;
revoke all on function ged_desconectar(uuid, text) from public, anon, authenticated;
grant execute on function ged_desconectar(uuid, text) to service_role;
