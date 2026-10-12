-- =========================================================
-- Neo Admin — 0129 Contas a pagar: confirmação dos documentos no Consistem (Fase 4d, leitura)
-- No Consistem da Neo Formas o Contas a Pagar usa controle de liberação (CCFFB000): cada documento precisa ser CONFIRMADO na tela
-- Confirmação de Documentos a Pagar (CCFFB014) para entrar no borderô (CCFFE065) e ser baixado. A API REST (Financeiro v1.0,
-- Swagger v1.0.15 em 12/10/2026) NÃO tem operação de confirmação, mas a coluna `docConfirmado` da tabela da listagem responde ao
-- filtro dinâmico de GET /contasPagar (1 = confirmado, 0 = não confirmado, nulo = nunca passou pela tela). A Edge Function
-- cap-sincronizar-consistem passa a ler isso e a anotar:
--   cap_lancamentos.confirmado_consistem (true/false/nulo = não verificado) e confirmacao_vista_em;
--   cap_autorizacao_itens.confirmado_consistem_em (data em que o item foi visto confirmado; limpa se deixar de estar).
-- A tela da autorização mostra "Confirmados no Consistem X de N" e o que ainda falta confirmar no CCFFB014.
-- Escrever a confirmação continua FORA (pedido aberto à Consistem). Especificação: docs/modulos/financeiro-contas-pagar.md (seção 16).
-- =========================================================

alter table cap_lancamentos add column confirmado_consistem boolean;
alter table cap_lancamentos add column confirmacao_vista_em timestamptz;
comment on column cap_lancamentos.confirmado_consistem is 'Consistem docConfirmado: true = confirmado (CCFFB014), false = verificado e não confirmado, nulo = não verificado.';
create index idx_cap_lancamentos_confirmacao on cap_lancamentos (empresa_id, confirmado_consistem) where baixado_em is null;

alter table cap_autorizacao_itens add column confirmado_consistem_em date;
comment on column cap_autorizacao_itens.confirmado_consistem_em is 'Anotado pela sincronização quando o lançamento consta confirmado no Consistem (docConfirmado = 1); limpo se deixar de constar.';

-- Gatilho dos itens: a service role (sincronização) pode anotar a baixa E a confirmação; o resto continua imutável.
create or replace function fn_cap_item_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status cap_status_autorizacao;
  v_codigo text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null then return new; end if;
    select status, codigo into v_status, v_codigo from cap_autorizacoes where id = new.autorizacao_id;
    if v_status is distinct from 'rascunho' then
      raise exception 'Só é possível incluir itens em uma autorização em rascunho.';
    end if;
    new.removido_em := null; new.removido_por := null; new.motivo_remocao := null; new.baixado_consistem_em := null; new.confirmado_consistem_em := null; new.criado_em := now();
    return new;
  end if;

  if auth.uid() is null then
    if (to_jsonb(new) - 'baixado_consistem_em' - 'confirmado_consistem_em') <> (to_jsonb(old) - 'baixado_consistem_em' - 'confirmado_consistem_em') then
      raise exception 'Itens de autorização são imutáveis (a sincronização só anota a baixa e a confirmação no Consistem).';
    end if;
    return new;
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

-- Views: pendentes ganha a confirmação do lançamento; autorizações ganha a contagem de itens confirmados.
drop view cap_vw_pendentes;
create view cap_vw_pendentes with (security_invoker = true) as
select l.id, l.empresa_id, l.cod_lancamento, l.tipo_lancamento, l.cod_fornecedor, l.num_documento, l.categoria_doc, l.cod_banco,
       l.complemento_historico, l.data_emissao, l.data_vencimento, l.data_pagamento, l.valor_documento, l.valor_atualizado,
       l.tem_bordero, l.bordero_visto_em, l.confirmado_consistem, l.confirmacao_vista_em,
       f.nome as fornecedor_nome, f.documento as fornecedor_documento,
       a.id as autorizacao_id, a.numero as autorizacao_numero, a.codigo as autorizacao_codigo, a.status as autorizacao_status,
       t.id as tratada_id, t.motivo as tratada_motivo, t.tratada_em
  from cap_lancamentos l
  left join cap_fornecedores f on f.empresa_id = l.empresa_id and f.cod_fornecedor = l.cod_fornecedor
  left join lateral (
    select a.id, a.numero, a.codigo, a.status
      from cap_autorizacao_itens i join cap_autorizacoes a on a.id = i.autorizacao_id
     where i.lancamento_id = l.id and i.removido_em is null and a.status in ('rascunho', 'autorizada')
     order by a.criado_em desc limit 1
  ) a on true
  left join cap_antecipacoes_tratadas t on t.lancamento_id = l.id and t.desfeita_em is null
 where l.baixado_em is null and l.valor_atualizado > 0 and l.tipo_lancamento in ('C', 'A');

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
           count(*) filter (where baixado_consistem_em is not null) as baixados,
           -- confirmado no Consistem e ainda não baixado (depois da baixa a confirmação já cumpriu o papel)
           count(*) filter (where confirmado_consistem_em is not null and baixado_consistem_em is null) as confirmados
      from cap_autorizacao_itens where autorizacao_id = a.id and removido_em is null
  ) i on true
  left join lateral (
    select count(*) as extras, sum(valor) as total_extras
      from cap_autorizacao_extras where autorizacao_id = a.id and removido_em is null
  ) x on true;

-- Autorizar: a pendência passa a pedir a confirmação no CCFFB014 antes do borderô; devolve quantos já estão confirmados.
create or replace function cap_autorizar(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_atual int;
  v_codigo text;
  v_empresa uuid;
  v_itens int;
  v_confirmados int;
  v_extras int;
  v_total numeric(14,2);
  v_total_extras numeric(14,2);
  v_prazo date;
  v_titulo text;
  v_quantos text;
begin
  update cap_autorizacoes set status = 'autorizada' where id = p_id and status = 'rascunho';
  get diagnostics v_atual = row_count;
  if v_atual = 0 then
    raise exception 'Autorização não encontrada, já autorizada ou cancelada (ou você não tem acesso a ela).';
  end if;
  select codigo, empresa_id into v_codigo, v_empresa from cap_autorizacoes where id = p_id;
  select count(*), coalesce(sum(valor), 0), min(coalesce(data_vencimento, data_pagamento, v_hoje)),
         count(*) filter (where confirmado_consistem_em is not null and baixado_consistem_em is null)
    into v_itens, v_total, v_prazo, v_confirmados
    from cap_autorizacao_itens where autorizacao_id = p_id and removido_em is null;
  select count(*), coalesce(sum(valor), 0) into v_extras, v_total_extras
    from cap_autorizacao_extras where autorizacao_id = p_id and removido_em is null;
  v_total := v_total + v_total_extras;
  if v_prazo is null or v_prazo < v_hoje then v_prazo := v_hoje; end if;

  v_quantos := v_itens || case when v_itens = 1 then ' item' else ' itens' end
            || case when v_extras > 0 then ' e ' || v_extras || case when v_extras = 1 then ' pagamento extra' else ' pagamentos extras' end else '' end;
  v_titulo := 'Executar autorização de pagamento ' || v_codigo || ' — ' || cap_formatar_reais(v_total);
  insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
  select 'financeiro.contas-pagar', v_empresa, v_titulo,
         'A diretoria autorizou o pagamento de ' || v_quantos || ' (' || cap_formatar_reais(v_total) || '). Abra a autorização, confirme os documentos no Consistem (CCFFB014), monte o borderô, faça os pagamentos e dê baixa. Depois conclua esta pendência.',
         v_prazo, case when v_prazo <= v_hoje + 3 then 'alta'::criticidade else 'normal'::criticidade end,
         'cap_autorizacoes', p_id, '/financeiro/contas-pagar/autorizacoes/' || p_id
   where not exists (
     select 1 from pendencias where modulo = 'financeiro.contas-pagar' and referencia_tabela = 'cap_autorizacoes' and referencia_id = p_id
        and titulo = v_titulo and status in ('aberta', 'em_andamento'));
  return jsonb_build_object('codigo', v_codigo, 'itens', v_itens, 'confirmados', v_confirmados, 'extras', v_extras, 'total', v_total, 'prazo', v_prazo);
end $$;
