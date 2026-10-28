-- =========================================================
-- Neo Admin — 0803 GED: auditoria da verificação das raízes candidatas (Fase A0, especificação 5.2.4)
--
-- A verificação lista a árvore de uma raiz candidata (só metadados) e devolve o resumo NA RESPOSTA, só ao admin geral
-- (Edge Function nucleo-ged-metadados). Nada da árvore é gravado (5.2.4.4): a auditoria guarda só quem verificou, o ID da
-- raiz candidata (da lista da seção 2.2), a quantidade de itens e o resultado. Sem nomes de pastas ou arquivos.
-- =========================================================

create function ged_registrar_verificacao_raiz(p_perfil uuid, p_raiz text, p_itens integer, p_resultado text) returns void
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
  if p_resultado is null or p_resultado not in ('ok', 'invalid_grant', 'sem_permissao_drive', 'http') then
    raise exception 'ged:codigo_invalido';
  end if;
  select id into v_id from ged_conexao where unica;
  insert into auditoria (tabela, registro_id, acao, depois, usuario_id)
  values ('ged_conexao', v_id, 'verificou_raiz',
          jsonb_build_object('raiz', p_raiz, 'itens', greatest(coalesce(p_itens, 0), 0), 'resultado', p_resultado), p_perfil);
end $$;
revoke all on function ged_registrar_verificacao_raiz(uuid, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function ged_registrar_verificacao_raiz(uuid, text, integer, text) to service_role;
