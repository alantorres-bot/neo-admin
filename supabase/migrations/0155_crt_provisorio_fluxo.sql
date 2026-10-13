-- =========================================================
-- Neo Admin — 0155 Cartão de crédito: conta de fluxo do título provisório da fatura
-- Decisão do Alan (13/10/2026): 22/24 Despesas Financeiras › Cartão de Crédito Empresa. As contas contábeis de débito e crédito
-- do provisório ainda serão informadas por ele (até lá o fechamento abre a pendência "Criar o provisório").
-- =========================================================

update configuracoes
   set valor = valor || '{"grupoContaFluxoCaixa": 22, "contaFluxoCaixa": 24}'::jsonb
 where chave = 'financeiro.cartao.provisorio';
