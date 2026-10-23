-- =========================================================
-- Neo Admin — 0704 COMERCIAL: CATÁLOGO DE ATIVIDADES (Central de Gestão, Fase 3B)
-- Comissões: fechamento e reabertura. Mecanismo: 0094_nucleo_atividades.sql.
-- =========================================================
insert into atividade_regras (codigo, nome, area, modulo, fonte, tabela, gatilho, campo, valor, condicao, autor_coluna, descricao, link) values
  ('com.comissoes.fechou', 'Fechou comissões do mês', 'comercial', 'comercial.comissoes', 'auditoria', 'fin_com_fechamentos', 'muda_para', 'status', 'fechado', null, 'fechado_por',
   'Fechou as comissões de {competencia|mes}', '/comercial/comissoes/{id}'),
  ('com.comissoes.reabriu', 'Reabriu comissões do mês', 'comercial', 'comercial.comissoes', 'auditoria', 'fin_com_fechamentos', 'muda_para', 'status', 'em_conferencia', null, null,
   'Reabriu as comissões de {competencia|mes}', '/comercial/comissoes/{id}')
on conflict (codigo) do nothing;
