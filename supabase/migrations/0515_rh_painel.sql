-- =========================================================
-- Neo Admin — 0515 RH/SST > Painel do RH
-- Tela inicial do RH (/rh/painel): fechamento da folha em andamento, folha aguardando aprovação, números do ano, gráfico
-- mês a mês e Fila do RH. Só leitura (das tabelas da folha, do cadastro único e das pendências, com a RLS de quem chama).
-- Especificação: docs/modulos/rh-painel.md.
-- =========================================================
insert into modulos (codigo, area, nome, ativo) values ('rh.painel', 'rh', 'Painel do RH', true)
  on conflict (codigo) do update set ativo = true, nome = excluded.nome;
