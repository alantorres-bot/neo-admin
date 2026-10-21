# Módulo: RH/SST / Folha de pagamento (fechamento mensal)

Status: em construção. Especificação aprovada em 14/10/2026; **F1 (cadastro único), F2 (mês e pagamento) e F6 (importação da Relação dos Líquidos) entregues em 14/10/2026**.

## 1. Objetivo
Fechar todo mês a folha de Cuiabá no Neo Admin, a partir do que o escritório de contabilidade calcula. São seis frentes:
1. Montar a lista do que cada pessoa recebe: líquido, férias e acréscimos, 13º e avulsos.
2. Conferir automaticamente o extrato do escritório com o pagamento e com as guias (DARF, FGTS, consignado).
3. Passar pela aprovação do gestor.
4. Gerar o arquivo do BB e a lista de PIX.
5. Lançar os títulos no Consistem: um por funcionário e um por guia.
6. Guardar os documentos do mês, com um checklist e prazos na Fila do dia.

Substitui a planilha `FOLHA PGTO CBA - <MÊS>-<ANO>.xlsx` e o controle feito à mão nas pastas do Drive. O **cálculo** da folha
continua com o escritório.

## 2. Como é feito hoje
Pasta do mês: `ADMINISTRATIVO\01 - RH\01 - FOLHA DE PAGAMENTO\<ano>\<MM - MÊS>\`. A amostra analisada é a de setembro/2026,
"BASE FOLHA PARA NEO ADMIN".

| Arquivo | O que é |
| --- | --- |
| `FOLHA PGTO CBA - SETEMBRO-2026.xlsx`, aba "ESCRITÓRIO (2)" | Planilha do RH. Por pessoa: EMPRESA (Neo Serviços, Oeste), NATUREZA (salário, 13º), MAT. (= Nº de fornecedor no Consistem), FUNCIONÁRIO, SAL. LÍQUIDO, FÉRIAS/ACRÉSCIMOS, 13º SALÁRIO, A RECEBER (= líquido + férias/acréscimos), PAGAMENTO (FOPAG, PIX - NEO FORMAS, PIX - NEO SERVIÇOS) e, ao lado, "IMPORTAÇÃO BB" (CPF, AG, CONTA, SALÁRIO). As abas Planilha1/Planilha3 são a exportação para o BB. |
| `IMPORTAÇÃO BANCO BB/EXPORTAÇÃO BB.xlsx` | Cópia da planilha usada para gerar o arquivo do BB. |
| `EXTRATO MENSAL.pdf` (Neo Serviços e Oeste) | Do escritório. Por pessoa: código do escritório, CPF, situação (trabalhando, transferido, afastado…), eventos com referência e valor, proventos, descontos, **líquido**, bases de INSS, FGTS e IRRF. Na última página: proventos, descontos e líquido gerais; INSS (segurados, empresa, RAT, terceiros, total); FGTS; IRRF (cálculo e pagamento); contagem de situações. **PDF só imagem (sem texto).** |
| `<EMPRESA> - Relatório de Líquidos.xls` (do escritório, um por empresa e por cálculo) | **Relação Geral dos Líquidos**: empresa, CNPJ, cálculo (Folha Mensal, 13º…), competência e, por pessoa, **código do escritório**, nome (até 30 letras), identidade e **líquido**; no fim, "Empregados: N" e "Total da Empresa". Recebido em 14/10/2026 (setembro/2026, Neo Serviços e Oeste). O arquivo é Excel 97 com o envelope fora do padrão: o Excel abre, mas as bibliotecas comuns recusam (ver regra 12). |
| `HOLERITES/HOLERITES.pdf`, `13º SALARIO/1ª PARCELA 13º SALARIO.pdf`, `EXTRATO MENSAL 13º.pdf` | Recibos por pessoa (folha mensal e adiantamento do 13º). |
| `INSSIR*.pdf` (uma por empresa) | DARF (DCTFWeb) com INSS segurados, patronal, GILRAT, terceiros e IRRF. Vencimento no dia 20. |
| `FGTS*.pdf` (por empresa) | GFD do FGTS Digital: **mensal** e **consignado** (Crédito do Trabalhador). Vencimento no dia 20. |
| `DETALHE DA GUIA*.pdf` (tem texto) | FGTS por trabalhador: base, valor, vencimento. |
| `RELAÇÃO DE AVISO DE CALCULO - CONSIGNADO.pdf`, `comunicado - credito trabalhador.pdf` | Avisos do escritório: consignado descontado só em parte (o funcionário paga o resto direto ao banco), férias vencendo. |
| `CARTÃO E PONTO/*` | Ponto (Control iD): inconsistências por quinzena (26 a 11 e 12 a 25), por setor, e o cartão de ponto. |
| `AVULSO/*.xls` | Recibos de pagamento fora da folha do escritório: admitido no meio do mês ainda não registrado, complementos. |

Empresas na folha: **Neo Formas Serviços de Manutenção de Metais** (escritório 23, CNPJ 45.513.941/0001-67), **Oeste Formas para
Concreto** (escritório 21, CNPJ 03.070.443/0001-47) e **Neo Formas para Concreto** (guias próprias; também é a emissora dos recibos
avulsos).

O que a amostra de setembro mostrou (é por isso que existem as conferências da regra 6):
- **DARF Neo Serviços:** a guia é R$ 109.535,17; no extrato, Total INSS R$ 99.224,99 + IRRF do pagamento R$ 10.310,19 =
  R$ 109.535,18. Diferença de **R$ 0,01**.
- **FGTS mensal Neo Serviços:** a guia é R$ 20.489,82; o extrato diz "Valor do FGTS" R$ 20.545,04. Diferença de **R$ 55,22**
  ainda sem explicação.
- **Líquido Neo Serviços:** na planilha do RH soma R$ 199.618,51; no extrato, "Líquido Geral" R$ 197.895,75. Diferença de
  **R$ 1.722,76**, a explicar pessoa a pessoa.
- **Códigos:** o extrato e a Relação dos Líquidos usam o **código do escritório**; a planilha usa o **Nº de fornecedor do
  Consistem**; a guia do FGTS usa a **matrícula do eSocial**. A matrícula do eSocial **não é o código do escritório**: em
  setembro/2026, 19 de 60 pessoas da Neo Serviços tinham números diferentes, quase sempre +1. O casamento do relatório é feito
  pelo **código do escritório**, guardado no cadastro (`matricula_escritorio`).
- **Relação dos Líquidos de setembro/2026 contra a planilha do RH:**
  - Neo Serviços: **59 de 60 iguais**. A diferença é o Nº 1072, com R$ 2.004,26 na planilha e **R$ 1.954,26** no escritório
    (R$ 50,00).
  - Oeste: 3 de 3 iguais.
  - A soma de cada relatório bate com o "Total da Empresa" (Neo Serviços R$ 197.895,75 = Líquido Geral do extrato; Oeste
    R$ 12.292,78).
  - A diferença de R$ 1.722,76 do item anterior se explica: são R$ 1.672,76 do 13º adiantado de uma pessoa, que entrou na
    planilha como linha "13º SALÁRIO" e vem em outro cálculo do escritório, mais esses R$ 50,00.
- **13º 1ª parcela nas planilhas de jan–set/2026:**
  - Vem como linha própria, NATUREZA "13º SALÁRIO", com o valor na coluna SAL. LÍQUIDO e a forma de pagamento da pessoa.
  - Quantos por mês: jan 5, fev 9, mar 18, set 1.
  - Em 09/2026 foi só o Nº 687, aniversário em 22/09: R$ 1.672,76 = 13º adiantado 1.570,89 (metade do salário) + médias
    68,01 e 33,86. Não teve INSS nem IRRF; FGTS de 133,82.
  - O BB de setembro levou só o salário desse Nº; com a regra 4, o 13º passa a ir somado no mesmo crédito.
- **SUBTOTAIS:** os da planilha usam faixas inconsistentes (ex.: `SUBTOTAL(9,F7:G83)`), o mesmo tipo de erro achado no VT.

## 3. Escopo
| Entra | Fica fora |
| --- | --- |
| Mês da folha por empresa; lista de pagamento (líquido, férias/acréscimos, 13º, avulsos) com forma FOPAG/PIX; conferências automáticas; guias (DARF, FGTS mensal, FGTS consignado); aprovação; arquivo do BB; PIX; títulos no Consistem (funcionários e guias); documentos do mês; checklist e prazos na Fila do dia; relatório | Cálculo da folha (continua com o escritório); eSocial, DCTFWeb e transmissões; rescisões e férias pagas fora do fechamento do mês (ver ponto em aberto 7); ponto eletrônico (o módulo só guarda o relatório e controla o prazo) |

## 4. Entradas
- **Relação Geral dos Líquidos** (.xls do escritório): um arquivo por empresa e por cálculo. "Folha Mensal" preenche o
  **líquido**; o do 13º preenche o **13º**; o de férias, quando houver, preenche **férias/acréscimos**.
  - O arquivo é identificado pelo CNPJ e pela competência do cabeçalho.
  - Cada pessoa é casada pelo **código do escritório** (`rh_colaboradores.matricula_escritorio`).
  - A soma das linhas tem de bater com o "Total da Empresa".
  - Quem não casar fica para o operador ligar ao cadastro (o código fica gravado para os meses seguintes).
  - A grade continua editável para o que não vier do escritório (avulsos).
- **Extrato Mensal** (totais de INSS, FGTS, IRRF): ainda em PDF só imagem. Para as conferências C2–C5 é preciso pedir a versão
  em Excel/TXT ao escritório, ou ler os totais da última página.
- **Guias em PDF:** DARF, GFD mensal, GFD consignado e o "Detalhe da guia" (tem texto). Do PDF se leem valor, vencimento,
  competência e número; o que não for lido, digita-se.
- **Documentos do mês:** extrato, holerites, avisos, ponto. Ficam guardados como anexos do mês.
- **Avulsos:** pessoa, valor, motivo e forma de pagamento, digitados no mês.
- **Cadastro único do RH:** Nº, nome, CPF, agência, conta, forma habitual. É o mesmo do VT (regra 1).

## 5. Regras de negócio
1. **Cadastro único** (decisão de 14/10/2026): RH > Colaboradores passa a valer para o VT e para a folha. Os dados de VT (tarifa,
   passagens por dia, valor fixo) ficam em campos próprios. Quem não recebe VT fica marcado como tal. O cadastro atual do VT
   (`rh_vt_colaboradores`) é migrado sem perda.
   - **Control iD / RHiD (decisão de 21/10/2026, migration 0520):** o cadastro de funcionários do Control iD (person_….csv) é importado
     em RH > Colaboradores ("Importar do Control iD"), unindo numa linha o **nº de fornecedor** (Consistem), a **matrícula da folha**
     (escritório) e o **nº RHiD** (`id_rhid`, o mesmo "Id" dos CSVs de banco de horas).
     - **Casamento, nesta ordem:** nº RHiD, CPF (o Control iD tira o zero da frente), nome igual e nome parecido. O nome parecido só
       vale com quem está sem CPF; foi o caso do Jean da Oeste, "VAUDREIL PIERRI" × "VAUDREUIL PIERRE".
     - **Só completa o que está vazio** (RHiD, CPF, departamento, cargo, admissão). Fornecedor e matrícula nunca vêm do Control iD;
       as diferenças (nomes, CPF, empresa) aparecem na prévia para o RH corrigir.
     - **Quem não existe no cadastro é incluído** sem nº de fornecedor e sem VT, marcado "Completar". Esse colaborador **fica fora da
       folha** (abertura, atualização pelo cadastro e recibos) e do VT até o RH informar o fornecedor.
     - Do arquivo só saem nº RHiD, CPF, nome, empresa, departamento, cargo e admissão, lidos no navegador. Senha, PIN, endereço e
       filiação não são enviados.
     - O **departamento** dá o setor do colaborador: é o setor do RH > Ponto com o mesmo nome. Esse setor é usado pelo Banco de horas.
2. **Competência e pagamento:** a folha do mês M é paga no **5º dia útil de M+1** (decisão de 14/10/2026). Ex.: setembro/2026 é
   pago até 07/10/2026. Para contar os dias úteis, a semana vai de segunda a sexta; feriados ajustados à mão, como no VT.
3. **Um mês por empresa:** o fechamento junta as três empresas, mas cada uma tem a sua lista, os seus totais e as suas guias.
4. **Valor a pagar por pessoa** = líquido + férias/acréscimos + 13º do mês + avulsos.
   - Cada parte é uma **natureza**: salário, férias/acréscimos, 13º 1ª parcela, 13º 2ª parcela, avulso.
   - **13º 1ª parcela (decisão de 15/10/2026):**
     - É paga na folha do **mês do aniversário** da pessoa. Quem faz aniversário em **dezembro** recebe na folha de **novembro**.
     - O valor é o do escritório (cálculo "13o Adiantamento"), na coluna 13º. Entra pelo "Importar do escritório" quando vier a
       Relação dos Líquidos do cálculo; se não vier, é digitado do PDF.
     - Sai **em separado** do salário: a coluna "13º (1ª parcela)" na grade, a seção "13º salário do mês" na tela do mês, a linha
       própria nos totais e a seção "13º salário — 1ª parcela" no relatório. É a linha "13º SALÁRIO" da planilha do RH.
     - No arquivo do BB vai **somado** ao salário: um crédito por pessoa.
     - O aniversário **não** é controlado no Neo Admin por enquanto. Não há data de nascimento no cadastro; quem deveria receber,
       os admitidos depois do aniversário e o adiantamento nas férias o RH acompanha por fora.
   - A forma de pagamento (FOPAG / PIX Neo Formas / PIX Neo Serviços) vem do cadastro e pode ser trocada só no mês.
   - Líquido zero (ex.: afastado) aparece, mas não gera pagamento nem título.
5. **Fluxo:** aberto → conferido → aprovado (gestor) → pago, com o mesmo desenho do VT.
   - Para passar a "conferido", as conferências da regra 6 têm de estar ok ou justificadas.
   - Depois de aprovado nada muda, só a marcação dos PIX.
   - Reabrir é só do gestor, com motivo, e é recusado se já houver título no Consistem.
   - Nada é apagado; tudo passa por auditoria.
6. **Conferências automáticas**, por empresa. Cada diferença acima da tolerância (ponto em aberto 3) vira um apontamento que
   precisa de justificativa.
   - **C1 Extrato × pagamento, por pessoa:** casadas pelo **CPF**. O líquido do escritório tem de ser igual ao valor a pagar no
     mês, sem os avulsos. Aponta quem só aparece de um lado: transferidos, afastados, admitidos, desligados.
   - **C2 Totais do extrato:** a soma dos líquidos é igual ao "Líquido Geral", e proventos − descontos = líquido.
   - **C3 DARF:** a guia é igual a Total INSS + IRRF (competência do pagamento) do extrato.
   - **C4 FGTS mensal:** a guia é igual ao "Valor do FGTS" do extrato e à soma do "Detalhe da guia" por trabalhador.
   - **C5 FGTS consignado:** a guia é igual à soma dos descontos de consignado (Crédito do Trabalhador) no extrato. Os avisos de
     desconto parcial viram alerta, para avisar o funcionário.
   - **C6 VT × folha:** compara o desconto de VT no holerite com o VT pago no módulo de VT, por pessoa. Só aponta.
7. **Arquivo do BB:** só no mês aprovado e só gestor.
   - Uma linha por pessoa **FOPAG** com valor > 0; colunas `CPF | AG | CONTA | SALÁRIO`, iguais às da exportação de hoje.
   - Falta de CPF, agência ou conta bloqueia a geração.
   - Cada geração fica registrada.
8. **PIX:** lista por pagadora (Neo Formas / Neo Serviços), cada linha marcada como "paga". O mês só vai para "pago" com o arquivo
   do BB gerado e todos os PIX marcados.
9. **Avulsos** (decisões de 14 e 15/10/2026): o valor vem **só dos recibos avulsos** do mês (capítulo "Recibos avulsos").
   - O avulso da pessoa na folha é a soma dos recibos dela no mês, e o motivo é montado pelos recibos. Na grade, a coluna fica
     travada.
   - Os avulsos aparecem **separados** da folha do escritório no relatório e nos totais.
   - Não entram nas conferências C1–C5.
   - Entram no arquivo do BB, no PIX e nos títulos, conforme a forma de pagamento.
10. **Títulos no Consistem** (decisão de 14/10/2026). Nada sai sozinho: a chave liga/desliga começa desligada e o operador confere
    e clica, com o mesmo livro imutável e envio único do VT.
    - **Por funcionário:** fornecedor = Nº; valor = valor a pagar; vencimento = 5º dia útil de M+1.
    - **Por guia:** DARF, FGTS mensal e FGTS consignado, contra o fornecedor do órgão no Consistem, com o valor e o vencimento da
      guia.
    - **Códigos** (histórico, portador, categoria, conta de fluxo, contas contábeis) por tipo de título, nos Parâmetros. São
      copiados de lançamentos antigos, como no VT; a categoria tem de ser a do fornecedor.
11. **Checklist do mês e prazos** (Fila do dia):
    - ponto da 1ª e da 2ª quinzena enviado ao escritório (prazo: ponto em aberto 2);
    - folha do escritório recebida;
    - conferências ok;
    - guias recebidas;
    - aprovação;
    - pagamento até o 5º dia útil;
    - guias pagas até o dia 20;
    - avisos de consignado e de férias vencendo tratados.

## 6. Saídas e automações
- **Relatório do mês:** Nº, funcionário, valor a pagar e pagamento, como o do VT. Os avulsos ficam numa seção à parte. Tem subtotais
  por empresa e totais por forma (FOPAG, PIX Neo Formas, PIX Neo Serviços).
- **Arquivo do BB:** `FOLHA <mm>-<aaaa> - EXPORTA BB.xlsx`.
- **Lista de PIX** com marcação de pago.
- **Títulos no Consistem:** funcionários e guias.
- **Quadro de conferências:** C1–C6, com o que bate, o que difere e as justificativas.
- **Pendências na Fila do dia:** os prazos da regra 11.
- **Documentos do mês:** extrato, holerites, guias, avisos e ponto, guardados como anexos do mês. Só a área RH acessa.

## 7. Telas
As abas de RH > Folha de pagamento:
- **Meses:** os 12 meses do ano, com situação, prazo de pagamento, valor por empresa e total.
- **Mês:**
  - por empresa, a grade de pagamento (pessoa, naturezas, valor, forma) e os avulsos;
  - o quadro de conferências C1–C6 com justificativas;
  - as guias (valor, vencimento, documento, título);
  - os documentos e o checklist;
  - botões: Conferido, Aprovar, Arquivo do BB, PIX, Lançar no Consistem, Relatório, Reabrir.
- **Colaboradores:** o cadastro único do RH (regra 1). O VT passa a usar este.
- **Parâmetros** (gestor): códigos dos títulos por tipo (salário, DARF, FGTS, FGTS consignado), fornecedores das guias, tolerância
  das conferências e a chave do Consistem.

## 8. Dados (prefixo `rh_` / `rh_fp_`; migrations na faixa 0510+)
- **`rh_colaboradores`:** o cadastro único (Nº de fornecedor, nome, CPF, agência, conta, forma habitual, empresa empregadora, ativo),
  com os dados de VT em campos próprios. Migração de `rh_vt_colaboradores`; o VT passa a apontar para ele.
- **`rh_fp_competencias`:** mês × empresa (competência, empresa, data de pagamento, status, quem conferiu, aprovou e pagou, arquivo
  do BB).
- **`rh_fp_itens`:** pessoa no mês (foto do cadastro, natureza, valor, forma, origem `escritorio | avulso`, motivo do avulso, PIX
  pago).
- **`rh_fp_extrato`:** o que veio do escritório, por pessoa e nos totais, quando houver o arquivo. É a base das conferências.
- **`rh_fp_guias`:** tipo (`darf | fgts_mensal | fgts_consignado`), empresa, competência, número, vencimento, valor, anexo.
- **`rh_fp_conferencias`:** apontamentos C1–C6, com valor esperado, valor achado, diferença, justificativa, quem e quando.
- **`rh_fp_lancamentos_erp`:** livro dos títulos no Consistem, igual ao do VT.
- **Documentos:** pelo núcleo `anexos`.

Nenhum dado pessoal vai para `docs/amostras/` (LGPD).

## 9. Permissões
- A área é a `rh`, sensível: só vê quem recebe permissão.
- **Operador** monta o mês, lança avulsos, guarda documentos, justifica diferenças, marca PIX e lança no Consistem.
- **Gestor** marca conferido, aprova, reabre, gera o arquivo do BB e altera os Parâmetros.
- Extrato, holerites e guias trazem salário e CPF: ficam só na área RH.

## 10. Pontos em aberto
1. **Arquivo do escritório:** os **líquidos** estão resolvidos com a Relação Geral dos Líquidos em .xls (14/10/2026).
   - Falta confirmar que o escritório manda todo mês um arquivo por empresa e por cálculo (Folha Mensal, 13º 1ª e 2ª parcela,
     férias).
   - Falta pedir a amostra da Neo Formas Concreto.
   - Para as conferências de INSS/FGTS/IRRF falta o **Extrato Mensal** em Excel/TXT (hoje é PDF só imagem).
2. **Ponto:** quem envia ao escritório o ponto e as inconsistências de cada quinzena, e até que dia.
   - As inconsistências de cada quinzena ganharam módulo próprio, **RH > Ponto** (`rh-ponto.md`, 21/10/2026): o líder do setor
     justifica e o RH ajusta no Control iD. Quando o checklist desta regra 11 existir, ele pode marcar o ponto da quinzena como
     feito ao concluir os lotes dos setores.
3. **Tolerância das conferências:** qual diferença é aceita sem justificativa (ex.: R$ 0,05, por causa do centavo da DARF) e quem
   pode justificar.
4. **FGTS de setembro:** por que a guia mensal é R$ 55,22 menor que o "Valor do FGTS" do extrato.
5. **Empresas no Consistem e no núcleo:** em qual empresa do Consistem vão os títulos de cada CNPJ (salários e guias). Hoje só a
   Neo Formas (código 1) está cadastrada no núcleo; ver se Neo Serviços e Oeste entram como empresas.
6. **Fornecedores das guias no Consistem:** os códigos de Receita Federal e de Caixa/FGTS, e se o consignado vai contra a Caixa
   ou contra o banco do empréstimo.
7. **Férias, rescisões e 13º:** se entram como natureza no mês (como hoje na planilha) ou como lançamentos com data própria.
   - O 13º 1ª parcela está resolvido (regra 4, 15/10/2026).
   - Continuam em aberto a 2ª parcela (dezembro), as férias e as rescisões.
8. **Neo Formas para Concreto:** quem está nessa folha (pró-labore?) e quais guias ela gera.
9. **Avulsos:** como aparecem no relatório e nos títulos, e se precisam de aprovação própria.
10. **Os R$ 50,00 do Nº 1072 em setembro/2026:** a planilha pagaria R$ 2.004,26, e o escritório calculou R$ 1.954,26. Qual vale?

Regra 12 (leitura do .xls do escritório): o arquivo é um Excel 97 válido por dentro, mas com o índice que aponta para a planilha
errado. O Neo Admin lê os registros em sequência, sem depender desse índice, e confere a soma com o "Total da Empresa" antes de
aceitar.

## Recibos avulsos (padronizados em 15/10/2026)
Antes, o RH fazia os recibos à mão em .xls (pasta `AVULSO`); foram analisados os 76 de jan–set/2026.

**Tipos**
- **Recorrente:** modelo por pessoa (rubricas e referências). O recibo nasce ao abrir a folha do mês, ou pelo botão "Gerar
  recorrentes", com o salário do cadastro. Ex.: salário por fora, horas normais + assiduidade, reembolso IRRF digitado no mês.
- **Compra de férias:** pessoa e período (dias corridos), com **um recibo por mês** tocado pelo período e **sem 1/3** (o 1/3 é
  rubrica opcional). As linhas são salário – férias + assiduidade + insalubridade e adicional noturno de quem tem.
- **Início antes do registro:** pessoa e período, com dias normais + assiduidade (+ insalubridade/noturno).
- **Eventual:** linhas livres do catálogo (bonificação, diferença de salário, gratificação, descontos de lote/VT…).

**Cálculo** (`lib/modulos/rh/folha/recibos.ts`): cada linha é arredondada em centavos e o líquido é proventos − descontos.
- `dias` = salário ÷ 30 × dias.
- `horas` = salário ÷ 220 × horas (220 = mês cheio).
- **Assiduidade** = valor mensal da CCT ÷ 30 × dias: R$ 120 até 05/2026, **R$ 185 desde 06/2026**.
- **Insalubridade** = % da pessoa × **salário mínimo** ÷ 30 × dias. O salário mínimo é R$ 1.621,00 desde 01/2026.
- **Adicional noturno** = % da pessoa × salário ÷ 30 × dias.
- **Fração do salário** = salário × ref (1/3 férias; bonificação 5%).
- **Valor** = digitado.
- Assiduidade e salário mínimo ficam nos **Parâmetros**, com vigência: cada recibo usa o valor do mês dele.
- O percentual de insalubridade (0/10/20/40) e o de adicional noturno ficam no cadastro da pessoa, junto com salário e função.
  O assistente oferece gravá-los.

**Na folha** (migration 0514):
- `rh_fp_gravar_recibo` grava e soma no avulso da pessoa.
- `rh_fp_cancelar_recibo` cancela com motivo; nada se apaga. Corrigir um recibo é substituí-lo: o antigo fica cancelado.
- Recibo de mês ainda não aberto entra quando o mês abrir.
- Folha conferida ou aprovada não aceita mudança de recibo; o gestor reabre a folha.

**Impressão:** modelo novo, uma folha A4 por recibo com duas vias (empregador e empregado) e linha de corte. Tem:
- cabeçalho da empresa;
- quadro da pessoa: Nº, nome, função, CPF, salário e período;
- rubricas com código, referência, proventos e descontos;
- líquido em destaque, com o valor por extenso;
- mensagem, declaração, data e assinatura.

Há o recibo avulso (`/imprimir/rh/folha/recibo/<id>`) e todos os do mês (`/imprimir/rh/folha/recibos/<mês>`).

**Carga de 09/2026:** os 9 recibos da Neo Serviços (4 recorrentes, 3 compras de férias, 2 inícios antes do registro) e os 4
modelos recorrentes.
- Conferidos com os .xls: 7 iguais e 2 com R$ 0,01 a menos (Rubens e Thiago), porque o .xls não arredondava cada linha.
- Os recibos de "Roberto Felicio" (outro empregador) ficaram fora.

## Fases (proposta)
- **F1:** cadastro único do RH (migra o VT, sem mudar o uso do VT). **Entregue em 14/10/2026.**
  - Migration `0510_rh_colaboradores.sql`: `rh_vt_colaboradores` vira `rh_colaboradores`, com os mesmos registros e ids, e com
    os itens do VT e a auditoria preservados. As alterações novas aparecem na auditoria como `rh_colaboradores`.
  - Campos novos: `recebe_vt` e `matricula_escritorio`. Tarifa ou valor fixo são exigidos só de quem recebe VT.
  - `rh_salvar_colaborador` substitui `rh_vt_salvar_colaborador`. O VT abre o mês e "Atualiza do cadastro" só com quem está
    ativo **e** recebe VT; quem deixou de receber vira "sem VT".
  - Módulo `rh.colaboradores`: a tela RH > Colaboradores (`app/(plataforma)/rh/colaboradores/`) é a antiga tela do VT, com
    matrícula do escritório e a seção "Vale-transporte". A aba Colaboradores do VT aponta para ela.
  - Regras puras em `lib/modulos/rh/colaboradores/` (`modulo.ts`, `cadastro.ts`).
  - Carga feita por script fora do repositório: quem está na folha de setembro/2026 e não estava no cadastro entra ativo, sem VT;
    quem estava inativo, vindo do histórico do VT, e está na folha volta a ativo, sem VT. A matrícula do escritório vem do
    "Detalhe da guia" do FGTS (casada pelo CPF); CPF, agência e conta vêm da planilha só onde estavam vazios.
- **F2:** mês por empresa, pagamento, avulsos, aprovação, arquivo do BB, PIX e relatório. A grade pode ser preenchida à mão.
  **Entregue em 14/10/2026.**
  - Migration `0511_rh_fp_base.sql`:
    - `rh_fp_competencias`: um mês para as três empresas. Cada linha guarda a empresa empregadora; os totais saem por empresa.
    - `rh_fp_itens`: foto do cadastro, com líquido, férias/acréscimos, 13º e avulso (com motivo); o "a pagar" é uma coluna
      gerada.
    - Fluxo aberta → conferida (operador) → aprovada (gestor) → paga. Fora de "aberta" só os PIX mudam. Reabrir é só do gestor,
      com motivo.
    - Pendências "Fechar", "Aprovar" e "Pagar folha de <mês>", todas com prazo no dia do pagamento.
    - `rh_enesimo_dia_util` e `rh_exigir`.
  - Nesta fase, "conferida" é a confirmação à mão do operador. A F3 põe as conferências automáticas como condição.
  - A F2 recusa só mês vazio e FOPAG com valor sem CPF, agência ou conta.
  - Regras puras:
    - `lib/modulos/rh/calendario.ts`: o 5º dia útil (`pagamentoDaFolha`); calendário compartilhado com o VT.
    - `lib/modulos/rh/arquivo-bb.ts`: arquivo do BB do RH; a folha usa o cabeçalho `CPF | AG | CONTA | SALÁRIO`.
    - `lib/modulos/rh/folha/modulo.ts`: naturezas, valor a pagar e leitura de reais digitados.
  - Telas em `app/(plataforma)/rh/folha/`:
    - Meses: total por empresa.
    - Mês: grade editável, filtro "só quem tem valor", "Atualizar do cadastro", totais por empresa, forma e avulsos, PIX e
      botões do fluxo.
    - Download do BB.
    - Relatório `app/(impressao)/imprimir/rh/folha/[id]`: por empresa, com Nº, funcionário, valor e pagamento; avulsos à parte;
      totais por forma.
  - Testes: `tests/db/rh-fp-base.test.ts` e `lib/modulos/rh/folha/modulo.test.ts`.
- **F3:** guias e conferências C1–C6.
- **F4:** títulos no Consistem (funcionários e guias).
- **F5:** documentos e checklist com prazos na Fila do dia.
- **F7 — recibos avulsos padronizados:** entregue em 15/10/2026 (capítulo acima; migration 0514).
- **F6:** importação da Relação Geral dos Líquidos (.xls). As amostras de setembro/2026 chegaram em 14/10/2026; esta fase pode
  vir antes da F3. Em 14/10/2026 a matrícula do escritório do cadastro foi corrigida a partir delas: na F1 ela tinha vindo da
  guia do FGTS (eSocial).
  **Entregue em 14/10/2026.**
  - Leitor de .xls próprio: `lib/integracoes/importador/xls.ts`, com testes num arquivo sintético que reproduz os defeitos
    (`xls.fixture.ts`).
    - Lê o contêiner OLE mesmo com o fim cortado e acha as planilhas percorrendo os registros, sem confiar no deslocamento do
      BOUNDSHEET.
    - Cobre textos (SST com CONTINUE), RK, MULRK, NUMBER e fórmulas.
    - Conferido nos dois arquivos reais de 09/2026, só localmente.
  - Intérprete: `lib/modulos/rh/folha/relacao-liquidos.ts`.
    - Lê empresa, CNPJ (o CNPJ diz qual é a empregadora), cálculo (Folha Mensal → líquido, 13 → 13º, Férias →
      férias/acréscimos), competência, pessoas e Total da Empresa.
    - Recusa soma diferente do total, CNPJ fora da folha, cálculo desconhecido e código repetido.
    - O casamento é pelo código do escritório dentro da empresa, com ligação manual.
  - Migration `0512_rh_fp_importacao_liquidos.sql`:
    - `rh_fp_importacoes` guarda cada arquivo: empresa, cálculo, total, gravadas, ligadas à mão e quem ficou de fora.
    - `rh_fp_importar_relacao` grava a natureza só com o mês aberto e confere de novo que a soma das linhas é o total. As
      ligações manuais gravam o código no cadastro e na foto do mês.
  - Tela: botão "Importar do escritório" no mês aberto.
    - O sistema lê o arquivo e confere a competência com o mês.
    - A prévia mostra quem muda de valor, quem não casou (com a opção de ligar à pessoa certa) e quem tem valor na folha e não
      veio no arquivo.
    - "Gravar" lê o arquivo de novo antes de gravar.
    - Abaixo da grade fica o quadro "Importações do escritório".
  - Simulação com os arquivos de 09/2026 e o cadastro de produção: Neo Serviços casou 58 de 60 sozinhas (2 para ligar à mão);
    Oeste casou 3 de 3.
