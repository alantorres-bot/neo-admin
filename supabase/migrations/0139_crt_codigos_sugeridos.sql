-- =========================================================
-- Neo Admin — 0139 Cartão de crédito: códigos sugeridos para lançar compras no Consistem
-- Especificação: docs/modulos/financeiro-cartao.md (regras 38 e 39).
--
-- Proposta tirada de 1.203 compras de cartão lançadas à mão no último ano (ação exemplos_compras_cartao, 13/10/2026),
-- aprovada pelo Alan em 13/10/2026 ("pode carregar todas"). São SUGESTÕES: o operador confere e pode mudar no diálogo.
--   - Padrões de todos os cartões: histórico 2, categoria 17, conta contábil de crédito 2004; portador 91 (Inter PJ: 77).
--   - Por tipo de despesa (estabelecimentos do dicionário): grupo/conta de fluxo e conta contábil de débito.
--   - Fornecedor fica vazio: cada estabelecimento terá um fornecedor próprio cadastrado no Consistem.
--   - "Combustível no Inter PJ" (fluxo 29/11, débito 3238) não foi carregado: o dicionário é por estabelecimento, não por
--     cartão, e esse grupo de fluxo só apareceu nos títulos do Inter PJ. Petrobras recebe o seu (18/4, 3344).
-- =========================================================

update crt_cartoes
   set lancamento_compras = jsonb_build_object('codPortador', case when codigo = 'INTER PJ' then 77 else 91 end,
                                               'categoriaDoc', 17, 'codHistorico', 2, 'contaContabilCredito', 2004)
 where lancamento_compras is null;

update crt_estabelecimentos e
   set lancamento_erp = coalesce(e.lancamento_erp, '{}'::jsonb)
                        || jsonb_build_object('grupoContaFluxoCaixa', v.grupo, 'contaFluxoCaixa', v.conta, 'contaContabilDebito', v.debito)
  from (values
    ('AZUL', 13, 6, 3338), ('DECOLAR', 13, 6, 3338), ('EBW', 13, 6, 3338), ('GOL', 13, 6, 3338), ('LATAM', 13, 6, 3338), ('NUVIAGENS', 13, 6, 3338),
    ('UBER', 13, 5, 3435),
    ('PETROBRAS', 18, 4, 3344),
    ('ANTHROPIC', 16, 4, 1153), ('CHATGPT', 16, 4, 1153), ('CLAUDE', 16, 4, 1153), ('CLICKUP', 16, 4, 1153), ('D4SIGN', 16, 4, 1153),
    ('GOOGLE', 16, 4, 1153), ('MICROSOFT', 16, 4, 1153), ('OPENAI', 16, 4, 1153),
    ('MERCADOLIVRE', 22, 5, 1153), ('MERCADO*MERCADOLIVRE', 22, 5, 1153), ('EBAZAR', 22, 5, 1153),
    ('PADARIA', 10, 15, 1086), ('RESTAURANTE', 10, 15, 1086), ('SUPERMERCADO', 10, 15, 1086), ('IFOOD', 10, 15, 1086),
    ('LOCADORA', 22, 26, 3152), ('LOCALIZA', 22, 26, 3152), ('MOVIDA', 22, 26, 3152), ('UNIDAS', 22, 26, 3152)
  ) v(padrao, grupo, conta, debito)
 where e.padrao = v.padrao;
