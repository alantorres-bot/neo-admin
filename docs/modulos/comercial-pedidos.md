# Módulo: Comercial / Pedidos

Status: em construção. Fase 0 (especificação e sondagem) concluída em 19/10/2026. Fase 1 (carteira e faturamento) publicada no banco e na Edge Function em 19/10/2026 e no app (Cloud Run, revisão neo-admin-00069-nfj, publicada pelo Alan).

## 1. Objetivo
Acompanhar o pedido de venda do digitado até a entrega e a liquidação, num só lugar:
- carteira e previsão de faturamento;
- expedição (separação, NF, transporte, MDF-e);
- títulos e comissão do representante;
- pós-venda (cancelamentos e devoluções).

Os dados vêm da **API Comercial v1.0 do Consistem**. A v1 **só lê** o ERP.

## 2. Como é feito hoje
- **Quem:** o próprio Alan acompanha os pedidos.
- **Onde:** direto nas telas de consulta do Consistem, sem planilha e sem relatório exportado.
  - Não há uma visão consolidada: para saber o que falta faturar, o que está atrasado e o que saiu, é preciso consultar pedido por pedido.
- **A confirmar:**
  - com que frequência isso é feito e quanto tempo toma;
  - como se sabe que a mercadoria saiu e foi entregue;
  - o que mais incomoda na rotina hoje.
- **Comissão dos representantes:** calculada pelo Alan em **Excel**, fora do Consistem. Nas NFs e nos títulos a comissão vem zerada, mas o extrato de comissões do Consistem tem lançamentos (3ª sondagem, §10).
  - Para o Fernando há a planilha anual "Comissões Fernando - 2026.xlsx", alimentada pelo relatório de títulos pagos.
  - A Fase 3 deve entregar ao Comercial > Comissões os dados que hoje vão para o Excel: representante de cada pedido e NF, parcelas e baixas. Assim o Excel pode ser substituído.

## 3. Escopo
| Entra | Fica fora |
| --- | --- |
| Espelho dos pedidos, itens e NFs por pedido (leitura a cada 30 min, janela por datas) | Incluir, alterar ou cancelar pedido ou NF no Consistem (a API permite; fica para uma fase futura, com aprovação) |
| Carteira, previsão de faturamento e pedidos atrasados | Liberar bloqueio de crédito ou comercial pela API (futuro) |
| Linha do tempo do pedido e painel da expedição | Emissão de NF-e ou MDF-e (continua no Consistem) |
| DANFE e XML da NF em Anexos | Análise fiscal do pedido (pode alimentar o módulo Fiscal depois) |
| Títulos da NF, parcelas e comissão do representante (faturamento e liquidação) | Cálculo próprio de comissão: vale o que o Consistem calcula |
| NFs canceladas, devoluções e pedidos cancelados, com pendência quando há título em aberto | Baixa ou abatimento de título (segue com Recebíveis e com um humano) |

## 4. Entradas (API Comercial v1.0)
O token, o cabeçalho `empresa` e o retry de 429 são os mesmos das outras integrações (`supabase/functions/_shared/consistem-receber.ts`).

**Paginação**
- **Listas completas:** `continuationToken` + `paginacao`.
- **Serviços "Resumido/Resumida":** cabeçalhos `page` (a partir de 0) e `size`, com retorno em array puro (`buscarResumido`, em `_shared/consistem-comercial.ts`).

| Uso | Serviço | Campos principais |
| --- | --- | --- |
| Carteira | `GET pedidoVendaResumido` (filtros: digitação, previsão de faturamento, clientes, representantes, tipoNota, situacao) | `codPedido`, `situacao` (0 Digitado … 9 Cancelado), `nomeCliente`, `nomeRepresentante`, `vlrTotalPedido`, `vlrTotalFaturado`, `vlrSaldo`, `vlrTotalCancelado`, `vlrTotalBloqueado`, `dataPrevFat`, `descCondVenda`, `numeroUltimaNF`, `dataUltimoFat` |
| Detalhe | `GET pedidoVenda/{id}` | itens (`qtdPedida`, `qtdFaturada`, `qtdCancelada`); `codCondVenda`, `vencimentoEsp`, `codPortador`, `codTipoCobranca`, `vlrAntecipado`, `percComissRep`, `libFin`, `flgBloqCredito`, `flgBloqComercial` |
| Bloqueados | `GET pedidosVendaBloqueados` | igual ao pedido |
| NFs do pedido | `GET notaFiscalSaidaPedido/{codPedido}`; `GET notaFiscalSaida` (filtro `pedidos`) | `codNumNota`, `serie`, `chaveAcesso`, `statusNfe`, `situacao` (1 Gerada, 2 Emitida, 3 Cancelada), `codRepresentante`, `dataHoraSaida`, `codTransportadora`, `qtdVolumes`, `valorTotal`, `valorLiquido`, retenções `valorRet*` |
| Títulos da NF | `GET notaFiscalSaida/{id}/titulo` (formato do `{id}` a confirmar na sondagem) | `codTitulo`, `dataVencimento`, `dataPagamento`, `valorTitulo`, `valorJuros`, `valorDesconto`, `*ComissaoRepresentanteFat`, `*ComissaoRepresentanteLiq` |
| Expedição | `GET pedidoVenda/{id}/sugestaoFaturamento`, `GET romaneioTextil`, `GET listaTransporte/{id}`, `GET mdfe` (lista em `listaMDFe`) | situação da sugestão; `qtdSugerida`/`qtdConferida`; `qtdVolumeSaldo`; MDF-e: `chaveMDFe`, `situcao` (sic), `placaVeiculos` |
| Documentos | `GET danfeNotaFiscal?dataEmissao&codNota`, `GET notaFiscalXML` | `arquivo` (base64) |
| Pós-venda | `GET notaFiscalSaida?situacao=3`; `GET devolucaoNota` (lista em `notasDevolucao`) | cancelamento: `dataHoraCancelaNfe`, `obsCancNF1..3`; devolução: `CNPJCPFCliente`, `notasDevolvidas[]{codNotaDev,dataNotaDev}`, `itensDevolucao[].vlrTotalLiquido`, `motivoDevolucao` |
| Crédito (futuro) | `GET somaPedidoAberto?cliente=<CPF/CNPJ>` | `qtdTotalPedidos`, `valorTotal` |

**Limites conhecidos da API**
- Não existe filtro "alterado desde". A sincronização é por janela de datas; para dados em tempo real seria preciso a API de Eventos (CSWMEN170).
- O formato do `{id}` de `notaFiscalSaida/{id}` não está documentado.
- O tipo do filtro `clientes` muda: código inteiro no pedido, texto na NF, CPF/CNPJ em `somaPedidoAberto`, DANFE e devolução.
- O `required` da especificação cita campos que não existem (`dataPrevisaoFaturamento`, `parcelaDuplicataNF`).
- Romaneio têxtil, caixa/tag e sugestão de faturamento são da confecção e da malharia. A sondagem mede se a Neo usa.
- Já sabido em Recebíveis (§13): as NFs do tipo 12 não trazem `codPedido`.

## 5. Regras de negócio (propostas; confirmar após a sondagem)
1. **Situação do pedido** é a do Consistem; o Neo Admin não muda situação.
2. **Pedido atrasado**: `dataPrevFat` menor que hoje (fuso America/Cuiaba) e `vlrSaldo` maior que 0. Vira a pendência "Pedido com previsão vencida".
3. **Pós-venda**: NF cancelada (`situacao=3`) ou devolvida que ainda tem título em aberto no contas a receber vira pendência para o Financeiro. O cruzamento é por número da NF + código do cliente, a mesma regra de `ligarTituloNota`.
4. **Comissão**: vale o valor que o Consistem calcula no título (`*Fat` na emissão, `*Liq` na baixa). O módulo não recalcula.
5. **Documentos**: DANFE e XML vão para os Anexos do núcleo, ligados ao pedido. Nada sai para terceiros sem regra (`modo_rascunho`).

## 6. Saídas e automações
- Sincronização a cada 30 minutos (pg_cron), por janela de datas, como Recebíveis e Contas a pagar (Fase 1).
- Pendências na Fila do dia: pedido com previsão vencida; NF cancelada ou devolvida com título em aberto.
- Relatório de comissão por representante e período (Fase 3).

## 7. Telas (por fase)
- **Fase 1:** Carteira (grade com classificação e filtro), Detalhe do pedido e Previsão de faturamento (semana e mês).
- **Fase 2:** Linha do tempo do pedido e Painel da expedição.
- **Fase 3:** Títulos e comissão por representante.
- **Fase 4:** Pós-venda (canceladas, devoluções, cancelamentos).

## 8. Dados (prefixo `com_`, migrations 0700–0799)
- **Fase 1:** `com_pedidos`, `com_pedido_itens`, `com_notas` (NF por pedido) e `com_sincronizacoes`.
- **Fases seguintes:** `com_nota_titulos` (Fase 3), `com_devolucoes` (Fase 4).
- **Integração com outros módulos:** sem acesso a tabelas internas.
  - Comercial > Comissões e Recebíveis leem views públicas documentadas (ex.: `com_vw_titulos_nota`).
  - O Comercial lê os títulos em aberto direto da API, não de `rec_titulos`.

## 9. Permissões
- Área **Comercial** (migration 0091): o acesso é dado em Configurações > Usuários.
- **Consulta:** vê.
- **Operador:** anexa e trata pendências.
- **Gestor:** sincroniza e roda a sondagem.

## 10. Fase 0: sondagem (só leitura)
**Como rodar**
- Função: Edge Function `com-pedidos-sincronizar`.
- Corpo: `{ "acao": "amostra", "dias": 90, "lista_transporte": "<opcional>" }`.
- Quem pode: gestor do Comercial ou admin geral.
- Não grava nada. Devolve só contagens, formatos e nomes de campos.

**O que ela mede**
- Pedidos por situação, com saldo, atrasados e com `numeroUltimaNF`; representante; bloqueios.
- NFs: tipos, pedido no cabeçalho ou só nos itens, representante e comissão, retenções, transporte.
- `/titulo`: qual formato de `{id}` funciona, parcelas por NF, comissão Fat/Liq.
- NFs por pedido.
- Canceladas e devoluções, e quantas têm título em aberto.
- Se a Neo usa sugestão de faturamento, romaneio, lista de transporte e MDF-e.
- Tamanho do DANFE e do XML.

A lógica pura fica em `supabase/functions/_shared/consistem-comercial.ts`, com testes em `lib/integracoes/consistem/consistem-comercial.test.ts`.

### Resultado da 1ª sondagem (19/10/2026, NEO FORMAS, janela de 21/07 a 19/10/2026)

**Pedidos (`pedidoVendaResumido`): 56 na janela**
- Por situação: 41 faturado total, 11 digitado, 3 faturado parcial, 1 listado.
- 15 têm saldo a faturar. Desses, **13 estão com a previsão de faturamento vencida**: a pendência "Pedido com previsão vencida" faz sentido.
- Todos trazem nome do cliente e representante (3 representantes no total).
- `numeroUltimaNF` vem **sempre vazio**: o caminho inverso pedido → NF não funciona por esse campo.
- Condição de venda vazia em 32 dos 56 pedidos.
- Pedido completo (amostra de 10):
  - todos com `libFin` liberado, nenhum bloqueado (`pedidosVendaBloqueados` vazio);
  - 2 com valor antecipado;
  - só 1 com % de comissão.
- **Conclusão:** o bloqueio de crédito no Consistem não é usado hoje, e a tela de bloqueados fica fora da Fase 1.

**NFs emitidas: 190**
- Por tipo: 107 do tipo 12, depois 17, 4, 2, 3 e 300.
- 83 têm chave de NF-e e 62 têm pedido no cabeçalho. Nenhuma tem pedido só nos itens.
- Todas trazem `codRepresentante` e `dataHoraSaida`. Nenhuma tem transportadora; 83 têm volumes.
- Comissão do representante só em 5 NFs. Nenhuma retenção.

**Títulos da NF (`/titulo`)**
- **O `{id}` é a chave de acesso (44 dígitos).** NF sem chave responde "Nota Fiscal de Saída não encontrada" em qualquer formato.
- Só as NFs com chave (83 de 190) têm títulos por esse caminho.
- O título traz `codTitulo` no formato `9999999A`, o mesmo do contas a receber, com vencimento.
- Na amostra, comissão Fat/Liq zerada.

**Pós-venda**
- 19 NFs canceladas, todas com motivo e data e hora do cancelamento. **Nenhuma tem título em aberto.**
- Nenhuma devolução na janela (`devolucaoNota` vazio).

**Expedição**
- **Não são usados:** sugestão de faturamento e romaneio, sem dados.
- **É usado:** MDF-e, com 12 na janela (10 encerrados, 1 com pendência, 1 cancelado).
- Lista de transporte não conferida (falta o código de uma lista).

**Documentos**
- O **DANFE** sai pela API: cerca de 192 KB por `dataEmissao` + `codNota`.
- O XML deu "Índice do arquivo não encontrado" na NF testada, que não tinha chave.

### Resultado da 2ª sondagem (19/10/2026, mesma janela)

Mudanças em relação à 1ª:
- `/titulo` só nas NFs com chave (até 10);
- NFs por pedido nos pedidos faturados (situação 5 ou 6);
- DANFE e XML de uma NF com chave.

**`/titulo` pela chave de acesso: confirmado**
- Das 10 NFs testadas, 4 têm títulos:
  - 3 com 1 parcela, 1 com **6 parcelas**;
  - 9 títulos ao todo, todos com vencimento, 3 já pagos (`dataPagamento`).
- As outras 6 NFs foram encontradas, mas a resposta foi "Títulos não encontrados para a nota fiscal N": são notas que não geram duplicata (ex.: remessa).
- Comissão Fat/Liq e % zerados em todos os títulos.

**NFs por pedido (`notaFiscalSaidaPedido/{codPedido}`): funciona**
- 10 pedidos faturados deram 11 NFs (9 com 1 NF, 1 com 2), todas com chave.
- **É assim que o pedido se liga à NF**, e não por `numeroUltimaNF`.

**Documentos**
- DANFE: cerca de 388 KB.
- **XML: cerca de 10 KB**, também pela API (`dataEmissao` + `codNota`) na NF eletrônica.

### Resultado da 3ª sondagem (19/10/2026, mesma janela): comissão

**Títulos pagos (`financeiro/v10/titulosPagos`, `dataInicio`/`dataFim`): 153**
- Campos: `codTitulo`, `cliente`, `vlrTitulo`, `vlrPago`, `dataVencimento`, `dataPagamento`, `portador`, `tipoCobranca`, `notaFiscal`.
- Por prefixo do código: 144 numéricos, 6 "Z…" (sem NF), 3 "A…" (com NF vinculada). Nenhum "AZ…" na janela.
- 147 têm NF.
- **Valor pago = valor do título em 151 de 153** (1 maior, 1 menor). A dúvida entre base no título e base no pago quase não muda o resultado.
- 36 títulos foram pagos antes do vencimento. Isso confirma que o mês da comissão é o do **pagamento**, e não o do vencimento.

**Adiantamento no pedido (`pedidoVenda` completo, `vlrAntecipado`)**
- 2 dos 56 pedidos, ambos ainda não faturados (digitado/listado).
- Nos dois, o adiantamento é igual ao valor do pedido: pagamento antecipado integral.
- Isso marca o pedido, mas **não** informa a data em que o dinheiro entrou. Essa data está nos "créditos cadastrados", que não têm API.

**Extrato de comissões (`comissaosobrevendas/v10/extratoComissoes`, `dataComissoesInicial`/`Final`): TEM DADOS**
- 4 representantes e 25 lançamentos: 18 créditos e 7 débitos.
- Descrições: "COMISSAO REF. LIQUIDACOES DO DIA" (10), "COMISSAO REF. FATURAMENTO DO DIA" (2), 13 sem descrição.
- 12 lançamentos citam títulos: 17 títulos, todos com `valorComissao`.
- Ou seja, o Consistem lança comissão em conta corrente para pelo menos parte dos representantes, tanto na liquidação quanto no faturamento.
- Falta saber quais são os 4 representantes e se os valores batem com as planilhas.

### Comparação do extrato de comissões do Consistem com as planilhas (setembro/2026, feita em 19/10/2026)

**O que o Consistem lançou no extrato de comissões em setembro**
- **Representante 3:** 3 créditos "COMISSAO REF. LIQUIDACOES DO DIA", um por título pago, a 1,5% do valor do título.
- **Representante 7:** 1 crédito "COMISSAO REF. FATURAMENTO DO DIA" em 03/09, de 1% sobre **as 6 parcelas** da NF 1350, todas de uma vez no faturamento.
- **Representantes 4 e 6:** sem movimento.

**Planilha do Fernando, 7 linhas**
- 3 batem exatamente com o representante 3 (mesmo título, valor e data de pagamento): 1001249E, 1001333B e A1001273D.
- Não estão no extrato:
  - 1001295C (pago em 03/09);
  - 1001350A (pago em 04/09; no Consistem só aparece no representante 7, a 1%, no faturamento);
  - Z00027A (não consta como pago em setembro em `titulosPagos`);
  - 1 linha sem documento (possível adiantamento da CCCCI010, a confirmar).

**Planilha do Heitor, 3 linhas**
- 1001350A bate em valor (1%) com o representante 7. Mas o Consistem creditou as 6 parcelas no faturamento, enquanto a planilha paga só a parcela paga no mês.
- 1001295C e Z00027A não estão no extrato.

**Tipos de baixa dos 53 títulos pagos em setembro**
- Contagem: 3 (40 títulos), 10 (7), 1 (5) e **7 – Antecipação (1 título)**.
- O significado dos tipos 1, 3 e 10: a confirmar.

**Conclusão**
- O extrato do Consistem cobre só parte da comissão: os títulos com NF em que o representante do pedido está configurado.
- Há representante configurado para comissão no **faturamento**, quando a regra da Neo é **parcela paga no mês**.
- Também ficam fora os títulos com dois representantes, os "Z…" e os adiantamentos.
- **A Fase 3 calcula a comissão com as regras da Neo (§10-A)** e usa o extrato do Consistem só como conferência.
- **Confirmado pelo Alan (19/10/2026):**
  - **representante 3 = Fernando Grassmann; 7 = Heitor Selerges.** Por enquanto, só esses dois recebem comissão calculada (os demais, como 4 e 6, ficam fora);
  - a linha sem documento da planilha do Fernando é um **adiantamento** (CCCCI010).

**Tipos de baixa do contas a receber** (consulta do Consistem enviada pelo Alan, campo `tipoBaixa`):

| Cód. | Descrição | Em setembro/2026 | Gera comissão? |
| --- | --- | --- | --- |
| 1 | Normal | 5 | sim (1001350A) |
| 2 | Parcial | 0 | sim |
| 3 | Desconto | 40 | sim (1001249E, 1001295C, 1001333B, A1001273D) |
| 4 | Dinheiro | 0 | sim |
| 5 | Cheques | 0 | sim |
| 6 | Cartório | 0 | sim |
| 7 | Antecipação | 1 | **não**: a comissão saiu no adiantamento (CCCCI010) |
| 8 | Devolução de cliente | 0 | **não** |
| 9 | Depósito | 0 | sim |
| 10 | Dev. de compras | 7 | sim |
| 11 | Perdas | 0 | **não** |

- **Regra (confirmada pelo Alan em 19/10/2026): não geram comissão as baixas 7 (Antecipação), 8 (Devolução de cliente) e 11 (Perdas). Todas as demais geram.**
- **Caso Z00027A (explicado pelo Alan em 19/10/2026): título "Z" (sem NF) cedido à AKF.**
  1. O título foi baixado com o tipo 3 (Desconto), pela cessão à AKF.
  2. Depois a baixa foi **estornada**, porque saiu a NF definitiva e era preciso vincular o crédito à NF.
  3. Com o estorno, o título some de `titulosPagos`. A planilha, porém, já tinha pago a comissão em setembro.
  - **Implicação para a regra:** comissão paga sobre um "Z" depois estornado não pode ser paga de novo na NF definitiva. Também não pode se perder, caso a NF definitiva seja baixada com o tipo 7 (Antecipação) usando esse crédito.
  - **Proposta:** o Neo Admin guarda a comissão já paga por título e por pedido, e uma comissão já paga nunca é recalculada. Estorno posterior vira pendência para conferência humana, e não um desconto automático.
  - **Confirmado pelo Alan (19/10/2026):**
    - o crédito do estorno entra na **CCCCI010 como adiantamento, com a data em que foi pago** (a data original do pagamento);
    - depois esse crédito é **compensado com a duplicata da NF**, que é a baixa tipo 7 (Antecipação).
  - **Regra resultante: um recebimento, uma comissão.** O mesmo dinheiro aparece até três vezes:
    1. a baixa do Z, tipo 3;
    2. o crédito na CCCCI010, com a mesma data e o mesmo valor;
    3. a compensação na duplicata da NF, tipo 7.

    A comissão sai uma única vez, na data do pagamento. A baixa tipo 7 não gera comissão (regra já confirmada). O crédito da CCCCI010 que corresponde a um Z já comissionado não gera de novo: ele é reconhecido pelo mesmo cliente, valor e data de pagamento.
  - **A confirmar:** se o relatório da CCCCI010 informa o título de origem do crédito (por exemplo, o Z estornado). Se informar, a ligação é direta; se não, ela é feita por cliente + valor + data, com conferência humana quando houver dúvida.

### Conclusões para a Fase 1
1. **Carteira:** `pedidoVendaResumido`, com nomes já incluídos. Sincronização por janela de digitação, mais todos os pedidos com saldo.
2. **Pedido → NF:** `notaFiscalSaidaPedido/{codPedido}` nos pedidos faturados, de forma parcial ou total.
   - Isso não resolve as NFs tipo 12 sem pedido. Elas são da Filial e são implantadas sem pedido.
3. **NF → títulos:** `notaFiscalSaida/{chaveAcesso}/titulo`.
   - Traz as parcelas reais (até 6 vistas) e se cada uma foi paga.
   - Só funciona para NF com chave.
   - "Títulos não encontrados" significa que a NF não gera duplicata. Não é erro.
4. **Comissão:** nas NFs e nos títulos o percentual e os valores vêm zerados. Mas o **extrato de comissões** do Consistem tem lançamentos (ver a 3ª sondagem): falta comparar com a planilha antes de decidir entre usar o Consistem e manter o cálculo próprio.
5. **Expedição:** a linha do tempo fica pedido → NF (`dataHoraSaida`) → MDF-e. Sugestão de faturamento e romaneio não são usados. Transportadora não é preenchida.
6. **Documentos:** DANFE e XML automáticos nos Anexos.
7. **Pós-venda e bloqueios:** quase sem casos na janela (19 canceladas sem título em aberto, 0 devoluções, 0 bloqueios). Ficam para depois, como alertas simples.

## 10-A. Comissão hoje: o que as planilhas mostram (lidas em 19/10/2026)

**Fonte**
- Arquivos: `G:\Drives compartilhados\Neo Formas Publico\ADMINISTRATIVO\02 - COMERCIAL\03 - COMISSÕES\Comissões <Representante> - 2026.xlsx` (Fernando Grassmann e Heitor Selerges).
- Uma aba por mês de referência.

**Estrutura**
- Colunas: Nº docto, Parcela/REF, Sacado, Dt. emissão, Dt. vencimento, Vl. total, Tipo (Venda/Locação) e Comissão.
- Fechamento:
  - TOTAL DO MÊS;
  - menos ANTECIPADO ("Antecipação comissão – dd/mm/aaaa"), que pode aparecer mais de uma vez no mês;
  - igual a SALDO A PAGAR.

**Fórmula**
- **Comissão = Vl. total do título × percentual do tipo.**
- Os percentuais ficam no cabeçalho de cada aba, por representante:

  | Representante | Venda | Locação |
  | --- | --- | --- |
  | Fernando | 1,5% | 3% |
  | Heitor | 1% | 1% |

- Exemplo: título de venda de R$ 154.000,00 → Fernando R$ 2.310,00; Heitor R$ 1.540,00.

**Regras confirmadas pelo Alan (19/10/2026)**
1. **Mês de referência = parcela PAGA no mês** (relatório de baixas). A data de vencimento não decide.
2. **Base = valor do título** (Vl. total) × percentual do tipo do representante.
3. **Dois representantes no mesmo título: os dois recebem cheio.** Cada um aplica o seu percentual sobre o valor total (ex.: Fernando 1,5% + Heitor 1%).
   - O Consistem guarda **um** `codRepresentante` por pedido e NF. Os representantes de cada venda precisam ser cadastrados no Neo Admin.
4. **Prefixo do documento:**
   - **"AZ…" = antecipação;**
   - **"A100…" = título com nota fiscal vinculada.**
   - Exemplo de título que aparece duas vezes no mês, cada vez com metade do valor: 1001291B + A1001291B.
5. **A coluna "Parcela/REF" (137, 168, 110…) NÃO é o número do pedido.** O que ela significa: a confirmar.

**Ainda a confirmar**
- O que é a REF.
- As linhas que não são títulos do Consistem:
  - contratos "195/25-1" com REF "ANT-FS"/"ANT";
  - o "LOC" de locação;
  - a linha sem documento.
- Se juros e desconto ficam fora da base, como a fórmula sugere.
- Como se decide se um título é Venda ou Locação (tipo de nota, contrato?).

**Adiantamento de cliente ("créditos cadastrados")**

Alguns clientes pagam adiantado. O valor entra no Consistem como **crédito cadastrado do cliente**, não como título do contas a receber, e por isso não aparece na API de títulos.

O que a documentação da API mostra (consultada em 19/10/2026):
- **Não existe serviço de leitura de créditos ou adiantamentos de cliente** no catálogo: nem Financeiro v1.0, nem Comercial.
- O mais próximo são os "créditos a identificar" (Administração Financeira). Mas só há a lista de finalidades (`GET tipoFinalidadeCreditoIdentificar`) e a inclusão de lançamento bancário (`PUT lancamentoDocumentoBancario`). Não há leitura.
- **Sinais aproveitáveis:**
  - o pedido traz `vlrAntecipado` (2 dos 10 pedidos da amostra);
  - `GET financeiro/v10/titulosPagos` traz `vlrPago` e `dataPagamento` por período, que é a base de "parcela paga no mês";
  - existe `GET comissaosobrevendas/v10/extratoComissoes`, o extrato de comissões por representante, com lançamentos de crédito e débito e os títulos de referência. Ainda não foi sondado.
- **Caminhos possíveis para os adiantamentos:**
  1. importar o relatório da tela de créditos do Consistem (núcleo: Importador);
  2. lançar à mão no Neo Admin;
  3. pedir à Consistem um serviço de API para os créditos.
- **Confirmado pelo Alan (19/10/2026):**
  - o crédito é cadastrado na rotina **CCCCI010** do Consistem;
  - **o adiantamento gera comissão** (no mês em que é recebido, pela regra "pago no mês").
  - a CCCCI010 **exporta relatório**: os adiantamentos entram pelo Importador do núcleo;
  - **o abatimento é a baixa do título no contas a receber com tipo de baixa 7 – Antecipação**, que consome os créditos cadastrados.
- **Regra resultante (a validar com dados):**
  - o adiantamento gera comissão quando é recebido (CCCCI010);
  - o título baixado depois com `tipoBaixa` = 7 **não** gera comissão de novo;
  - o campo `tipoBaixa` existe em `financeiro/v10/contasReceber`; `titulosPagos` não o traz.

**Controle: todo título "Z" pago precisa de um crédito de cliente (CCCCI010) — pedido do Alan, 19/10/2026**
- O título "Z" (sem NF) não gera movimento bancário quando é baixado. Por regra, cada "Z" pago tem de ter um **crédito de cliente** lançado na CCCCI010, que depois é compensado com a duplicata da NF (baixa tipo 7).
- **Problema hoje:** o financeiro às vezes esquece de lançar o crédito. O "Z" fica baixado sem lastro, e a duplicata da NF não tem crédito com que ser compensada.
- **Proposta de controle (conferência diária):**
  1. "Z" baixado (`titulosPagos`) sem crédito correspondente na CCCCI010 (mesmo cliente, valor e data de pagamento) gera a pendência **"Título Z sem crédito de cliente"** na Fila do dia do Financeiro.
  2. Crédito da CCCCI010 sem duplicata compensada (tipo 7) depois de N dias da emissão da NF gera a pendência "Crédito de cliente não compensado". O prazo N fica a definir.
- **Onde fica:** é um controle do Financeiro. A importação da CCCCI010 e as pendências ficam no **Financeiro > Recebíveis**, que expõe os créditos numa view pública. O Comercial lê essa view para a comissão dos adiantamentos (regra do núcleo: um módulo não lê tabela interna de outro).
- **Depende de:** um exemplo do relatório exportado da CCCCI010 (colunas, se traz o título de origem).

**Implicação para a Fase 3**
- Cadastro de representantes, com percentual por tipo (venda/locação), e da divisão por pedido, que pode ter mais de um representante.
- Base: as parcelas pagas no mês (`/titulo` traz `dataPagamento`; as baixas vêm do contas a receber).
- Lançamentos manuais (antecipações de contrato, locação) e antecipações de comissão a descontar.
- Saídas: o fechamento mensal por representante, no lugar da planilha.

## 10-B. Fase 1 entregue: carteira e faturamento (19/10/2026)

**Banco**
- **Migrations:** 0091 (área), 0700 (módulo ativo) e 0701.
- **Tabelas:** `com_pedidos`, `com_pedido_itens`, `com_notas`, `com_nota_parcelas` e `com_sincronizacoes`.
- **Regras das tabelas:**
  - são espelho: só a Edge Function grava, com a service role;
  - leitura com `tem_acesso_modulo('comercial.pedidos')`;
  - sem gatilho de auditoria, porque a prova continua no Consistem.

**Sincronização**
- **Função:** `com-pedidos-sincronizar`, ação `sincronizar` (`simular` só lê a lista).
- **Agendamento:** pg_cron a cada 30 min nos dias úteis, nos minutos :05 e :35 (`com_chamar_sincronizacao()`), com o mesmo segredo do Vault das outras sincronizações.
- **Cada rodada:**
  1. Lê o `pedidoVendaResumido` dos últimos 2 anos de digitação. Os pedidos abertos mais antigos que já estão gravados são relidos um a um (`pedidoVenda/{id}`, até 40 por rodada).
  2. Grava a carteira e liga o cliente à contraparte do núcleo pelo código do Consistem.
  3. Para os pedidos novos ou que mudaram (assinatura = situação + valores + previsão; até 60 por rodada, os com saldo primeiro), lê os itens (`pedidoVenda/{id}`). Se o pedido já faturou, lê também as NFs (`notaFiscalSaidaPedido/{codPedido}`).
  4. Lê as parcelas das NFs com chave que nunca foram lidas ou que ainda têm parcela em aberto (`notaFiscalSaida/{chave}/titulo`, até 60 por rodada). A resposta "Títulos não encontrados" marca a NF como sem duplicata.
  5. Abre, atualiza e conclui a pendência **"Pedido com previsão vencida"** (saldo > 0, não cancelado nem faturado total, previsão < hoje). Link: `/comercial/pedidos/<id>`.
- **Proteções:**
  - API sem nenhum pedido, com pedidos já gravados: nada é alterado.
  - Falha da rodada: abre a pendência "Falha na sincronização dos pedidos", que é cancelada na próxima rodada que der certo.
  - Uma falha num único pedido ou numa única NF não derruba a rodada e é tentada de novo depois.
- **Documentos:** ação `documento`. O DANFE ou o XML da NF é baixado na hora, em base64, e não é guardado.

**Telas** (`/comercial/pedidos`)
- **Previsão de faturamento:** atrasados, esta semana e as próximas 5, depois por mês e por fim os sem previsão.
- **Carteira:** em aberto, ou todos com "ver todos". Grade com classificação e filtro, selo de atraso e o botão do gestor "Simular / Atualizar do Consistem".
- **Detalhe do pedido** (`/comercial/pedidos/<id>`): cabeçalho, itens, NFs com DANFE e XML, e parcelas (paga, vencida, a vencer).

**Testes**
- `lib/integracoes/consistem/consistem-comercial-sincronizacao.test.ts` (normalização, o que reler, pendência).
- `lib/modulos/comercial/pedidos/carteira.test.ts` (atraso, previsão, parcelas).
- `tests/db/com-pedidos-base.test.ts` (RLS, cascata, unicidade).

**Publicação (19/10/2026, à noite)**
- Migrations 0091, 0700 e 0701 aplicadas em produção e registradas em `schema_migrations`.
- Agendamento `com-pedidos-sincronizar-30min` criado; função publicada.
- App publicado pelo Alan no Cloud Run (revisão neo-admin-00069-nfj).
- **Carga inicial:** 5 rodadas disparadas à mão, sem nenhum erro.
- **Resultado:** 210 pedidos (2 anos), 303 itens, 248 NFs e 211 parcelas (49 em aberto). A última rodada não teve nada a reler.
- **Pendências "Pedido com previsão vencida": 35 abertas.**
  - 20 são pedidos com mais de 180 dias de atraso: 13 nunca faturados (digitado ou listado), 7 faturados parcialmente com saldo residual.
  - 15 têm até 90 dias de atraso.
  - **A decidir com o Alan:** ignorar atrasos acima de um limite (ex.: 180 dias), ou usar a lista para cancelar ou encerrar no Consistem os pedidos esquecidos.

## 10-C. Fase 2: expedição (construída em 19/10/2026, com a autorização do Alan para continuar)

O que a API permite, conforme as sondagens:
- **NF:** tem `dataHoraSaida` (todas as 190 NFs da janela) e volumes (83). Não tem transportadora: o campo vem vazio.
- **MDF-e (`GET mdfe`):** traz número, chave, protocolo, UF final, placa, situação e data, mas **não lista as NFs do manifesto**.
  - Não há serviço de detalhe; só a lista de cidades e o encerramento.
  - Por isso a API não permite ligar MDF-e → NF → pedido.
- **Lista de transporte:** traz as NFs com volumes conferidos e pendentes, mas só é consultada pelo código da lista. Não há listagem.

Proposta:
1. **Expedição por pedido:** no detalhe do pedido, a data e hora de saída e os volumes de cada NF. Na carteira, o selo "Faturado e saiu" ou "Faturado, sem saída".
2. **Painel de MDF-e** (`/comercial/pedidos/mdfe` ou um quadro na carteira):
   - os manifestos por situação;
   - a pendência **"MDF-e autorizado não encerrado"** para manifesto autorizado (2) ou com pendência (1) há mais de N dias. O MDF-e precisa ser encerrado ao fim da viagem; o prazo N fica a definir com o Alan, sem inventar o prazo legal.
3. **Encerrar o MDF-e pela API** (`POST mdfe/encerrar`) fica para uma fase de escrita, com aprovação.
- **A confirmar com o Alan:**
  - o que marca a "entrega";
  - se a lista de transporte é usada e como se obtém o código dela;
  - o prazo N do MDF-e.

**O que a Fase 2 entregou (19/10/2026)**
- **Migration 0702:** tabela `com_mdfes` (espelho, leitura com `tem_acesso_modulo`) e o parâmetro `comercial.pedidos.mdfe_dias_alerta`.
  - O parâmetro nasce **nulo, ou seja, alerta desligado**. Para ligar: `update configuracoes set valor = '<dias>' where chave = 'comercial.pedidos.mdfe_dias_alerta'`.
- **Sincronização, etapa 6:**
  - lê `GET mdfe` dos últimos 180 dias (`situacao=99`, lista em `listaMDFe`) e grava em `com_mdfes`;
  - com o prazo configurado, abre a pendência **"MDF-e não encerrado"** (criticidade alta) para cada manifesto autorizado, com pendência ou em contingência há N dias ou mais, e a conclui quando ele é encerrado ou cancelado;
  - uma falha no MDF-e não derruba a rodada (fica em `erroMdfe` no resumo).
- **Telas:**
  - **`/comercial/pedidos/mdfe`**: em aberto (com os dias desde a emissão) e todos;
  - **no detalhe do pedido**, a coluna de volumes na NF, ao lado da data e hora de saída;
  - **na carteira**, o link "MDF-e emitidos".
- **Testes:** normalização (`situcao`), prazo, plano das pendências e RLS da `com_mdfes`.
- **Fora da Fase 2:**
  - ligar MDF-e ao pedido (a API não permite);
  - lista de transporte (precisa do código da lista);
  - encerrar o MDF-e pela API (escrita).

## 11. Pontos em aberto
1. Seção 2 (como é feito hoje): o Alan completa.
2. ~~Formato do `{id}` de `notaFiscalSaida/{id}/titulo`~~: é a chave de acesso (sondagem de 19/10).
3. Expedição: a sondagem mostrou que a Neo usa NF + MDF-e, e não usa sugestão de faturamento nem romaneio. Falta saber o que marca a "entrega" e se a lista de transporte é usada.
4. O token do CSMEN050 precisa ter liberados os serviços da Comercial (pedido, NF de saída, devolução, MDF-e, lista de transporte).
5. ~~Pedido das NFs tipo 12 por `numeroUltimaNF`~~: o campo vem sempre vazio. A ligação é por `notaFiscalSaidaPedido/{codPedido}`.
6. Comissão: comparar o extrato de comissões do Consistem (4 representantes, liquidações e faturamento do dia) com as planilhas do Fernando e do Heitor. Se bater, a Fase 3 usa o Consistem; senão, cálculo próprio.
