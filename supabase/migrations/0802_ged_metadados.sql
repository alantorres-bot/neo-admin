-- =========================================================
-- Neo Admin — 0802 GED: primeira leitura controlada do Drive (só metadados) e correção do registro de erros da conexão
--
--  1. CORREÇÃO (0801): ged_registrar_erro_conexao marcava a conexão ATIVA como "com erro" quando falhava uma NOVA tentativa
--     de conexão (conta errada, recusa no Google, falha na troca do código). Erro de tentativa (com p_state) agora só vai para
--     a auditoria; a situação da conexão só muda com erro operacional sem state (ex.: invalid_grant ao renovar o acesso).
--  2. ged_registrar_consulta_metadados: auditoria da consulta de metadados (quem, quantos itens, resultado). Sem nome de
--     arquivo, id, token ou e-mail. Chamada só pela Edge Function nucleo-ged-metadados (service_role).
-- Nada de indexação, download ou escrita no Drive.
-- =========================================================

create or replace function ged_registrar_erro_conexao(p_codigo text, p_state text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_perfil uuid;
begin
  if p_codigo is null or p_codigo not in ('invalid_grant', 'escopo_divergente', 'conta_divergente', 'identidade_invalida',
                                           'token_ausente', 'http', 'recusado') then
    raise exception 'ged:codigo_invalido';
  end if;
  if p_state is not null then
    -- Tentativa de conexão que falhou: a conexão existente (se houver) continua como está.
    select perfil_id into v_perfil from ged_conexao_estados where state = p_state;
    select id into v_id from ged_conexao where unica;
    insert into auditoria (tabela, registro_id, acao, depois, usuario_id)
    values ('ged_conexao', v_id, 'tentativa_falhou', jsonb_build_object('codigo', p_codigo), v_perfil);
    return;
  end if;
  update ged_conexao set ultimo_erro = p_codigo, ultimo_erro_em = now() where unica and desconectado_em is null returning id into v_id;
  insert into auditoria (tabela, registro_id, acao, depois)
  values ('ged_conexao', v_id, 'erro', jsonb_build_object('codigo', p_codigo));
end $$;
revoke all on function ged_registrar_erro_conexao(text, text) from public, anon, authenticated;
grant execute on function ged_registrar_erro_conexao(text, text) to service_role;

create function ged_registrar_consulta_metadados(p_perfil uuid, p_itens integer, p_resultado text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not ged_perfil_admin(p_perfil) then
    raise exception 'ged:sem_permissao';
  end if;
  if p_resultado is null or p_resultado not in ('ok', 'invalid_grant', 'sem_permissao_drive', 'http') then
    raise exception 'ged:codigo_invalido';
  end if;
  select id into v_id from ged_conexao where unica;
  insert into auditoria (tabela, registro_id, acao, depois, usuario_id)
  values ('ged_conexao', v_id, 'consultou_metadados',
          jsonb_build_object('itens', greatest(coalesce(p_itens, 0), 0), 'resultado', p_resultado), p_perfil);
end $$;
revoke all on function ged_registrar_consulta_metadados(uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function ged_registrar_consulta_metadados(uuid, integer, text) to service_role;
