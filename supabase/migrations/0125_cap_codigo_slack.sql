-- =========================================================
-- Neo Admin — 0125 Contas a pagar: código da autorização = data do pagamento (DDMMAA); cancelamento apaga no Slack
-- 1) Pedido do financeiro (11/10/2026): a autorização passa a ser identificada pela DATA DO PAGAMENTO no formato DDMMAA
--    (ex.: pagamentos de 10/10/2026 = "101026"). Mais de uma no mesmo dia: "101026-2", "101026-3"... O `numero` sequencial
--    continua existindo só para ordenação interna. `codigo` é imutável e único.
-- 2) Envio no Slack: só o PDF (sem texto). Guardamos o id do arquivo e o ts da mensagem para, no cancelamento, a Edge
--    Function apagar os dois e publicar um aviso curto de cancelamento no canal.
-- =========================================================

alter table cap_autorizacoes add column codigo text;
alter table cap_autorizacoes add column slack_file_id text;
alter table cap_autorizacoes add column slack_message_ts text;
alter table cap_autorizacoes add column slack_retirada_em timestamptz;

-- Código de uma data: DDMMAA, com sufixo -2, -3... quando já existe autorização na mesma data (ignorando a própria linha).
create function cap_codigo_para_data(p_data date, p_ignorar uuid default null) returns text
language plpgsql stable set search_path = public as $$
declare
  v_base text := to_char(p_data, 'DDMMYY');
  v_n int;
begin
  select count(*) into v_n from cap_autorizacoes where data = p_data and (p_ignorar is null or id <> p_ignorar);
  return case when v_n = 0 then v_base else v_base || '-' || (v_n + 1) end;
end $$;

-- Backfill das existentes: DDMMAA e sufixo -2, -3... na ordem do número dentro de cada data.
do $$
declare r record; v_n int; v_base text;
begin
  for r in select id, data, row_number() over (partition by data order by numero) as n from cap_autorizacoes loop
    v_base := to_char(r.data, 'DDMMYY');
    update cap_autorizacoes set codigo = case when r.n = 1 then v_base else v_base || '-' || r.n end where id = r.id;
  end loop;
end $$;
alter table cap_autorizacoes alter column codigo set not null;
alter table cap_autorizacoes add constraint cap_autorizacoes_codigo_unico unique (codigo);

-- Gatilho: código e campos do Slack imutáveis pelo usuário.
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
    if not exists (select 1 from cap_autorizacao_itens where autorizacao_id = old.id and removido_em is null) then
      raise exception 'A autorização % não tem itens.', old.codigo;
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

-- Itens: mensagem de erro com o código.
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
    new.removido_em := null; new.removido_por := null; new.motivo_remocao := null; new.baixado_consistem_em := null; new.criado_em := now();
    return new;
  end if;

  if auth.uid() is null then
    if (to_jsonb(new) - 'baixado_consistem_em') <> (to_jsonb(old) - 'baixado_consistem_em') then
      raise exception 'Itens de autorização são imutáveis (a sincronização só anota a baixa no Consistem).';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - 'removido_em' - 'removido_por' - 'motivo_remocao') <> (to_jsonb(old) - 'removido_em' - 'removido_por' - 'motivo_remocao') then
    raise exception 'Itens de autorização são imutáveis; só podem ser removidos enquanto a autorização é rascunho.';
  end if;
  if old.removido_em is not null then
    raise exception 'Este item já foi removido da autorização.';
  end if;
  if new.removido_em is not null then
    select status, codigo into v_status, v_codigo from cap_autorizacoes where id = old.autorizacao_id;
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

-- Views
drop view cap_vw_pendentes;
create view cap_vw_pendentes with (security_invoker = true) as
select l.id, l.empresa_id, l.cod_lancamento, l.tipo_lancamento, l.cod_fornecedor, l.num_documento, l.categoria_doc, l.cod_banco,
       l.complemento_historico, l.data_emissao, l.data_vencimento, l.data_pagamento, l.valor_documento, l.valor_atualizado,
       l.tem_bordero, l.bordero_visto_em,
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
       coalesce(i.itens, 0)::int as itens, coalesce(i.titulos, 0)::int as titulos, coalesce(i.antecipacoes, 0)::int as antecipacoes,
       coalesce(i.total_titulos, 0)::numeric(14,2) as total_titulos, coalesce(i.total_antecipacoes, 0)::numeric(14,2) as total_antecipacoes,
       coalesce(i.total, 0)::numeric(14,2) as total, coalesce(i.baixados, 0)::int as baixados,
       case when a.caixa_disponivel is null then null else greatest(coalesce(i.total, 0) - a.caixa_disponivel, 0)::numeric(14,2) end as excedente
  from cap_autorizacoes a
  join empresas e on e.id = a.empresa_id
  left join perfis pc on pc.id = a.criado_por
  left join perfis pa on pa.id = a.autorizada_por
  left join perfis pk on pk.id = a.cancelada_por
  left join perfis ps on ps.id = a.slack_enviada_por
  left join lateral (
    select count(*) as itens,
           count(*) filter (where tipo = 'titulo') as titulos,
           count(*) filter (where tipo = 'antecipacao') as antecipacoes,
           sum(valor) filter (where tipo = 'titulo') as total_titulos,
           sum(valor) filter (where tipo = 'antecipacao') as total_antecipacoes,
           sum(valor) as total,
           count(*) filter (where baixado_consistem_em is not null) as baixados
      from cap_autorizacao_itens where autorizacao_id = a.id and removido_em is null
  ) i on true;

-- Funções: autorizar (pendência com o código), criar (gera o código), cancelar (devolve dados do Slack para a retirada).
create or replace function cap_autorizar(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_atual int;
  v_codigo text;
  v_empresa uuid;
  v_itens int;
  v_total numeric(14,2);
  v_prazo date;
  v_titulo text;
begin
  update cap_autorizacoes set status = 'autorizada' where id = p_id and status = 'rascunho';
  get diagnostics v_atual = row_count;
  if v_atual = 0 then
    raise exception 'Autorização não encontrada, já autorizada ou cancelada (ou você não tem acesso a ela).';
  end if;
  select codigo, empresa_id into v_codigo, v_empresa from cap_autorizacoes where id = p_id;
  select count(*), coalesce(sum(valor), 0), min(coalesce(data_vencimento, data_pagamento, v_hoje))
    into v_itens, v_total, v_prazo
    from cap_autorizacao_itens where autorizacao_id = p_id and removido_em is null;
  if v_prazo is null or v_prazo < v_hoje then v_prazo := v_hoje; end if;

  v_titulo := 'Executar autorização de pagamento ' || v_codigo || ' — ' || cap_formatar_reais(v_total);
  insert into pendencias (modulo, empresa_id, titulo, descricao, prazo, criticidade, referencia_tabela, referencia_id, link)
  select 'financeiro.contas-pagar', v_empresa, v_titulo,
         'A diretoria autorizou o pagamento de ' || v_itens || case when v_itens = 1 then ' item' else ' itens' end || ' (' || cap_formatar_reais(v_total) || '). Abra a autorização, imprima o relatório, faça os pagamentos e dê baixa no Consistem. Depois conclua esta pendência.',
         v_prazo, case when v_prazo <= v_hoje + 3 then 'alta'::criticidade else 'normal'::criticidade end,
         'cap_autorizacoes', p_id, '/financeiro/contas-pagar/autorizacoes/' || p_id
   where not exists (
     select 1 from pendencias where modulo = 'financeiro.contas-pagar' and referencia_tabela = 'cap_autorizacoes' and referencia_id = p_id
        and titulo = v_titulo and status in ('aberta', 'em_andamento'));
  return jsonb_build_object('codigo', v_codigo, 'itens', v_itens, 'total', v_total, 'prazo', v_prazo);
end $$;

drop function cap_criar_autorizacao(uuid, uuid[], text, date, boolean, numeric);
create function cap_criar_autorizacao(p_empresa uuid, p_lancamentos uuid[], p_observacao text default null, p_data date default null, p_autorizar boolean default false, p_caixa numeric default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_ok int;
  v_numero int;
  v_codigo text;
  v_data date;
  v_id uuid;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_corte date;
  v_cod text;
  v_cod_aut text;
  v_forn text;
  v_itens int;
  v_tot_t numeric(14,2);
  v_tot_a numeric(14,2);
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode montar uma autorização de pagamento.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_lancamentos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Marque pelo menos um item.';
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'Uma autorização aceita no máximo 500 itens (marcados: %).', cardinality(v_ids);
  end if;
  if not exists (select 1 from empresas where id = p_empresa and ativa) then
    raise exception 'Empresa inválida.';
  end if;
  v_data := coalesce(p_data, v_hoje);
  if v_data < v_hoje - 30 or v_data > v_hoje + 30 then
    raise exception 'A data do pagamento deve ficar até 30 dias antes ou depois de hoje.';
  end if;
  if p_caixa is not null and (p_caixa < 0 or p_caixa > 1000000000) then
    raise exception 'Caixa disponível inválido.';
  end if;

  lock table cap_autorizacoes in share row exclusive mode;

  select count(*) into v_ok from cap_lancamentos
   where id = any(v_ids) and empresa_id = p_empresa and baixado_em is null and valor_atualizado > 0 and tipo_lancamento in ('C', 'A');
  if v_ok <> cardinality(v_ids) then
    raise exception 'Um dos itens marcados já saiu dos abertos do Consistem, não é título/antecipação ou não é desta empresa. Atualize a lista e tente de novo.';
  end if;

  select cod_lancamento into v_cod from cap_lancamentos where id = any(v_ids) and tipo_lancamento = 'A' and tem_bordero = true limit 1;
  if v_cod is not null then
    raise exception 'A antecipação % já foi paga (tem borderô no Consistem). Atualize a lista.', v_cod;
  end if;

  select l.cod_lancamento, a.codigo, f.nome into v_cod, v_cod_aut, v_forn
    from cap_autorizacao_itens i
    join cap_autorizacoes a on a.id = i.autorizacao_id
    join cap_lancamentos l on l.id = i.lancamento_id
    left join cap_fornecedores f on f.empresa_id = l.empresa_id and f.cod_fornecedor = l.cod_fornecedor
   where i.lancamento_id = any(v_ids) and i.removido_em is null and a.status in ('rascunho', 'autorizada')
   limit 1;
  if v_cod is not null then
    raise exception 'O lançamento % (%) já está na autorização %.', v_cod, coalesce(v_forn, 'fornecedor'), v_cod_aut;
  end if;

  select l.cod_lancamento into v_cod
    from cap_antecipacoes_tratadas t join cap_lancamentos l on l.id = t.lancamento_id
   where t.lancamento_id = any(v_ids) and t.desfeita_em is null limit 1;
  if v_cod is not null then
    raise exception 'A antecipação % foi marcada como já paga fora do Neo Admin. Desfaça a marcação antes de incluí-la.', v_cod;
  end if;

  select nullif(valor #>> '{}', '')::date into v_corte from configuracoes
   where chave = 'financeiro.contas-pagar.antecipacoes_a_partir_de' and jsonb_typeof(valor) = 'string';
  if v_corte is not null then
    select cod_lancamento into v_cod from cap_lancamentos
     where id = any(v_ids) and tipo_lancamento = 'A' and coalesce(data_pagamento, data_emissao) < v_corte limit 1;
    if v_cod is not null then
      raise exception 'A antecipação % é anterior à data de corte (%) e é considerada paga fora do Neo Admin.', v_cod, to_char(v_corte, 'DD/MM/YYYY');
    end if;
  end if;

  select coalesce(max(numero), 0) + 1 into v_numero from cap_autorizacoes;
  v_codigo := cap_codigo_para_data(v_data);
  insert into cap_autorizacoes (numero, codigo, empresa_id, data, observacao, caixa_disponivel)
  values (v_numero, v_codigo, p_empresa, v_data, nullif(trim(p_observacao), ''), p_caixa)
  returning id into v_id;

  insert into cap_autorizacao_itens (autorizacao_id, lancamento_id, tipo, cod_lancamento, cod_fornecedor, fornecedor_nome, fornecedor_documento,
                                     num_documento, categoria_doc, data_emissao, data_vencimento, data_pagamento, valor, valor_original,
                                     complemento_historico, cod_banco, cod_portador, cod_barras, qrcode_pix, ordem)
  select v_id, l.id, case when l.tipo_lancamento = 'A' then 'antecipacao' else 'titulo' end, l.cod_lancamento, l.cod_fornecedor,
         coalesce(f.nome, 'Fornecedor ' || coalesce(l.cod_fornecedor, '?')), f.documento,
         l.num_documento, l.categoria_doc, l.data_emissao, l.data_vencimento, l.data_pagamento, l.valor_atualizado, l.valor_documento,
         l.complemento_historico, l.cod_banco, l.cod_portador, l.cod_barras, l.qrcode_pix,
         row_number() over (order by case when l.tipo_lancamento = 'A' then 1 else 0 end, coalesce(l.data_vencimento, l.data_pagamento, l.data_emissao), f.nome, l.cod_lancamento)
    from cap_lancamentos l
    left join cap_fornecedores f on f.empresa_id = l.empresa_id and f.cod_fornecedor = l.cod_fornecedor
   where l.id = any(v_ids);

  select count(*), coalesce(sum(valor) filter (where tipo = 'titulo'), 0), coalesce(sum(valor) filter (where tipo = 'antecipacao'), 0)
    into v_itens, v_tot_t, v_tot_a from cap_autorizacao_itens where autorizacao_id = v_id;

  if p_autorizar then
    perform cap_autorizar(v_id);
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'codigo', v_codigo, 'itens', v_itens, 'total_titulos', v_tot_t, 'total_antecipacoes', v_tot_a,
                            'caixa_disponivel', p_caixa, 'status', (select status from cap_autorizacoes where id = v_id));
end $$;
revoke all on function cap_criar_autorizacao(uuid, uuid[], text, date, boolean, numeric) from public, anon;
grant execute on function cap_criar_autorizacao(uuid, uuid[], text, date, boolean, numeric) to authenticated;

create or replace function cap_cancelar(p_id uuid, p_motivo text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_atual int;
  v_codigo text;
  v_pend int;
  v_file text;
  v_ts text;
begin
  update cap_autorizacoes set status = 'cancelada', motivo_cancelamento = nullif(trim(p_motivo), '')
   where id = p_id and status in ('rascunho', 'autorizada');
  get diagnostics v_atual = row_count;
  if v_atual = 0 then
    raise exception 'Autorização não encontrada ou já cancelada (ou você não tem acesso a ela).';
  end if;
  select codigo, slack_file_id, slack_message_ts into v_codigo, v_file, v_ts from cap_autorizacoes where id = p_id;
  update pendencias set status = 'cancelada'
   where modulo = 'financeiro.contas-pagar' and referencia_tabela = 'cap_autorizacoes' and referencia_id = p_id and status in ('aberta', 'em_andamento');
  get diagnostics v_pend = row_count;
  return jsonb_build_object('codigo', v_codigo, 'pendencias_canceladas', v_pend, 'enviada_slack', v_file is not null or v_ts is not null);
end $$;
