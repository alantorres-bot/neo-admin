# Visão geral — Neo Admin

Plataforma única do administrativo, com um núcleo comum e módulos por área. Cada módulo automatiza
uma rotina que hoje é feita em planilha, e-mail, ERP ou skill avulsa.

## 1. Áreas e módulos

| Área | Módulo | O que automatiza | Prioridade |
| --- | --- | --- | --- |
| **Financeiro** | Recebíveis | Carteira, envio de boletos, confirmações, régua de cobrança, renegociações | 1 |
| Financeiro | Contas a pagar | Lista unificada de títulos e antecipações a fornecedor em aberto (API do Consistem), autorização de pagamento pela diretoria, histórico e relatório (ver `modulos/financeiro-contas-pagar.md`) | em construção |
| Financeiro | Cartão de crédito | Conciliação da fatura do cartão (PDF) x títulos do espelho do Contas a pagar, sugestão de lançamentos, planilha (ver `modulos/financeiro-cartao.md`; Fase 1 entregue) | em construção |
| Financeiro | Conciliação bancária | Extrato x lançamentos do ERP, pendências de baixa | 4 |
| Financeiro | Fluxo de caixa | Previsão a partir de recebíveis, pagáveis e parcelamentos | 5 |
| **Fiscal/Tributário** | Parcelamentos | Acordos (Receita, PGFN, SEFAZ/MT, PGE/MT), parcelas, risco de rescisão | 2 |
| Fiscal/Tributário | Análise de entradas | Conferência semanal de CFOP/CST/bases (CCESE735) | 4 |
| Fiscal/Tributário | Créditos tributários (Fiscal Control) | Créditos (registro, validação, disponibilidade), razão imutável, apuração mensal com transporte de saldo, fechamento, consolidado anual, obrigações com recibo, documentos privados, conciliação e tarefas com o contador (ver `modulos/fiscal-creditos.md` e `fiscal-control/`; primeira versão em 22/10/2026, aguardando avaliação) | em construção |
| Fiscal/Tributário | Notificações e guias | Notificações de órgãos, guias recebidas, prazos de resposta | 2 |
| **Contratos** | Contratos de venda/locação | Proposta → dados → minuta; aditivos; vencimentos contratuais | 3 |
| Contratos | Remessas e retornos (locação) | Controle REM x RET de equipamentos locados, pendências de devolução | 4 |
| Contratos | Cessões de crédito | Títulos cedidos (ex.: AKF), cartas de cessão — alimenta Recebíveis | 2 |
| Financeiro | AKF | Títulos cedidos/antecipados na AKF Securitizadora: carteira, antecipação, borderôs, passivo "por fora", prorrogação (ver `modulos/financeiro-akf.md`; Fases 1 e 2 entregues: carteira e solicitação de antecipação com rascunho no Gmail) | em construção |
| **Jurídico** | Processos e prazos | Processos (execuções, reclamatórias, ações), prazos, advogados, custos | 2 |
| Jurídico | Notificações extrajudiciais | Emitidas e recebidas, prazos e respostas | 3 |
| **RH/SST** | Folha de pagamento | Fechamento mensal: pagamento dos líquidos e avulsos, conferências (extrato × pagamento × DARF/FGTS/consignado), arquivo do BB, PIX, títulos no Consistem, documentos e checklist (ver `modulos/rh-folha.md`; especificação em rascunho desde 14/10/2026) | em especificação |
| RH/SST | Ponto | Inconsistências do Control iD por quinzena e setor: o líder justifica cada ocorrência pelo link do e-mail; o RH ajusta no Control iD e marca (ver `modulos/rh-ponto.md`; construído e calibrado com o PDF real em 21/10/2026, falta publicar) | em construção |
| RH/SST | Banco de horas | Saldo dos últimos 6 meses pelo CSV do Control iD, vencimento por ciclo (26 a 25 + 6 meses), aviso ao RH e ao líder, vencido a pagar na folha e alerta de negativo (ver `modulos/rh-banco-horas.md`; construído em 21/10/2026) | em construção |
| RH/SST | EPIs | Entregas por colaborador, vencimentos, análise mensal | 4 |
| RH/SST | Vale-transporte | Apuração mensal do VT de Cuiabá (dias, faltas, extras, tarifa), aprovação, arquivo do BB, PIX e títulos no Consistem (ver `modulos/rh-vale-transporte.md`; Fases A, B e C entregues em 14/10/2026: cadastro, mês a mês com ocorrências, aprovação, relatório, arquivo do BB, PIX, resumo do ano, histórico 2026 e títulos no Consistem) | em construção |
| **Comercial** | Pedidos | Carteira e previsão de faturamento, expedição (separação, NF, transporte, MDF-e), títulos e comissão do representante, pós-venda (cancelamentos e devoluções), tudo pela API Comercial do Consistem, só leitura na v1 (ver `modulos/comercial-pedidos.md`; Fase 0 e Fase 1 (carteira e faturamento) em 19/10/2026) | em construção |
| Comercial | Comissões | Fechamento mensal da comissão dos representantes (títulos pagos + CCCCI010), histórico das planilhas, teto por pedido, relatório e extrato por representante (ver `modulos/comercial-comissoes.md`; movido do Financeiro em 20/10/2026) | em construção |
| **Administrativo geral** | Central de Gestão | Visão gerencial das pendências de todos os módulos (indicadores, "Exige minha intervenção", equipe, fila consolidada), tarefas manuais com bloqueio e decisão do gestor, destaque gerencial com motivo e sugestões de melhoria (ver `modulos/administrativo-gestao.md`; especificação em rascunho desde 22/10/2026) | em especificação |
| Administrativo geral | POPs | Procedimentos padrão por área, versionados | 5 |

Prioridade: 1 = primeiro a construir. Ajustável.

## 2. Núcleo comum (usado por todos os módulos)

| Componente | Função |
| --- | --- |
| Empresas | Empresas do grupo (Neo Formas, Neo Serviços, Oeste Formas, Bolão etc.) |
| Contrapartes | Cadastro único de clientes, fornecedores, órgãos, tribunais, escritórios, pessoas |
| Usuários e permissões | Perfil por área: administrador, gestor, operador, consulta, sem acesso |
| Pendências | Itens que exigem ação humana, de qualquer módulo → **Fila do dia** |
| Anexos | Arquivos no Storage ligados a qualquer registro |
| Importador | Leitura de CSV/XLSX com mapeamento de colunas configurável (relatórios do Consistem) |
| Comunicação | Envio por e-mail (rascunho no Gmail) e WhatsApp, com histórico |
| Integração ClickUp | Cria/atualiza tarefas a partir de pendências, quando configurado |
| Auditoria | Antes/depois de toda alteração relevante |
| Configurações | Parâmetros globais e por módulo (`modo_rascunho`, horários de envio etc.) |
| Aplicativos externos | Cadastro dos sistemas de outras áreas (Vigilância Fiscal, NEOControl, apps de Produção…) que aparecem no menu e no Início; abrem embutidos em `/apps/<codigo>` ou em nova aba. Só admin_geral cadastra; quem tem a área vê |

## 3. Telas da plataforma
- **Painel geral:** indicadores-chave de cada área que o usuário pode ver.
- **Início (super painel):** cartões por área com os módulos do Neo Admin e os aplicativos externos a que o usuário tem acesso. A Fila do dia fica em Financeiro > Recebíveis > Fila do dia.
- **Menu por área:** Financeiro, Fiscal, Contratos, Jurídico, RH/SST, Administrativo, Produção, Estoques, Comercial. Módulos nativos e aplicativos externos lado a lado.
- **Configurações:** empresas, contrapartes, usuários e permissões, integrações.

## 4. Ordem de construção
1. **Fase 0 — Núcleo:** projeto, login, permissões por área, empresas, contrapartes, pendências, anexos,
   importador genérico, layout com menu por área e Fila do dia.
2. **Fase 1 — Financeiro / Recebíveis** (ver `docs/modulos/financeiro-recebiveis.md`, fases internas 1 a 8).
3. **Fase 2 — Fiscal / Parcelamentos e Notificações; Jurídico / Processos; Contratos / Cessões.**
4. **Fase 3 — Contas a pagar (em construção desde 09/10/2026); Cartão de crédito (em construção desde 12/10/2026); Comissões; Contratos de venda/locação.**
5. **Fase 4 — Conciliação bancária; Análise de entradas; REM x RET; RH/SST.**
6. **Fase 5 — Fluxo de caixa; POPs; painel geral consolidado.**

Cada módulo novo começa com uma especificação em `docs/modulos/` (usar `_MODELO.md`), aprovada antes do código.

## 5. Aplicativos externos (super painel) — decisão de 09/10/2026
Os sistemas das outras áreas **não** são fundidos ao Neo Admin: cada um segue com código, banco, login e time próprios.
O Neo Admin é a porta de entrada única: tabela `aplicativos` (migration 0006), rota `app/(plataforma)/apps/[codigo]`
(quadro embutido com "Abrir em nova aba", ou só nova aba), itens no menu e cartões no Início via `montarMenu(..., aplicativos)`.
Cadastro em Configurações > Aplicativos (admin_geral): nome, código, endereço https, área, modo de abertura, ícone, ordem, ativo.
Identidade comum: a conta Google do Workspace. O Neo Admin aceita "Entrar com Google" desde 10/10/2026 (`docs/LOGIN_GOOGLE.md`,
migration 0007); a Vigilância Fiscal e o NEOControl recebem o mesmo botão na fase seguinte, funcionando dentro do quadro
embutido por meio de uma janela de login (popup). Os bancos continuam separados: sair de um app não sai dos outros.
