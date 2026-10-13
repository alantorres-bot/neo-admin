-- =========================================================
-- Neo Admin — 0161 Contas a pagar: sem a confirmação CCFFB014 (Fase 4d desligada, 13/10/2026)
-- O Consistem passou a "Sem Controle" no campo "Controle de Apresentação de Documento" da rotina CCFFB000 (orientação da
-- Consistem nos chamados 557808 e 561244): o título entra no borderô sem ser confirmado no CCFFB014. O controle passa a ser a
-- autorização + a conferência com o banco (Fase 4e) do Neo Admin. A pendência deixa de mandar confirmar no CCFFB014.
-- As colunas da Fase 4d (cap_lancamentos.confirmado_consistem, cap_autorizacao_itens.confirmado_consistem_em, …) ficam como
-- histórico; a sincronização para de preenchê-las. Especificação: docs/modulos/financeiro-contas-pagar.md (seção 16).
-- =========================================================

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
         'A diretoria autorizou o pagamento de ' || v_quantos || ' (' || cap_formatar_reais(v_total) || '). Abra a autorização, monte o borderô, faça os pagamentos, confira com o banco e dê baixa no Consistem. Depois conclua esta pendência.',
         v_prazo, case when v_prazo <= v_hoje + 3 then 'alta'::criticidade else 'normal'::criticidade end,
         'cap_autorizacoes', p_id, '/financeiro/contas-pagar/autorizacoes/' || p_id
   where not exists (
     select 1 from pendencias where modulo = 'financeiro.contas-pagar' and referencia_tabela = 'cap_autorizacoes' and referencia_id = p_id
        and titulo = v_titulo and status in ('aberta', 'em_andamento'));
  return jsonb_build_object('codigo', v_codigo, 'itens', v_itens, 'extras', v_extras, 'total', v_total, 'prazo', v_prazo);
end $$;

-- Pendências já abertas com o texto antigo (ex.: autorização 131026-2).
update pendencias
   set descricao = replace(descricao, 'Abra a autorização, confirme os documentos no Consistem (CCFFB014), monte o borderô, faça os pagamentos e dê baixa. Depois conclua esta pendência.', 'Abra a autorização, monte o borderô, faça os pagamentos, confira com o banco e dê baixa no Consistem. Depois conclua esta pendência.')
 where modulo = 'financeiro.contas-pagar' and referencia_tabela = 'cap_autorizacoes'
   and status in ('aberta', 'em_andamento') and descricao like '%CCFFB014%';
