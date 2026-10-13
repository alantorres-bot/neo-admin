-- =========================================================
-- Neo Admin — 0156 Cartão de crédito: contas contábeis do título provisório da fatura
-- Informadas pelo Alan (13/10/2026): débito 3251, crédito 2004. Com elas a configuração financeiro.cartao.provisorio fica
-- completa (histórico 1, categoria 17, portador 91, fluxo 22/24) e o fechamento passa a criar o provisório no Consistem.
-- =========================================================

update configuracoes
   set valor = valor || '{"contaContabilDebito": 3251, "contaContabilCredito": 2004}'::jsonb
 where chave = 'financeiro.cartao.provisorio';
