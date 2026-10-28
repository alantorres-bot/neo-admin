-- =========================================================
-- Neo Admin — 0805 GED: só verificação COMPLETA libera a ativação da raiz (correção da 0803/0804)
--
-- Falha encontrada em produção (25/10/2026): a verificação que parava num limite (leitura incompleta) era auditada como `ok` e,
-- pela 0804, liberava em_verificacao -> ativa.
--  - ged_registrar_verificacao_raiz aceita o resultado `incompleta` e grava `completa` (true só para `ok`) na auditoria.
--  - ged_definir_situacao_raiz exige que a verificação MAIS RECENTE da pasta seja completa. Registros anteriores a esta migration
--    não têm `completa` e não contam (são prova e não são alterados): a raiz em verificação precisa ser verificada de novo.
-- =========================================================

create or replace function ged_registrar_verificacao_raiz(p_perfil uuid, p_raiz text, p_itens integer, p_resultado text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not ged_perfil_admin(p_perfil) then
    raise exception 'ged:sem_permissao';
  end if;
  if p_raiz is null or p_raiz not in ('1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR', '1JOh-QFYw9uwNkxSAdPa6cLzOzIuOiT56',
                                      '1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak') then
    raise exception 'ged:raiz_invalida';
  end if;
  if p_resultado is null or p_resultado not in ('ok', 'incompleta', 'invalid_grant', 'sem_permissao_drive', 'http') then
    raise exception 'ged:codigo_invalido';
  end if;
  select id into v_id from ged_conexao where unica;
  insert into auditoria (tabela, registro_id, acao, depois, usuario_id)
  values ('ged_conexao', v_id, 'verificou_raiz',
          jsonb_build_object('raiz', p_raiz, 'itens', greatest(coalesce(p_itens, 0), 0), 'resultado', p_resultado,
                             'completa', p_resultado = 'ok'), p_perfil);
end $$;
revoke all on function ged_registrar_verificacao_raiz(uuid, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function ged_registrar_verificacao_raiz(uuid, text, integer, text) to service_role;

create or replace function ged_definir_situacao_raiz(p_raiz uuid, p_situacao text) returns void
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
  -- 5.2.4: a última verificação da pasta precisa ter lido a árvore inteira.
  if r.situacao = 'em_verificacao' and coalesce((
       select (a.depois ->> 'completa')::boolean from auditoria a
        where a.tabela = 'ged_conexao' and a.acao = 'verificou_raiz' and a.depois ->> 'raiz' = r.drive_id
        order by a.id desc limit 1), false) is not true then
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
