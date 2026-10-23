-- =========================================================
-- Neo Admin — 0207 FISCAL: CATÁLOGO DE ATIVIDADES (Central de Gestão, Fase 3B)
-- Créditos tributários (Fiscal Control): o que a auditoria já grava, em ações de gestão.
-- Mecanismo: 0094_nucleo_atividades.sql. A conclusão de tarefa fiscal já aparece como "Concluiu pendência" (a tarefa
-- espelha a pendência), então não há regra própria para ela.
-- =========================================================
insert into atividade_regras (codigo, nome, area, modulo, fonte, tabela, gatilho, campo, valor, condicao, autor_coluna, descricao, link) values
  ('fis.obrigacao.transmitiu', 'Transmitiu obrigação', 'fiscal', 'fiscal.creditos', 'auditoria', 'fis_obrigacoes', 'muda_para', 'status', 'transmitida', null, 'transmitida_por',
   'Transmitiu a obrigação da competência {competencia|mes} (recibo {numero_recibo})', '/fiscal/creditos/obrigacoes/{id}'),
  ('fis.obrigacao.conferiu', 'Conferiu entrega de obrigação', 'fiscal', 'fiscal.creditos', 'auditoria', 'fis_obrigacoes', 'muda_para', 'status', 'entregue_conferida', null, 'conferida_por',
   'Conferiu a entrega da obrigação da competência {competencia|mes}', '/fiscal/creditos/obrigacoes/{id}'),
  ('fis.obrigacao.retificou', 'Retificou obrigação', 'fiscal', 'fiscal.creditos', 'auditoria', 'fis_obrigacoes', 'muda_para', 'status', 'retificada', null, null,
   'Retificou a obrigação da competência {competencia|mes}', '/fiscal/creditos/obrigacoes/{id}'),
  ('fis.credito.registrou', 'Registrou crédito', 'fiscal', 'fiscal.creditos', 'auditoria', 'fis_creditos', 'insert', null, null, null, 'responsavel_lancamento',
   'Registrou o crédito {codigo}: {descricao}', '/fiscal/creditos/creditos/{id}'),
  ('fis.credito.validou', 'Validou crédito', 'fiscal', 'fiscal.creditos', 'auditoria', 'fis_creditos', 'muda_para', 'validacao', 'validado', null, 'validado_por',
   'Validou o crédito {codigo}', '/fiscal/creditos/creditos/{id}'),
  ('fis.credito.rejeitou', 'Rejeitou crédito', 'fiscal', 'fiscal.creditos', 'auditoria', 'fis_creditos', 'muda_para', 'validacao', 'rejeitado', null, 'validado_por',
   'Rejeitou o crédito {codigo}', '/fiscal/creditos/creditos/{id}'),
  ('fis.periodo.enviou_revisao', 'Enviou apuração para revisão', 'fiscal', 'fiscal.creditos', 'auditoria', 'fis_periodos', 'muda_para', 'status', 'em_revisao', null, 'enviado_revisao_por',
   'Enviou para revisão a apuração de {competencia|mes}', '/fiscal/creditos/apuracao'),
  ('fis.periodo.fechou', 'Fechou apuração', 'fiscal', 'fiscal.creditos', 'auditoria', 'fis_periodos', 'muda_para', 'status', 'fechado', null, 'fechado_por',
   'Fechou a apuração de {competencia|mes}', '/fiscal/creditos/apuracao'),
  ('fis.divergencia.resolveu', 'Resolveu divergência', 'fiscal', 'fiscal.creditos', 'auditoria', 'fis_divergencias', 'muda_para', 'status', 'resolvida', null, 'resolvido_por',
   'Resolveu a divergência nº {numero}', '/fiscal/creditos/conciliacao'),
  ('fis.divergencia.justificou', 'Justificou divergência', 'fiscal', 'fiscal.creditos', 'auditoria', 'fis_divergencias', 'muda_para', 'status', 'justificada', null, 'resolvido_por',
   'Justificou a divergência nº {numero}', '/fiscal/creditos/conciliacao'),
  ('fis.tarefa.abriu', 'Abriu tarefa fiscal', 'fiscal', 'fiscal.creditos', 'auditoria', 'fis_tarefas', 'insert', null, null, null, 'solicitante_id',
   'Abriu a tarefa "{titulo}"', '/fiscal/creditos/tarefas?tarefa={id}'),
  ('fis.documento.enviou', 'Enviou documento fiscal', 'fiscal', 'fiscal.creditos', 'auditoria', 'fis_documentos', 'insert', null, null, null, 'enviado_por',
   'Enviou o documento "{titulo}" (versão {versao})', '/fiscal/creditos/documentos?doc={id}')
on conflict (codigo) do nothing;
