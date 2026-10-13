-- =========================================================
-- Neo Admin — 0143 Contas a pagar / Cartão: categorias de fornecedor e contas do fluxo de caixa do Consistem (listas)
-- Especificação: docs/modulos/financeiro-cartao.md (regras 44 e 50).
--
-- Cadastros de referência do Consistem enviados pelo Alan em 13/10/2026 (planilhas "CATEGORIA DE FORNECEDOR" e "CONTAS FLUXO"):
--   - cap_categorias_fornecedor: codCategoria do fornecedor (27);
--   - cap_contas_fluxo: grupo do fluxo de caixa × item (209; situação ativa/inativa). No fornecedor, codGrupo = o grupo do fluxo e
--     item = a conta dentro do grupo (confirmado pelo Alan); nos títulos, grupoContaFluxoCaixa/contaFluxoCaixa.
-- As telas trocam os números digitados por listas. Também corrige duas sugestões do dicionário (decisão do Alan): alimentação
-- passa a 12/6 (Despesas com Pessoal › Alimentação; era 10/15 Insumos) e o Mercado Livre (marketplace) fica sem conta de fluxo.
-- O cadastro do fornecedor "Outros" passa a exigir categoria e conta de fluxo válidas e envia o item.
-- =========================================================

create table cap_categorias_fornecedor (
  codigo int primary key check (codigo between 1 and 99),
  descricao text not null
);
comment on table cap_categorias_fornecedor is 'Categorias de fornecedor do Consistem (codCategoria). Cópia da planilha enviada pelo Alan em 13/10/2026.';

create table cap_contas_fluxo (
  grupo int not null check (grupo between 1 and 999),
  grupo_descricao text not null,
  natureza char(1) not null check (natureza in ('D', 'C')),
  item int not null check (item between 1 and 999),
  descricao text not null,
  ativa boolean not null default true,
  primary key (grupo, item)
);
comment on table cap_contas_fluxo is 'Contas do fluxo de caixa do Consistem: grupo (grupoContaFluxoCaixa / codGrupo do fornecedor) × item (contaFluxoCaixa / item do fornecedor). Cópia da planilha enviada pelo Alan em 13/10/2026.';

alter table cap_categorias_fornecedor enable row level security;
alter table cap_contas_fluxo enable row level security;
create policy cap_categorias_fornecedor_ler on cap_categorias_fornecedor for select to authenticated using (tem_acesso_area('financeiro'));
create policy cap_contas_fluxo_ler on cap_contas_fluxo for select to authenticated using (tem_acesso_area('financeiro'));

insert into cap_categorias_fornecedor (codigo, descricao) values
  (1, 'TRIBUTOS E OBRIGAÇÕES FISCAIS'),
  (2, 'MATÉRIA-PRIMA ALUMINIO'),
  (3, 'TRANSPORTE E LOGISTÍCA'),
  (4, 'SERVIÇOS ESPECIALIZADOS'),
  (5, 'SOFTWARES'),
  (6, 'MÃO DE OBRA E RH'),
  (7, 'SERVIÇOS ADMINISTRATIVOS'),
  (8, 'SERVIÇOS GERAIS E UTILIDADES'),
  (9, 'MATERIAIS DE ESCTITÓRIO E TI'),
  (10, 'EQUIPAMENTOS E FERRAMENTAS'),
  (11, 'MANUTENÇÃO E INFRAESTRUTURA'),
  (12, 'MARKETING E PUBLICIDADE'),
  (13, 'TREINAMENTOS E CAPACITAÇÃO'),
  (14, 'INSUMOS'),
  (15, 'EPIS E SEGURANÇA DO TRABALHO'),
  (16, 'AUTARQUIAS E ORGAOS PUBLICOS'),
  (17, 'SERVIÇOS FINANCEIROS'),
  (18, 'VIAGENS E DESLOCAMENTOS'),
  (19, 'VEICULOS'),
  (20, 'COMBUSTIVEIS E LUBRIFICANTES'),
  (21, 'LEGADO'),
  (22, 'DIRETORIA'),
  (23, 'PENSÃO'),
  (24, 'SERVIÇOS TERCEIRIZADOS'),
  (25, 'MATÉRIA PRIMA AÇO'),
  (26, 'PLANO DE SAUDE'),
  (27, 'OBRAS E REFORMAS');

insert into cap_contas_fluxo (grupo, grupo_descricao, natureza, item, descricao, ativa) values
  (1, 'RECEITAS OPERACIONAIS', 'C', 1, 'Carteira', true),
  (1, 'RECEITAS OPERACIONAIS', 'C', 2, 'Bancaria', true),
  (1, 'RECEITAS OPERACIONAIS', 'C', 3, 'Disponivel', true),
  (1, 'RECEITAS OPERACIONAIS', 'C', 4, 'Cheque', true),
  (1, 'RECEITAS OPERACIONAIS', 'C', 5, 'Depositos Clientes', true),
  (1, 'RECEITAS OPERACIONAIS', 'C', 6, 'Receitas com Vendas', true),
  (2, 'RECEITAS FINANCEIRAS', 'C', 1, 'Descontos Obtidos', true),
  (2, 'RECEITAS FINANCEIRAS', 'C', 2, 'Juros Recebidos', true),
  (2, 'RECEITAS FINANCEIRAS', 'C', 3, 'Resgate Aplicacao Financeira', true),
  (2, 'RECEITAS FINANCEIRAS', 'C', 4, 'Emprestimos/Financiamentos', true),
  (10, 'DESPESAS INDUSTRIAIS', 'D', 1, 'Matéria Prima', true),
  (10, 'DESPESAS INDUSTRIAIS', 'D', 3, 'Material Operacional', true),
  (10, 'DESPESAS INDUSTRIAIS', 'D', 4, 'Fretes sobre Compras', true),
  (10, 'DESPESAS INDUSTRIAIS', 'D', 5, 'Manutenção Máq. Equip.', true),
  (10, 'DESPESAS INDUSTRIAIS', 'D', 6, 'Embalagens', true),
  (10, 'DESPESAS INDUSTRIAIS', 'D', 7, 'Serviço de Terceiros', true),
  (10, 'DESPESAS INDUSTRIAIS', 'D', 9, 'Energia Elétrica', true),
  (10, 'DESPESAS INDUSTRIAIS', 'D', 12, 'Obras e Reformas', true),
  (10, 'DESPESAS INDUSTRIAIS', 'D', 13, 'Produto Acabado Revenda', false),
  (10, 'DESPESAS INDUSTRIAIS', 'D', 15, 'Insumos', true),
  (10, 'DESPESAS INDUSTRIAIS', 'D', 16, 'EPI e Uniformes', true),
  (11, 'DESPESAS COM IMÓVEIS', 'D', 1, 'Manutenção Predial', true),
  (11, 'DESPESAS COM IMÓVEIS', 'D', 2, 'Seguro de Instalações', true),
  (11, 'DESPESAS COM IMÓVEIS', 'D', 3, 'Vigilância Patrimonial', true),
  (11, 'DESPESAS COM IMÓVEIS', 'D', 4, 'Alvarás', true),
  (11, 'DESPESAS COM IMÓVEIS', 'D', 5, 'IPTU', true),
  (11, 'DESPESAS COM IMÓVEIS', 'D', 6, 'Aluguel de Imóveis', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 1, 'Salarios', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 2, 'INSS', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 3, 'FGTS', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 4, 'Seguro de Vida', false),
  (12, 'DESPESAS COM PESSOAL', 'D', 5, 'Treinamento', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 6, 'Alimentação', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 7, 'Medicina do Trabalho', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 9, 'Vale Transporte', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 10, 'Férias', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 11, '13º Salário', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 12, 'Adiantamento de Salário', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 13, 'Rescisão', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 14, 'Gratificações', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 15, 'Processo Trabalhista', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 16, 'Outros Enc./Beneficios', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 18, 'Pensão Alimenticia', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 19, 'Assistência Médica', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 20, 'Plano de Saúde', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 21, 'Contribuição Patronal', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 22, 'Contribuição Sindical', false),
  (12, 'DESPESAS COM PESSOAL', 'D', 23, 'IRRF S/ Folha', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 24, 'Segurança do Trabalho', true),
  (12, 'DESPESAS COM PESSOAL', 'D', 25, 'FGTS Rescisório', true),
  (13, 'DESPESAS COMERCIAIS', 'D', 1, 'Marketing', true),
  (13, 'DESPESAS COMERCIAIS', 'D', 3, 'Fretes s/ venda', true),
  (13, 'DESPESAS COMERCIAIS', 'D', 4, 'Comissão', true),
  (13, 'DESPESAS COMERCIAIS', 'D', 5, 'Viagens e Lobby', true),
  (13, 'DESPESAS COMERCIAIS', 'D', 6, 'Passagens', true),
  (13, 'DESPESAS COMERCIAIS', 'D', 7, 'Hospedagens', true),
  (15, 'DESPESAS COM DIRETORIA', 'D', 1, 'Pró Labore', true),
  (15, 'DESPESAS COM DIRETORIA', 'D', 2, 'Antecipação de Lucros', true),
  (15, 'DESPESAS COM DIRETORIA', 'D', 3, 'Distribuição de Lucros', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 1, 'Telefone/Internet', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 2, 'Consultorias', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 4, 'Softwares e Licenças', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 5, 'Material de Escritório', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 6, 'Manutenção/Limpeza', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 7, 'Mat. Copa e Cozinha', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 9, 'Água e Saneamento', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 11, 'Correios e Malotes', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 13, 'Custas Judiciais e Cart', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 14, 'Honorários', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 17, 'Doações', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 18, 'Passagens', false),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 19, 'Hospedagens', false),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 20, 'Análise de Crédito', true),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 21, 'Moveis e Utensilios', false),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 22, 'Computadores e Periféri', false),
  (16, 'DESPESAS ADMINISTRATIVAS', 'D', 23, 'Celulares', false),
  (18, 'DESPESAS VEICULOS', 'D', 1, 'Seguro Veículo', true),
  (18, 'DESPESAS VEICULOS', 'D', 2, 'Licenciamento', true),
  (18, 'DESPESAS VEICULOS', 'D', 3, 'Manutenção Veículo', true),
  (18, 'DESPESAS VEICULOS', 'D', 4, 'Combustiveis/Lubrificantes', true),
  (18, 'DESPESAS VEICULOS', 'D', 5, 'Multas/Taxas', true),
  (18, 'DESPESAS VEICULOS', 'D', 7, 'Estacionamento', true),
  (18, 'DESPESAS VEICULOS', 'D', 8, 'Pedágios', true),
  (18, 'DESPESAS VEICULOS', 'D', 9, 'Seguro DPVAT', true),
  (18, 'DESPESAS VEICULOS', 'D', 10, 'IPVA', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 1, 'ISS', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 2, 'ICMS', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 3, 'PIS', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 4, 'Taxas e Multas Diversas', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 5, 'ICMS ST', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 6, 'ICMS Difal', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 7, 'COFINS', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 8, 'CSLL', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 9, 'IRPJ', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 10, 'INSS Retido', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 11, 'ISS Retido', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 12, 'Simples Nacional', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 13, 'Taxas Municipais', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 14, 'Taxas Estaduais', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 15, 'Taxas Federais', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 16, 'Parc. Imp. Municipais', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 17, 'Parc. Imp. Estaduais', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 18, 'Parc. Imp. Federais', true),
  (20, 'DESPESAS COM IMPOSTOS', 'D', 19, 'IRRF Retido', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 1, 'Juros Pagos', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 2, 'Descontos Concedidos', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 3, 'Tarifas Bancarias', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 4, 'Tarifas Cobranca', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 5, 'Amortização Emprestimos', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 6, 'Multas Pagas', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 7, 'Juros de Antecipação', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 8, 'IOF', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 9, 'Juros s/ Emprestimo', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 10, 'Despesas Antecipação', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 11, 'Juros Ant. Diferença', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 12, 'Seguro Prestamista', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 13, 'Consórcios', false),
  (22, 'DESPESAS FINANCEIRAS', 'D', 14, 'Reembolso Despesas', false),
  (22, 'DESPESAS FINANCEIRAS', 'D', 15, 'Caixinha', false),
  (22, 'DESPESAS FINANCEIRAS', 'D', 16, 'Duplicada K - Recompra', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 17, 'Recompra de Títulos', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 18, 'Aluguel de Maq. Equip.', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 19, 'Aplicação Automática', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 20, 'Assinaturas', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 21, 'Amort. Emprest. Socios', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 22, 'Amort. Emp. Terceiros', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 23, 'Adiantamento Viagem', false),
  (22, 'DESPESAS FINANCEIRAS', 'D', 24, 'Cartão de Crédito Empre', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 25, 'Amor. Empréstimo Cartão', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 26, 'Rep. Locação a Terceiro', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 27, 'Rep. Titulo Antecipado', true),
  (22, 'DESPESAS FINANCEIRAS', 'D', 28, 'Taxas e Mensalidades', true),
  (24, 'INVESTIMENTOS', 'D', 1, 'Máquinas e Equipamentos', true),
  (24, 'INVESTIMENTOS', 'D', 2, 'Aplicacoes Financeiras', true),
  (24, 'INVESTIMENTOS', 'D', 3, 'Aquisição de Veículos', true),
  (24, 'INVESTIMENTOS', 'D', 4, 'Obras e Reformas', true),
  (25, 'LEGADO', 'D', 1, 'LEGADO', true),
  (26, 'NEO SERVIÇOS', 'D', 1, 'Salário', true),
  (26, 'NEO SERVIÇOS', 'D', 2, '13º Salário', true),
  (26, 'NEO SERVIÇOS', 'D', 3, 'Vale Transporte', true),
  (26, 'NEO SERVIÇOS', 'D', 4, 'Bonificação', true),
  (26, 'NEO SERVIÇOS', 'D', 5, 'Alimentação', true),
  (26, 'NEO SERVIÇOS', 'D', 6, 'FGTS', true),
  (26, 'NEO SERVIÇOS', 'D', 7, 'FGTS - Rescisão', true),
  (26, 'NEO SERVIÇOS', 'D', 8, 'Férias', true),
  (26, 'NEO SERVIÇOS', 'D', 9, 'Rescisão', true),
  (26, 'NEO SERVIÇOS', 'D', 10, 'Parc Impostos Federais', true),
  (26, 'NEO SERVIÇOS', 'D', 11, 'Simples Nacional', true),
  (26, 'NEO SERVIÇOS', 'D', 12, 'INSS/IRRF', true),
  (26, 'NEO SERVIÇOS', 'D', 13, 'Assistência Médica', true),
  (26, 'NEO SERVIÇOS', 'D', 14, 'Seguro de Vida', true),
  (26, 'NEO SERVIÇOS', 'D', 15, 'Adiantamento de Salario', true),
  (27, 'OESTE FORMAS', 'D', 1, 'Salário', true),
  (27, 'OESTE FORMAS', 'D', 2, '13º Salário', true),
  (27, 'OESTE FORMAS', 'D', 3, 'Vale Transporte', true),
  (27, 'OESTE FORMAS', 'D', 4, 'FGTS', true),
  (27, 'OESTE FORMAS', 'D', 5, 'Alimentação', true),
  (27, 'OESTE FORMAS', 'D', 6, 'INSS/IRRF', true),
  (28, 'NUMERARIOS EM TRANSITO', 'C', 1, 'Rep. Titulo Antecipado', true),
  (28, 'NUMERARIOS EM TRANSITO', 'C', 2, 'Rec. Titulo Antecipado', true),
  (29, 'NEO CONTAGEM', 'D', 1, 'Água', true),
  (29, 'NEO CONTAGEM', 'D', 2, 'Alimentação', true),
  (29, 'NEO CONTAGEM', 'D', 3, 'Aluguel', true),
  (29, 'NEO CONTAGEM', 'D', 4, 'Aluguel de Maq. Equip.', true),
  (29, 'NEO CONTAGEM', 'D', 5, 'Alavarás - Taxas', true),
  (29, 'NEO CONTAGEM', 'D', 6, 'Análise de Crédito', true),
  (29, 'NEO CONTAGEM', 'D', 7, 'Aquisiçoes Ativo Imob.', true),
  (29, 'NEO CONTAGEM', 'D', 8, 'Assis. Medica/Plano', true),
  (29, 'NEO CONTAGEM', 'D', 9, 'Bonificação', true),
  (29, 'NEO CONTAGEM', 'D', 10, 'Cesta Basica/Natal', true),
  (29, 'NEO CONTAGEM', 'D', 11, 'Combustivel', true),
  (29, 'NEO CONTAGEM', 'D', 12, 'Comissão', true),
  (29, 'NEO CONTAGEM', 'D', 13, 'Consultorias/Treinament', true),
  (29, 'NEO CONTAGEM', 'D', 14, 'Custa Judiciais/Cartori', true),
  (29, 'NEO CONTAGEM', 'D', 15, 'Encargos Sociais', true),
  (29, 'NEO CONTAGEM', 'D', 16, 'Energia Administração', true),
  (29, 'NEO CONTAGEM', 'D', 17, 'EPIs e Uniformes', true),
  (29, 'NEO CONTAGEM', 'D', 18, 'Ferias', true),
  (29, 'NEO CONTAGEM', 'D', 19, 'FGTS', true),
  (29, 'NEO CONTAGEM', 'D', 20, 'Folha 13º Salario', true),
  (29, 'NEO CONTAGEM', 'D', 21, 'Folha de Pagamento', true),
  (29, 'NEO CONTAGEM', 'D', 22, 'Frete Carretos s/Compra', true),
  (29, 'NEO CONTAGEM', 'D', 23, 'Fretes Carretos s/Venda', true),
  (29, 'NEO CONTAGEM', 'D', 24, 'Honorários', true),
  (29, 'NEO CONTAGEM', 'D', 25, 'IPTU', true),
  (29, 'NEO CONTAGEM', 'D', 26, 'Manutenção/Limpeza', true),
  (29, 'NEO CONTAGEM', 'D', 27, 'Manutençao Maq. e Equip', true),
  (29, 'NEO CONTAGEM', 'D', 28, 'Manutenção de Veiculos', true),
  (29, 'NEO CONTAGEM', 'D', 29, 'Manutenção Predial', true),
  (29, 'NEO CONTAGEM', 'D', 30, 'Maquinas / Equipamentos', true),
  (29, 'NEO CONTAGEM', 'D', 31, 'Material Escrito/Suprim', true),
  (29, 'NEO CONTAGEM', 'D', 32, 'Material Operacional', true),
  (29, 'NEO CONTAGEM', 'D', 33, 'Obras e Reformas', true),
  (29, 'NEO CONTAGEM', 'D', 34, 'Passagens', true),
  (29, 'NEO CONTAGEM', 'D', 35, 'Publicidade /Propaganda', true),
  (29, 'NEO CONTAGEM', 'D', 36, 'Rescisão', true),
  (29, 'NEO CONTAGEM', 'D', 37, 'Segurança do Trabalho', true),
  (29, 'NEO CONTAGEM', 'D', 38, 'Seg. Instalaçoes/Equipa', true),
  (29, 'NEO CONTAGEM', 'D', 39, 'Seguro dos Empregados', true),
  (29, 'NEO CONTAGEM', 'D', 40, 'Software/Licenças uso', true),
  (29, 'NEO CONTAGEM', 'D', 41, 'Tarifas Bancarias', true),
  (29, 'NEO CONTAGEM', 'D', 42, 'Taxas - ART', true),
  (29, 'NEO CONTAGEM', 'D', 43, 'Telefone/comun/internet', true),
  (29, 'NEO CONTAGEM', 'D', 44, 'Vale Transporte', true),
  (29, 'NEO CONTAGEM', 'D', 45, 'Viagens e Lobby', true),
  (29, 'NEO CONTAGEM', 'D', 46, 'INSS / IRRF', true),
  (29, 'NEO CONTAGEM', 'D', 47, 'Salario', true),
  (29, 'NEO CONTAGEM', 'D', 48, 'Sublocação de Equipamen', true),
  (29, 'NEO CONTAGEM', 'D', 49, 'Caixinha', true);

-- Correções do dicionário (decisão do Alan).
update crt_estabelecimentos
   set lancamento_erp = lancamento_erp || '{"grupoContaFluxoCaixa": 12, "contaFluxoCaixa": 6}'::jsonb
 where padrao in ('IFOOD', 'PADARIA', 'RESTAURANTE', 'SUPERMERCADO') and lancamento_erp is not null;
update crt_estabelecimentos
   set lancamento_erp = nullif(lancamento_erp - 'grupoContaFluxoCaixa' - 'contaFluxoCaixa' - 'contaContabilDebito', '{}'::jsonb)
 where marketplace;

-- Cadastro do fornecedor "Outros": categoria e conta de fluxo validadas; o item vai no corpo.
drop function crt_reservar_cadastro_fornecedor(uuid, text, int, int, uuid);
create function crt_reservar_cadastro_fornecedor(p_empresa uuid, p_nome text, p_categoria int, p_grupo int, p_item int, p_estabelecimento uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb := (select valor from configuracoes where chave = 'financeiro.cartao.fornecedor_outros');
  v_nome text := upper(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'));
  v_existente text;
  v_payload jsonb;
  v_id uuid;
begin
  if auth.uid() is null or not usuario_ativo() or not tem_acesso_area('financeiro', 'operador') then
    raise exception 'Somente operador do Financeiro (ou acima) cadastra fornecedor no Consistem.';
  end if;
  if not crt_lancar_no_erp_ligado() then
    raise exception 'O lançamento no Consistem está desligado (Configurações: financeiro.cartao.lancar_no_erp).';
  end if;
  if v_cfg is null or coalesce(v_cfg ->> 'endereco', '') = '' or coalesce(v_cfg ->> 'cep', '') = '' then
    raise exception 'Configure o endereço do fornecedor "Outros" (financeiro.cartao.fornecedor_outros).';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and codigo_erp is not null) then
    raise exception 'Empresa sem código do Consistem.';
  end if;
  if length(v_nome) < 2 or length(v_nome) > 60 then
    raise exception 'Informe o nome do fornecedor (2 a 60 caracteres).';
  end if;
  if not exists (select 1 from cap_categorias_fornecedor where codigo = p_categoria) then
    raise exception 'Escolha a categoria do fornecedor.';
  end if;
  if not exists (select 1 from cap_contas_fluxo where grupo = p_grupo and item = p_item and ativa) then
    raise exception 'Escolha uma conta de fluxo ativa.';
  end if;
  if p_estabelecimento is not null and exists (select 1 from crt_estabelecimentos where id = p_estabelecimento and marketplace) then
    raise exception 'Marketplace não tem fornecedor próprio: a nota é do vendedor e a conciliação casa pelo valor.';
  end if;
  select cod_fornecedor || ' · ' || nome into v_existente
    from cap_fornecedores
   where empresa_id = p_empresa and (crt_normalizar(nome) = crt_normalizar(v_nome) or crt_normalizar(coalesce(nome_fantasia, '')) = crt_normalizar(v_nome))
   limit 1;
  if v_existente is not null then
    raise exception 'Já existe fornecedor com esse nome no Consistem (%): use "Ligar".', v_existente;
  end if;
  v_payload := jsonb_build_object(
    'nome', v_nome, 'nomeFantasia', left(v_nome, 30), 'situacao', 1, 'classificacao', 3,
    'codCategoria', p_categoria, 'codGrupo', p_grupo, 'item', p_item,
    'endereco', left(v_cfg ->> 'endereco', 60), 'numero', left(v_cfg ->> 'numero', 5), 'bairro', left(v_cfg ->> 'bairro', 30),
    'cep', left(regexp_replace(v_cfg ->> 'cep', '\D', '', 'g'), 8), 'cidade', left(coalesce(v_cfg ->> 'cidade', ''), 60),
    'estado', left(coalesce(v_cfg ->> 'estado', ''), 2),
    'inscEstadual', left(coalesce(nullif(v_cfg ->> 'inscEstadual', ''), 'ISENTO'), 17),
    'codIbge', left(coalesce(v_cfg ->> 'codIbge', ''), 7));
  begin
    insert into crt_fornecedores_cadastrados (empresa_id, nome, payload, estabelecimento_id)
    values (p_empresa, v_nome, v_payload, p_estabelecimento)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Esse fornecedor já está sendo (ou já foi) cadastrado pelo painel.';
  end;
  return v_id;
end $$;
revoke all on function crt_reservar_cadastro_fornecedor(uuid, text, int, int, int, uuid) from public, anon;
grant execute on function crt_reservar_cadastro_fornecedor(uuid, text, int, int, int, uuid) to authenticated;
