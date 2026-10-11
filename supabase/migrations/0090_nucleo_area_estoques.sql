-- =========================================================
-- Neo Admin — 0090 Núcleo: área "Estoques" (pedido do Alan, 11/10/2026)
-- O NEOControl (EPIs, uniformes, matéria-prima, insumos e equipamentos) é de Estoques, não de RH/SST.
-- Acesso à área é dado em Configurações > Usuários, como as demais (admin geral já vê).
-- =========================================================
insert into areas (codigo, nome, sensivel, ordem) values ('estoques', 'Estoques', false, 8)
on conflict (codigo) do nothing;

update aplicativos set area = 'estoques', icone = 'package' where codigo = 'neocontrol';
