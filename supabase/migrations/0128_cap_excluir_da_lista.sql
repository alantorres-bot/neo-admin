-- =========================================================
-- Neo Admin — 0128 Contas a pagar: excluir autorização cancelada da lista (pedido do financeiro, 11/10/2026)
-- A autorização cancelada pode ser tirada da lista (histórico) por um gestor. Nada é apagado: fica gravada com quem excluiu,
-- quando e por quê, e some das telas. Só cancelada (cancelar antes já retira do Slack e da Fila do dia).
-- =========================================================

alter table cap_autorizacoes add column excluida_em timestamptz;
alter table cap_autorizacoes add column excluida_por uuid references perfis(id);
alter table cap_autorizacoes add column motivo_exclusao text;

-- Gatilho: a única mudança permitida numa cancelada é a exclusão da lista (uma vez, por gestor).
create or replace function fn_cap_autorizacao_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'rascunho';
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.autorizada_por := null; new.autorizada_em := null;
    new.cancelada_por := null;  new.cancelada_em := null; new.motivo_cancelamento := null;
    new.slack_enviada_em := null; new.slack_enviada_por := null; new.slack_permalink := null;
    new.slack_file_id := null; new.slack_message_ts := null; new.slack_retirada_em := null;
    new.excluida_em := null; new.excluida_por := null; new.motivo_exclusao := null;
    return new;
  end if;

  -- Exclusão da lista: só cancelada, só gestor, uma vez; nada mais muda junto.
  if new.excluida_em is distinct from old.excluida_em or new.excluida_por is distinct from old.excluida_por
     or new.motivo_exclusao is distinct from old.motivo_exclusao then
    if old.excluida_em is not null then
      raise exception 'A autorização % já foi excluída da lista.', old.codigo;
    end if;
    if old.status <> 'cancelada' then
      raise exception 'Só autorização cancelada pode ser excluída da lista. Cancele a % antes.', old.codigo;
    end if;
    if not tem_acesso_area('financeiro', 'gestor') then
      raise exception 'Somente gestor do Financeiro (ou acima) pode excluir uma autorização da lista.';
    end if;
    if (to_jsonb(new) - 'excluida_em' - 'excluida_por' - 'motivo_exclusao' - 'atualizado_em') <> (to_jsonb(old) - 'excluida_em' - 'excluida_por' - 'motivo_exclusao' - 'atualizado_em') then
      raise exception 'Ao excluir da lista, nada mais da autorização pode mudar.';
    end if;
    new.excluida_em := now();
    new.excluida_por := auth.uid();
    new.motivo_exclusao := nullif(trim(new.motivo_exclusao), '');
    return new;
  end if;

  new.numero := old.numero; new.codigo := old.codigo; new.empresa_id := old.empresa_id; new.data := old.data;
  new.criado_por := old.criado_por; new.criado_em := old.criado_em;
  new.slack_enviada_em := old.slack_enviada_em; new.slack_enviada_por := old.slack_enviada_por; new.slack_permalink := old.slack_permalink;
  new.slack_file_id := old.slack_file_id; new.slack_message_ts := old.slack_message_ts; new.slack_retirada_em := old.slack_retirada_em;

  if old.status = 'cancelada' then
    raise exception 'A autorização % está cancelada e não pode mais ser alterada.', old.codigo;
  end if;
  if old.status = 'autorizada' and new.status = 'rascunho' then
    raise exception 'A autorização % já foi autorizada e não volta a rascunho.', old.codigo;
  end if;
  if old.status <> 'rascunho' and new.observacao is distinct from old.observacao then
    raise exception 'A observação só pode ser alterada enquanto a autorização é rascunho.';
  end if;
  if old.status <> 'rascunho' and new.caixa_disponivel is distinct from old.caixa_disponivel then
    raise exception 'O caixa disponível só pode ser alterado enquanto a autorização é rascunho.';
  end if;

  if new.status = 'autorizada' and old.status <> 'autorizada' then
    if not tem_acesso_area('financeiro', 'gestor') then
      raise exception 'Somente gestor do Financeiro (ou acima) pode autorizar o pagamento.';
    end if;
    if not exists (select 1 from cap_autorizacao_itens where autorizacao_id = old.id and removido_em is null)
       and not exists (select 1 from cap_autorizacao_extras where autorizacao_id = old.id and removido_em is null) then
      raise exception 'A autorização % não tem itens nem pagamentos extras.', old.codigo;
    end if;
    new.autorizada_por := auth.uid();
    new.autorizada_em := now();
  else
    new.autorizada_por := old.autorizada_por;
    new.autorizada_em := old.autorizada_em;
  end if;

  if new.status = 'cancelada' then
    if not tem_acesso_area('financeiro', 'gestor') and not (old.status = 'rascunho' and old.criado_por = auth.uid()) then
      raise exception 'Só gestor do Financeiro cancela uma autorização (ou quem a montou, enquanto é rascunho).';
    end if;
    if coalesce(trim(new.motivo_cancelamento), '') = '' then
      raise exception 'Informe o motivo do cancelamento.';
    end if;
    new.cancelada_por := auth.uid();
    new.cancelada_em := now();
  else
    new.cancelada_por := old.cancelada_por; new.cancelada_em := old.cancelada_em; new.motivo_cancelamento := old.motivo_cancelamento;
  end if;
  return new;
end $$;

-- A view traz a.* : recriar para incluir as colunas novas e o nome de quem excluiu.
drop view cap_vw_autorizacoes;
create view cap_vw_autorizacoes with (security_invoker = true) as
select a.*, e.nome_curto as empresa_nome, e.razao_social as empresa_razao_social, e.cnpj as empresa_cnpj,
       pc.nome as criado_por_nome, pa.nome as autorizada_por_nome, pk.nome as cancelada_por_nome, ps.nome as slack_enviada_por_nome,
       px.nome as excluida_por_nome,
       coalesce(i.itens, 0)::int as itens, coalesce(i.titulos, 0)::int as titulos, coalesce(i.antecipacoes, 0)::int as antecipacoes,
       coalesce(i.total_titulos, 0)::numeric(14,2) as total_titulos, coalesce(i.total_antecipacoes, 0)::numeric(14,2) as total_antecipacoes,
       coalesce(x.extras, 0)::int as extras, coalesce(x.total_extras, 0)::numeric(14,2) as total_extras,
       (coalesce(i.total, 0) + coalesce(x.total_extras, 0))::numeric(14,2) as total, coalesce(i.baixados, 0)::int as baixados,
       case when a.caixa_disponivel is null then null
            else greatest(coalesce(i.total, 0) + coalesce(x.total_extras, 0) - a.caixa_disponivel, 0)::numeric(14,2) end as excedente
  from cap_autorizacoes a
  join empresas e on e.id = a.empresa_id
  left join perfis pc on pc.id = a.criado_por
  left join perfis pa on pa.id = a.autorizada_por
  left join perfis pk on pk.id = a.cancelada_por
  left join perfis ps on ps.id = a.slack_enviada_por
  left join perfis px on px.id = a.excluida_por
  left join lateral (
    select count(*) as itens,
           count(*) filter (where tipo = 'titulo') as titulos,
           count(*) filter (where tipo = 'antecipacao') as antecipacoes,
           sum(valor) filter (where tipo = 'titulo') as total_titulos,
           sum(valor) filter (where tipo = 'antecipacao') as total_antecipacoes,
           sum(valor) as total,
           count(*) filter (where baixado_consistem_em is not null) as baixados
      from cap_autorizacao_itens where autorizacao_id = a.id and removido_em is null
  ) i on true
  left join lateral (
    select count(*) as extras, sum(valor) as total_extras
      from cap_autorizacao_extras where autorizacao_id = a.id and removido_em is null
  ) x on true;

create function cap_excluir_da_lista(p_id uuid, p_motivo text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_atual int;
  v_codigo text;
begin
  update cap_autorizacoes set excluida_em = now(), motivo_exclusao = coalesce(nullif(trim(p_motivo), ''), 'Excluída da lista')
   where id = p_id and excluida_em is null
  returning codigo into v_codigo;
  get diagnostics v_atual = row_count;
  if v_atual = 0 then
    raise exception 'Autorização não encontrada ou já excluída da lista (ou você não tem acesso a ela).';
  end if;
  return jsonb_build_object('codigo', v_codigo);
end $$;
revoke all on function cap_excluir_da_lista(uuid, text) from public, anon;
grant execute on function cap_excluir_da_lista(uuid, text) to authenticated;
