-- Contas a pagar: o que vale é o Consistem. Lançamento em aberto lá fica disponível para nova autorização,
-- mesmo que já esteja numa autorização aprovada (ex.: autorizado, não pago e depois protestado).
-- A trava continua só para rascunho: o mesmo lançamento não fica em dois rascunhos ao mesmo tempo.

create or replace function cap_adicionar_itens(p_autorizacao uuid, p_lancamentos uuid[]) returns jsonb
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
   where i.lancamento_id = any(v_ids) and i.removido_em is null and i.conferencia_banco is distinct from 'nao_pago' and a.status = 'rascunho'
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
