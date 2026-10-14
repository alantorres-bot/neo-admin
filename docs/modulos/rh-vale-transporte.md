# Módulo: RH/SST / Vale-transporte

Status: em construção. Especificação aprovada em 14/10/2026.
- **Fase A** entregue em 14/10/2026: cadastro, consulta ao Consistem, carga inicial.
- **Fases B e C** entregues em 14/10/2026 (código): mês a mês, relatório, arquivo do BB, PIX, resumo do ano, histórico de 2026 e
  contas a pagar no Consistem. Falta a publicação em produção.

## 1. Objetivo
Apurar todo mês o **vale-transporte** dos funcionários de Cuiabá e calcular o valor de cada um, com faltas, atestados, extras,
férias, afastamentos e abatimentos. O fechamento passa pela aprovação do gestor e gera:
- o **relatório** do mês;
- o **arquivo de crédito do BB** (FOPAG);
- a lista de **PIX**;
- os **títulos a pagar no Consistem**, um por colaborador.

O ano fica dividido por mês. O módulo substitui a planilha anual `Vale Transporte - Cuiabá 2026.xlsx`, mantida à mão aba por aba.

## 2. Como é feito hoje
1. A planilha fica em `ADMINISTRATIVO\01 - RH\03 - CONTROLE DE VALE TRANSPORTES\Vale Transporte - Cuiabá <ano>.xlsx`.
2. No fim de cada mês o RH copia a aba anterior e a renomeia com a data do pagamento (ex.: "OUTUBRO 30.10"). Essa aba é o
   **VT do mês seguinte**: o título diz "RELATÓRIO DE VALE TRANSPORTE - NOVEMBRO".
3. Uma linha por funcionário, com as colunas:
   - EMPRESA (Neo Serviços, Oeste), Nº, FUNCIONÁRIO, DIAS ÚTEIS, FALTAS, EXTRAS;
   - PASSAGENS `=(D-E+F)*2`, VR. UNITÁRIO (R$ 4,95, 5,95 ou 8,00), VALOR TOTAL `=G*H`;
   - PAGAMENTO (FOPAG, PIX - NEO FORMAS, PIX - NEO SERVIÇOS).
   As faltas e extras são as do **mês que está fechando** e ajustam o adiantamento pago no mês anterior. Quem recebe valor fixo
   aparece com "DESPESAS" nos dias e o valor digitado.
4. Ao lado ("IMPORTAÇÃO BB", colunas L a O) ficam CPF, AGÊNCIA, CONTA e VALOR. Essas colunas são copiadas para a aba
   **EXPORTA BB**, que vira o XLSX enviado ao BB para crédito em conta de quem é FOPAG. Os PIX são pagos um a um.
5. Subtotal por `SUBTOTAL(9, ...)`. As linhas que às vezes ficam abaixo do subtotal não têm significado e são desconsideradas.
   Em 14/10/2026 o SUBTOTAL das abas de setembro e outubro **não pegava a última linha** (Nº 1311: R$ 217,80 e R$ 207,90). O módulo
   soma todas as linhas.
6. A aba ENGENHARIA - CAJU (R$ 500 fixos de despesas no cartão Caju) **não** faz parte deste módulo.

O "Nº" da planilha é o **código de fornecedor no Consistem**, conferido em 14/10/2026 (660 = Ailton, 658 = Adrian etc.). Os
fornecedores estão na empresa Neo Formas do Consistem (`codigo_erp` 1). Os nomes da planilha às vezes têm grafia diferente da do
Consistem.

## 3. Escopo
| Entra | Fica fora |
| --- | --- |
| Cadastro de quem recebe VT; mês a mês com ocorrências por pessoa (falta, atestado, extra, férias, afastamento, abatimento em dias e/ou R$, sem VT no mês); cálculo; aprovação do gestor; relatório; XLSX do BB; PIX; resumo do ano; títulos a pagar no Consistem; pendências na Fila do dia; histórico de 2026 importado da planilha | Caju / despesas da engenharia; desconto de até 6% na folha (fica com a folha); outras cidades/unidades (o cadastro já guarda a tarifa por pessoa, então dá para ampliar depois); calendário de feriados; envio automático ao banco; CNAB |

## 4. Entradas
- **Cadastro**: carga inicial com as linhas acima de SUBTOTAIS da aba "OUTUBRO 30.10" (45 pessoas, 38 FOPAG).
  - Nº → código de fornecedor; CPF, agência e conta vêm das colunas L a N; a coluna K vira observação.
  - Depois da carga, "Conferir no Consistem" acerta nome e CPF.
  - A planilha tem CPF e conta bancária: **não vai para `docs/amostras/`** (LGPD).
- **Histórico de 2026**: as abas DEZEMBRO 30.12 … SETEMBRO 30.09 viram os meses de VT de janeiro a outubro/2026, pagos e só
  consulta. A aba OUTUBRO 30.10 vira novembro/2026 aberto.
  - Script fora do repositório; o total de cada mês bate, ao centavo, com a soma das linhas da planilha.
  - Quem não está mais na lista entra como colaborador inativo.
  - Os R$ 500 "DESPESAS" de janeiro (719, 701, 705, engenharia) entram como valor fixo, porque estavam no total daquele mês.
- **Consistem**: fornecedor por código (`cadastrosgerais/v10/fornecedor/{cod}`, só leitura) para **nome e CPF**. Agência e conta
  ficam no cadastro do Neo Admin.
- **Digitação mensal** (grade do mês):
  - dias úteis do mês;
  - por pessoa: faltas, atestados, extras, abatimento em dias e em R$ (com motivo), férias e afastamento por período, sem VT
    (com motivo), forma de pagamento do mês, observação.

## 5. Regras de negócio
1. **Competência** = mês do VT (M+1), paga no **último dia útil do mês M**. Ex.: VT de novembro/2026 é pago em 30/10/2026.
2. **Faltas, atestados e extras** são do mês M (o que fecha) e ajustam o adiantamento já pago. **Atestado desconta como falta**
   (decisão de 14/10/2026).
3. **Férias e afastamento** são informados por período (início e fim). Descontam os dias úteis (segunda a sexta) do período que
   caem **dentro do mês do VT**. Ex.: férias de 10/11 a 20/11/2026 → 9 dias.
4. **Dias pagos** = `max(0, dias_úteis − faltas − atestados − dias_férias − dias_afastamento − abatimento_dias + extras)`.
5. **Valor**:
   - **Por dias**: `max(0, dias_pagos × passagens_por_dia × tarifa − abatimento_R$)`. `passagens_por_dia` vem do cadastro (padrão 2).
   - **Valor fixo mensal** (decisão de 14/10/2026): é **proporcional** aos dias pagos.
     `max(0, round(valor_fixo × dias_pagos ÷ dias_úteis, 2) − abatimento_R$)`.
   - **Sem VT no mês** (com motivo, ex.: desligado, afastado o mês inteiro) dá **R$ 0,00**.
   - Exemplos:
     - 21 dias, R$ 4,95 → **R$ 207,90**;
     - 19 dias + 1 extra → **R$ 198,00**;
     - 21 dias com 1 falta e 1 atestado → **R$ 188,10**;
     - férias de 10 a 20/11 → 12 × 9,90 = **R$ 118,80**;
     - valor fixo de R$ 800, 21 dias, 2 faltas → **R$ 723,81**;
     - abatimento de R$ 50 → valor − 50, nunca negativo.

   O cálculo é feito **no banco** (gatilho `rh_vt_calcular_item`) e repetido na tela (`lib/modulos/rh/vale-transporte/calculo.ts`).
6. **Abatimento** pode ser em dias e/ou em R$ (ex.: saldo no cartão, VT pago a mais), sempre com motivo.
7. **Dias úteis**: o mês tem um valor padrão.
   - Ao abrir o mês, a tela sugere a contagem de segunda a sexta; o RH desconta os feriados.
   - Cada pessoa pode ter o seu (admissão, desligamento).
   - "Aplicar a todos" muda o padrão e quem estava nele.
8. Ao **abrir** o mês entram todos os ativos do cadastro, com a **foto** do cadastro.
   - Enquanto o mês está aberto, "Atualizar do cadastro" traz os dados novos, inclui quem entrou e marca "sem VT" quem foi
     desativado. As ocorrências já lançadas ficam.
   - A **forma de pagamento** pode ser trocada só naquele mês.
9. **Fluxo**: aberto → enviado para aprovação (operador) → aprovado (gestor) → pago.
   - Fora de "aberto" nada muda, só a marcação dos PIX.
   - Só o gestor reabre, com motivo. Reabrir desfaz a aprovação, o arquivo do BB e o "pago".
   - Reabrir é **recusado se já houver título no Consistem**: acerte lá primeiro.
   - Nada é apagado; tudo passa por auditoria.
   - Os meses importados da planilha são só consulta.
10. **Enviar** recusa FOPAG com valor sem CPF, agência ou conta: complete o cadastro e "Atualizar do cadastro", ou mude a forma.
11. **Arquivo do BB** (só gestor; mês aprovado ou pago), igual à aba EXPORTA BB:
    - uma linha por **FOPAG** com valor > 0; colunas `CPF | AGENCIA | CONTA | VALOR`;
    - CPF `000000000-00`, agência e conta como texto, valor numérico, ordem por nome;
    - cada geração fica registrada no mês.
12. **PIX** (aprovado): cada linha é marcada "paga". O mês só vai para "pago" com o arquivo do BB gerado (se houver FOPAG) e todos
    os PIX marcados.
13. **Prazos** (segunda a sexta, sem feriados):
    - **fechamento**: 2 dias úteis antes do último dia útil do mês M. Ex.: outubro/2026 → quarta **28/10**; se o último dia útil
      for uma segunda, o prazo é a quinta anterior;
    - **aprovação e pagamento**: no último dia útil.
14. **Consistem** (contas a pagar), só no mês aprovado ou pago e só com a chave ligada nos Parâmetros. Um título por pessoa com
    valor e ainda sem título:
    - **fornecedor** = Nº; **valor** = valor do mês; **vencimento** = dia do pagamento;
    - **emissão e entrada** = dia do lançamento; **documento** = `VT` + MMAA;
    - **complemento** = `VALE TRANSPORTE <MÊS>/<ANO> - <FOPAG|PIX NEO FORMAS|PIX NEO SERVICOS>`;
    - **histórico, portador, categoria, conta de fluxo e contas contábeis** vêm dos **Parâmetros**. Podem ser copiados de um VT
      já lançado: o último título do fornecedor 660, ou um código de lançamento.

    Como o envio funciona:
    - O painel monta os títulos, a reserva confere de novo no banco (valor, fornecedor, vencimento, códigos) e grava o payload
      (imutável).
    - A Edge Function envia uma vez só. Recusado pelo Consistem vira "erro" e pode ser lançado de novo.
    - Resposta incerta para o lote; o operador confere no Consistem e "Resolve" com o código, ou que não foi criado.

## 6. Saídas e automações
- **Relatório do mês** para imprimir ou PDF (`/imprimir/rh/vale-transporte/<id>`): por empresa, com subtotais por empresa e por
  forma de pagamento. Mês não aprovado sai com o selo "PRÉVIA".
- **Arquivo do BB** `VT <mm>-<aaaa> - EXPORTA BB.xlsx`.
- **Lista de PIX** com marcação de pago.
- **Títulos a pagar no Consistem** (regra 14).
- **Resumo do ano**: colaborador × 12 meses, com totais por pessoa e por mês.
- **Pendências na Fila do dia**:
  - "Fechar VT de <mês>": aberta pela rotina diária a partir de 7 dias úteis antes do prazo, ou ao abrir o mês;
  - "Aprovar VT de <mês>": quando o mês é enviado;
  - "Pagar VT de <mês>": quando o mês é aprovado.

  Cada uma é encerrada sozinha quando a etapa termina. Rotina diária `rh_vt_rotina_diaria()` às 07:00 de Cuiabá (pg_cron).

## 7. Telas
As abas de RH > Vale-transporte:
- **Meses**: os 12 meses do ano, com pagamento, prazo, situação, pessoas, FOPAG, PIX e total. Tem o botão "Abrir mês", que sugere
  o próximo mês e os dias úteis.
- **Mês**:
  - grade editável, com uma linha por pessoa: pagamento, dias úteis, faltas, atestados, extras, abatimento em dias e em R$;
  - "Ocorrências" abre férias, afastamento, motivo do abatimento, sem VT e observação;
  - a grade recalcula na hora e tem um botão Salvar; os totais saem por empresa e por forma;
  - botões: Relatório, Enviar, Aprovar, Arquivo do BB, Marcar mês como pago, Reabrir;
  - depois de aprovado, aparecem os quadros **PIX** e **Contas a pagar no Consistem**.
- **Resumo do ano**: o fechamento anual dividido por mês.
- **Colaboradores**: o cadastro. Desde 14/10/2026 é o **cadastro único do RH** (RH > Colaboradores, migration 0510; ver
  `docs/modulos/rh-folha.md`, regra 1). O VT considera só quem está ativo **e** recebe VT.
- **Parâmetros** (gestor): os códigos do título no Consistem, a cópia de um VT já lançado e a chave liga/desliga.

Todas as grades usam `components/ui/table.tsx` (classificação e filtro).

## 8. Dados (tabelas do módulo, prefixo `rh_vt_`)
- **`rh_vt_colaboradores`** (0500, 0501):
  - colunas: empresa_id (empresa do Consistem), empregador (texto), cod_fornecedor, nome, cpf, agencia, conta,
    forma_pagamento, tarifa, valor_fixo, passagens_dia, ativo, observacao;
  - únicos: (empresa, fornecedor) e CPF; não se apaga, desativa.
- **`rh_vt_competencias`** (0502):
  - competencia (1º dia do mês do VT), dias_uteis_padrao, data_pagamento, prazo_fechamento;
  - status `aberta | enviada | aprovada | paga`;
  - quem e quando enviou, aprovou, pagou e reabriu (com motivo); arquivo_bb_gerado_por/em; importada (histórico).
- **`rh_vt_itens`** (0502):
  - foto do cadastro; ocorrências;
  - calculados pelo gatilho: dias_ferias, dias_afastamento, dias_pagos, valor;
  - pix_pago_por/em; importado.
- **`rh_vt_lancamentos_erp`** (0503): o livro dos títulos enviados ao Consistem, igual ao do Cartão.
  - payload imutável; situação `reservado → enviando → lancado | erro`;
  - no máximo um ativo por item; nunca apagado.
- **Configurações**:
  - `rh.vale_transporte.lancar_no_erp`: começa desligada;
  - `rh.vale_transporte.lancamento`: códigos do título.
- **Funções**:
  - fluxo: `rh_vt_abrir_competencia`, `rh_vt_atualizar_do_cadastro`, `rh_vt_definir_dias_uteis`, `rh_vt_salvar_itens`,
    `rh_vt_enviar`, `rh_vt_aprovar`, `rh_vt_reabrir`, `rh_vt_marcar_pix`, `rh_vt_registrar_arquivo_bb`, `rh_vt_marcar_paga`;
  - Consistem: `rh_vt_salvar_parametros`, `rh_vt_reservar_lancamentos`, `rh_vt_resolver_lancamento`; envio só pela Edge
    Function (`rh_vt_iniciar_envio_erp`, `rh_vt_concluir_lancamento_erp`, `rh_vt_interromper_lote`).

## 9. Permissões
- A área é a `rh`, sensível: só vê quem recebe permissão.
- Quem opera é **todo o pessoal do Financeiro**, com nível **operador** na área RH (Configurações > Usuários). Esse acesso vale
  também para os próximos módulos de RH.
- **Consulta** vê.
- **Operador** cadastra, abre o mês, lança ocorrências, envia, marca PIX, marca pago e lança no Consistem.
- **Gestor** (Alan) aprova, reabre, gera o arquivo do BB e altera os Parâmetros.
- Leitura por RLS com `tem_acesso_area('rh')`; escrita só pelas funções, que conferem o nível.

## 10. Pontos em aberto
Respondidos em 14/10/2026:
1. **Forma de pagamento**: pode mudar de um mês para outro; as colunas do BB servem só para gerar o arquivo.
2. **Linhas abaixo de "SUBTOTAIS"**: desconsiderar.
3. **Dados do Consistem**: bastam nome, CPF e código de fornecedor.
4. **Prazo**: 2 dias úteis antes do último dia útil.
5. **Operadores**: todo o Financeiro.
6. **Valor fixo mensal**: existe e é proporcional.
7. **Atestado**: desconta como falta.
8. **Férias**: informadas por período.
9. **Abatimento**: em dias e/ou R$.
10. **Histórico de 2026**: importado.
11. **Consistem**: copiar os códigos de um VT já lançado (fornecedor 660).

Ainda a conferir:
- **Códigos do título no Consistem**. O espelho do Contas a Pagar não tem títulos de VT (só guarda saldo > 0). A busca do modelo
  é feita pela API, na tela Parâmetros. Se o modelo não trouxer algum código, o gestor digita.
- **Portador**: se ele for diferente para FOPAG e para cada PIX, hoje o módulo usa um só conjunto de códigos.
- **Feriados**: não são contados; o RH ajusta os dias úteis do mês.

## Fases
- **Fase A — base e cadastro.** Entregue em 14/10/2026.
  - `0500_rh_vt_base.sql`, `0501_rh_vt_valor_fixo.sql`, tela Colaboradores e Edge Function `rh-vt-consultar-fornecedor`.
- **Fase B — mês a mês.** Entregue em 14/10/2026.
  - `0502_rh_vt_competencias.sql`.
  - Regras: `lib/modulos/rh/vale-transporte/calendario.ts`, `calculo.ts`, `planilha-bb.ts`.
  - Telas: Meses, Mês, Resumo do ano, relatório de impressão e download do BB.
  - Testes: `tests/db/rh-vt-competencias.test.ts` e os unitários em `lib/modulos/rh`.
- **Fase C — contas a pagar no Consistem.** Entregue em 14/10/2026.
  - `0503_rh_vt_consistem.sql`, `lancamento.ts`.
  - Edge Function `rh-vt-lancar-no-consistem` (`_shared/rh-vt-envio-lote.ts`).
  - Ação "modelo" (só leitura) em `rh-vt-consultar-fornecedor` e tela Parâmetros.
  - Testes: `tests/db/rh-vt-consistem.test.ts`.
