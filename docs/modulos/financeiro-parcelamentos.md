# Financeiro > Gestão de Parcelamentos

> Situação: **Fase 1 concluída; Fase 2 construída e revisada (pré-homologação) em 11/11/2026; aguarda autorização para commit, push e publicação.**
> O Consistem continua sendo a fonte oficial. O módulo só **lê** o ERP (nenhuma escrita na primeira versão).

## 1. Diagnóstico técnico (11/11/2026)

### 1.1 O que o Neo Admin já tem e será reaproveitado
| Peça | Onde | Uso no módulo |
| --- | --- | --- |
| Cliente HTTP do Consistem (token CSMEN050, header `empresa`, paginação por `continuationToken`, retry 429) | `supabase/functions/_shared/consistem-receber.ts` (`buscarTodasPaginas`) | mesma chamada; nenhuma integração nova |
| Normalização dos lançamentos do Contas a Pagar (valores pt-BR, datas, tipos C/A/B/D/P) e detalhe por id | `supabase/functions/_shared/consistem-pagar.ts` | ampliar o detalhe com `grupoContaFluxoCaixa`, `contaFluxoCaixa`, `codDocumento`, `tipoLancamento` |
| Regra "principal quitado, resto é juros que o ERP não baixa" | `principalQuitado` (mesmo arquivo) | parcela paga com resíduo de saldo |
| Cadastro de grupos/contas de fluxo | `cap_contas_fluxo` (0143) — ex.: 20/16 Parc. Imp. Municipais, 20/17 Estaduais, 20/18 Federais, 11/6 Aluguel de Imóveis, 27/6 INSS/IRRF Oeste | tela de regras (lido por view pública, não pela tabela do módulo) |
| Empresas e código do ERP | `empresas.codigo_erp` (0101) | empresa do lançamento |
| Pendências, anexos (Storage), auditoria, permissões por área | núcleo (`publicar_pendencia`, `anexos`, `auditoria`, `tem_acesso_area`/`nivel_area`) | Fila do dia, guias em PDF, histórico, acesso |
| Grade com classificação/filtro | `components/ui/table.tsx` | todas as telas |
| Agendamento | pg_cron + segredo do Vault (padrão de `cap-sincronizar-consistem`) | sincronização periódica |

O espelho atual do Contas a Pagar (`cap_lancamentos`) **descarta o tipo P** (`classificarLancamento` → "ignorar").

### 1.2 API do Contas a Pagar — verificado ao vivo, só leitura (GET), 11/11/2026
Swagger ao vivo: `https://erp.neoformas.com.br/api/resources/documents` (55 serviços; Financeiro v1.0 com 20 rotas).

- `GET financeiro/v10/contasPagar` — parâmetros: `situacao, categoria, portador, origem, tipoDocumento, venceApresentacao,
  dataEmissaoIni/Fim, dataVencimentoIni/Fim, dataPagamentoIni/Fim, campoFiltroDinamico, valorFiltroDinamico, continuationToken, paginacao`.
  **`campoFiltroDinamico=tipoLancamento&valorFiltroDinamico=P` funciona no servidor** (nov/2026: 34 de 702; vida inteira: 1.201 P).
  A lista **não** traz grupo/conta de fluxo nem empresa (empresa vai no header).
- `GET financeiro/v10/lancamentoContasPagar/{id}` — traz `grupoContaFluxoCaixa`, `contaFluxoCaixa`, `codDocumento`, `tipoLancamento`,
  `dataVencimentoOriginal`, `dataPagamento`, `valorPago`, `valorJuros`, `valorMulta`, `codBarras`, `qrCodePix`. Um GET por lançamento.
- `GET financeiro/v10/titulosPagos` existe, mas é do **Contas a Receber** (`codTitulo`, `cliente`) — não serve.
- `GET financeiro/v10/gruposFluxoCaixa` — cadastro de grupos (`codGrupo, descGrupo, tipoGrupo`).
- Identificador único: `codLancamento` (por empresa).

**Ciclo de vida do P (constatado nos dados):**
1. O parcelamento é provisionado de uma vez: um lançamento **P** por mês, com `numDocumento` = `<sufixo do nº do parcelamento>-MM/AA`
   (ex.: `8003-11/26`, `8003-12/26`…), códigos sequenciais. Hoje há P até 07/2032.
2. Quando a guia do mês é lançada, o **mesmo `codLancamento` vira tipo C**, com o valor atualizado da guia
   (ex.: CDA 2025658003: P 12482 de nov = R$ 2.061,18; o 12481 de out já é C = R$ 2.295,73). *Inferido pela sequência dos códigos;
   confirmar acompanhando um lançamento de P para C em novembro.*
3. A baixa aparece no C (`valorAtualizado` 0, `dataPagamento`/`valorPago` no detalhe). Parcelas pagas com atraso ficam com resíduo
   de juros no saldo (ex.: 4660-09/26 saldo R$ 24,51) — mesma regra do `principalQuitado`.
4. Não existe P vencido no ERP (só 1 resíduo de INSS de 08/2026). **Logo, o histórico das parcelas pagas só existe se o Neo Admin
   guardar o lançamento desde que ele é P.** Para o passado (antes da implantação), dá para recuperar os C pelos mesmos documentos.

### 1.3 Outras rotas da API
- Não há rota específica de parcelamentos em nenhum dos 55 serviços: os parcelamentos existem no ERP só como lançamentos do
  Contas a Pagar (P, depois C).
- `portalanalytics /clara/executeQuery` (SQL pela pipeline da Clara) é acesso direto ao banco do ERP, cobrado por crédito e sem
  autorização da Consistem — **não usar**.

### 1.4 As duas planilhas × API (nov/2026, empresa 1)
| | Planilha | API (tipo P, venc. nov/26) |
| --- | --- | --- |
| NOVEMBRO (forn. 475 SEFAZ, 986 PGE, 336 Min. Fazenda; grupo/conta 20/17 e 20/18) | 22 lanç. — R$ 139.611,83 | 475 + 986 + 1 do 336 = **R$ 139.611,83** ✔ |
| ALUTEC (forn. 917; grupo/conta 11/6) | 8 lanç. — R$ 3.874,50 | 917 = **R$ 3.874,50** ✔ |
| Fora das planilhas | — | 3 P do 336 "INSS/IRRF" (R$ 1,00 cada, conta 27/6) e 1 P do 623 "TELEFONE … VIVO" (R$ 1,00, conta 16/1) |

Conclusões para as regras:
- **"Conta" da planilha é o par grupo/conta de fluxo** (20/17, 20/18, 11/6); conta 17 sozinha não identifica nada.
- **P + fornecedor 336 não basta**: também traz a projeção de INSS/IRRF (não é parcelamento). Para o 336 a regra exige 20/18.
- Os lançamentos "Alutec" estão na **empresa 1 do ERP** (Neo Formas), no fornecedor 917, classificados em **11/6 Aluguel de Imóveis**
  (provável classificação errada no ERP; o histórico fala de PGFN, eSocial, multas CLT, IRPF, ITR da Oeste Formas, de pessoas físicas ligadas ao grupo e do imóvel Caetés).
  O "devedor" (Oeste Formas, uma pessoa física…) é um campo do parcelamento, não a empresa do lançamento.
- **Parcelamentos da Alutec = P (ou C) do fornecedor 917**, sem exigir conta de fluxo (hoje estão em 11/6, mas a regra não
  depende disso). Em nov/2026 os 8 P do 917 são todos parcelamentos; exceções pontuais vão por regra de exceção ou classificação manual.
- Outros fornecedores com P (50, 621, 623, 683, 744, 752, 762, 791, 850 — 23 meses cada, ex.: telefone) **não** são parcelamentos:
  ficam fora por não casarem com regra nenhuma.
- Casos para conferência manual já presentes: docs `533-11/26` e `1533-11/26` com o mesmo histórico "CDA 20262271533" e valores
  diferentes; `0507` (FUNJUS) e `3507` (ICMS) citam a mesma CDA 2025663507 (são parcelamentos diferentes); ITR com valor R$ 1,00.

## 2. Modelagem (Fase 2, migration `0189_par_parcelamentos.sql`)

Princípio contra duplicidade: **painel e relatórios somam `par_parcelas`, nunca os lançamentos do ERP.** Um lançamento do
Consistem liga-se a no máximo uma parcela e cada parcela a no máximo um lançamento (`par_lancamentos.parcela_id` único). Parcela
cadastrada à mão que depois aparece no ERP só é juntada ao lançamento por uma pessoa (`par_vincular_lancamento`).

| Tabela | Conteúdo |
| --- | --- |
| `par_naturezas` | federal, estadual, municipal, neo_servico, outros (tabela, não enum: natureza nova sem mudar código) |
| `par_regras` | nome, empresa (nulo = todas), `tipos` (P/C), `fornecedores` (códigos), `grupo`+`conta` de fluxo (par; os dois ou nenhum), `complemento_contem` (texto do histórico), natureza, `excecao`, prioridade, ativa. Todo critério é opcional, mas a regra exige fornecedor, conta de fluxo ou texto (senão pegaria todo P do ERP). Não se apagam: desativam-se |
| `par_parcelamentos` | id estável, empresa, descrição, natureza, origem (`CONTAS_PAGAR` quando criado de uma sugestão, `MANUAL`), devedor, credor, fornecedor, grupo/conta, nº, processo, CDA, inscrição, referência do débito, adesão, valor original, qtd. de parcelas, dia do vencimento, situação (ativo/suspenso/rescindido/encerrado/cancelado), responsável, observações, `chave_erp` (única por empresa) |
| `par_parcelas` | parcelamento, competência (`aaaa-mm`, única por parcelamento entre as não canceladas), nº, origem, vencimento e valor (só da manual; a do ERP usa o lançamento), situação da guia (7 valores; operada na Fase 4), responsável, observações, cancelamento com motivo |
| `par_lancamentos` | espelho dos lançamentos do Contas a Pagar (chave empresa + `cod_lancamento`): tipo, fornecedor e nome, documento, histórico, emissão, vencimento, valor do documento, saldo, **valor provisionado** (último valor enquanto era P), grupo/conta, pagamento (data, valor, juros, multa), código de barras, `detalhado_em`, `virou_c_em`, `sumiu_em`, `chave_erp`, competência, classificação, natureza, regra, motivo, parcela |
| `par_sincronizacoes` | cada leitura: empresa, agendada/manual, usuário, situação (em andamento/ok/erro), resumo, erro |

Ficou fora (sem necessidade): tabela própria de histórico/auditoria → núcleo `auditoria` (gatilho `fn_auditoria` em regras,
parcelamentos, parcelas e lançamentos, só quando algo muda de fato); tabela de responsáveis → coluna `responsavel_id`;
`par_guias` → Fase 4. Nada se apaga (`fn_bloquear_delete`).

Views (com `security_invoker`): `par_vw_lancamentos`, `par_vw_parcelas` (valores do ERP quando há lançamento, senão os da parcela
manual), `par_vw_parcelamentos` (parcelas registradas/pagas, total pago, em aberto, próximo vencimento), `par_vw_sugestoes`.

Permissões (módulo `financeiro.parcelamentos`, níveis da área Financeiro; tabelas só leitura, escrita só por funções que conferem
o nível): **consulta** vê tudo; **operador** atualiza do Consistem, classifica à mão, devolve às regras, vincula/desvincula e
reaplica as regras; **gestor** cria e edita parcelamentos, inclui parcela manual e edita regras. Não há permissão por empresa no
Neo Admin (o acesso é por área, como nos demais módulos); o que existe é a trava de não vincular lançamento de uma empresa a
parcelamento de outra.

### Classificação (`par_classificar`)
1. Regra que precisa de conta de fluxo e lançamento ainda sem o detalhe → **aguardando conta de fluxo** (a lista não traz).
2. Exceção que casa → **exceção: não é parcelamento** (`ignorado`; vence as outras).
3. Nenhuma regra → **sem regra (para análise)** (`sem_regra`, "Nenhuma regra casa."). Não é decisão: fica na visão própria,
   com a conta de fluxo à vista (todo lançamento é detalhado), para alguém classificar à mão ou criar regra.
4. Menor prioridade vence; empate entre naturezas diferentes → **pendente** ("Regras em conflito").
5. Classificação manual (operador, com motivo) vale sobre as regras até ser devolvida.
6. Lançamento já numa parcela que as regras deixam de classificar → **pendente** (não desfaz sozinho).
Salvar regra reclassifica tudo o que não é manual. O texto do histórico é comparado literalmente (sem curingas).

### Associação (`par_associar`)
Chave = `<fornecedor>:<documento sem -MM/AA>` (ex.: `986:8003`); competência vem do `-MM/AA`. O gestor cria o parcelamento
**uma vez** a partir da sugestão; as parcelas dessa chave (inclusive as que chegarem depois) entram sozinhas. Já existe parcela
na competência → o lançamento fica sem parcela, com o motivo, em "Sem parcelamento associado". Mesma obrigação com documento
diferente → "Juntar a existente" (`par_vincular_chave`). Casos reais: PGFN Oeste 15043689 (`3689` → `0689`), ITR 917 (`0033` e
`033`), IRPF Oeste (`2424` → `2454`). Documento sem `-MM/AA` (formatos antigos como `11324660/09`, `10830665-11`) → vínculo manual.

**P excluído e guia relançada como C de código novo** (caso real, 4 de 301): o P responde "Lançamento não cadastrado" e ganha
`sumiu_em`; o C novo (mesma chave e competência) não troca sozinho: fica sem parcela com o motivo "Pode substituir o lançamento X";
o operador vincula e o novo substitui o antigo na parcela (o antigo fica no histórico, sem parcela).

### Baixa (`quitado_em`)
Só o Consistem confirma: C com **saldo 0 na lista** ou **valor pago ≥ valor do documento** no detalhe (resto do saldo = juros que
o ERP não baixa; ex. real 12147: saldo R$ 100,60 com o principal pago). Guia, anexo ou comprovante nunca marcam baixa. A
**data do pagamento não vem** no detalhe desses C (`dataPagamento` vazia em 11/11/2026): grava-se quando a leitura viu a baixa
("Baixa vista em"), e a data real só se o ERP passar a informar. Se o ERP reabrir o saldo, `quitado_em` volta a nulo.

### Sincronização (Edge Function `fin-parcelamentos-sincronizar`, só GET no ERP)
1. `GET contasPagar` com `campoFiltroDinamico=tipoLancamento&valorFiltroDinamico=P` (todos os P, ≈1.200) **e** com
   `campoFiltroDinamico=codFornecedor` para cada fornecedor das regras ativas (≈500 cada, toda a vida) → `par_registrar_lista`
   (só P e C; idempotente; devolve os que deviam ter vindo e não vieram). Os dois filtros funcionam no servidor (11/11/2026).
2. Detalhe (`/{id}`) de até 400 por rodada, nesta ordem: os que não vieram na lista, os que esperam a conta de fluxo, os demais
   nunca detalhados, os C de parcelamento não quitados → `par_registrar_detalhes` (só grava o que mudou). HTTP 400 "Lançamento
   não cadastrado!" (ou 404) = excluído (`sumiu_em`, nunca apaga). Outra falha = tenta na próxima rodada.
3. Nome dos fornecedores sem nome (`cadastrosgerais/v10/fornecedor/{id}`).
4. Uma leitura por empresa de cada vez (rodada presa há mais de 10 min é encerrada como erro).
5. Botão "Atualizar do Consistem" (operador) e pg_cron `fin-parcelamentos-sincronizar-2h` (dias úteis, 07:50–17:50 de Cuiabá),
   que só chama com a configuração `financeiro.parcelamentos.sincronizar_agendado` = true (começa **false**).

### Validação com os dados reais (11/11/2026, só GET na API + banco de teste local com a 0189)
- Listas: 1.201 P + 512/496/548/546 dos fornecedores 336/475/917/986 = **1.827 lançamentos** (1.201 P e 626 C); todos
  detalhados em 5 rodadas de até 400 (~44 s de ERP). 0 recusados, 0 divergências lista × detalhe.
- Os 203 P de fornecedores fora das regras (50, 621, 623, 683, 744, 752, 762, 791, 850) são faturas, telefone, comissão de R$ 1,00
  (contas 12/19, 11/6, 16/1, 13/4, 29/3, 16/9): nenhum em conta de parcelamento (20/16–20/18).
- Classificados: 475 e 986 em 20/17 (P 489 + C 211), 336 em 20/18 (P 25 + C 46), 917 (P 342 + C 103, todos em 11/6). O 336 tem
  ainda 20/3, 20/10, 20/12, 26/10–12, 27/6, 29/46, 11/6, 12/23 (INSS/IRRF, PIS, outros): sem regra, para análise. Nov/2026 continua
  igual às planilhas (estaduais R$ 139.037,13; federais R$ 4.449,20).
- P → C: dos 301 C com P na mesma chave, **297 são o próprio P convertido** (mesmo lote numérico: código = 1º P − meses) e **4
  foram relançados com código novo** (336 9982-08/26 e 09/26, 475 4660-09/25, 986 6592-06/26). 9242/9243 respondem
  "Lançamento não cadastrado!".
- 51 sugestões de parcelamento (inclui o histórico de 2025–2026 e parcelamentos já encerrados).
- Para conferir: 21 C classificados sem `-MM/AA` (formatos antigos, entradas de parcelamento, IPVA 8x da Frontier em 20/17).

### Homologação visual (sem produção)
`npx playwright test -c playwright.parcelamentos.config.ts` sobe `e2e/parcelamentos-simulado.mjs` (PGlite com TODAS as migrations,
RLS e funções reais, PostgREST mínimo, "Atualizar do Consistem" repetindo uma carga gravada) e o `next dev --webpack`.
`PARC_CARGA=<carga.json>` usa uma carga real (fica fora do repositório); sem ela, a amostra de nov/2026 dos testes mais um C pago sintético (versionados, sem nomes de pessoas). `PARC_CAPTURAS=<pasta>`
salva as telas. Roteiro (`e2e/parcelamentos.spec.ts`, 5 cenários): menu, lista e detalhe (gestor); parcelas e "sem parcelamento";
classificação (sugestões, criar parcelamento pelo diálogo, visões); regras (editar) e leituras; operador atualiza; consulta só
vê; sem acesso = 404; nenhum pedido sai da máquina.

## 3. Fases
- **Fase 2 — construída e revisada em 11/11/2026 (aguarda publicação):** migration 0189; Edge Function `fin-parcelamentos-sincronizar`;
  `normalizarDetalheParcelamento`, `juntarListasParcelamento`, `lancamentoNaoCadastrado` em `_shared/consistem-pagar.ts`; telas em
  `/financeiro/parcelamentos`. Testes: `tests/db/par-parcelamentos.test.ts` (21), `lib/integracoes/consistem/consistem-parcelamentos.test.ts`,
  `lib/modulos/financeiro/parcelamentos/parcelamentos.test.ts`, `e2e/parcelamentos.spec.ts` (5).
  **Para pôr no ar (cada passo com autorização):** commit; push; aplicar a 0189 e registrar em `schema_migrations`; publicar a
  função e o app por `scripts/publicar.mjs`; clicar "Atualizar do Consistem" ~5 vezes até zerar os pendentes de detalhe; conferir
  nov/2026 com as planilhas; criar os parcelamentos das sugestões; só então ligar `financeiro.parcelamentos.sincronizar_agendado`.
- **Fase 3** — situação financeira (em aberto/vencida/paga…), abas da tela de parcelas, alertas e pendências na Fila do dia, dashboard.
- **Fase 4** — central de guias (anexo, extração da linha digitável do PDF, conferência valor/vencimento).
- **Fase 5** — previsão mensal e relatórios (Excel/PDF).
- **Fase 6** — homologação com o Consistem e usuários.

## 4. Riscos
- Data real do pagamento indisponível na API para esses C: só "baixa vista em".
- Saldo residual de centavos (ex. real: parcela 06/2026 do 8003 paga R$ 0,35 a menos) mantém a parcela em aberto, como no ERP;
  tolerância é decisão de negócio (Fase 3).
- Parcelamento lançado direto como C sem `-MM/AA` ou de fornecedor fora das regras não entra sozinho (fica sem regra/manual).
- Lançamentos da "Alutec" em conta de aluguel (11/6) distorcem o fluxo do ERP (não corrigimos no ERP); a conta 11/6 também
  tem faturas do fornecedor 621 (por isso a regra do 917 é por fornecedor).
- Só uma chave por parcelamento entra sozinha; documentos renumerados precisam de "Juntar a existente".

## 5. Pendências funcionais (registradas na pré-publicação, 11/11/2026)
Nenhuma muda as regras financeiras aprovadas; ficam para a operação ou para as próximas fases.
1. **Data da baixa:** o que a tela mostra ("Baixa vista em dd/mm/aaaa", `quitado_em`) é a data em que o Neo Admin percebeu a baixa
   no Consistem, **não** necessariamente a data real do pagamento (o detalhe da API vem com `dataPagamento` vazia). Se o ERP
   passar a informar, `data_pagamento` é gravada e exibida no lugar.
2. **Saldo residual positivo continua em aberto**, como no Consistem (ex. real: 06/2026 do 8003 com R$ 0,35). Qualquer
   tolerância é decisão do Alan (Fase 3); hoje não há.
3. **21 documentos antigos** (C de 2024–2026 sem `-MM/AA`: `11324660/09`, `10830665-11`, `3429982/66`, entradas `4669-1` etc.)
   estão classificados mas exigem **associação manual** (Parcelas > Sem parcelamento associado > Vincular).
4. **Documentos renumerados** (ex.: `3689` → `0689`, `0033`/`033`, `2424` → `2454`) aparecem como sugestões separadas e exigem
   **conferência** antes de "Criar parcelamento" ou "Juntar a existente".
5. **IPVA parcelado** (Frontier, 8x, conta 20/17) hoje cai na regra estadual. Precisa de identificação específica da natureza:
   classificar à mão, criar regra de exceção ou regra própria pelo histórico ("IPVA"). Uma natureza nova (ex.: "IPVA") exige
   migration, porque ainda não há tela de naturezas. Decisão do Alan.
6. **Conversão P → C ao vivo:** confirmada nos dados (297 de 301 no mesmo lote), mas ainda não acompanhada acontecendo; conferir
   na primeira guia lançada depois da publicação (`virou_c_em` preenchido, parcela continua a mesma).
