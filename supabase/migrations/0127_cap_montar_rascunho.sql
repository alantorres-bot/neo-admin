-- =========================================================
-- Neo Admin — 0127 Contas a pagar: montagem do rascunho na própria tela de seleção (pedido do financeiro, 11/10/2026)
-- Fluxo novo na tela "Autorizar pagamento": Salvar parcial (grava os marcados num rascunho e continua na tela) →
-- Extras (pagamentos fora do Consistem direto no rascunho) → Gerar autorização (fecha o rascunho).
-- "Rascunho em montagem" = a autorização mais recente da empresa com status 'rascunho'.
-- 1) cap_adicionar_itens: acrescenta lançamentos a um rascunho, com TODAS as validações que estavam em cap_criar_autorizacao
--    (validação num lugar só). cap_criar_autorizacao passa a criar só o cabeçalho e chamar esta função.
-- 2) cap_montar_rascunho: numa transação, acha o rascunho em montagem da empresa (ou cria um vazio), acrescenta itens,
--    caixa, observação e um pagamento extra opcional. Devolve o resumo da view.
-- =========================================================

-- 1) Acrescentar itens a um rascunho (validações) ------------------------------
create function cap_adicionar_itens(p_autorizacao uuid, p_lancamentos uuid[]) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_status cap_status_autorizacao;
  v_empresa uuid;
  v_codigo text;
  v_ok int;
  v_atuais int;
  v_corte date;
  v_cod text;
  v_cod_aut text;
  v_forn text;
  v_ordem int;
  v_novos int;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode montar uma autorização de pagamento.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_lancamentos) as x;
  if v_ids is null or cardinality(v_ids) = 0 then
    return jsonb_build_object('adicionados', 0);
  end if;

  select status, empresa_id, codigo into v_status, v_empresa, v_codigo from cap_autorizacoes where id = p_autorizacao for update;
  if v_status is null then
    raise exception 'Autorização não encontrada (ou você não tem acesso a ela).';
  end if;
  if v_status <> 'rascunho' then
    raise exception 'A autorização % não é mais rascunho; itens só entram em rascunho.', v_codigo;
  end if;
  select count(*) into v_atuais from cap_autorizacao_itens where autorizacao_id = p_autorizacao and removido_em is null;
  if v_atuais + cardinality(v_ids) > 500 then
    raise exception 'Uma autorização aceita no máximo 500 itens (ficaria com %).', v_atuais + cardinality(v_ids);
  end if;

  select count(*) into v_ok from cap_lancamentos
   where id = any(v_ids) and empresa_id = v_empresa and baixado_em is null and valor_atualizado > 0 and tipo_lancamento in ('C', 'A');
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

  select coalesce(max(ordem), 0) into v_ordem from cap_autorizacao_itens where autorizacao_id = p_autorizacao;
  -- Lançamento removido do rascunho e marcado de novo: a linha removida fica (prova); entra uma linha nova. Como há
  -- unique (autorizacao_id, lancamento_id), a nova inclusão reativa a linha removida em vez de inserir outra.
  update cap_autorizacao_itens set removido_em = null, removido_por = null, motivo_remocao = null
   where autorizacao_id = p_autorizacao and lancamento_id = any(v_ids) and removido_em is not null;

  insert into cap_autorizacao_itens (autorizacao_id, lancamento_id, tipo, cod_lancamento, cod_fornecedor, fornecedor_nome, fornecedor_documento,
                                     num_documento, categoria_doc, data_emissao, data_vencimento, data_pagamento, valor, valor_original,
                                     complemento_historico, cod_banco, cod_portador, cod_barras, qrcode_pix, ordem)
  select p_autorizacao, l.id, case when l.tipo_lancamento = 'A' then 'antecipacao' else 'titulo' end, l.cod_lancamento, l.cod_fornecedor,
         coalesce(f.nome, 'Fornecedor ' || coalesce(l.cod_fornecedor, '?')), f.documento,
         l.num_documento, l.categoria_doc, l.data_emissao, l.data_vencimento, l.data_pagamento, l.valor_atualizado, l.valor_documento,
         l.complemento_historico, l.cod_banco, l.cod_portador, l.cod_barras, l.qrcode_pix,
         v_ordem + row_number() over (order by case when l.tipo_lancamento = 'A' then 1 else 0 end, coalesce(l.data_vencimento, l.data_pagamento, l.data_emissao), f.nome, l.cod_lancamento)
    from cap_lancamentos l
    left join cap_fornecedores f on f.empresa_id = l.empresa_id and f.cod_fornecedor = l.cod_fornecedor
   where l.id = any(v_ids)
     and not exists (select 1 from cap_autorizacao_itens i where i.autorizacao_id = p_autorizacao and i.lancamento_id = l.id);
  get diagnostics v_novos = row_count;
  return jsonb_build_object('adicionados', cardinality(v_ids), 'inseridos', v_novos);
end $$;
revoke all on function cap_adicionar_itens(uuid, uuid[]) from public, anon;
grant execute on function cap_adicionar_itens(uuid, uuid[]) to authenticated;

-- O gatilho dos itens precisa deixar a "reativação" (removido_em volta a nulo) passar enquanto é rascunho.
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

-- 2) Criar: só o cabeçalho; os itens entram por cap_adicionar_itens --------------
create or replace function cap_criar_autorizacao(p_empresa uuid, p_lancamentos uuid[], p_observacao text default null, p_data date default null, p_autorizar boolean default false, p_caixa numeric default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ids uuid[];
  v_numero int;
  v_codigo text;
  v_data date;
  v_id uuid;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
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
  select coalesce(max(numero), 0) + 1 into v_numero from cap_autorizacoes;
  v_codigo := cap_codigo_para_data(v_data);
  insert into cap_autorizacoes (numero, codigo, empresa_id, data, observacao, caixa_disponivel)
  values (v_numero, v_codigo, p_empresa, v_data, nullif(trim(p_observacao), ''), p_caixa)
  returning id into v_id;

  perform cap_adicionar_itens(v_id, v_ids);

  select count(*), coalesce(sum(valor) filter (where tipo = 'titulo'), 0), coalesce(sum(valor) filter (where tipo = 'antecipacao'), 0)
    into v_itens, v_tot_t, v_tot_a from cap_autorizacao_itens where autorizacao_id = v_id and removido_em is null;

  if p_autorizar then
    perform cap_autorizar(v_id);
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'codigo', v_codigo, 'itens', v_itens, 'total_titulos', v_tot_t, 'total_antecipacoes', v_tot_a,
                            'caixa_disponivel', p_caixa, 'status', (select status from cap_autorizacoes where id = v_id));
end $$;

-- 3) Montar o rascunho em montagem da empresa ------------------------------------
-- p_extra: {"descricao": "...", "favorecido": "...", "valor": 123.45} (opcional). p_data: só vale ao criar (define o código DDMMAA).
create function cap_montar_rascunho(p_empresa uuid, p_lancamentos uuid[], p_caixa numeric default null, p_observacao text default null, p_extra jsonb default null, p_data date default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_criado boolean := false;
  v_ids uuid[];
  r record;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) pode montar uma autorização de pagamento.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_lancamentos) as x;
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  lock table cap_autorizacoes in share row exclusive mode;
  select id into v_id from cap_autorizacoes where empresa_id = p_empresa and status = 'rascunho' order by numero desc limit 1 for update;
  if v_id is null then
    v_id := (cap_criar_autorizacao(p_empresa, '{}'::uuid[], p_observacao, p_data, false, p_caixa) ->> 'id')::uuid;
    v_criado := true;
  else
    if p_caixa is not null then
      perform cap_definir_caixa(v_id, p_caixa);
    end if;
    if p_observacao is not null then
      update cap_autorizacoes set observacao = nullif(trim(p_observacao), '') where id = v_id;
    end if;
  end if;

  if cardinality(v_ids) > 0 then
    perform cap_adicionar_itens(v_id, v_ids);
  end if;

  if p_extra is not null and jsonb_typeof(p_extra) = 'object' then
    perform cap_incluir_extra(v_id, p_extra ->> 'descricao', p_extra ->> 'favorecido', (p_extra ->> 'valor')::numeric);
  end if;

  select id, codigo, itens, extras, total, total_extras, caixa_disponivel, observacao into r from cap_vw_autorizacoes where id = v_id;
  return jsonb_build_object('id', r.id, 'codigo', r.codigo, 'criado', v_criado, 'itens', r.itens, 'extras', r.extras, 'total', r.total,
                            'total_extras', r.total_extras, 'caixa_disponivel', r.caixa_disponivel, 'observacao', r.observacao);
end $$;
revoke all on function cap_montar_rascunho(uuid, uuid[], numeric, text, jsonb, date) from public, anon;
grant execute on function cap_montar_rascunho(uuid, uuid[], numeric, text, jsonb, date) to authenticated;
