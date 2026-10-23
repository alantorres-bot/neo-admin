-- =========================================================
-- Neo Admin — 0522 RH/SST: CATÁLOGO DE ATIVIDADES (Central de Gestão, Fase 3B)
-- Folha, vale-transporte, ponto e banco de horas: o que a auditoria já grava, em ações de gestão.
-- Mecanismo: 0094_nucleo_atividades.sql. A justificativa do ponto pelo link público não tem conta (só o nome digitado):
-- não vira atividade de uma pessoa do sistema.
-- =========================================================
insert into atividade_regras (codigo, nome, area, modulo, fonte, tabela, gatilho, campo, valor, condicao, autor_coluna, descricao, link) values
  -- Folha
  ('rh.folha.abriu', 'Abriu folha do mês', 'rh', 'rh.folha', 'auditoria', 'rh_fp_competencias', 'insert', null, null, null, 'criado_por',
   'Abriu a folha de {competencia|mes}', '/rh/folha/mes/{id}'),
  ('rh.folha.conferiu', 'Conferiu folha', 'rh', 'rh.folha', 'auditoria', 'rh_fp_competencias', 'muda_para', 'status', 'conferida', null, 'conferida_por',
   'Conferiu a folha de {competencia|mes}', '/rh/folha/mes/{id}'),
  ('rh.folha.aprovou', 'Aprovou folha', 'rh', 'rh.folha', 'auditoria', 'rh_fp_competencias', 'muda_para', 'status', 'aprovada', null, 'aprovada_por',
   'Aprovou a folha de {competencia|mes}', '/rh/folha/mes/{id}'),
  ('rh.folha.pagou', 'Pagou folha', 'rh', 'rh.folha', 'auditoria', 'rh_fp_competencias', 'muda_para', 'status', 'paga', null, 'paga_por',
   'Marcou como paga a folha de {competencia|mes}', '/rh/folha/mes/{id}'),
  ('rh.folha.reabriu', 'Reabriu folha', 'rh', 'rh.folha', 'auditoria', 'rh_fp_competencias', 'muda_para', 'status', 'aberta', null, 'reaberta_por',
   'Reabriu a folha de {competencia|mes}: {reaberta_motivo}', '/rh/folha/mes/{id}'),
  ('rh.folha.arquivo_bb', 'Gerou arquivo do BB (folha)', 'rh', 'rh.folha', 'auditoria', 'rh_fp_competencias', 'preenche', 'arquivo_bb_gerado_em', null, null, 'arquivo_bb_gerado_por',
   'Gerou o arquivo do BB da folha de {competencia|mes}', '/rh/folha/mes/{id}'),
  -- Vale-transporte
  ('rh.vt.abriu', 'Abriu VT do mês', 'rh', 'rh.vale_transporte', 'auditoria', 'rh_vt_competencias', 'insert', null, null, null, 'criado_por',
   'Abriu o VT de {competencia|mes}', '/rh/vale_transporte/mes/{id}'),
  ('rh.vt.enviou', 'Fechou VT para aprovação', 'rh', 'rh.vale_transporte', 'auditoria', 'rh_vt_competencias', 'muda_para', 'status', 'enviada', null, 'enviada_por',
   'Fechou e enviou para aprovação o VT de {competencia|mes}', '/rh/vale_transporte/mes/{id}'),
  ('rh.vt.aprovou', 'Aprovou VT', 'rh', 'rh.vale_transporte', 'auditoria', 'rh_vt_competencias', 'muda_para', 'status', 'aprovada', null, 'aprovada_por',
   'Aprovou o VT de {competencia|mes}', '/rh/vale_transporte/mes/{id}'),
  ('rh.vt.pagou', 'Pagou VT', 'rh', 'rh.vale_transporte', 'auditoria', 'rh_vt_competencias', 'muda_para', 'status', 'paga', null, 'paga_por',
   'Marcou como pago o VT de {competencia|mes}', '/rh/vale_transporte/mes/{id}'),
  ('rh.vt.reabriu', 'Reabriu VT', 'rh', 'rh.vale_transporte', 'auditoria', 'rh_vt_competencias', 'muda_para', 'status', 'aberta', null, 'reaberta_por',
   'Reabriu o VT de {competencia|mes}: {reaberta_motivo}', '/rh/vale_transporte/mes/{id}'),
  ('rh.vt.arquivo_bb', 'Gerou arquivo do BB (VT)', 'rh', 'rh.vale_transporte', 'auditoria', 'rh_vt_competencias', 'preenche', 'arquivo_bb_gerado_em', null, null, 'arquivo_bb_gerado_por',
   'Gerou o arquivo do BB do VT de {competencia|mes}', '/rh/vale_transporte/mes/{id}'),
  -- Ponto
  ('rh.ponto.importou', 'Importou ponto', 'rh', 'rh.ponto', 'auditoria', 'rh_pt_lotes', 'insert', null, null, null, 'importado_por',
   'Importou o ponto de {periodo_inicio|data} a {periodo_fim|data}', '/rh/ponto/lote/{id}'),
  ('rh.ponto.enviou_lider', 'Enviou ponto ao líder', 'rh', 'rh.ponto', 'auditoria', 'rh_pt_lotes', 'muda_para', 'status', 'enviado', null, 'enviado_por',
   'Enviou ao líder as inconsistências do ponto de {periodo_inicio|data} a {periodo_fim|data}', '/rh/ponto/lote/{id}'),
  ('rh.ponto.devolveu', 'Devolveu justificativas ao líder', 'rh', 'rh.ponto', 'auditoria', 'rh_pt_lotes', 'muda_para', 'status', 'devolvido', null, 'devolvido_por',
   'Devolveu ao líder o ponto de {periodo_inicio|data} a {periodo_fim|data}: {devolvido_motivo}', '/rh/ponto/lote/{id}'),
  ('rh.ponto.concluiu', 'Concluiu ajustes do ponto', 'rh', 'rh.ponto', 'auditoria', 'rh_pt_lotes', 'muda_para', 'status', 'concluido', null, null,
   'Concluiu os ajustes no Control iD do ponto de {periodo_inicio|data} a {periodo_fim|data}', '/rh/ponto/lote/{id}'),
  ('rh.ponto.ajustou_ocorrencia', 'Ajustou ocorrência no Control iD', 'rh', 'rh.ponto', 'auditoria', 'rh_pt_ocorrencias', 'preenche', 'ajustado_em', null, null, 'ajustado_por',
   'Ajustou no Control iD a ocorrência de {nome} em {data|data}', '/rh/ponto/lote/{lote_id}'),
  ('rh.ponto.anexou', 'Anexou documento do ponto', 'rh', 'rh.ponto', 'anexos', 'anexos', 'insert', null, null, '{"modulo":"rh.ponto"}', null,
   'Anexou {tipo}: {nome_arquivo}', null),
  -- Banco de horas
  ('rh.bh.emitiu', 'Emitiu fechamento do banco de horas', 'rh', 'rh.banco_horas', 'auditoria', 'rh_bh_fechamentos', 'insert', null, null, null, 'emitido_por',
   'Emitiu o fechamento do banco de horas de {competencia|mes}', '/rh/banco_horas/fechamentos/{id}'),
  ('rh.bh.aprovou', 'Aprovou fechamento do banco de horas', 'rh', 'rh.banco_horas', 'auditoria', 'rh_bh_fechamentos', 'muda_para', 'status', 'aprovado', null, 'aprovado_por',
   'Aprovou o fechamento do banco de horas de {competencia|mes}', '/rh/banco_horas/fechamentos/{id}'),
  ('rh.bh.devolveu', 'Devolveu fechamento do banco de horas', 'rh', 'rh.banco_horas', 'auditoria', 'rh_bh_fechamentos', 'muda_para', 'status', 'devolvido', null, 'devolvido_por',
   'Devolveu o fechamento do banco de horas de {competencia|mes}: {devolvido_motivo}', '/rh/banco_horas/fechamentos/{id}'),
  ('rh.bh.enviou', 'Enviou banco de horas ao escritório', 'rh', 'rh.banco_horas', 'auditoria', 'rh_bh_fechamentos', 'muda_para', 'status', 'enviado', null, 'enviado_por',
   'Enviou ao escritório o banco de horas de {competencia|mes}', '/rh/banco_horas/fechamentos/{id}'),
  ('rh.bh.lancou', 'Lançou banco de horas na folha', 'rh', 'rh.banco_horas', 'auditoria', 'rh_bh_fechamentos', 'muda_para', 'status', 'lancado', null, 'lancado_por',
   'Marcou como lançado na folha o banco de horas de {competencia|mes}', '/rh/banco_horas/fechamentos/{id}')
on conflict (codigo) do nothing;
