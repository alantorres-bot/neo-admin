-- =========================================================
-- Neo Admin — 0141 Cartão de crédito: estabelecimentos genéricos têm fornecedor por compra
-- Especificação: docs/modulos/financeiro-cartao.md (regra 47).
--
-- Decisão do Alan (13/10/2026): posto, restaurante, padaria, hotel, pousada e supermercado não têm fornecedor fixo — cada
-- compra é numa empresa diferente. No diálogo de lançar, o operador busca o fornecedor da compra ou cadastra um "Outros".
-- Na aba Estabelecimentos eles mostram "fornecedor por compra" (sem "Ligar ou cadastrar").
-- =========================================================

alter table crt_estabelecimentos add column fornecedor_por_compra boolean not null default false;
comment on column crt_estabelecimentos.fornecedor_por_compra is 'Estabelecimento genérico (posto, restaurante...): sem fornecedor fixo; o fornecedor é escolhido ou cadastrado em cada compra.';
update crt_estabelecimentos set fornecedor_por_compra = true
 where padrao in ('POSTO', 'RESTAURANTE', 'PADARIA', 'HOTEL', 'POUSADA', 'SUPERMERCADO');
