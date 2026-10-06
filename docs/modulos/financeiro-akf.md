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

## 11. Antecipação parcial (desdobramento no Neo Admin) — entregue em 06/10/2026

Alguns títulos são antecipados só em parte na AKF e **o Consistem não aceita desdobrar o título em Contas a Receber**. O desdobramento fica só aqui, **por cima** do título: `rec_titulos` continua igual ao Consistem (a sincronização reescreve valor e vencimento dele) e cada antecipação parcial é um lançamento em `akf_desdobramentos`.

- **Regras (decisões do usuário):** a parte na AKF tem **valor e vencimento próprios** (o do borderô); um título pode ter **várias antecipações parciais**; o que resta com a Neo é **título − soma das partes ativas** e continua em "Disponíveis para antecipar", com o valor restante e o vencimento original do título; a régua de cobrança e a confirmação de Recebíveis usam **só o valor restante** (a parte na AKF não é cobrada pela Neo).
- **Banco (migration 0113):** `akf_desdobramentos` (valor, vencimento da parte, data da operação, observação, status ativo/encerrado, quem e quando criou e encerrou, motivo; RLS de Financeiro; auditoria; **sem exclusão**), a view `akf_vw_valor_restante` (por título com parte ativa: valor na AKF e restante), `akf_desdobrar_titulo()` e `akf_encerrar_desdobramento()` (transação, RLS de quem chama, interação `akf_desdobramento`/`akf_desdobramento_encerrado` no histórico do título). Valida: valor > 0 e com até 2 casas, o valor antecipado (somado às partes) **menor que o título** (para antecipar o título inteiro, "Marcar como na AKF"), vencimento não anterior à emissão e no máximo 3 anos à frente, data da operação não futura, título aberto e ainda não cedido por inteiro.
- **Consistência:** título pago/cancelado/renegociado em Recebíveis **encerra as partes sozinho**; título que passa por inteiro para a AKF (portador 998 ou marcação manual) deixa de contar as partes, e `akf_marcar_cedido` recusa marcar o título inteiro enquanto houver parte ativa (é preciso encerrar as partes antes).
- **Telas:** em `/financeiro/akf`, na visão "Disponíveis para antecipar", o botão **Antecipar parte** abre o valor, o vencimento da parte e a observação; a seção **Antecipações parciais na AKF** lista as partes (valor, vencimento, operação, o que resta com a Neo) com **Encerrar parte** (motivo obrigatório). Os cartões somam a parte em "Na AKF" (e em "Vencidos" quando o vencimento da parte passou) e tiram a parte de "Disponíveis". Em Recebíveis, a Carteira mostra "R$ X na AKF · resta R$ Y" sob o valor, e a ficha do título mostra o selo "Parcial na AKF". A cobrança e a confirmação (telas e Edge Function `rec-sincronizar-consistem`) usam o valor restante.
- **Testado:** 12 testes de banco (antecipação, várias partes, validações, permissões, encerramento, ausência de exclusão, encerramento automático, título inteiro na AKF, view) e, ao vivo com o título de teste `TESTE-NOVO-1` (R$ 30.000): parte de R$ 12.000 com vencimento 30/10 → "Na AKF" +12.000, "Disponíveis" −12.000 e R$ 18.000 restantes; a sincronização rodou sem erro; parte encerrada ao final.
- **Fica para a Fase 2 (solicitar antecipação):** a seleção de títulos deve usar o valor restante dos títulos parciais; o borderô (Fase 3) pode registrar as partes ao conciliar.

### 11.1 Localizar qualquer título para antecipar (06/10/2026)
A visão "Disponíveis para antecipar" só traz título **a vencer**; os títulos antigos e vencidos não aparecem ali. Por isso `/financeiro/akf` tem, logo abaixo dos cartões, o campo **Antecipar um título (parcial ou inteiro)**: busca por documento, código ou nome do cliente em **todos os títulos em aberto** (inclusive vencidos e antigos; respeita a unidade escolhida; até 30 resultados, os de vencimento mais recente primeiro). Em cada resultado há **Antecipar parte** (valor, vencimento da parte, observação) e a caixa para **Marcar como na AKF** (título inteiro); o que já está inteiro na AKF aparece só como "Na AKF", sem ações. Num título vencido, o vencimento da parte pode ser passado (não anterior à emissão); o restante com a Neo segue vencido na carteira de Recebíveis (só título a vencer é "disponível para antecipar").

### 11.2 A parte antecipada é uma linha como outro título qualquer (06/10/2026)
Nas visões **Na AKF** e **Vencidos na AKF**, cada parte antecipada aparece como uma **linha própria** (documento do título com o selo "Parcial", valor e vencimento **da parte**, atraso pelo vencimento da parte, "resta R$ X com a Neo"), misturada aos títulos inteiros e ordenada por vencimento. Conta como título normal nos cartões, nas quantidades das abas e do seletor de unidade, no rodapé ("N títulos") e na paginação (a lista junta títulos inteiros e partes e pagina na tela). Em "Vencidos na AKF" entram as partes cujo vencimento já passou. Cada linha de parte tem **Encerrar parte** (motivo obrigatório); a busca da tela também acha as partes pelo documento ou pelo cliente. A seção separada "Antecipações parciais" ficou só na visão "Disponíveis", onde as partes não são linhas. Recebíveis continua com o título inteiro do Consistem e a nota "X na AKF · resta Y" (decisão do usuário).
