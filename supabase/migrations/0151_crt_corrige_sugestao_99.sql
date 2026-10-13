-- =========================================================
-- Neo Admin — 0151 Cartão de crédito: corrige a sugestão do estabelecimento "99" (contas contábeis invertidas)
--
-- No primeiro uso real (13/10/2026) o "Lembrar" gravou para "99" débito 2004 e crédito 3241 (invertidas: 2004 é a conta de
-- crédito — fornecedores — de todos os títulos de cartão). A sugestão volta ao padrão da Uber (mesmo tipo): débito 3435,
-- crédito 2004. O título 33626 já criado no Consistem com as contas invertidas é corrigido lá pelo financeiro.
-- O painel passa a recusar débito igual à conta de crédito padrão do cartão.
-- =========================================================

update crt_estabelecimentos
   set lancamento_erp = lancamento_erp || '{"contaContabilDebito": 3435, "contaContabilCredito": 2004}'::jsonb
 where padrao = '99' and (lancamento_erp ->> 'contaContabilDebito') = '2004';
