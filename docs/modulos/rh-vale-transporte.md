# Módulo: RH/SST / Vale-transporte

Status: em construção — especificação aprovada em 14/10/2026; **Fase A entregue em 14/10/2026** (cadastro, consulta ao Consistem, carga inicial).

## 1. Objetivo
Apurar todo mês o **vale-transporte** dos funcionários de Cuiabá, calcular o valor de cada um, passar o fechamento pela aprovação
do gestor e gerar o **arquivo de crédito do BB** (FOPAG), a lista de **PIX** e o **lançamento dos títulos no Consistem**.
Substitui a planilha anual `Vale Transporte - Cuiabá 2026.xlsx`, mantida à mão aba por aba.

## 2. Como é feito hoje
1. A planilha fica em `ADMINISTRATIVO\01 - RH\03 - CONTROLE DE VALE TRANSPORTES\Vale Transporte - Cuiabá <ano>.xlsx`.
2. No fim de cada mês o RH copia a aba anterior e a renomeia com a data do pagamento (ex.: "OUTUBRO 30.10"). Essa aba é o
   **VT do mês seguinte**: o título diz "RELATÓRIO DE VALE TRANSPORTE - NOVEMBRO".
3. Uma linha por funcionário: EMPRESA (Neo Serviços, Oeste), Nº (matrícula), FUNCIONÁRIO, DIAS ÚTEIS, FALTAS, EXTRAS,
   PASSAGENS `=(D-E+F)*2`, VR. UNITÁRIO (R$ 4,95, 5,95 ou 8,00), VALOR TOTAL `=G*H` e PAGAMENTO (FOPAG, PIX - NEO FORMAS,
   PIX - NEO SERVIÇOS). As faltas e extras são as do **mês que está fechando** e ajustam o adiantamento pago no mês anterior.
4. Ao lado ("IMPORTAÇÃO BB", colunas L a O) ficam CPF, AGÊNCIA, CONTA e VALOR. Essas colunas são copiadas para a aba
   **EXPORTA BB**, que vira o XLSX enviado ao BB para crédito em conta de quem é FOPAG. Os PIX são pagos um a um.
5. Subtotal por `SUBTOTAL(9, ...)`. As linhas que às vezes ficam abaixo do subtotal não têm significado e são desconsideradas.
6. A aba ENGENHARIA - CAJU (R$ 500 fixos de despesas no cartão Caju) **não** faz parte deste módulo.
Cada funcionário tem um código de fornecedor no Consistem, e ele **é o "Nº" da planilha** (conferido em 14/10/2026: 660 = Ailton,
658 = Adrian etc., na empresa Neo Formas do Consistem, `codigo_erp` 1). Os nomes da planilha às vezes têm grafia diferente da do Consistem.

## 3. Escopo
| Entra | Fica fora |
| --- | --- |
| Cadastro de quem recebe VT (empresa, matrícula, código de fornecedor no Consistem, nome, CPF, agência, conta, forma de pagamento habitual, tarifa, passagens por dia); consulta ao fornecedor no Consistem para preencher/conferir nome e CPF; competência mensal com dias, faltas e extras; cálculo; envio para aprovação e aprovação pelo gestor; XLSX do BB; lista e marcação dos PIX pagos; relatório do mês; pendências na Fila do dia; lançamento dos títulos a pagar no Consistem (Fase C, **adiada**: será priorizada depois) | Caju / despesas da engenharia; desconto de até 6% na folha (fica com a folha); outras cidades/unidades (o cadastro já guarda a tarifa por pessoa, então dá para ampliar depois); calendário de feriados; envio automático ao banco; CNAB |

## 4. Entradas
- **Carga inicial**: as linhas acima de SUBTOTAIS da aba mais recente ("OUTUBRO 30.10": 45 pessoas, 38 FOPAG). Nº → código de
  fornecedor; CPF, agência e conta das colunas L a N ("IMPORTAÇÃO BB") da própria linha; coluna K → observação. Feita uma vez,
  por script fora do repositório (scratchpad da sessão), gerando um `insert ... on conflict do nothing`. Depois dela, o botão
  "Conferir no Consistem" acerta nome e CPF. A planilha tem CPF e conta bancária: **não vai para `docs/amostras/`** (LGPD); só o layout descrito na seção 2.
- **Consistem**: fornecedor por código (`cadastrosgerais/v10/fornecedor/{cod}`, só leitura) para **nome e CPF**. Agência e conta
  ficam no cadastro do Neo Admin (carga inicial da planilha, depois manutenção na tela).
- **Digitação mensal**: dias úteis da competência e, por pessoa, faltas, extras, ajuste de dias (admissão, férias, afastamento) e,
  se mudar naquele mês, a forma de pagamento.

## 5. Regras de negócio
1. **Competência** = mês do VT (M+1). É apurada e paga no fim do mês M. Ex.: competência 11/2026 paga em 30/10/2026.
2. **Passagens** = `max(0, dias_úteis − faltas + extras) × passagens_por_dia`. `passagens_por_dia` é do cadastro, padrão 2.
3. **Valor** = `passagens × tarifa`, arredondado a 2 casas (`numeric(14,2)`).
   Exemplos: 21 dias, sem falta/extra, R$ 4,95 → 42 × 4,95 = **R$ 207,90**. 19 dias + 1 extra, R$ 4,95 → 40 × 4,95 = **R$ 198,00**.
   21 dias, R$ 8,00 → **R$ 336,00**. Faltas maiores que dias + extras → **R$ 0,00** (nunca negativo).
   **Valor fixo mensal** (decisão de 14/10/2026): quem tem `valor_fixo` no cadastro recebe esse valor no mês, sem cálculo por
   dias (ex.: Nº 659, R$ 800,00). Com valor fixo a tarifa é opcional; sem ele, obrigatória.
4. **Dias úteis**: a competência tem um valor padrão digitado pelo RH (a tela sugere a contagem de segunda a sexta do mês);
   cada pessoa pode ter o seu (admissão no meio do mês, férias, afastamento). Sem calendário de feriados nesta versão.
5. **Faltas e extras** são do mês M (o que fecha) e ajustam o adiantamento já pago — regra da planilha de hoje.
6. Ao **abrir** a competência entram todos os cadastros ativos, com **foto** de empresa, CPF, agência, conta, forma de pagamento,
   tarifa e passagens por dia. Mudar o cadastro depois não altera competência já aberta (há botão "atualizar do cadastro"
   enquanto ela está aberta). A **forma de pagamento** (FOPAG / PIX Neo Formas / PIX Neo Serviços) pode ser trocada no item
   enquanto a competência está aberta, sem mexer na forma habitual do cadastro.
7. **Fluxo**: aberta → enviada para aprovação (operador) → aprovada (gestor) → paga. Aprovada congela valores; só o gestor reabre,
   com motivo. Competência e itens **não são apagados** (mudam de status); tudo passa por auditoria.
8. **Arquivo do BB**: só competência aprovada. Uma linha por item **FOPAG** com valor > 0 (os dados bancários servem só para
   gerar esse arquivo; item PIX nunca entra), colunas `CPF | AGENCIA | CONTA | VALOR`,
   no mesmo formato da aba EXPORTA BB de hoje (CPF `000000000-00`, agência e conta como texto com dígito, valor numérico).
   Item FOPAG sem CPF, agência ou conta bloqueia a geração e aparece na lista de pendências da competência.
9. **PIX**: lista separada por pagadora (Neo Formas / Neo Serviços); cada linha é marcada "paga" com data. A competência fica
   "paga" quando o arquivo do BB foi gerado e marcado como enviado e todos os PIX foram marcados.
10. **Prazo de fechamento**: 2 dias úteis (segunda a sexta) antes do último dia útil do mês M. Ex.: outubro/2026, último dia
    útil sexta 30/10 → prazo quarta **28/10**; se o último dia útil for uma segunda, o prazo é a quinta anterior. A aprovação
    do gestor vence no último dia útil (dia do pagamento).
11. **Consistem** (Fase C, adiada): nada sai sozinho. O operador confere e clica; cada título enviado guarda o código devolvido
    pelo Consistem e não é reenviado. Parâmetros do título a definir quando a fase for priorizada.

## 6. Saídas e automações
- XLSX do BB (`VT <mm-aaaa> - BB.xlsx`), relatório do mês para impressão (por empresa e forma de pagamento, com totais),
  lista de PIX.
- Pendências na Fila do dia: "Fechar VT de <mês>" (operador, prazo da regra 10), "Aprovar VT de <mês>" (gestor, quando
  enviada, prazo no último dia útil), "Pagar PIX do VT de <mês>" (após aprovar). Encerradas sozinhas quando a etapa termina.
- Títulos a pagar no Consistem (Fase C, adiada).

## 7. Telas
- **RH > Vale-transporte**: lista de competências (mês, status, total, nº de pessoas, total por forma de pagamento).
- **Competência**: grade com empresa, matrícula, nome, dias, faltas, extras, passagens, tarifa, valor, forma de pagamento;
  edição em linha enquanto aberta; totais; botões Enviar / Aprovar / Reabrir / Arquivo BB / Imprimir; aba PIX.
- **Cadastro**: grade de quem recebe VT; novo/editar/desativar; "Conferir no Consistem" (busca pelo código de fornecedor e
  compara nome e CPF).
Todas as grades com `components/ui/table.tsx` (classificação e filtro).

## 8. Dados (tabelas do módulo, prefixo `rh_vt_`)
- `rh_vt_colaboradores`: empresa_id, matricula, nome, codigo_fornecedor_erp, cpf, agencia, conta, forma_pagamento
  (`fopag` | `pix_neo_formas` | `pix_neo_servicos`), tarifa `numeric(14,2)`, passagens_dia (padrão 2), ativo, observacoes.
- `rh_vt_competencias` (Fase B, migration 0502): competencia (1º dia do mês), dias_uteis_padrao, status, enviada_por/em, aprovada_por/em,
  reaberta_motivo, arquivo_bb_gerado_em, arquivo_bb_enviado_em.
- `rh_vt_itens`: competencia_id, colaborador_id, foto dos dados do cadastro, dias_uteis, faltas, extras, passagens, valor,
  pix_pago_em, codigo_lancamento_erp, erro_erp.
Migration `0500_rh_vt_base.sql` (Fase A): módulo `rh.vale_transporte`, `rh_vt_colaboradores` e `rh_vt_salvar_colaborador`.
`rh_vt_colaboradores` tem ainda `empresa_id` (empresa do Consistem onde está o fornecedor) e `empregador` (texto: NEO SERVIÇOS,
OESTE…), porque as empregadoras não estão cadastradas no núcleo; únicos: (empresa, fornecedor) e CPF. Não se apaga: desativa.
Migration `0501_rh_vt_valor_fixo.sql`: coluna `valor_fixo` (opcional), tarifa opcional quando há valor fixo, e
`rh_vt_salvar_colaborador` com o parâmetro `p_valor_fixo`.

## 9. Permissões
Área `rh` (sensível: só vê quem recebe permissão). Quem opera é **todo o pessoal do Financeiro**: o admin dá a cada um nível
**operador** na área RH (Configurações > Usuários) — sabendo que esse acesso valerá também para os próximos módulos de RH.
Consulta vê; operador cadastra, lança e envia; **gestor** (Alan) aprova, reabre e gera o arquivo do BB.
RLS com `tem_acesso_area('rh', ...)`.

## 10. Pontos em aberto
Respondidos em 14/10/2026:
1. A forma de pagamento pode mudar de um mês para outro; as colunas do BB servem só para gerar o arquivo → regras 6 e 8.
2. Linhas abaixo de "SUBTOTAIS": desconsiderar.
3. Do Consistem bastam nome, CPF e código de fornecedor; conta bancária fica no Neo Admin.
4. Título no Consistem: priorizar depois (Fase C adiada).
5. Prazo: 2 dias úteis antes do último dia útil do mês → regra 10.
6. Operadores: todos do Financeiro, com acesso liberado à área RH.

Novo (14/10/2026, na carga):
7. **Valor fixo mensal**: o Nº 659 aparece sem dias nem tarifa, com VALOR TOTAL fixo de R$ 800,00 (FOPAG). Aprovado o campo
   opcional "valor fixo mensal" no cadastro, que substitui o cálculo por dias → regra 3, migration 0501.

## Fases
- **Fase A** — base e cadastro. **Entregue em 14/10/2026**:
  - `supabase/migrations/0500_rh_vt_base.sql` e `0501_rh_vt_valor_fixo.sql`; testes `tests/db/rh-vt-base.test.ts`.
  - Regras puras `lib/modulos/rh/vale-transporte/` (`modulo.ts`, `cadastro.ts` + teste: agência/conta, CPF, código, tarifa,
    divergências com o Consistem).
  - Tela RH > Vale-transporte > Colaboradores (`app/(plataforma)/rh/vale_transporte/`): grade, novo/editar com botão
    "Consistem" (traz nome e CPF pelo código), aviso de FOPAG sem CPF/agência/conta, "Conferir no Consistem" (todos os ativos;
    mostra só o que diverge; "Usar o do Consistem" grava nome e CPF consultando de novo na hora).
  - Edge Function `rh-vt-consultar-fornecedor` (só leitura; operador do RH): GET `cadastrosgerais/v10/fornecedor/{cod}`.
- **Fase B** — competência mensal, cálculo, aprovação, arquivo BB, PIX, pendências.
- **Fase C** — lançamento dos títulos no Consistem (adiada).
