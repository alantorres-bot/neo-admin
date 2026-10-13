-- =========================================================
-- Neo Admin — 0144 Cartão de crédito: fornecedores genéricos por tipo de aquisição
-- Especificação: docs/modulos/financeiro-cartao.md (regra 51).
--
-- Decisão do Alan (13/10/2026): um fornecedor "Outros" por tipo de aquisição, cadastrado por ele na tela do Consistem (a API
-- ainda recusa o tipo 3) — planilha "Consulta de Fornecedores": 1372 HOSPEDAGEM, 1373 ESTACIONAMENTO E PEDAGIOS, 1374 PASSAGENS
-- AEREAS, 1375 LOCACAO DE VEICULOS, 1376 TRANSPORTE POR APLICATIVO, 1377 COMBUSTIVEIS E LUBRIFICANTES, 1378 ALIMENTACAO E
-- REFEICOES, 1379 SOFTWARES E ASSINATURAS, 1380 MATERIAL DE COPA E LIMPEZA, 1381 FARMACIA E MEDICAMENTOS.
-- Cada estabelecimento do dicionário passa a sugerir o fornecedor do seu tipo e a conta de fluxo do tipo (a da proposta,
-- decisão do Alan, mesmo onde o cadastro do fornecedor no Consistem tem outra conta). Google fica no 928 GOOGLE SUITE.
-- Os genéricos (posto, restaurante, padaria, hotel, pousada, supermercado) deixam de ser "fornecedor por compra".
-- Correios e Fretes não foi cadastrado: CORREIOS fica sem fornecedor.
-- =========================================================

update crt_estabelecimentos e
   set lancamento_erp = coalesce(e.lancamento_erp, '{}'::jsonb)
                        || jsonb_build_object('codFornecedor', v.fornecedor, 'grupoContaFluxoCaixa', v.grupo, 'contaFluxoCaixa', v.conta),
       fornecedor_por_compra = false
  from (values
    -- 1374 PASSAGENS AEREAS — 13/6 Passagens
    ('AZUL', 1374, 13, 6), ('DECOLAR', 1374, 13, 6), ('EBW', 1374, 13, 6), ('GOL', 1374, 13, 6), ('LATAM', 1374, 13, 6), ('NUVIAGENS', 1374, 13, 6),
    -- 1372 HOSPEDAGEM — 13/7 Hospedagens
    ('AIRBNB', 1372, 13, 7), ('BOOKING', 1372, 13, 7), ('HOTEIS.COM', 1372, 13, 7), ('HOTEL', 1372, 13, 7), ('POUSADA', 1372, 13, 7),
    -- 1373 ESTACIONAMENTO E PEDAGIOS — 18/7 Estacionamento, 18/8 Pedágios
    ('ESTACIONAMENTO', 1373, 18, 7), ('CONECTCAR', 1373, 18, 8), ('NUTAG', 1373, 18, 8), ('SEM PARAR', 1373, 18, 8), ('VELOE', 1373, 18, 8),
    -- 1375 LOCACAO DE VEICULOS — 22/26 Rep. Locação a Terceiro
    ('LOCADORA', 1375, 22, 26), ('LOCALIZA', 1375, 22, 26), ('MOVIDA', 1375, 22, 26), ('UNIDAS', 1375, 22, 26),
    -- 1376 TRANSPORTE POR APLICATIVO — 13/5 Viagens e Lobby
    ('UBER', 1376, 13, 5), ('99APP', 1376, 13, 5),
    -- 1377 COMBUSTIVEIS E LUBRIFICANTES — 18/4
    ('POSTO', 1377, 18, 4), ('IPIRANGA', 1377, 18, 4), ('SHELL', 1377, 18, 4), ('PETROBRAS', 1377, 18, 4),
    -- 1378 ALIMENTACAO E REFEICOES — 12/6 Alimentação
    ('RESTAURANTE', 1378, 12, 6), ('PADARIA', 1378, 12, 6), ('IFOOD', 1378, 12, 6), ('SUPERMERCADO', 1378, 12, 6),
    -- 1379 SOFTWARES E ASSINATURAS — 16/4 Softwares e Licenças
    ('ANTHROPIC', 1379, 16, 4), ('CHATGPT', 1379, 16, 4), ('CLAUDE', 1379, 16, 4), ('CLICKUP', 1379, 16, 4), ('D4SIGN', 1379, 16, 4),
    ('MICROSOFT', 1379, 16, 4), ('OPENAI', 1379, 16, 4),
    -- 928 GOOGLE SUITE (já existia) — 16/4
    ('GOOGLE', 928, 16, 4)
  ) v(padrao, fornecedor, grupo, conta)
 where e.padrao = v.padrao and not e.marketplace;

-- Farmácia: estabelecimentos novos no dicionário, com o genérico 1381 (12/24 Segurança do Trabalho).
insert into crt_estabelecimentos (padrao, categoria, conta_fluxo, ativo, lancamento_erp)
values ('DROGARIA', 'Farmácia e medicamentos', 'Segurança do Trabalho', true, '{"codFornecedor": 1381, "grupoContaFluxoCaixa": 12, "contaFluxoCaixa": 24}'),
       ('FARMACIA', 'Farmácia e medicamentos', 'Segurança do Trabalho', true, '{"codFornecedor": 1381, "grupoContaFluxoCaixa": 12, "contaFluxoCaixa": 24}')
on conflict (padrao) do nothing;
