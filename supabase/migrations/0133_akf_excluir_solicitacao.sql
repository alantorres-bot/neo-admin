-- =========================================================
-- Neo Admin — 0133 AKF: excluir da lista uma solicitação de antecipação cancelada (pedido do Alan, 12/10/2026)
-- Mesmo modelo do "Excluir da lista" de Contas a pagar (0128): a solicitação CANCELADA pode ser tirada das telas por um
-- gestor do Financeiro. Nada é apagado (regra global 4): fica gravada com quem excluiu, quando e por quê.
-- Os títulos copiados e as interações no histórico de cada título continuam.
-- =========================================================

alter table akf_operacoes add column excluida_em timestamptz;
alter table akf_operacoes add column excluida_por uuid references perfis(id);
alter table akf_operacoes add column motivo_exclusao text;

-- Gatilho do cabeçalho: a única mudança permitida numa cancelada é a exclusão da lista (uma vez, por gestor, nada mais junto).
create or replace function fn_akf_operacoes_regras() returns trigger language plpgsql as $$
begin
  if new.numero <> old.numero or new.data <> old.data or new.criado_por is distinct from old.criado_por or new.criado_em <> old.criado_em then
    raise exception 'Número, data e autor da solicitação não mudam.';
  end if;

  if new.excluida_em is distinct from old.excluida_em or new.excluida_por is distinct from old.excluida_por
     or new.motivo_exclusao is distinct from old.motivo_exclusao then
    if old.excluida_em is not null then
      raise exception 'A solicitação nº % já foi excluída da lista.', old.numero;
    end if;
    if old.status <> 'cancelada' then
      raise exception 'Só solicitação cancelada pode ser excluída da lista. Cancele a nº % antes.', old.numero;
    end if;
    if not tem_acesso_area('financeiro', 'gestor') then
      raise exception 'Somente gestor do Financeiro (ou acima) pode excluir uma solicitação da lista.';
    end if;
    if (to_jsonb(new) - 'excluida_em' - 'excluida_por' - 'motivo_exclusao') <> (to_jsonb(old) - 'excluida_em' - 'excluida_por' - 'motivo_exclusao') then
      raise exception 'Ao excluir da lista, nada mais da solicitação pode mudar.';
    end if;
    new.excluida_em := now();
    new.excluida_por := auth.uid();
    new.motivo_exclusao := coalesce(nullif(trim(new.motivo_exclusao), ''), 'Excluída da lista');
    return new;
  end if;

  if old.status = 'cancelada' then
    raise exception 'A solicitação nº % está cancelada e não pode mais ser alterada.', old.numero;
  end if;
  if old.status = 'solicitada' and new.status = 'rascunho' then
    raise exception 'A solicitação nº % já foi solicitada à AKF; não volta a rascunho.', old.numero;
  end if;
  return new;
end $$;

-- A view ganha a exclusão (colunas novas no fim; create or replace aceita).
create or replace view akf_vw_operacoes with (security_invoker = true) as
select o.id, o.numero, o.data, o.status, o.observacao, o.assunto, o.corpo, o.mensagem_id, o.criado_em, o.solicitada_em, o.cancelada_em, o.motivo_cancelamento,
       o.criado_por, o.solicitada_por, o.cancelada_por, pc.nome as criado_por_nome, ps.nome as solicitada_por_nome, pk.nome as cancelada_por_nome,
       m.id_externo as rascunho_gmail, m.destinatario, m.cc,
       (select count(*)::int from akf_operacao_titulos t where t.operacao_id = o.id) as itens,
       (select coalesce(sum(t.valor_solicitado), 0) from akf_operacao_titulos t where t.operacao_id = o.id) as total,
       (select count(*)::int from akf_operacao_titulos t where t.operacao_id = o.id and t.parcial) as parciais,
       (select count(*)::int from akf_operacao_titulos t where t.operacao_id = o.id and t.sem_boleto) as sem_boleto,
       o.excluida_em, o.excluida_por, o.motivo_exclusao, px.nome as excluida_por_nome
  from akf_operacoes o
  left join perfis pc on pc.id = o.criado_por
  left join perfis ps on ps.id = o.solicitada_por
  left join perfis pk on pk.id = o.cancelada_por
  left join perfis px on px.id = o.excluida_por
  left join mensagens m on m.id = o.mensagem_id;

create function akf_excluir_solicitacao(p_id uuid, p_motivo text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_numero int;
begin
  update akf_operacoes set excluida_em = now(), motivo_exclusao = coalesce(nullif(trim(p_motivo), ''), 'Excluída da lista')
   where id = p_id and excluida_em is null
  returning numero into v_numero;
  if v_numero is null then
    raise exception 'Solicitação não encontrada ou já excluída da lista (ou você não tem acesso a ela).';
  end if;
  return jsonb_build_object('numero', v_numero);
end $$;
revoke all on function akf_excluir_solicitacao(uuid, text) from public, anon;
grant execute on function akf_excluir_solicitacao(uuid, text) to authenticated;
