-- =========================================================
-- Neo Admin — 0700 Comercial / Pedidos: cadastro do módulo
-- Especificação: docs/modulos/comercial-pedidos.md. Ativo no menu desde a Fase 1 (carteira e faturamento, 19/10/2026);
-- as tabelas do espelho estão na 0701. Requer a 0091 (área comercial).
-- =========================================================
insert into modulos (codigo, area, nome, ativo) values ('comercial.pedidos', 'comercial', 'Pedidos', true)
on conflict (codigo) do update set ativo = true, nome = excluded.nome;
