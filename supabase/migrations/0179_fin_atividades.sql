-- =========================================================
-- Neo Admin — 0179 FINANCEIRO: CATÁLOGO DE ATIVIDADES (Central de Gestão, Fase 3B)
-- Regras que traduzem o que o Financeiro já grava (auditoria, interacoes, anexos) em ações de gestão.
-- Mecanismo e regras gerais: 0094_nucleo_atividades.sql. Especificação: docs/modulos/administrativo-gestao.md, 5.9.
-- No Recebíveis/Cobrança a ação vem de `interacoes` (é ali que cada rotina registra o que a pessoa fez); a mudança de
-- estágio do título que a acompanha não gera uma segunda atividade.
-- =========================================================
insert into atividade_regras (codigo, nome, area, modulo, fonte, tabela, gatilho, campo, valor, condicao, autor_coluna, descricao, link) values
  -- Recebíveis e Cobrança (interações registradas pelas rotinas do módulo)
  ('fin.cob.confirmou_pagamento', 'Confirmou pagamento', 'financeiro', 'financeiro.cobranca', 'interacoes', 'interacoes', 'insert', null, null,
   '{"tipo":"confirmacao","referencia_tabela":"rec_titulos"}', null, 'Confirmou pagamento: {descricao}', '/financeiro/recebiveis/{referencia_id}'),
  ('fin.cob.sem_resposta', 'Tentou confirmar (sem resposta)', 'financeiro', 'financeiro.cobranca', 'interacoes', 'interacoes', 'insert', null, null,
   '{"tipo":"sem_resposta_confirmacao","referencia_tabela":"rec_titulos"}', null, 'Tentou confirmar o pagamento, sem resposta: {descricao}', '/financeiro/recebiveis/{referencia_id}'),
  ('fin.cob.registrou_cobranca', 'Registrou cobrança', 'financeiro', 'financeiro.cobranca', 'interacoes', 'interacoes', 'insert', null, null,
   '{"tipo":"cobranca","referencia_tabela":"rec_titulos"}', null, '{descricao}', '/financeiro/recebiveis/{referencia_id}'),
  ('fin.cob.registrou_promessa', 'Registrou promessa de pagamento', 'financeiro', 'financeiro.cobranca', 'interacoes', 'interacoes', 'insert', null, null,
   '{"tipo":"promessa","referencia_tabela":"rec_titulos"}', null, 'Promessa de pagamento: {descricao}', '/financeiro/recebiveis/{referencia_id}'),
  ('fin.cob.registrou_posicao', 'Registrou posição do cliente', 'financeiro', 'financeiro.cobranca', 'interacoes', 'interacoes', 'insert', null, null,
   '{"tipo":"posicao","referencia_tabela":"rec_titulos"}', null, 'Posição do cliente: {descricao}', '/financeiro/recebiveis/{referencia_id}'),
  ('fin.cob.registrou_contestacao', 'Registrou contestação', 'financeiro', 'financeiro.cobranca', 'interacoes', 'interacoes', 'insert', null, null,
   '{"tipo":"contestacao","referencia_tabela":"rec_titulos"}', null, 'Contestação: {descricao}', '/financeiro/recebiveis/{referencia_id}'),
  ('fin.cob.deu_baixa', 'Deu baixa em título', 'financeiro', 'financeiro.cobranca', 'interacoes', 'interacoes', 'insert', null, null,
   '{"tipo":"baixa","referencia_tabela":"rec_titulos"}', null, 'Baixa: {descricao}', '/financeiro/recebiveis/{referencia_id}'),
  ('fin.cob.cancelou_titulo', 'Cancelou título', 'financeiro', 'financeiro.cobranca', 'interacoes', 'interacoes', 'insert', null, null,
   '{"tipo":"cancelamento","referencia_tabela":"rec_titulos"}', null, 'Cancelamento: {descricao}', '/financeiro/recebiveis/{referencia_id}'),
  ('fin.rec.enviou_boleto', 'Enviou boleto', 'financeiro', 'financeiro.recebiveis', 'interacoes', 'interacoes', 'insert', null, null,
   '{"tipo":"boleto_enviado","referencia_tabela":"rec_titulos"}', null, '{descricao}', '/financeiro/recebiveis/{referencia_id}'),
  ('fin.rec.enviou_dados', 'Enviou dados de pagamento', 'financeiro', 'financeiro.recebiveis', 'interacoes', 'interacoes', 'insert', null, null,
   '{"tipo":"dados_enviados","referencia_tabela":"rec_titulos"}', null, '{descricao}', '/financeiro/recebiveis/{referencia_id}'),
  ('fin.rec.definiu_forma', 'Definiu forma de pagamento', 'financeiro', 'financeiro.recebiveis', 'interacoes', 'interacoes', 'insert', null, null,
   '{"tipo":"forma_pagamento","referencia_tabela":"rec_titulos"}', null, '{descricao}', '/financeiro/recebiveis/{referencia_id}'),
  ('fin.rec.rascunho_gmail', 'Gerou e-mail (rascunho)', 'financeiro', 'financeiro.recebiveis', 'interacoes', 'interacoes', 'insert', null, null,
   '{"tipo":"rascunho_gmail","referencia_tabela":"rec_titulos"}', null, 'Rascunho no Gmail: {descricao}', '/financeiro/recebiveis/{referencia_id}'),
  ('fin.rec.anexou_boleto', 'Anexou boleto', 'financeiro', 'financeiro.recebiveis', 'anexos', 'anexos', 'insert', null, null,
   '{"tipo":"boleto","referencia_tabela":"rec_titulos"}', null, 'Anexou o boleto {nome_arquivo}', '/financeiro/recebiveis/{referencia_id}'),
  -- Faturamento Filial (kits e remessas)
  ('fin.filial.anexou_documento', 'Anexou documento do kit', 'financeiro', 'financeiro.filial', 'anexos', 'anexos', 'insert', null, null,
   '{"referencia_tabela":"rec_kits"}', null, 'Anexou {tipo}: {nome_arquivo}', '/financeiro/filial/{referencia_id}'),
  ('fin.filial.enviou_kit', 'Enviou kit ao cliente', 'financeiro', 'financeiro.filial', 'auditoria', 'rec_kits', 'muda_para', 'estagio', 'enviada', null, 'enviado_por',
   'Enviou o kit da NF {nota_fiscal} — {cliente_nome}', '/financeiro/filial/{id}'),
  ('fin.filial.enviou_nota', 'Enviou nota antes do boleto', 'financeiro', 'financeiro.filial', 'auditoria', 'rec_kits', 'preenche', 'nota_enviada_em', null, null, 'nota_enviada_por',
   'Enviou a nota e o demonstrativo da NF {nota_fiscal} — {cliente_nome}', '/financeiro/filial/{id}'),
  ('fin.filial.cancelou_kit', 'Cancelou kit', 'financeiro', 'financeiro.filial', 'auditoria', 'rec_kits', 'muda_para', 'estagio', 'cancelada', null, 'cancelada_por',
   'Cancelou o kit da NF {nota_fiscal}: {motivo_cancelamento}', '/financeiro/filial/{id}'),
  ('fin.filial.criou_remessa', 'Criou remessa', 'financeiro', 'financeiro.filial', 'auditoria', 'rec_remessas', 'insert', null, null, null, 'criado_por',
   'Criou a remessa nº {numero}', '/financeiro/filial/remessas/{numero}'),
  -- Contas a pagar
  ('fin.cap.autorizou', 'Autorizou pagamento', 'financeiro', 'financeiro.contas-pagar', 'auditoria', 'cap_autorizacoes', 'muda_para', 'status', 'autorizada', null, 'autorizada_por',
   'Autorizou os pagamentos {codigo}', '/financeiro/contas-pagar/autorizacoes/{id}'),
  ('fin.cap.cancelou', 'Cancelou autorização', 'financeiro', 'financeiro.contas-pagar', 'auditoria', 'cap_autorizacoes', 'muda_para', 'status', 'cancelada', null, 'cancelada_por',
   'Cancelou a autorização {codigo}', '/financeiro/contas-pagar/autorizacoes/{id}'),
  ('fin.cap.enviou_slack', 'Enviou autorização no Slack', 'financeiro', 'financeiro.contas-pagar', 'auditoria', 'cap_autorizacoes', 'preenche', 'slack_enviada_em', null, null, 'slack_enviada_por',
   'Enviou no Slack a autorização {codigo}', '/financeiro/contas-pagar/autorizacoes/{id}'),
  -- Cartão de crédito
  ('fin.crt.importou_fatura', 'Importou fatura do cartão', 'financeiro', 'financeiro.cartao', 'auditoria', 'crt_ciclos', 'muda_para', 'situacao', 'em_conciliacao', null, null,
   'Importou a fatura de {competencia|mes}', '/financeiro/cartao/ciclo/{id}'),
  ('fin.crt.fechou_fatura', 'Fechou fatura do cartão', 'financeiro', 'financeiro.cartao', 'auditoria', 'crt_ciclos', 'muda_para', 'situacao', 'fechada', null, 'fechada_por',
   'Fechou a fatura de {competencia|mes}', '/financeiro/cartao/ciclo/{id}'),
  ('fin.crt.reabriu_fatura', 'Reabriu fatura do cartão', 'financeiro', 'financeiro.cartao', 'auditoria', 'crt_fechamentos', 'preenche', 'reaberto_em', null, null, 'reaberto_por',
   'Reabriu o fechamento da fatura (versão {versao}): {motivo_reabertura}', '/financeiro/cartao/ciclo/{ciclo_id}'),
  ('fin.crt.anexou_fatura', 'Anexou fatura do cartão', 'financeiro', 'financeiro.cartao', 'anexos', 'anexos', 'insert', null, null,
   '{"tipo":"fatura"}', null, 'Anexou a fatura {nome_arquivo}', null),
  -- AKF
  ('fin.akf.solicitou', 'Solicitou antecipação à AKF', 'financeiro', 'financeiro.akf', 'auditoria', 'akf_operacoes', 'muda_para', 'status', 'solicitada', null, 'solicitada_por',
   'Solicitou à AKF a antecipação nº {numero}', '/financeiro/akf/solicitacoes/{id}'),
  ('fin.akf.cancelou', 'Cancelou solicitação à AKF', 'financeiro', 'financeiro.akf', 'auditoria', 'akf_operacoes', 'muda_para', 'status', 'cancelada', null, 'cancelada_por',
   'Cancelou a solicitação nº {numero}: {motivo_cancelamento}', '/financeiro/akf/solicitacoes/{id}')
on conflict (codigo) do nothing;
