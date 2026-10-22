-- =========================================================
-- Fiscal Control — DADOS DE DEMONSTRAÇÃO (TODOS FICTÍCIOS)
-- NÃO é migration e NUNCA roda sozinho. Carregar só em base de teste/homologação:
--   node scripts/fiscal-demo.mjs --banco "postgresql://..." --confirmar        (Postgres local)
--   node scripts/fiscal-demo.mjs --ref <ref-do-projeto-de-TESTE> --confirmar     (Supabase de teste)
-- Recusa carregar se: a base tiver créditos reais (não fictícios), a configuração 'fiscal.creditos.bloquear_demonstracao'
-- for true (marque-a em produção) ou a demonstração já tiver sido carregada.
-- Empresa, CNPJs, valores, protocolos, recibos e documentos são inventados e marcados como fictícios.
-- Exercício completo: 01/2025 a 12/2025 (12 competências) + 01/2026 a 09/2026, com saldos transportados mês a mês.
-- =========================================================
do $demo$
declare
  v_emp uuid; v_mat uuid; v_fil uuid; v_resp uuid;
  t_icms uuid; t_pis uuid; t_cof uuid; t_ipi uuid; t_irpj uuid; t_inss uuid;
  c_icms uuid; c_pis uuid; c_cof uuid; c_ipi uuid; c_pagto uuid; c_irpj uuid; c_inss uuid; c_jud uuid;
  m date; i int; v_ger numeric; v_uso numeric; v_mov uuid; v_doc uuid; v_ob uuid; v_snap jsonb;
  v_tipo uuid; v_tipos uuid[]; k int;
begin
  if coalesce((select valor::text from configuracoes where chave = 'fiscal.creditos.bloquear_demonstracao'), 'false') = 'true' then
    raise exception 'Base marcada como produção (fiscal.creditos.bloquear_demonstracao = true): demonstração não carregada.';
  end if;
  if exists (select 1 from fis_creditos where not ficticio) then
    raise exception 'A base já tem créditos reais: a demonstração não é carregada para não misturar dados.';
  end if;
  if exists (select 1 from empresas where cnpj = '99.999.999/0001-91') then
    raise exception 'A demonstração já foi carregada nesta base.';
  end if;

  v_resp := (select id from perfis where admin_geral and ativo order by id limit 1);
  insert into empresas (razao_social, nome_curto, cnpj) values ('Indústria Modelo de Formas Ltda (FICTÍCIA)', 'Modelo (FICTÍCIA)', '99.999.999/0001-91')
  returning id into v_emp;
  insert into fis_estabelecimentos (empresa_id, nome, cnpj, uf, inscricao_estadual, matriz, ficticio)
  values (v_emp, 'Matriz Cuiabá (FICTÍCIA)', '99999999000191', 'MT', '00.000000-0', true, true) returning id into v_mat;
  insert into fis_estabelecimentos (empresa_id, nome, cnpj, uf, inscricao_estadual, matriz, ficticio)
  values (v_emp, 'Filial Várzea Grande (FICTÍCIA)', '99999999000272', 'MT', '00.000001-0', false, true) returning id into v_fil;

  select id into t_icms from fis_tributos where codigo = 'ICMS';
  select id into t_pis from fis_tributos where codigo = 'PIS';
  select id into t_cof from fis_tributos where codigo = 'COFINS';
  select id into t_ipi from fis_tributos where codigo = 'IPI';
  select id into t_irpj from fis_tributos where codigo = 'IRPJ';
  select id into t_inss from fis_tributos where codigo = 'INSS';

  -- 1) ICMS matriz: saldo transportado (implantação em 01/2025) + crédito apurado e utilização todo mês -------------------
  c_icms := fis_credito_criar(jsonb_build_object('estabelecimento_id', v_mat, 'tributo_id', t_icms,
    'categoria_id', (select id from fis_categorias where codigo = 'ICMS_SALDO_CREDOR'), 'origem', 'implantacao_saldo',
    'competencia_origem', '2025-01-01', 'tipo_entrada', 'saldo_inicial', 'data_entrada', '2025-01-01', 'valor_original', 48250.00,
    'descricao', '[FICTÍCIO] Conta-corrente do saldo credor de ICMS da matriz', 'documento_ref', 'Livro de apuração 12/2024 (fictício)',
    'descricao_entrada', '[FICTÍCIO] Saldo credor transportado de 12/2024', 'responsavel_id', v_resp, 'ficticio', true));
  -- 2) PIS e Cofins não cumulativos (matriz)
  c_pis := fis_credito_criar(jsonb_build_object('estabelecimento_id', v_mat, 'tributo_id', t_pis,
    'categoria_id', (select id from fis_categorias where codigo = 'PIS_NAO_CUMULATIVO'), 'origem', 'apuracao_mensal',
    'competencia_origem', '2025-01-01', 'data_entrada', '2025-01-31', 'valor_original', 6120.40,
    'descricao', '[FICTÍCIO] Créditos de PIS sobre insumos', 'responsavel_id', v_resp, 'ficticio', true));
  c_cof := fis_credito_criar(jsonb_build_object('estabelecimento_id', v_mat, 'tributo_id', t_cof,
    'categoria_id', (select id from fis_categorias where codigo = 'COFINS_NAO_CUMULATIVO'), 'origem', 'apuracao_mensal',
    'competencia_origem', '2025-01-01', 'data_entrada', '2025-01-31', 'valor_original', 28190.75,
    'descricao', '[FICTÍCIO] Créditos de Cofins sobre insumos', 'responsavel_id', v_resp, 'ficticio', true));
  -- 3) IPI filial: com utilização errada estornada e corrigida
  c_ipi := fis_credito_criar(jsonb_build_object('estabelecimento_id', v_fil, 'tributo_id', t_ipi,
    'categoria_id', (select id from fis_categorias where codigo = 'IPI_SALDO_CREDOR'), 'origem', 'apuracao_mensal',
    'competencia_origem', '2025-01-01', 'data_entrada', '2025-01-31', 'valor_original', 9800.00,
    'descricao', '[FICTÍCIO] Saldo credor de IPI da filial', 'responsavel_id', v_resp, 'ficticio', true));
  -- 4) Pagamento a maior (compensado com e sem protocolo)
  c_pagto := fis_credito_criar(jsonb_build_object('estabelecimento_id', v_mat, 'tributo_id', t_cof,
    'categoria_id', (select id from fis_categorias where codigo = 'PAGAMENTO_INDEVIDO'), 'origem', 'pagamento_indevido',
    'competencia_origem', '2025-03-01', 'tipo_entrada', 'credito_reconhecido', 'data_entrada', '2025-04-10', 'valor_original', 12400.00,
    'descricao', '[FICTÍCIO] DARF de Cofins 03/2025 recolhido a maior', 'documento_ref', 'DARF nº 0000.0000.0000.0000 (fictício)',
    'responsavel_id', v_resp, 'ficticio', true));
  -- 5) Saldo negativo de IRPJ: pendente de validação e sem documentos (documento faltante)
  c_irpj := fis_credito_criar(jsonb_build_object('estabelecimento_id', v_mat, 'tributo_id', t_irpj,
    'categoria_id', (select id from fis_categorias where codigo = 'SALDO_NEGATIVO_IRPJ'), 'origem', 'saldo_negativo',
    'competencia_origem', '2025-12-01', 'tipo_entrada', 'credito_reconhecido', 'data_entrada', '2026-03-31', 'valor_original', 35000.00,
    'descricao', '[FICTÍCIO] Saldo negativo de IRPJ do ano-calendário 2025', 'responsavel_id', v_resp, 'ficticio', true));
  -- 6) Crédito previdenciário em análise
  c_inss := fis_credito_criar(jsonb_build_object('estabelecimento_id', v_mat, 'tributo_id', t_inss,
    'categoria_id', (select id from fis_categorias where codigo = 'INSS_RESTITUICAO'), 'origem', 'decisao_administrativa',
    'competencia_origem', '2026-02-01', 'tipo_entrada', 'credito_reconhecido', 'data_entrada', '2026-02-27', 'valor_original', 7450.30,
    'descricao', '[FICTÍCIO] Contribuição previdenciária recolhida em duplicidade', 'responsavel_id', v_resp, 'ficticio', true));
  -- 7) Crédito judicial validado, mas bloqueado até o trânsito em julgado
  c_jud := fis_credito_criar(jsonb_build_object('estabelecimento_id', v_mat, 'tributo_id', t_pis,
    'categoria_id', (select id from fis_categorias where codigo = 'JUDICIAL'), 'origem', 'decisao_judicial',
    'competencia_origem', '2025-06-01', 'tipo_entrada', 'credito_reconhecido', 'data_entrada', '2025-06-30', 'valor_original', 54300.00,
    'numero_processo', '0000000-00.0000.0.00.0000 (fictício)', 'descricao', '[FICTÍCIO] Exclusão do ICMS da base do PIS (ação judicial)',
    'responsavel_id', v_resp, 'ficticio', true));

  -- Documentos fictícios (sem arquivo) e validações -------------------------------------------------------------------------
  foreach v_mov in array array[c_icms, c_pis, c_cof, c_ipi, c_pagto, c_jud] loop
    perform fis_documento_registrar(jsonb_build_object('tipo', 'memoria_calculo', 'titulo', '[FICTÍCIO] Memória de cálculo', 'empresa_id', v_emp,
      'ficticio', true, 'observacoes', 'Documento simulado de demonstração (sem arquivo)'), jsonb_build_array(jsonb_build_object('alvo', 'credito', 'alvo_id', v_mov)));
  end loop;
  perform fis_documento_registrar(jsonb_build_object('tipo', 'comprovante_pagamento', 'titulo', '[FICTÍCIO] DARF Cofins 03/2025', 'empresa_id', v_emp, 'ficticio', true),
    jsonb_build_array(jsonb_build_object('alvo', 'credito', 'alvo_id', c_pagto)));
  perform fis_documento_registrar(jsonb_build_object('tipo', 'decisao', 'titulo', '[FICTÍCIO] Sentença', 'empresa_id', v_emp, 'ficticio', true),
    jsonb_build_array(jsonb_build_object('alvo', 'credito', 'alvo_id', c_jud)));
  perform fis_credito_validar(c_icms, 'validado', null, '[FICTÍCIO] Conferido com o livro de apuração');
  perform fis_credito_validar(c_pis, 'validado', null, '[FICTÍCIO] Conferido com a EFD-Contribuições');
  perform fis_credito_validar(c_cof, 'validado', null, '[FICTÍCIO] Conferido com a EFD-Contribuições');
  perform fis_credito_validar(c_ipi, 'validado', null, '[FICTÍCIO] Conferido com a EFD ICMS/IPI');
  perform fis_credito_validar(c_pagto, 'validado', null, '[FICTÍCIO] Pagamento a maior confirmado');
  perform fis_credito_validar(c_jud, 'validado', null, '[FICTÍCIO] Decisão favorável juntada');
  perform fis_credito_validar(c_inss, 'em_analise', null, '[FICTÍCIO] Aguardando extrato do eSocial');
  perform fis_credito_bloquear(c_jud, true, '[FICTÍCIO] Aguardando trânsito em julgado');

  -- Movimentação mensal de 01/2025 a 09/2026 --------------------------------------------------------------------------------
  for i in 0..20 loop
    m := (date '2025-01-01' + make_interval(months => i))::date;
    -- ICMS: crédito do mês e dedução de ~94% dele (o saldo transportado cresce devagar)
    v_ger := round(28000 + 997.37 * i + (i % 3) * 1450.15, 2);
    v_uso := round(v_ger * 0.94, 2);
    if i > 0 then
      perform fis_movimento_registrar(jsonb_build_object('credito_id', c_icms, 'tipo', 'credito_apurado', 'valor', v_ger, 'data', (m + interval '1 month - 1 day')::date,
        'competencia', m, 'descricao', '[FICTÍCIO] Créditos de entradas ' || to_char(m, 'MM/YYYY'), 'origem_registro', 'demonstracao'));
    end if;
    perform fis_movimento_registrar(jsonb_build_object('credito_id', c_icms, 'tipo', 'utilizacao', 'valor', v_uso, 'data', (m + interval '1 month - 1 day')::date,
      'competencia', m, 'descricao', '[FICTÍCIO] Dedução do débito de ICMS ' || to_char(m, 'MM/YYYY'), 'origem_registro', 'demonstracao'));
    -- PIS e Cofins: crédito do mês, dedução parcial (utilização parcial)
    if i > 0 then
      perform fis_movimento_registrar(jsonb_build_object('credito_id', c_pis, 'tipo', 'credito_apurado', 'valor', round(5900 + 41.3 * i, 2),
        'data', (m + interval '1 month - 1 day')::date, 'competencia', m, 'descricao', '[FICTÍCIO] Créditos de PIS ' || to_char(m, 'MM/YYYY'), 'origem_registro', 'demonstracao'));
      perform fis_movimento_registrar(jsonb_build_object('credito_id', c_cof, 'tipo', 'credito_apurado', 'valor', round(27180 + 190.25 * i, 2),
        'data', (m + interval '1 month - 1 day')::date, 'competencia', m, 'descricao', '[FICTÍCIO] Créditos de Cofins ' || to_char(m, 'MM/YYYY'), 'origem_registro', 'demonstracao'));
    end if;
    perform fis_movimento_registrar(jsonb_build_object('credito_id', c_pis, 'tipo', 'utilizacao', 'valor', round((5900 + 41.3 * i) * 0.81, 2),
      'data', (m + interval '1 month - 1 day')::date, 'competencia', m, 'descricao', '[FICTÍCIO] Dedução do PIS devido ' || to_char(m, 'MM/YYYY'), 'origem_registro', 'demonstracao'));
    perform fis_movimento_registrar(jsonb_build_object('credito_id', c_cof, 'tipo', 'utilizacao', 'valor', round((27180 + 190.25 * i) * 0.86, 2),
      'data', (m + interval '1 month - 1 day')::date, 'competencia', m, 'descricao', '[FICTÍCIO] Dedução da Cofins devida ' || to_char(m, 'MM/YYYY'), 'origem_registro', 'demonstracao'));
    -- IPI filial: crédito e uso a cada mês
    if i > 0 then
      perform fis_movimento_registrar(jsonb_build_object('credito_id', c_ipi, 'tipo', 'credito_apurado', 'valor', round(4100 + 33.1 * i, 2),
        'data', (m + interval '1 month - 1 day')::date, 'competencia', m, 'descricao', '[FICTÍCIO] Créditos de IPI ' || to_char(m, 'MM/YYYY'), 'origem_registro', 'demonstracao'));
    end if;
    perform fis_movimento_registrar(jsonb_build_object('credito_id', c_ipi, 'tipo', 'utilizacao', 'valor', round((4100 + 33.1 * i) * 0.7, 2),
      'data', (m + interval '1 month - 1 day')::date, 'competencia', m, 'descricao', '[FICTÍCIO] Dedução do IPI devido ' || to_char(m, 'MM/YYYY'), 'origem_registro', 'demonstracao'));
    if m = date '2025-06-01' then
      -- utilização lançada em duplicidade, estornada (correção auditável)
      v_mov := fis_movimento_registrar(jsonb_build_object('credito_id', c_ipi, 'tipo', 'utilizacao', 'valor', 1500.00, 'data', '2025-06-28',
        'competencia', m, 'descricao', '[FICTÍCIO] Dedução lançada em duplicidade', 'origem_registro', 'demonstracao'));
      perform fis_movimento_estornar(v_mov, '[FICTÍCIO] Dedução em duplicidade com o lançamento do dia 30/06', null);
    end if;
  end loop;

  -- Pagamento a maior: compensação com protocolo (05/2025) e outra sem protocolo (08/2025: gera alerta)
  perform fis_movimento_registrar(jsonb_build_object('credito_id', c_pagto, 'tipo', 'compensacao', 'valor', 7000.00, 'data', '2025-05-20', 'competencia', '2025-05-01',
    'protocolo', 'PERDCOMP 00000.00000.000000.0.0.00-0000 (fictício)', 'descricao', '[FICTÍCIO] Compensação com IRPJ 04/2025', 'origem_registro', 'demonstracao'));
  perform fis_movimento_registrar(jsonb_build_object('credito_id', c_pagto, 'tipo', 'compensacao', 'valor', 2500.00, 'data', '2025-08-20', 'competencia', '2025-08-01',
    'descricao', '[FICTÍCIO] Compensação com CSLL 07/2025 (protocolo não informado)', 'origem_registro', 'demonstracao'));
  perform fis_documento_registrar(jsonb_build_object('tipo', 'comprovante_compensacao', 'titulo', '[FICTÍCIO] Recibo PER/DCOMP 05/2025', 'empresa_id', v_emp, 'ficticio', true),
    jsonb_build_array(jsonb_build_object('alvo', 'movimento', 'alvo_id', (select id from fis_movimentos where credito_id = c_pagto and competencia = '2025-05-01'))));

  -- Saldos oficiais (simulam a EFD) e fechamentos: 2025 inteiro e 2026 até 08 ------------------------------------------------
  for i in 0..19 loop
    m := (date '2025-01-01' + make_interval(months => i))::date;
    foreach v_tipo in array array[t_icms, t_pis, t_cof] loop
      v_snap := fis_apuracao_chave(v_mat, v_tipo, m);
      perform fis_periodo_informar_saldos(v_mat, v_tipo, m, jsonb_build_object(
        'saldo_oficial', case when v_tipo = t_pis and m = date '2025-11-01' then (v_snap ->> 'saldo_final')::numeric + 150.00 else (v_snap ->> 'saldo_final')::numeric end,
        'saldo_oficial_fonte', '[FICTÍCIO] EFD ' || to_char(m, 'MM/YYYY')));
      if v_tipo = t_pis and m = date '2025-11-01' then
        perform fis_divergencia_registrar(jsonb_build_object('empresa_id', v_emp, 'estabelecimento_id', v_mat, 'tributo_id', t_pis, 'competencia', m,
          'periodo_id', (select id from fis_periodos where estabelecimento_id = v_mat and tributo_id = t_pis and competencia = m),
          'fonte_comparada', 'apuracao_oficial', 'valor_interno', (v_snap ->> 'saldo_final')::numeric, 'valor_externo', (v_snap ->> 'saldo_final')::numeric + 150.00,
          'motivo', '[FICTÍCIO] EFD-Contribuições 11/2025 com R$ 150,00 a mais que o controle', 'providencia', 'Conferir notas de devolução de novembro',
          'responsavel_id', v_resp, 'prazo_interno', '2026-11-05', 'ficticio', true));
        perform fis_periodo_fechar(v_mat, v_tipo, m, '[FICTÍCIO] Diferença de R$ 150,00 em análise (divergência registrada)', true);
      else
        perform fis_periodo_fechar(v_mat, v_tipo, m, null, false);
      end if;
    end loop;
    if m <= date '2025-12-01' then
      perform fis_periodo_fechar(v_fil, t_ipi, m, null, false);
    end if;
  end loop;
  perform fis_periodo_enviar_revisao(v_mat, t_icms, date '2026-09-01', '[FICTÍCIO] Apuração de 09/2026 pronta para revisão');

  -- Obrigações: perfil tributário da matriz e entregas de 2026 ---------------------------------------------------------------
  v_tipos := array[(select id from fis_tipos_obrigacao where codigo = 'EFD_ICMS_IPI'), (select id from fis_tipos_obrigacao where codigo = 'EFD_CONTRIBUICOES'),
                   (select id from fis_tipos_obrigacao where codigo = 'DCTFWEB')];
  foreach v_tipo in array v_tipos loop
    perform fis_definir_aplicavel(v_tipo, v_mat, true, v_resp, '[FICTÍCIO] Escritório Contábil Exemplo');
  end loop;
  for k in 1..10 loop
    m := make_date(2026, k, 1);
    perform fis_obrigacoes_gerar(m, v_emp);
  end loop;
  update fis_obrigacoes set ficticio = true, vencimento_fonte = '[FICTÍCIO] data de demonstração, não é prazo legal',
         vencimento = (competencia + interval '1 month' + interval '14 days')::date
   where empresa_id = v_emp;
  for v_ob in select id from fis_obrigacoes where empresa_id = v_emp and competencia <= date '2026-08-01' order by competencia loop
    perform fis_obrigacao_status(v_ob, 'em_preparacao');
    perform fis_obrigacao_status(v_ob, 'pronta_transmissao');
    perform fis_documento_registrar(jsonb_build_object('tipo', 'recibo_transmissao', 'titulo', '[FICTÍCIO] Recibo de entrega', 'empresa_id', v_emp, 'ficticio', true),
      jsonb_build_array(jsonb_build_object('alvo', 'obrigacao', 'alvo_id', v_ob)));
    perform fis_obrigacao_status(v_ob, 'transmitida', jsonb_build_object('data_transmissao', (select vencimento - 3 from fis_obrigacoes where id = v_ob),
      'numero_recibo', '[FICTÍCIO] ' || upper(substr(md5(v_ob::text), 1, 12))));
    perform fis_obrigacao_status(v_ob, 'entregue_conferida', jsonb_build_object('observacao', '[FICTÍCIO] Recibo conferido'));
  end loop;
  -- 09/2026: EFD ICMS/IPI transmitida aguardando conferência; EFD-Contribuições em revisão; DCTFWeb atrasada
  select id into v_ob from fis_obrigacoes where empresa_id = v_emp and competencia = '2026-09-01' and tipo_id = v_tipos[1];
  perform fis_obrigacao_status(v_ob, 'pronta_transmissao');
  perform fis_documento_registrar(jsonb_build_object('tipo', 'recibo_transmissao', 'titulo', '[FICTÍCIO] Recibo EFD ICMS/IPI 09/2026', 'empresa_id', v_emp, 'ficticio', true),
    jsonb_build_array(jsonb_build_object('alvo', 'obrigacao', 'alvo_id', v_ob)));
  perform fis_obrigacao_status(v_ob, 'transmitida', jsonb_build_object('data_transmissao', '2026-10-13', 'numero_recibo', '[FICTÍCIO] REC-2026-09-ICMS'));
  select id into v_ob from fis_obrigacoes where empresa_id = v_emp and competencia = '2026-09-01' and tipo_id = v_tipos[2];
  perform fis_obrigacao_status(v_ob, 'em_revisao');
  perform fis_documento_registrar(jsonb_build_object('tipo', 'arquivo_declaracao', 'titulo', '[FICTÍCIO] Arquivo EFD-Contribuições 09/2026 (salvo, NÃO transmitido)',
    'empresa_id', v_emp, 'ficticio', true), jsonb_build_array(jsonb_build_object('alvo', 'obrigacao', 'alvo_id', v_ob)));
  select id into v_ob from fis_obrigacoes where empresa_id = v_emp and competencia = '2026-09-01' and tipo_id = v_tipos[3];
  perform fis_obrigacao_status(v_ob, 'aguardando_documentos', jsonb_build_object('observacao', '[FICTÍCIO] Aguardando folha de setembro'));

  -- Tarefas e solicitações -----------------------------------------------------------------------------------------------
  perform fis_tarefa_criar(jsonb_build_object('tipo', 'solicitacao_documento', 'titulo', '[FICTÍCIO] Enviar memória de cálculo do saldo negativo de IRPJ',
    'empresa_id', v_emp, 'alvo', 'credito', 'alvo_id', c_irpj, 'tipo_documento_solicitado', 'memoria_calculo', 'responsavel_id', v_resp,
    'prazo', '2026-10-30', 'ficticio', true));
  perform fis_tarefa_criar(jsonb_build_object('tipo', 'revisao_apuracao', 'titulo', '[FICTÍCIO] Revisar a apuração de ICMS 09/2026',
    'empresa_id', v_emp, 'alvo', 'periodo', 'alvo_id', (select id from fis_periodos where estabelecimento_id = v_mat and tributo_id = t_icms and competencia = '2026-09-01'),
    'responsavel_id', v_resp, 'prazo', '2026-10-25', 'ficticio', true));
  insert into fis_comentarios (alvo, alvo_id, empresa_id, texto, autor_id)
  values ('credito', c_irpj, v_emp, '[FICTÍCIO] Contador: precisamos da ECF para validar o saldo negativo.', v_resp);

  update fis_periodos set ficticio = true where empresa_id = v_emp;
  raise notice 'Demonstração fictícia carregada: empresa %, % créditos, % movimentações.', v_emp,
    (select count(*) from fis_creditos where empresa_id = v_emp), (select count(*) from fis_movimentos where empresa_id = v_emp);
end $demo$;
