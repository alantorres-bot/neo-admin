# Módulo: Financeiro / Recebíveis

Status: aprovado para construção — versão 1, 02/10/2026
Código do módulo: `financeiro.recebiveis` · Prefixo das tabelas: `rec_`

## 1. Objetivo e premissas

A aplicação executa a rotina de contas a receber de ponta a ponta: recebe os títulos, envia boletos, confirma pagamentos, cobra atrasos e controla renegociações, pedindo decisão humana só onde há risco.

1. **Títulos:** importados do Consistem (relatório "Consulta de Títulos em Aberto", CSV/XLSX) ou lançados manualmente.
2. **Boletos:** sem API bancária. O boleto é gerado no banco/Consistem; o PDF é anexado na aplicação, que cuida do envio e do acompanhamento.
3. **Pagamentos:** sem retorno bancário. Baixa pela importação do relatório de títulos pagos do Consistem ou baixa manual com comprovante.
4. **Canais:** e-mail e WhatsApp.

## 2. Escopo

| Entra no MVP | Fica fora (fase 2) |
| --- | --- |
| Importação da carteira e cadastro manual | Integração por API com o Consistem |
| Clientes, contatos de cobrança e contratos | Emissão automática de boletos |
| Upload do PDF do boleto e vínculo com o título | Baixa automática por retorno bancário (CNAB) |
| Envio de boleto por e-mail e WhatsApp, com registro | Negativação e protesto automático |
| Confirmação prévia de pagamento com o cliente | Portal do cliente |
| Régua de cobrança automática | Cobrança de locação com medição |
| Cálculo de encargos e carta de cobrança em PDF | |
| Simulação, aprovação e controle de renegociações | |
| Baixa por importação de títulos pagos ou manual | |
| Painel: aging, inadimplência, previsão | |
| Pendências na Fila do dia (núcleo) e, se configurado, no ClickUp | |

Títulos **cedidos** ficam marcados e fora da régua automática.

## 3. Ciclo de vida do título (estágios)

1. `importado` — verifica duplicidade (empresa + documento + parcela).
2. `aguardando_boleto` — falta PDF; alerta a partir de D-10.
3. `boleto_enviado` — registra canal, data, destinatário.
4. `confirmado_cliente` — cliente confirmou que o pagamento está programado.
5. `vencido` — passou da data sem baixa; entra na régua.
6. `promessa` — régua pausa até a data prometida; retoma se não houver baixa.
7. `em_renegociacao` — régua suspensa.
8. `renegociado` — substituído pelas parcelas do acordo.
9. `pago` — baixa por importação ou manual.
10. `juridico` — fora da cobrança administrativa.
11. `cancelado`.

Marcadores paralelos: `cedido` (fora da régua), `contestado` (régua pausada), cliente `estrategico` (toda cobrança exige aprovação).

## 4. Régua padrão (editável, pode variar por cliente)

| Marco | Ação | Canal | Aprovação |
| --- | --- | --- | --- |
| D-7 | Envio do boleto (se não enviado) | E-mail + WhatsApp | Automático |
| D-3 | Pedido de confirmação de programação do pagamento | WhatsApp | Automático |
| D-1 | Sem confirmação: pendência para contato telefônico | Interno | — |
| D+1 | Lembrete cordial de vencimento | E-mail + WhatsApp | Automático |
| D+5 | Segundo aviso, pedindo previsão | WhatsApp | Automático |
| D+10 | Cobrança formal com demonstrativo de encargos | E-mail | Operador |
| D+15 | Carta de cobrança em PDF (encargos + dados bancários) | E-mail | Gestor |
| D+30 | Proposta de renegociação ou notificação extrajudicial | E-mail | Gestor |
| D+45 | Encaminhamento ao jurídico | Interno | Gestor |

Regras:
- Vários títulos do mesmo cliente no mesmo marco = **uma** mensagem.
- Pausa: promessa, renegociação, contestação, cedido.
- Envios em dias úteis, 8h–18h (America/Cuiaba).
- **Início controlado:** nas primeiras semanas todos os marcos geram rascunho (configuração global `modo_rascunho = true`).

## 5. Renegociação

1. Simulação: saldo atualizado na data-base; cenários à vista com desconto, parcelado, entrada + parcelas.
2. Alçadas: desconto e prazo máximos por perfil (valores configuráveis, a definir).
3. Aprovação registrada.
4. Termo de acordo gerado de modelo (texto fornecido pelo jurídico — não redigir cláusulas por conta própria).
5. Títulos originais → `renegociado`; novas parcelas criadas com `origem = 'acordo'` e pendência para lançar no Consistem.
6. Quebra: atraso acima de `dias_tolerancia_quebra` → acordo `quebrado`, alerta ao gestor.

## 6. Telas

1. **Fila do dia** (inicial): boletos faltando, mensagens aguardando aprovação, clientes sem resposta, promessas vencendo, acordos em risco. Ação direta em cada item.
2. **Painel:** aging (a vencer, 1–15, 16–30, 31–60, +60), inadimplência %, previsão de recebimento por semana, top 10 devedores. Filtros por empresa, cliente, contrato.
3. **Carteira:** lista de títulos com estágio, vencimento, valor, valor atualizado, último contato; ações em lote.
4. **Ficha do cliente:** contatos, títulos, histórico de mensagens/interações, promessas, acordos, contratos.
5. **Boletos:** upload em lote; extrair linha digitável, valor e vencimento do PDF e sugerir o título correspondente.
6. **Renegociações:** simulador, propostas, aprovações, acordos ativos/quebrados.
7. **Importações:** títulos em aberto e pagos, com pré-visualização (novos, alterados, baixados, divergentes) antes de gravar.
8. **Configurações:** régua, modelos de mensagem, encargos padrão, alçadas, usuários.

Permissões (núcleo, área `financeiro`): `gestor` aprova cartas e acordos; `operador` opera; `consulta` só lê.

## 7. Modelo de dados

Ver `supabase/migrations/0100_financeiro_recebiveis.sql`.

- **Do núcleo:** empresas, contrapartes (clientes), contatos, mensagens, interações, anexos (PDF do boleto), pendências, importações, auditoria.
- **Do módulo:** rec_reguas, rec_regua_marcos, rec_clientes_config, rec_contratos, rec_titulos, rec_acordos, rec_acordo_titulos, rec_promessas, rec_mensagem_titulos.
- **View:** `rec_vw_titulos` (dias de atraso, faixa, valor atualizado).

## 8. Automações (Edge Functions + pg_cron)

| Função | Gatilho | Faz |
| --- | --- | --- |
| importar-titulos | Upload | Cria/atualiza pela chave de conciliação; aponta divergências |
| importar-pagos | Upload | Baixa títulos, encerra régua, cumpre promessas/parcelas de acordo |
| motor-regua | Dias úteis 8h | Calcula marco de cada título; gera mensagens agrupadas (rascunho ou envio) |
| enviar-mensagem | Mensagem aprovada | Gmail e/ou WhatsApp com boleto anexo; grava status/erro |
| webhook-whatsapp | Resposta do cliente | Registra interação; botões "Já programei", "2ª via", "Quero negociar" atualizam estágio |
| resumo-semanal | Segunda 7h30 | Aging, recebido x previsto, acordos em risco; rascunho no Gmail |

## 9. Importação do Consistem

O layout exato dos relatórios será fornecido por amostra (`docs/amostras/`). Mapear colunas em arquivo de configuração, não fixo no código. Campos mínimos esperados: empresa, código/nome do cliente, CNPJ, documento, parcela, emissão, vencimento, valor, (pagos: data e valor do pagamento).

## 10. Fases internas do módulo

1. **Fase 1 — Base do módulo:** migration 0100, configuração de clientes no módulo, contratos (encargos, cedido), menu Financeiro > Recebíveis. (Login, empresas e contrapartes já vêm do núcleo.)
2. **Fase 2 — Carteira:** importação de títulos em aberto e pagos, tela Carteira, view de valor atualizado, testes de encargos.
3. **Fase 3 — Boletos:** upload, leitura do PDF, vínculo com títulos.
4. **Fase 4 — Régua e e-mail:** modelos, motor da régua, Fila do dia, rascunhos no Gmail.
5. **Fase 5 — Painel e ficha do cliente.**
6. **Fase 6 — Renegociação.**
7. **Fase 7 — WhatsApp** (depende de número e modelos aprovados pela Meta).
8. **Fase 8 — Carga real e testes com 3 a 5 clientes.**

## 11. Pontos em aberto

- Alçadas de desconto e prazo.
- Modelo do termo de acordo e da notificação (validar com advogado).
- Provedor/número do WhatsApp Business.
- Quem aprova mensagens no dia a dia.
- Empresas do grupo incluídas no início.
- Títulos de locação mensal no MVP ou depois.
