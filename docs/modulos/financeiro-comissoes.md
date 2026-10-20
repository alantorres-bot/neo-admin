# Módulo: Financeiro / Comissões

Status: em construção. Fase 1 construída e publicada em 19/10/2026 (migration 0171, função fin-comissoes-titulos-pagos, telas em /financeiro/comissoes).

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

8. **Hierarquia (19/10/2026):** o Fernando é superior do Heitor e **recebe também pelas vendas do Heitor** (representante 7), com o percentual dele, Fernando. Cadastro: Fernando `recebe_de` = {3, 7}; Heitor `recebe_de` = {7}.
9. **A Filial Contagem fica fora por enquanto (19/10/2026):** títulos com documento iniciado em `400` não entram na proposta. Mesma regra de unidade do Recebíveis (§19 de financeiro-recebiveis.md). Fica como parâmetro, para entrar no futuro.

10. **Venda ou Locação (19/10/2026): pelo tipo da NF emitida. Tipo 12 = Locação.**
    - Na prática, os títulos de venda costumam começar com `A100`/`100`, e os de locação **sempre começam com `4`**.
    - **Implementação:** o tipo da NF (`codTipoDeNota` da NF do título) decide. Sem NF identificável, vale o prefixo do documento (`4…` = Locação, senão Venda). Sempre com troca manual na conferência.

    - **Matriz × Filial (Alan, 19/10/2026):**
      - existem locações também na Matriz, e **todas as que geram comissão na Matriz são do representante Fernando (3)**;
      - **as da Filial Contagem são do representante Lucas (5)**, que não entra no cálculo.
    - **Implementação, com duas travas:**
      1. só entram os representantes cadastrados (3 e 7);
      2. documento iniciado em `400` (Filial, regra 9) fica fora, mesmo que esteja com o representante 3.
    - A segunda trava é necessária porque, em agosto, **4000040U e 4002252U (Filial) estavam com o representante 3** no Consistem. A confirmar com o Alan se o cadastro desses dois está certo.
    - **Locação da Matriz:** NF tipo 12, ou documento iniciado em `4` mas não em `400`. Percentual de locação do Fernando: 3%.

11. **O fechamento começa pela planilha de créditos da CCCCI010 (Alan, 19/10/2026).**
    - **Todo título Z pago tem, obrigatoriamente, um crédito de cliente.** A baixa do Z não gera movimento bancário.
    - **Nem todo crédito tem um título Z:** há adiantamentos de cliente lançados direto no crédito.
    - **Fluxo do fechamento:**
      1. **Subir o relatório da CCCCI010 do mês** (Importador do núcleo).
      2. **Cruzar os títulos Z pagos com os créditos** (cliente + valor + data de pagamento):
         - Z com crédito: um recebimento, uma comissão (regra 6);
         - **Z sem crédito: alerta "Título Z sem crédito de cliente"**, porque o financeiro esqueceu de lançar. É o controle pedido em 19/10, que nasce aqui, no fechamento;
         - **crédito sem Z: adiantamento**, que gera comissão no mês em que entrou (regra 5).
      3. **Títulos com NF pagos no mês:** geram comissão, menos as baixas 7, 8 e 11. A duplicata compensada com o crédito (baixa 7) não gera de novo.
      4. Conferência, antecipações de comissão e fechamento.
    - **A definir com o exemplo do relatório:**
      - as colunas;
      - se o relatório traz o título de origem e o representante;
      - de onde sai o representante de um crédito sem Z (cliente → pedido?).

12. **Um pedido nunca rende comissão sobre mais que o seu valor (Alan, 20/10/2026).**
    - A comparação é por representante, porque cada um recebe cheio (regra 3).
    - **Conta:** base já comissionada do pedido (meses fechados, inclusive o histórico) + base do mês ≤ valor do pedido (`vlrTotalPedido − vlrTotalCancelado`).
    - **Unidade de controle:**
      - o pedido da NF do título;
      - NF sem pedido (ou de mais de um pedido): a própria NF, pelo valor dela;
      - adiantamento: o "Pedido de Venda" da CCCCI010;
      - Z e adiantamento sem pedido ficam sem teto, só com a trava por título.
    - **"Já comissionado"** soma as linhas fechadas com a mesma unidade e as dos títulos que o pedido gerou (NFs do pedido → `/titulo`). Por isso o histórico das planilhas, que só tem o nº do título, também conta.
    - **Na proposta:** a linha que passaria do teto vem **excluída**, com o motivo "Excede o pedido N: já comissionado R$ X de R$ Y", pela ordem de pagamento. O gestor pode incluir de novo, com motivo.
13. **Histórico do que já foi pago (20/10/2026).**
    - **Importação:** as planilhas anuais "Comissões <Nome> - <ano>.xlsx" entram como meses já fechados (`historico = true`), em Representantes > Histórico. Isso fecha o furo do 1001323C: pago em 08/09, lançado em agosto e proposto de novo em setembro.
    - **Leitura da planilha:**
      - o mês vem do nome da aba (o "Mês de Referência" de dentro às vezes fica copiado);
      - a data é a de vencimento, porque a planilha não tem a data do pagamento;
      - documento que não é título (contrato, "112", sem documento) entra como lançamento manual;
      - "ANTECIPAÇÃO…"/"ANTECIPADO" depois do TOTAL DO MÊS entra como antecipação;
      - a soma tem de bater com o TOTAL DO MÊS, senão nada é importado.
    - **Título que a planilha pagou em dois meses:** entra no segundo como manual "Repetido: já pago em MM/AAAA", para o total do mês continuar igual ao que foi pago. Casos achados em 20/10: **Z00022B** (junho e julho) e **1001278C** (julho e agosto), ambos do Fernando.
    - **Mês que já tem fechamento de trabalho no sistema** não recebe histórico.

14. **Reabrir fechamento (Alan, 20/10/2026).**
    - **Quem e o quê:** o gestor reabre **o último mês fechado**, com motivo. Mês de histórico das planilhas não se reabre.
    - **Para quando:** o mês ainda não foi pago nem enviado ao representante. Depois de pago, a correção é um lançamento no mês seguinte.
    - **O que fica registrado:** a reabertura vai para `fin_com_reaberturas` (quem tinha fechado e quando, quem reabriu, o motivo e os saldos por representante que estavam fechados). Esse registro não se apaga.
    - **Depois:** as linhas voltam para conferência e o mês é fechado de novo pelo fluxo normal.
    - Origem: setembro/2026 foi fechado com a antecipação do Heitor lançada como comissão manual.

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
| Importação do relatório da CCCCI010 como 1º passo do fechamento, cruzamento Z × crédito e alerta "Z sem crédito" | Lançamentos que não vêm do Consistem continuam manuais (contrato, ajustes) |
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
1. ~~O Fernando recebe pelas vendas do Heitor?~~ Sim: é superior do Heitor (regra 8).
2. ~~Filial Contagem (400…)?~~ Fora por enquanto (regra 9).
3. **1001341U** (NF 1341, R$ 1.500.000,00, pago em 24/08, representante 3) e **Z00009A** (R$ 12.467,33, pago em 25/08) não estão na planilha de agosto. O primeiro é a compensação de um adiantamento já comissionado (o "112" de julho)? E o segundo?
4. **1001323C** (vencimento 05/09, pago em 08/09) entrou na planilha de **agosto**. Foi exceção (comissão adiantada) ou a regra é outra para esse caso?
5. ~~Venda ou Locação?~~ Pelo tipo da NF: 12 = Locação; locação começa com 4 (regra 10).
6. **A comissão incide sobre o valor do título ou sobre o valor pago?** Em 151 de 153 títulos os dois são iguais.

## 11. Fase 1 entregue (19/10/2026)

**Banco (0171)**
- **Tabelas:** `fin_com_representantes` (Fernando 3: 1,5%/3%, recebe de {3,7}; Heitor 7: 1%/1%, recebe de {7}), `fin_com_fechamentos` (um por mês), `fin_com_creditos` (planilha da CCCCI010) e `fin_com_linhas`.
- **Gravação:** só pelas funções, com nível e situação conferidos: `fin_com_abrir`, `fin_com_importar_creditos`, `fin_com_gravar_proposta`, `fin_com_ajustar_linha`, `fin_com_lancar`, `fin_com_fechar` e `fin_com_salvar_representante`.
- **Fechado é congelado** (gatilho). O índice único `uq_fin_com_linhas_paga` impede pagar de novo o mesmo recebimento ao mesmo representante.
- **Auditoria** em todas as tabelas.

**Edge Function `fin-comissoes-titulos-pagos`** (só leitura)
- `titulosPagos` do mês e `contasReceber/{codTitulo}` de cada título: representante, cliente, tipo de baixa e comissão do Consistem na liquidação.
- Títulos dos clientes de adiantamento (`contasReceber?listaCliente=&tipoTitulo=3`), para sugerir o representante.

**Proposta** (`lib/modulos/financeiro/comissoes/regras.ts`, `montarProposta`)
- cruzamento Z × crédito (cliente + data + valor);
- adiantamento = crédito sem Z, com o representante do título mais recente do cliente;
- hierarquia, Filial fora, baixas 7/8/11 fora, venda/locação;
- o que já foi pago não entra de novo.
- **Refazer a busca mantém as decisões da conferência.**

**Telas**
- `/financeiro/comissoes`: fechamentos e "abrir mês".
- `/financeiro/comissoes/<id>`:
  - 1. créditos;
  - 2. títulos pagos e o alerta "Z sem crédito";
  - 3. uma grade por representante, com incluir/excluir (com motivo), venda/locação e totais (total − antecipado = saldo);
  - lançamentos;
  - 4. fechar (gestor).
- `/financeiro/comissoes/representantes`.
- **Saídas:** impressão `/imprimir/comissoes/<id>` e Excel `/financeiro/comissoes/<id>/planilha`, uma aba por representante no formato da planilha.

**Simulação com os dados reais (sem a planilha da CCCCI010): bate com as planilhas centavo a centavo, explicadas as diferenças**

| | Sistema | Planilha | Diferença |
| --- | --- | --- | --- |
| Heitor ago | 1.540,00 | 1.540,00 | — |
| Heitor set | 2.900,00 | 4.240,00 | Z00027A (1.340,00), que entra pelo crédito da CCCCI010 |
| Fernando ago | 73.508,96 | 52.291,95 | 1001341U (22.500,00) e Z00009A (187,01) não estão na planilha (§10, item 3); 1001323C (1.470,00) entrou em agosto (item 4) |
| Fernando set | 15.520,20 | 43.510,20 | Z00027A (2.010,00) e adiantamento de 1.830.000,00 (27.450,00), ambos pela CCCCI010; 1001323C já pago em agosto |

**Fica para depois**
- pendência "Fechar comissão de <mês>" na Fila do dia;
- pendência por título Z sem crédito (hoje é alerta no fechamento);
- tipo da NF (12) lido da API: hoje vale o prefixo do documento e a troca manual.

## 12. Fase 1.1 entregue (20/10/2026): trava contra pagamento em duplicidade

- **Migration 0172:**
  - `fin_com_fechamentos.historico` e `historico_arquivos`;
  - `fin_com_linhas.cod_pedido`, `teto_chave` (`P:<pedido>` ou `N:<nota>`) e `teto_valor`;
  - `fin_com_creditos.cod_pedido`;
  - **`fin_com_importar_historico`** (gestor): substitui o histórico do representante no mês e marca os "Repetido";
  - o gatilho `fn_fin_com_trava` aceita gravar no histórico **só** dentro dessa função;
  - `fin_com_gravar_proposta` passa a gravar pedido, teto e a decisão proposta (incluída ou excluída, com motivo). A decisão tomada na conferência fica.
- **Edge Function `fin-comissoes-titulos-pagos`:**
  - título → NF: nota + cliente, ou a chave, nas NFs emitidas desde a emissão mais antiga, até 36 meses;
  - NF → pedido;
  - para cada pedido, `pedidoVenda/{cod}` (valor) e `notaFiscalSaidaPedido/{cod}` → `/titulo` (os títulos que ele gerou);
  - **tipo da NF** (`codTipoDeNota`) passa a vir da API, e assim a regra 10 (12 = Locação) vale pelo tipo e não só pelo prefixo;
  - até 80 pedidos ou NFs por busca. O que não for lido fica sem teto, com aviso.
- **Regras:**
  - `aplicarTeto` (`regras.ts`);
  - `lerPlanilhaHistorico` (`historico.ts`);
  - a coluna "Pedido de Venda" na leitura da CCCCI010.
- **Telas:**
  - coluna Pedido nas grades e nos créditos;
  - aviso "linhas barradas pelo teto";
  - meses de histórico marcados "Histórico (planilha)";
  - importação do histórico em Representantes.
- **Teste com as planilhas reais:** todas as abas batem com o TOTAL DO MÊS. Fernando: janeiro a setembro. Heitor: março, julho, agosto e setembro.

## 13. Reabrir fechamento (20/10/2026)
- **Migration 0173:**
  - tabela `fin_com_reaberturas`, com auditoria e sem delete;
  - `fin_com_reabrir(p_id, p_motivo)`, para gestor, só o último mês fechado e não histórico;
  - o gatilho `fn_fin_com_trava` aceita, só dentro dessa função, devolver as linhas para conferência (`fechada` true → false, sem mudar mais nada).
- **Tela:** o quadro "Reabrir o fechamento" aparece no mês fechado para o gestor. Pede o motivo e confirma na própria tela, e a reabertura fica escrita no cabeçalho do mês.
- **Relatório por representante (20/10/2026):** impressão e Excel com `?rep=<código>`. O nome do arquivo leva o representante ("Comissões Heitor Selerges - 09-2026").
