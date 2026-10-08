# Módulo: Financeiro / Cobrança

Status: concluído (08/10/2026); regra editável (parâmetros e marcos) concluída

## 1. Objetivo
Reunir o trabalho do dia do contas a receber, por etapa, separado da carteira: o que falta boleto, o que falta enviar, o que falta confirmar, o que cobrar e o que baixar, mais a consulta da regra de cobrança.

## 2. Escopo
| Entra | Fica fora |
| --- | --- |
| Regra editável (parâmetros e marcos, com textos e prévia) e filas: boletos a anexar, a enviar (boleto e dados de pagamento), confirmar pagamento, cobrar (D+1/D+5/D+10), baixas a conferir; tela de regra (consulta) | Carteira, aging e fichas (Recebíveis); envio automático de mensagens (o sistema nunca envia) |

## 3. Referência
Regras, filas e rotas estão em `docs/modulos/financeiro-recebiveis.md` (seções 19, 26–31). Menu: módulo `financeiro.cobranca`, rota `/financeiro/cobranca`.
