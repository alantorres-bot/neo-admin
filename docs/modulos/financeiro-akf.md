# Módulo: Financeiro / AKF

Status: em construção (Fase 1 entregue em 06/10/2026)

## 1. Objetivo
Gerir os títulos da Neo Formas que estão com a AKF Securitizadora (cessão/antecipação de recebíveis): saber o que está na AKF, o que ainda pode ser antecipado, solicitar antecipações, conferir borderôs, controlar o passivo "por fora", prorrogar e cobrar. Traz para o Neo Admin o que o **Gestor AKF** (`C:\Users\alant\gestor-akf`, Streamlit) faz hoje, com persistência, histórico e integração com Recebíveis. O Gestor AKF não tem cobrar, prorrogar nem solicitar antecipação como telas: essas funções são especificadas junto, nas fases 2 e 5.

## 2. Como é feito hoje
- Carteira do Consistem (portador **998** = título na AKF; 91 e 237 = com a Neo) lida pela API no Gestor AKF, sem gravar nada.
- A AKF opera dois borderôs paralelos para os mesmos títulos: **"por dentro"** (conexão PRODUCAO, nº 8xxx, deságio oficial) e **"por fora"** (PRODUCAO02, nº 7xxx, deságio maior). A diferença é um custo extra, controlado numa planilha Excel.
- Seleção de títulos, e-mail de instrução, leitura de borderôs (PDF por OCR), conciliação, passivo e custo efetivo: telas do Gestor AKF, sem persistência.

## 3. Escopo
| Entra | Fica fora |
| --- | --- |
| Carteira na AKF e disponíveis para antecipar (Fase 1) | Leitura automática (OCR) dos PDFs dos borderôs (Fase 6, se pedida) |
| Solicitar antecipação: seleção, e-mail em rascunho (Fase 2) | Envio automático de e-mail à AKF (só rascunho no Gmail) |
| Borderôs com conferência, conciliação, custo efetivo (Fase 3) | Limites de crédito e concentração (o Gestor AKF os removeu por serem voláteis) |
| Passivo "por fora" (Fase 4) | Enquadramento fiscal/jurídico do "por fora" |
| Prorrogação e cobrança de título cedido (Fase 5) | Taxa de prorrogação inventada: o encargo é informado pela AKF |

## 4. Entradas
- Títulos de `rec_vw_titulos` (sincronizados do Consistem por Recebíveis; `cod_portador`, `cedido`).
- Parâmetros em `configuracoes` (`financeiro.akf.*`).
- Fases seguintes: borderôs (PDF anexado + totais e títulos digitados), planilha de passivo (Excel), encargo de prorrogação informado pela AKF.

## 5. Regras de negócio
1. **Na AKF** = `cedido` ou portador 998. Disponível para antecipar = a vencer, fora da AKF, não contestado, em estágio importado/aguardando boleto/boleto enviado/confirmado (`_shared/akf.ts`, regras do Gestor AKF).
2. **Portador manda no `cedido`** (migration 0112, gatilho em `rec_titulos`): entrou no 998 = cedido; saiu do 998 = deixa de ser cedido e volta à régua de Recebíveis. Marcar à mão (`akf_marcar_cedido`) vale enquanto o portador não mudar. Cedido já tira o título da régua de cobrança, da confirmação e do botão "Cobrar" de Recebíveis.
3. Clientes "sem boleto de factoring" (MIP, MB, JANEIRO, CAPARAO, HOUSE GARDEN, QRTZ 39; casa por trecho do nome sem acento): operados 1 dia após o vencimento, sem emitir boleto (aparece como selo na lista de disponíveis).
4. Fórmulas do Gestor AKF a portar nas fases seguintes (arquivo de origem entre parênteses): líquido = total − deságio; desembolso = líquido − recompras + créditos − débitos − abatimento, tolerância R$ 0,05 (`calculos.py`); recompra = título + correção + multa 2% do título + despesas; taxa efetiva = `deságio/(face−deságio)` composta a 30 dias; deságio estimado = valor × taxa a.m. × dias/30, com taxa de referência 2,18% a.m. (`selecao.py`); passivo = gerado − pago + estornado, estorno quando a observação contém "devolu/estorno" (`passivo.py`).
5. Nada é enviado: e-mails à AKF terminam em "Atenciosamente,", sem assinatura, e saem como rascunho no Gmail.

## 6. Saídas e automações
Fase 1: nenhuma automação nova (o gatilho do portador atua na sincronização existente). Fases seguintes: rascunho de e-mail à AKF, pendências na Fila do dia, interações no histórico do título.

## 7. Telas
- **`/financeiro/akf` (Fase 1):** seletor de unidade (Matriz/Filial Contagem), três cartões (Na AKF, Vencidos na AKF, Disponíveis para antecipar) e três visões com busca e paginação. Operador marca títulos como "na AKF" (na visão Disponíveis) ou os retira (nas visões da AKF), com observação opcional. O documento abre a ficha do título em Recebíveis.

## 8. Dados (prefixo `akf_`)
- Fase 1: `akf_marcar_cedido()` (função, `security invoker`, tudo ou nada, até 100 títulos, interação `akf_cessao`/`akf_retirada` no histórico) e o gatilho `trg_rec_titulos_cedido_portador`. A coluna `rec_titulos.cedido` já existia. Na migration, os 50 títulos abertos que já estavam no portador 998 (R$ 2,48 mi) foram marcados como cedidos.
- Fases 2–5: `akf_operacoes`, `akf_operacao_titulos`, `akf_borderos`, `akf_bordero_titulos`, `akf_passivo_lancamentos`, `akf_prorrogacoes`, `akf_instrucoes` (RLS por `financeiro`, auditoria, sem exclusão de registros de prova).

## 9. Permissões
Área `financeiro`: consulta vê; operador marca/retira e (nas fases seguintes) solicita, registra borderô e prorrogação; gestor aprova. Anexos (PDF dos borderôs) em `financeiro.akf/...` no bucket privado.

## 10. Pontos em aberto
- Regra de cálculo da prorrogação (hoje: valor informado pela AKF) e se a prorrogação altera o vencimento no Consistem (lançamento manual).
- Confirmar com o Financeiro a taxa de referência (2,18% a.m.) e a lista de clientes sem boleto.
- Contatos da AKF (destinatários do e-mail de instrução): entram na Fase 2, sem gravar e-mails no código.
- O cliente OAuth do Gmail do Neo Admin está no projeto Google Cloud do Gestor AKF: manter esse projeto.
- A visão "ocultar vencidos há mais de 90 dias" de Recebíveis ainda não existe aqui.
