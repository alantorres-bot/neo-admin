# Visão geral — Neo Admin

Plataforma única do administrativo, com um núcleo comum e módulos por área. Cada módulo automatiza
uma rotina que hoje é feita em planilha, e-mail, ERP ou skill avulsa.

## 1. Áreas e módulos

| Área | Módulo | O que automatiza | Prioridade |
| --- | --- | --- | --- |
| **Financeiro** | Recebíveis | Carteira, envio de boletos, confirmações, régua de cobrança, renegociações | 1 |
| Financeiro | Contas a pagar e cartão | Conciliação da fatura do cartão x contas a pagar, sugestão de lançamentos | 3 |
| Financeiro | Conciliação bancária | Extrato x lançamentos do ERP, pendências de baixa | 4 |
| Financeiro | Comissões | Cálculo de comissão sobre parcelas pagas (relatório de títulos pagos) | 3 |
| Financeiro | Fluxo de caixa | Previsão a partir de recebíveis, pagáveis e parcelamentos | 5 |
| **Fiscal/Tributário** | Parcelamentos | Acordos (Receita, PGFN, SEFAZ/MT, PGE/MT), parcelas, risco de rescisão | 2 |
| Fiscal/Tributário | Análise de entradas | Conferência semanal de CFOP/CST/bases (CCESE735) | 4 |
| Fiscal/Tributário | Notificações e guias | Notificações de órgãos, guias recebidas, prazos de resposta | 2 |
| **Contratos** | Contratos de venda/locação | Proposta → dados → minuta; aditivos; vencimentos contratuais | 3 |
| Contratos | Remessas e retornos (locação) | Controle REM x RET de equipamentos locados, pendências de devolução | 4 |
| Contratos | Cessões de crédito | Títulos cedidos (ex.: AKF), cartas de cessão — alimenta Recebíveis | 2 |
| **Jurídico** | Processos e prazos | Processos (execuções, reclamatórias, ações), prazos, advogados, custos | 2 |
| Jurídico | Notificações extrajudiciais | Emitidas e recebidas, prazos e respostas | 3 |
| **RH/SST** | Rotinas de folha | Checklist mensal, conferência de folha, FGTS, rescisões | 4 |
| RH/SST | EPIs | Entregas por colaborador, vencimentos, análise mensal | 4 |
| **Administrativo geral** | POPs | Procedimentos padrão por área, versionados | 5 |

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

## 3. Telas da plataforma
- **Início (Fila do dia):** pendências do usuário de todos os módulos, por prazo e criticidade.
- **Painel geral:** indicadores-chave de cada área que o usuário pode ver.
- **Menu por área:** Financeiro, Fiscal, Contratos, Jurídico, RH/SST, Administrativo.
- **Configurações:** empresas, contrapartes, usuários e permissões, integrações.

## 4. Ordem de construção
1. **Fase 0 — Núcleo:** projeto, login, permissões por área, empresas, contrapartes, pendências, anexos,
   importador genérico, layout com menu por área e Fila do dia.
2. **Fase 1 — Financeiro / Recebíveis** (ver `docs/modulos/financeiro-recebiveis.md`, fases internas 1 a 8).
3. **Fase 2 — Fiscal / Parcelamentos e Notificações; Jurídico / Processos; Contratos / Cessões.**
4. **Fase 3 — Contas a pagar e cartão; Comissões; Contratos de venda/locação.**
5. **Fase 4 — Conciliação bancária; Análise de entradas; REM x RET; RH/SST.**
6. **Fase 5 — Fluxo de caixa; POPs; painel geral consolidado.**

Cada módulo novo começa com uma especificação em `docs/modulos/` (usar `_MODELO.md`), aprovada antes do código.
