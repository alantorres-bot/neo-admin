# Módulo: Financeiro / Comissões

Status: rascunho (19/10/2026). Aguarda as respostas do §10 e a aprovação do Alan.

## 1. Objetivo
Fechar todo mês a comissão dos representantes no Neo Admin, no lugar das planilhas "Comissões <Nome> - 2026.xlsx".

O sistema propõe as linhas a partir dos títulos pagos no Consistem, o Alan confere e ajusta, e o fechamento fica registrado. Um fechamento registrado:
- não é recalculado;
- impede pagar duas vezes o mesmo título.

## 2. Como é feito hoje
- **Quem faz:** o Alan, em Excel, com uma planilha por representante e uma aba por mês. As planilhas ficam em `G:\Drives compartilhados\Neo Formas Publico\ADMINISTRATIVO\02 - COMERCIAL\03 - COMISSÕES`.
- **Quem recebe comissão hoje:** só **Fernando Grassmann** (representante 3 no Consistem) e **Heitor Selerges** (representante 7).
- **Detalhes:** a fórmula, os percentuais e o fechamento estão em `comercial-pedidos.md` §10-A.

## 3. Regras confirmadas (19/10/2026)
1. **Mês de referência = parcela PAGA no mês.** A data de pagamento conta, não o vencimento: 36 de 153 títulos foram pagos antes do vencimento.
2. **Comissão = valor do título × percentual do tipo.**

   | Representante | Venda | Locação |
   | --- | --- | --- |
   | Fernando (3) | 1,5% | 3% |
   | Heitor (7) | 1% | 1% |

   Exemplo: título de R$ 154.000,00 → Fernando R$ 2.310,00; Heitor R$ 1.540,00.
3. **Dois representantes no mesmo título: cada um recebe o seu percentual cheio.**
4. **Não geram comissão as baixas 7 (Antecipação), 8 (Devolução de cliente) e 11 (Perdas).** As demais geram, inclusive 3 (Desconto, a cessão à AKF) e 10 (Dev. de compras).
5. **Adiantamento do cliente** (crédito cadastrado na CCCCI010) gera comissão quando entra. A duplicata compensada depois com esse crédito (baixa 7) não gera de novo.
6. **Um recebimento, uma comissão.** Exemplo: um título Z cedido à AKF, depois estornado e compensado na NF definitiva gera uma comissão só, na data do pagamento.
7. **Antecipações de comissão já pagas ao representante** são descontadas no fechamento: total do mês − antecipado = saldo a pagar.

## 4. O que os dados mostram (comparação de agosto e setembro/2026 com as planilhas)

A fonte é `GET financeiro/v10/titulosPagos` (títulos pagos no período). Para cada título, `GET financeiro/v10/contasReceber/{codTitulo}`, que traz **`codRepresentante`**, `tipoBaixa`, `percComissao`, `valorComissaoFaturamento` e `valorComissaoLiquidacao`. Isso vale também para os títulos Z.

Hipótese testada: o **Heitor** recebe pelos títulos do representante 7, e o **Fernando** pelos do 3 **e do 7**.

| Mês | Heitor | Fernando |
| --- | --- | --- |
| Agosto | 1 de 1 linha bate | 6 de 8 linhas batem (uma é o Z00026B, lançado na planilha como "112"). Pela hipótese, entrariam mais 5 títulos que não estão na planilha (§10, itens 2 e 3) |
| Setembro | 2 de 3 batem. A 3ª é o Z00027A, estornado | 4 de 7 batem; as outras são o Z00027A e um adiantamento da CCCCI010. O 1001323C entrou em agosto, antes de ser pago (§10, item 4) |

**Extrato de comissões do Consistem** (`comissaosobrevendas/v10/extratoComissoes`):
- cobre só parte dos títulos;
- o representante 7 é creditado no faturamento, e não na baixa;
- serve de conferência, não de base.

## 5. Escopo
| Entra | Fica fora |
| --- | --- |
| Cadastro dos representantes comissionados, com percentuais e "recebe também pelas vendas de" | Pagamento da comissão (segue fora; o módulo registra o fechamento) |
| Fechamento mensal: proposta automática, conferência, ajustes com motivo, antecipações a descontar, saldo | Alterar a comissão no Consistem |
| Lançamentos manuais (adiantamento da CCCCI010 enquanto não há importação, contrato, locação) | Importação do relatório da CCCCI010 (Fase 2 deste módulo; depende de um exemplo do relatório) |
| Relatório do fechamento (imprimir e Excel) e histórico | Controle "título Z sem crédito na CCCCI010" (fica em Recebíveis) |

## 6. Telas (`/financeiro/comissoes`)
- **Fechamentos:** lista por mês e representante, com a situação (em conferência / fechado), o total, o antecipado e o saldo.
- **Fechamento do mês:**
  - botão "Buscar títulos pagos do mês" (Edge Function);
  - grade com título, NF, data de pagamento, valor, tipo (Venda/Locação), tipo de baixa, % e comissão, mais a coluna "Consistem", com o valor do extrato quando houver;
  - incluir ou excluir cada linha, com motivo;
  - adicionar lançamento manual e antecipação;
  - botão **Fechar**, que congela o fechamento.
- **Representantes:** código do Consistem, nome, % venda, % locação, de quais representantes recebe e se está ativo.

## 7. Dados (prefixo `fin_com_`, migrations do Financeiro a partir de 0171)
- **`fin_com_representantes`:** `cod_representante`, `nome`, `perc_venda`, `perc_locacao`, `ativo`, `recebe_de` (text[]: códigos dos representantes cujas vendas também geram comissão para ele; o Fernando recebe de {3, 7}).
- **`fin_com_fechamentos`:** representante, mês, situação (`em_conferencia` | `fechado`), total, antecipado, saldo, `fechado_em`, `fechado_por`.
  - **Fechado não muda nem é apagado (regra 4).** Uma correção vira lançamento de ajuste no mês seguinte.
- **`fin_com_linhas`:** do fechamento.
  - Campos: origem (`titulo` | `manual` | `antecipacao`), `cod_titulo`, `nota`, `data_pagamento`, `valor_base`, `tipo` (venda/locação), `tipo_baixa`, `percentual`, `valor_comissao`, `incluida`, `motivo`, `valor_consistem`.
  - **Índice único** (representante, `cod_titulo`) entre os fechamentos **fechados**: o mesmo título nunca é pago duas vezes ao mesmo representante.
- **Auditoria** em tudo, porque o fechamento é prova.

## 8. Permissões
- **Área Financeiro:**
  - consulta: vê;
  - operador: monta e confere;
  - gestor: fecha.
- **Pelo Comercial:** só via view pública, se for necessário.

## 9. Saídas
- Relatório do fechamento por representante, no formato da planilha atual: total do mês, antecipações e saldo a pagar.
- Exportação em Excel.
- Pendência na Fila do dia "Fechar comissão de <mês>", no 1º dia útil do mês seguinte.

## 10. Perguntas para o Alan (antes de construir)
1. **O Fernando recebe também pelas vendas do Heitor** (representante 7)? Os dados indicam que sim: todo título do Heitor está também na planilha do Fernando.
2. **Os títulos da Filial Contagem (prefixo 400…) não geram comissão?** Em agosto, 4000040U (R$ 2.660,00) e 4002252U (R$ 12.010,76), do representante 3, não estão na planilha.
3. **1001341U** (NF 1341, R$ 1.500.000,00, pago em 24/08, representante 3) e **Z00009A** (R$ 12.467,33, pago em 25/08) não estão na planilha de agosto. O primeiro é a compensação de um adiantamento já comissionado (o "112" de julho)? E o segundo?
4. **1001323C** (vencimento 05/09, pago em 08/09) entrou na planilha de **agosto**. Foi exceção (comissão adiantada) ou a regra é outra para esse caso?
5. **Como saber se o título é Venda ou Locação?** Hoje a planilha marca à mão; a única "Locação" foi um contrato. Por tipo de nota? Por padrão "Venda", com troca manual?
6. **A comissão incide sobre o valor do título ou sobre o valor pago?** Em 151 de 153 títulos os dois são iguais.
