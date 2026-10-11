-- =========================================================
-- Neo Admin — 0126 Contas a pagar: pagamentos extras na autorização (pedido do financeiro, 11/10/2026)
-- A diretoria às vezes manda pagar algo que NÃO existe no Consistem (frete avulso, reembolso, taxa, fornecedor ainda sem
-- título). Esses pedidos entram num terceiro bloco da autorização, com descrição, favorecido e valor, e somam na programação
-- (total, caixa/excedente, pendência, relatório). Mesma regra dos itens: só em rascunho, nunca apagados, registro de prova.
-- Uma autorização pode ter só extras (ex.: "pagar o frete avulso hoje"): cap_criar_autorizacao aceita rascunho vazio.
-- =========================================================

-- 1) Tabela ---------------------------------------------------------------
create table cap_autorizacao_extras (
  id uuid primary key default gen_random_uuid(),
  autorizacao_id uuid not null references cap_autorizacoes(id),
  descricao text not null check (length(trim(descricao)) between 3 and 200),
  favorecido text not null check (length(trim(favorecido)) between 2 and 120),
  valor numeric(14,2) not null check (valor > 0),
  ordem int not null default 0,
  criado_por uuid references perfis(id),
  criado_em timestamptz not null default now(),
  removido_em timestamptz,                               -- só em rascunho; nunca delete
  removido_por uuid references perfis(id),
  motivo_remocao text
);
create index idx_cap_extras_autorizacao on cap_autorizacao_extras (autorizacao_id) where removido_em is null;
comment on table cap_autorizacao_extras is 'Pagamentos extras (fora do Consistem) de uma autorização de pagamento: descrição, favorecido e valor. Só entram e saem em rascunho; nunca apagados.';

-- 2) Gatilho: só em rascunho; imutável, exceto a remoção (com motivo) -------
create function fn_cap_extra_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status cap_status_autorizacao;
  v_codigo text;
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
    return new;
  end if;

  if auth.uid() is null then
    if to_jsonb(new) <> to_jsonb(old) then
      raise exception 'Pagamentos extras são imutáveis.';
    end if;
    return new;
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
create trigger trg_cap_extras_regras before insert or update on cap_autorizacao_extras for each row execute function fn_cap_extra_regras();
create trigger trg_cap_extras_sem_delete before delete on cap_autorizacao_extras for each row execute function fn_bloquear_delete();
create trigger trg_aud_cap_extras after insert or update on cap_autorizacao_extras for each row execute function fn_auditoria();

-- 3) RLS -------------------------------------------------------------------
alter table cap_autorizacao_extras enable row level security;
create policy cap_extras_ler on cap_autorizacao_extras for select to authenticated using (tem_acesso_area('financeiro'));
create policy cap_extras_inserir on cap_autorizacao_extras for insert to authenticated with check (tem_acesso_area('financeiro', 'operador'));
create policy cap_extras_alterar on cap_autorizacao_extras for update to authenticated
  using (tem_acesso_area('financeiro', 'operador')) with check (tem_acesso_area('financeiro', 'operador'));
-- Sem delete: o gatilho bloqueia e não há política.

-- 4) Autorizar exige ao menos 1 item do Consistem OU 1 pagamento extra ---------
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

-- 5) View: extras e total somando itens + extras --------------------------
drop view cap_vw_autorizacoes;
create view cap_vw_autorizacoes with (security_invoker = true) as
select a.*, e.nome_curto as empresa_nome, e.razao_social as empresa_razao_social, e.cnpj as empresa_cnpj,
       pc.nome as criado_por_nome, pa.nome as autorizada_por_nome, pk.nome as cancelada_por_nome, ps.nome as slack_enviada_por_nome,
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

-- 6) Funções -----------------------------------------------------------------
-- Incluir um pagamento extra no rascunho (operador ou acima). Devolve o novo total da autorização.
create function cap_incluir_extra(p_autorizacao uuid, p_descricao text, p_favorecido text, p_valor numeric) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_status cap_status_autorizacao;
  v_codigo text;
  v_n int;
  v_id uuid;
  v_total numeric(14,2);
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode incluir pagamentos extras.';
  end if;
  select status, codigo into v_status, v_codigo from cap_autorizacoes where id = p_autorizacao;
  if v_status is null then
    raise exception 'Autorização não encontrada (ou você não tem acesso a ela).';
  end if;
  if v_status <> 'rascunho' then
    raise exception 'Pagamentos extras só entram em uma autorização em rascunho (a % está %).', v_codigo, v_status;
  end if;
  if length(trim(coalesce(p_descricao, ''))) < 3 or length(trim(p_descricao)) > 200 then
    raise exception 'Informe a descrição do pagamento (3 a 200 caracteres).';
  end if;
  if length(trim(coalesce(p_favorecido, ''))) < 2 or length(trim(p_favorecido)) > 120 then
    raise exception 'Informe o favorecido (quem recebe), com 2 a 120 caracteres.';
  end if;
  if p_valor is null or p_valor <= 0 or p_valor > 100000000 then
    raise exception 'Valor inválido: informe um valor maior que zero.';
  end if;
  select count(*) into v_n from cap_autorizacao_extras where autorizacao_id = p_autorizacao and removido_em is null;
  if v_n >= 100 then
    raise exception 'Uma autorização aceita no máximo 100 pagamentos extras.';
  end if;

  insert into cap_autorizacao_extras (autorizacao_id, descricao, favorecido, valor, ordem)
  values (p_autorizacao, trim(p_descricao), trim(p_favorecido), round(p_valor, 2),
          (select coalesce(max(ordem), 0) + 1 from cap_autorizacao_extras where autorizacao_id = p_autorizacao))
  returning id into v_id;

  select total into v_total from cap_vw_autorizacoes where id = p_autorizacao;
  return jsonb_build_object('id', v_id, 'codigo', v_codigo, 'extras', v_n + 1, 'total', v_total);
end $$;
revoke all on function cap_incluir_extra(uuid, text, text, numeric) from public, anon;
grant execute on function cap_incluir_extra(uuid, text, text, numeric) to authenticated;

-- Remover (com motivo; nunca delete). Como cap_remover_item.
create function cap_remover_extra(p_extra uuid, p_motivo text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_atual int;
  v_aut uuid;
  v_restantes int;
  v_total numeric(14,2);
begin
  update cap_autorizacao_extras set removido_em = now(), motivo_remocao = nullif(trim(p_motivo), '')
   where id = p_extra and removido_em is null
  returning autorizacao_id into v_aut;
  get diagnostics v_atual = row_count;
  if v_atual = 0 then
    raise exception 'Pagamento extra não encontrado ou já removido (ou você não tem acesso a ele).';
  end if;
  select count(*) into v_restantes from cap_autorizacao_extras where autorizacao_id = v_aut and removido_em is null;
  select total into v_total from cap_vw_autorizacoes where id = v_aut;
  return jsonb_build_object('restantes', v_restantes, 'total', v_total);
end $$;
revoke all on function cap_remover_extra(uuid, text) from public, anon;
grant execute on function cap_remover_extra(uuid, text) to authenticated;

-- Autorizar: a pendência soma itens + extras.
create or replace function cap_autorizar(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
  v_atual int;
  v_codigo text;
  v_empresa uuid;
  v_itens int;
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
  select count(*), coalesce(sum(valor), 0), min(coalesce(data_vencimento, data_pagamento, v_hoje))
    into v_itens, v_total, v_prazo
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
         'A diretoria autorizou o pagamento de ' || v_quantos || ' (' || cap_formatar_reais(v_total) || '). Abra a autorização, imprima o relatório, faça os pagamentos e dê baixa no Consistem. Depois conclua esta pendência.',
         v_prazo, case when v_prazo <= v_hoje + 3 then 'alta'::criticidade else 'normal'::criticidade end,
         'cap_autorizacoes', p_id, '/financeiro/contas-pagar/autorizacoes/' || p_id
   where not exists (
     select 1 from pendencias where modulo = 'financeiro.contas-pagar' and referencia_tabela = 'cap_autorizacoes' and referencia_id = p_id
        and titulo = v_titulo and status in ('aberta', 'em_andamento'));
  return jsonb_build_object('codigo', v_codigo, 'itens', v_itens, 'extras', v_extras, 'total', v_total, 'prazo', v_prazo);
end $$;

-- Criar: rascunho vazio (sem lançamentos) é permitido, para receber só pagamentos extras. Autorizar na hora continua exigindo itens.
create or replace function cap_criar_autorizacao(p_empresa uuid, p_lancamentos uuid[], p_observacao text default null, p_data date default null, p_autorizar boolean default false, p_caixa numeric default null)
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
    if p_autorizar then
      raise exception 'Marque pelo menos um item.';
    end if;
    v_ids := '{}'::uuid[];
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

  if cardinality(v_ids) > 0 then
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
