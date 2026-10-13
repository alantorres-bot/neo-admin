-- =========================================================
-- Neo Admin — 0160 Contas a pagar: conferência dos pagamentos com o banco (Fase 4e, pedido do Alan, 13/10/2026)
-- Depois de autorizada, quem libera os pagamentos no banco confere cada pagamento lançado lá com a autorização (hoje no papel,
-- à caneta). A tela "Conferir no banco" grava, item a item (títulos, antecipações e extras):
--   conferencia_banco = 'conferido' (o banco bate com a autorização) ou 'divergente' (valor do banco e/ou observação);
--   quem marcou e quando (carimbados pelo gatilho). Desmarcar limpa os campos; o antes/depois fica na auditoria.
-- Só vale para autorização AUTORIZADA e item não removido; operador ou gestor do Financeiro. As demais colunas continuam imutáveis.
-- Especificação: docs/modulos/financeiro-contas-pagar.md (seção 17).
-- =========================================================

alter table cap_autorizacao_itens
  add column conferencia_banco text check (conferencia_banco in ('conferido', 'divergente')),
  add column valor_banco numeric(14,2) check (valor_banco > 0),
  add column observacao_conferencia text check (length(observacao_conferencia) <= 300),
  add column conferido_banco_por uuid references perfis(id),
  add column conferido_banco_em timestamptz;
alter table cap_autorizacao_extras
  add column conferencia_banco text check (conferencia_banco in ('conferido', 'divergente')),
  add column valor_banco numeric(14,2) check (valor_banco > 0),
  add column observacao_conferencia text check (length(observacao_conferencia) <= 300),
  add column conferido_banco_por uuid references perfis(id),
  add column conferido_banco_em timestamptz;
comment on column cap_autorizacao_itens.conferencia_banco is 'Conferência com o banco (Fase 4e): conferido | divergente | nulo = não conferido.';
comment on column cap_autorizacao_extras.conferencia_banco is 'Conferência com o banco (Fase 4e): conferido | divergente | nulo = não conferido.';

-- Regra comum da conferência (itens e extras). Devolve a linha nova ajustada ou levanta o erro.
create function fn_cap_aplicar_conferencia(p_new jsonb, p_autorizacao uuid, p_removido timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status cap_status_autorizacao;
  v_codigo text;
  v_situacao text := p_new->>'conferencia_banco';
  v_obs text := nullif(trim(coalesce(p_new->>'observacao_conferencia', '')), '');
begin
  select status, codigo into v_status, v_codigo from cap_autorizacoes where id = p_autorizacao;
  if v_status is distinct from 'autorizada' then
    raise exception 'A conferência com o banco só vale para autorização autorizada.';
  end if;
  if p_removido is not null then
    raise exception 'Este item foi removido da autorização % e não entra na conferência.', v_codigo;
  end if;
  if v_situacao is null then
    return p_new || jsonb_build_object('valor_banco', null, 'observacao_conferencia', null,
                                       'conferido_banco_por', null, 'conferido_banco_em', null);
  end if;
  if v_situacao = 'divergente' and p_new->>'valor_banco' is null and v_obs is null then
    raise exception 'Para marcar divergente, informe o valor que está no banco ou uma observação.';
  end if;
  if v_situacao = 'conferido' then
    p_new := p_new || jsonb_build_object('valor_banco', null);
  end if;
  return p_new || jsonb_build_object('observacao_conferencia', v_obs, 'conferido_banco_por', auth.uid(), 'conferido_banco_em', now());
end $$;

-- Gatilho dos itens: acrescenta o caminho da conferência (usuário, autorização autorizada).
create or replace function fn_cap_item_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status cap_status_autorizacao;
  v_codigo text;
  v_conf constant text[] := array['conferencia_banco', 'valor_banco', 'observacao_conferencia', 'conferido_banco_por', 'conferido_banco_em'];
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null then return new; end if;
    select status, codigo into v_status, v_codigo from cap_autorizacoes where id = new.autorizacao_id;
    if v_status is distinct from 'rascunho' then
      raise exception 'Só é possível incluir itens em uma autorização em rascunho.';
    end if;
    new.removido_em := null; new.removido_por := null; new.motivo_remocao := null; new.baixado_consistem_em := null; new.confirmado_consistem_em := null; new.criado_em := now();
    new.conferencia_banco := null; new.valor_banco := null; new.observacao_conferencia := null; new.conferido_banco_por := null; new.conferido_banco_em := null;
    return new;
  end if;

  if auth.uid() is null then
    if (to_jsonb(new) - 'baixado_consistem_em' - 'confirmado_consistem_em') <> (to_jsonb(old) - 'baixado_consistem_em' - 'confirmado_consistem_em') then
      raise exception 'Itens de autorização são imutáveis (a sincronização só anota a baixa e a confirmação no Consistem).';
    end if;
    return new;
  end if;

  -- Conferência com o banco: só as cinco colunas mudam.
  if (to_jsonb(new) - v_conf) = (to_jsonb(old) - v_conf) and to_jsonb(new) <> to_jsonb(old) then
    return jsonb_populate_record(new, fn_cap_aplicar_conferencia(to_jsonb(new), old.autorizacao_id, old.removido_em));
  end if;

  if (to_jsonb(new) - 'removido_em' - 'removido_por' - 'motivo_remocao') <> (to_jsonb(old) - 'removido_em' - 'removido_por' - 'motivo_remocao') then
    raise exception 'Itens de autorização são imutáveis; só podem ser removidos enquanto a autorização é rascunho.';
  end if;
  select status, codigo into v_status, v_codigo from cap_autorizacoes where id = old.autorizacao_id;
  if old.removido_em is not null then
    -- Reativação (marcado de novo na tela): só em rascunho e só zerando os três campos.
    if new.removido_em is null and new.removido_por is null and new.motivo_remocao is null and v_status = 'rascunho' then
      return new;
    end if;
    raise exception 'Este item já foi removido da autorização.';
  end if;
  if new.removido_em is not null then
    if v_status <> 'rascunho' then
      raise exception 'Itens só podem ser removidos enquanto a autorização % é rascunho.', v_codigo;
    end if;
    if coalesce(trim(new.motivo_remocao), '') = '' then
      raise exception 'Informe o motivo da remoção.';
    end if;
    new.removido_por := auth.uid();
    new.removido_em := now();
  end if;
  return new;
end $$;

-- Gatilho dos extras: mesmo caminho da conferência.
create or replace function fn_cap_extra_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status cap_status_autorizacao;
  v_codigo text;
  v_conf constant text[] := array['conferencia_banco', 'valor_banco', 'observacao_conferencia', 'conferido_banco_por', 'conferido_banco_em'];
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null then return new; end if;
    select status, codigo into v_status, v_codigo from cap_autorizacoes where id = new.autorizacao_id;
    if v_status is distinct from 'rascunho' then
      raise exception 'Pagamentos extras só entram em uma autorização em rascunho.';
    end if;
    new.descricao := trim(new.descricao); new.favorecido := trim(new.favorecido);
    new.criado_por := auth.uid(); new.criado_em := now();
    new.removido_em := null; new.removido_por := null; new.motivo_remocao := null;
    new.conferencia_banco := null; new.valor_banco := null; new.observacao_conferencia := null; new.conferido_banco_por := null; new.conferido_banco_em := null;
    return new;
  end if;

  if auth.uid() is null then
    if to_jsonb(new) <> to_jsonb(old) then
      raise exception 'Pagamentos extras são imutáveis.';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - v_conf) = (to_jsonb(old) - v_conf) and to_jsonb(new) <> to_jsonb(old) then
    return jsonb_populate_record(new, fn_cap_aplicar_conferencia(to_jsonb(new), old.autorizacao_id, old.removido_em));
  end if;

  if (to_jsonb(new) - 'removido_em' - 'removido_por' - 'motivo_remocao') <> (to_jsonb(old) - 'removido_em' - 'removido_por' - 'motivo_remocao') then
    raise exception 'Pagamentos extras são imutáveis; só podem ser removidos enquanto a autorização é rascunho.';
  end if;
  if old.removido_em is not null then
    raise exception 'Este pagamento extra já foi removido da autorização.';
  end if;
  if new.removido_em is not null then
    select status, codigo into v_status, v_codigo from cap_autorizacoes where id = old.autorizacao_id;
    if v_status <> 'rascunho' then
      raise exception 'Pagamentos extras só podem ser removidos enquanto a autorização % é rascunho.', v_codigo;
    end if;
    if coalesce(trim(new.motivo_remocao), '') = '' then
      raise exception 'Informe o motivo da remoção.';
    end if;
    new.removido_por := auth.uid();
    new.removido_em := now();
  end if;
  return new;
end $$;

-- RPC usada pela tela. p_situacao nulo = desmarcar. Devolve a situação gravada e o resumo da autorização.
create function cap_conferir(p_origem text, p_id uuid, p_situacao text, p_valor_banco numeric default null, p_observacao text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_atual int;
  v_aut uuid;
  v_linha jsonb;
  v_resumo jsonb;
begin
  if not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Só operador ou gestor do Financeiro marca a conferência com o banco.';
  end if;
  if p_situacao is not null and p_situacao not in ('conferido', 'divergente') then
    raise exception 'Situação de conferência inválida.';
  end if;
  if p_origem = 'item' then
    update cap_autorizacao_itens
       set conferencia_banco = p_situacao, valor_banco = p_valor_banco, observacao_conferencia = p_observacao
     where id = p_id
    returning autorizacao_id, jsonb_build_object('conferencia_banco', conferencia_banco, 'valor_banco', valor_banco,
              'observacao_conferencia', observacao_conferencia, 'conferido_banco_em', conferido_banco_em) into v_aut, v_linha;
  elsif p_origem = 'extra' then
    update cap_autorizacao_extras
       set conferencia_banco = p_situacao, valor_banco = p_valor_banco, observacao_conferencia = p_observacao
     where id = p_id
    returning autorizacao_id, jsonb_build_object('conferencia_banco', conferencia_banco, 'valor_banco', valor_banco,
              'observacao_conferencia', observacao_conferencia, 'conferido_banco_em', conferido_banco_em) into v_aut, v_linha;
  else
    raise exception 'Origem inválida (item ou extra).';
  end if;
  get diagnostics v_atual = row_count;
  if v_atual = 0 then
    raise exception 'Item não encontrado (ou você não tem acesso a ele).';
  end if;
  select jsonb_build_object('itens', itens + extras, 'conferidos', conferidos, 'divergentes', divergentes) into v_resumo
    from cap_vw_autorizacoes where id = v_aut;
  return v_linha || jsonb_build_object('resumo', v_resumo);
end $$;
revoke all on function cap_conferir(text, uuid, text, numeric, text) from public, anon;
grant execute on function cap_conferir(text, uuid, text, numeric, text) to authenticated;

-- View das autorizações: + conferidos, divergentes e total conferido (itens + extras não removidos).
drop view cap_vw_autorizacoes;
create view cap_vw_autorizacoes with (security_invoker = true) as
select a.*, e.nome_curto as empresa_nome, e.razao_social as empresa_razao_social, e.cnpj as empresa_cnpj,
       pc.nome as criado_por_nome, pa.nome as autorizada_por_nome, pk.nome as cancelada_por_nome, ps.nome as slack_enviada_por_nome,
       px.nome as excluida_por_nome,
       coalesce(i.itens, 0)::int as itens, coalesce(i.titulos, 0)::int as titulos, coalesce(i.antecipacoes, 0)::int as antecipacoes,
       coalesce(i.total_titulos, 0)::numeric(14,2) as total_titulos, coalesce(i.total_antecipacoes, 0)::numeric(14,2) as total_antecipacoes,
       coalesce(x.extras, 0)::int as extras, coalesce(x.total_extras, 0)::numeric(14,2) as total_extras,
       (coalesce(i.total, 0) + coalesce(x.total_extras, 0))::numeric(14,2) as total, coalesce(i.baixados, 0)::int as baixados,
       coalesce(i.confirmados, 0)::int as confirmados,
       case when a.caixa_disponivel is null then null
            else greatest(coalesce(i.total, 0) + coalesce(x.total_extras, 0) - a.caixa_disponivel, 0)::numeric(14,2) end as excedente,
       (coalesce(i.conferidos, 0) + coalesce(x.conferidos, 0))::int as conferidos,
       (coalesce(i.divergentes, 0) + coalesce(x.divergentes, 0))::int as divergentes,
       (coalesce(i.total_conferido, 0) + coalesce(x.total_conferido, 0))::numeric(14,2) as total_conferido
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
           count(*) filter (where baixado_consistem_em is not null) as baixados,
           -- confirmado no Consistem e ainda não baixado (depois da baixa a confirmação já cumpriu o papel)
           count(*) filter (where confirmado_consistem_em is not null and baixado_consistem_em is null) as confirmados,
           count(*) filter (where conferencia_banco = 'conferido') as conferidos,
           count(*) filter (where conferencia_banco = 'divergente') as divergentes,
           sum(valor) filter (where conferencia_banco = 'conferido') as total_conferido
      from cap_autorizacao_itens where autorizacao_id = a.id and removido_em is null
  ) i on true
  left join lateral (
    select count(*) as extras, sum(valor) as total_extras,
           count(*) filter (where conferencia_banco = 'conferido') as conferidos,
           count(*) filter (where conferencia_banco = 'divergente') as divergentes,
           sum(valor) filter (where conferencia_banco = 'conferido') as total_conferido
      from cap_autorizacao_extras where autorizacao_id = a.id and removido_em is null
  ) x on true;
