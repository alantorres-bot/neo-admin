-- =========================================================
-- Neo Admin — 0091 Núcleo: área "Comercial" (pedido do Alan, 19/10/2026)
-- Recebe o módulo Pedidos (docs/modulos/comercial-pedidos.md), construído sobre a API Comercial do Consistem.
-- Faixa de migrations da área: 0700–0799. Acesso dado em Configurações > Usuários, como as demais (admin geral já vê).
-- =========================================================
insert into areas (codigo, nome, sensivel, ordem) values ('comercial', 'Comercial', false, 9)
on conflict (codigo) do nothing;
