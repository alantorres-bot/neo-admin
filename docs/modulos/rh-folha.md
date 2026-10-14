# Módulo: RH/SST / Folha de pagamento (fechamento mensal)

Status: em construção. Especificação aprovada em 14/10/2026; **F1 (cadastro único) entregue em 14/10/2026**.

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
- **Códigos:** o extrato usa o **código do escritório** e a planilha usa o **Nº de fornecedor do Consistem**. Os dois só batem
  pelo **CPF**.
- **SUBTOTAIS:** os da planilha usam faixas inconsistentes (ex.: `SUBTOTAL(9,F7:G83)`), o mesmo tipo de erro achado no VT.

## 3. Escopo
| Entra | Fica fora |
| --- | --- |
| Mês da folha por empresa; lista de pagamento (líquido, férias/acréscimos, 13º, avulsos) com forma FOPAG/PIX; conferências automáticas; guias (DARF, FGTS mensal, FGTS consignado); aprovação; arquivo do BB; PIX; títulos no Consistem (funcionários e guias); documentos do mês; checklist e prazos na Fila do dia; relatório | Cálculo da folha (continua com o escritório); eSocial, DCTFWeb e transmissões; rescisões e férias pagas fora do fechamento do mês (ver ponto em aberto 7); ponto eletrônico (o módulo só guarda o relatório e controla o prazo) |

## 4. Entradas
- **Folha do escritório em Excel/TXT**, a pedir ao escritório: por empresa, por pessoa, com CPF, código, situação, eventos, proventos,
  descontos e líquido, mais os totais do fim (INSS, FGTS, IRRF, líquido geral). O layout fica definido quando chegar a amostra
  (ponto em aberto 1). Enquanto isso, a grade do mês pode ser preenchida à mão.
- **Guias em PDF:** DARF, GFD mensal, GFD consignado e o "Detalhe da guia" (tem texto). Do PDF se leem valor, vencimento,
  competência e número; o que não for lido, digita-se.
- **Documentos do mês:** extrato, holerites, avisos, ponto. Ficam guardados como anexos do mês.
- **Avulsos:** pessoa, valor, motivo e forma de pagamento, digitados no mês.
- **Cadastro único do RH:** Nº, nome, CPF, agência, conta, forma habitual. É o mesmo do VT (regra 1).

## 5. Regras de negócio
1. **Cadastro único** (decisão de 14/10/2026): RH > Colaboradores passa a valer para o VT e para a folha. Os dados de VT (tarifa,
   passagens por dia, valor fixo) ficam em campos próprios. Quem não recebe VT fica marcado como tal. O cadastro atual do VT
   (`rh_vt_colaboradores`) é migrado sem perda.
2. **Competência e pagamento:** a folha do mês M é paga no **5º dia útil de M+1** (decisão de 14/10/2026). Ex.: setembro/2026 é
   pago até 07/10/2026. Para contar os dias úteis, a semana vai de segunda a sexta; feriados ajustados à mão, como no VT.
3. **Um mês por empresa:** o fechamento junta as três empresas, mas cada uma tem a sua lista, os seus totais e as suas guias.
4. **Valor a pagar por pessoa** = líquido + férias/acréscimos + 13º do mês + avulsos.
   - Cada parte é uma **natureza**: salário, férias/acréscimos, 13º 1ª parcela, 13º 2ª parcela, avulso.
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
9. **Avulsos** (decisão de 14/10/2026): lançados no mês com pessoa, valor, motivo e forma.
   - Aparecem **separados** da folha do escritório no relatório e nos totais.
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
1. **Arquivo do escritório:** pedir ao escritório a folha em Excel/TXT e mandar uma amostra. Para cada empresa: por pessoa, CPF,
   código, situação, eventos, proventos, descontos e líquido, mais os totais do fim.
2. **Ponto:** quem envia ao escritório o ponto e as inconsistências de cada quinzena, e até que dia.
3. **Tolerância das conferências:** qual diferença é aceita sem justificativa (ex.: R$ 0,05, por causa do centavo da DARF) e quem
   pode justificar.
4. **FGTS de setembro:** por que a guia mensal é R$ 55,22 menor que o "Valor do FGTS" do extrato.
5. **Empresas no Consistem e no núcleo:** em qual empresa do Consistem vão os títulos de cada CNPJ (salários e guias). Hoje só a
   Neo Formas (código 1) está cadastrada no núcleo; ver se Neo Serviços e Oeste entram como empresas.
6. **Fornecedores das guias no Consistem:** os códigos de Receita Federal e de Caixa/FGTS, e se o consignado vai contra a Caixa
   ou contra o banco do empréstimo.
7. **Férias, rescisões e 13º:** se entram como natureza no mês (como hoje na planilha) ou como lançamentos com data própria.
8. **Neo Formas para Concreto:** quem está nessa folha (pró-labore?) e quais guias ela gera.
9. **Avulsos:** como aparecem no relatório e nos títulos, e se precisam de aprovação própria.

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
- **F3:** guias e conferências C1–C6.
- **F4:** títulos no Consistem (funcionários e guias).
- **F5:** documentos e checklist com prazos na Fila do dia.
- **F6:** importação do arquivo do escritório, quando chegar a amostra.
