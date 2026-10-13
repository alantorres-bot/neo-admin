# Módulo: Financeiro / Contas a pagar

Status: em construção — especificação aprovada em 09/10/2026; **Fases 1 a 3 entregues (09–10/10/2026)** (sincronização + lista unificada; autorização, histórico e pendência; impressão/PDF); **Fase 4d (12/10/2026)**: leitura da confirmação dos documentos no Consistem (seção 16)

## 1. Objetivo
Reunir numa única tela os **títulos a pagar** e as **antecipações a fornecedor** que estão em aberto no Consistem, para a
diretoria marcar o que será pago e gerar **um único Relatório de autorização de pagamento**, com histórico das autorizações.
Hoje isso exige duas telas do ERP e não produz um relatório unificado.

## 2. Como é feito hoje
1. A diretoria consulta no Consistem os títulos do contas a pagar em aberto (uma rotina) e as antecipações a fornecedor
   (outra rotina), separadamente.
2. Monta a relação do que pagar e envia ao financeiro.
3. O financeiro executa os pagamentos e dá baixa no Consistem.
4. A antecipação, no Consistem, é considerada paga no momento do lançamento (tipo A). Para saber se foi paga de fato, o
   financeiro olha se o documento tem **número de borderô** relacionado.
Frequência: a cada rodada de autorização (diária/semanal, conforme a diretoria).

## 3. Escopo
| Entra | Fica fora |
| --- | --- |
| Lista unificada do que está em aberto no Consistem: títulos (tipo C) e antecipações (tipo A), com filtros e totais por tipo; seleção e geração da autorização; histórico de autorizações (rascunho → autorizada → cancelada); pendência "Executar autorização" na Fila do dia; relatório para impressão/PDF; marcar antecipação como "já paga fora do Neo Admin"; data de corte para antecipações antigas | Pagar, dar baixa ou alterar qualquer coisa no Consistem (o Neo Admin só lê o ERP); "marcar como pago" no Neo Admin; conciliação da fatura do cartão (módulo `financeiro.cartao`, `financeiro-cartao.md`); projeções (tipo P) e baixas de antecipação (tipo B); autorização parcial de um título; **confirmar documentos no Consistem (CCFFB014) a partir daqui** — a API não tem essa operação (seção 16): o Neo Admin só lê a confirmação e mostra o que falta |

## 4. Entradas
Tudo vem da **API REST do Consistem** (mesma ligação de Recebíveis: base `https://erp.neoformas.com.br/api`, cabeçalhos
`Authorization` = token do CSMEN050 e `empresa` = `empresas.codigo_erp`; segredo `CONSISTEM_API_KEY` nas Edge Functions).
Testado ao vivo em 09/10/2026:

| Rota | Situação | Uso |
| --- | --- | --- |
| `GET financeiro/v10/contasPagar` | Funciona. O filtro `situacao` é **ignorado** pelo servidor; `dataVencimentoIni/Fim` e `dataEmissaoIni/Fim` funcionam | Lista de títulos e antecipações (toda a vida: ~27 mil lançamentos) |
| `GET financeiro/v10/lancamentoContasPagar` (lista) | **HTTP 500** no servidor (bug do Consistem; reportar ao suporte) | não usar |
| `GET financeiro/v10/lancamentoContasPagar/{id}` | Funciona | Detalhe de um lançamento: portador, código de barras, Pix, `dataPagamento`, `valorPago` |
| `GET cadastrosgerais/v10/fornecedor?situacao=1` e `=0` | Funciona | Nome, nome fantasia e CPF/CNPJ do fornecedor (a lista de títulos só traz o código) |
| `GET financeiro/v10/contasPagar?campoFiltroDinamico=docConfirmado&valorFiltroDinamico=1` (+ `dataVencimentoIni/Fim` ou `dataEmissaoIni/Fim`) | Funciona (12/10/2026) | Só os documentos **confirmados** na tela CCFFB014. Valores da coluna: `1` confirmado, `0` verificado e não confirmado, nulo nunca avaliado. O campo **não** vem na resposta da lista nem dos detalhes; só o filtro enxerga. Nome inventado dá HTTP 400 |

Campos da lista: `codLancamento, codFornecedor, numDocumento, categoriaDoc, codBanco, codHistorico, complementoHistorico,
dataEmissao, dataEntrada, dataVencimento, tipoLancamento, valorDocumento, valorOriginal, valorAtualizado, codOrigem`.
Valores vêm como **texto em formato brasileiro** ("2.525,44"). Datas em `AAAA-MM-DD`; nas antecipações `dataVencimento` vem `"0"`.

`tipoLancamento`:
| Tipo | Significado | Na tela |
| --- | --- | --- |
| C | Título a pagar (em 09/10/2026: 2.423 em aberto, R$ 20,9 mi) | **entra** |
| A | Antecipação a fornecedor (552 lançadas; 48 com saldo, R$ 483.910,44) | **entra** |
| B | Baixa de antecipação (abatimento por nota fiscal) | fora |
| D | Débito = crédito do fornecedor (devolução etc.) | fora (Fase 4: só informação) |
| P | Projeção (parcelamentos tributários, INSS/IRRF) | fora |

## 5. Regras de negócio
1. **Em aberto** = `valorAtualizado > 0`. Para o título é o saldo a pagar; para a antecipação é o saldo ainda não abatido por NF.
2. **Sincronização, não leitura ao vivo.** Como a API não filtra "em aberto", a Edge Function `cap-sincronizar-consistem`
   lê a lista completa, grava os tipos C, A e D no espelho `cap_lancamentos` (um registro por `empresa + codLancamento`) e marca
   `baixado_em` em quem **sumiu dos abertos** (não voltou, ou voltou com saldo zero). Nunca escreve no Consistem.
   Trava: se a API devolver lista vazia e houver abertos no banco, a rodada aborta sem gravar. Cada rodada registra em `importacoes`.
3. **Fornecedores** são espelhados em `cap_fornecedores` (código, nome, fantasia, CPF/CNPJ, ativo). Virar contraparte do
   núcleo fica para a Fase 4 (`contrapartes.codigo_erp` é único e já é usado pelos clientes).
4. **Antecipação "a pagar" x "já paga"**: a API não traz o borderô. Regra adotada:
   a) a antecipação com saldo aparece na lista até entrar em uma autorização ativa (rascunho ou autorizada); depois mostra "Na autorização nº N";
   b) **data de corte** (`financeiro.contas-pagar.antecipacoes_a_partir_de`, gestor): antecipação com `dataPagamento` (ou emissão)
      anterior ao corte é considerada paga fora do Neo Admin e não entra na lista; vazia = todas entram;
   c) quem opera pode marcar uma antecipação como **"já paga fora do Neo Admin"** (motivo obrigatório; registro, nunca exclusão; desfazível).
5. **Autorização** = cabeçalho (`cap_autorizacoes`: número sequencial sem buracos, empresa, data, status, observação, quem
   montou/autorizou/cancelou e quando) + itens (`cap_autorizacao_itens`: **cópia** do lançamento no momento — tipo, código,
   fornecedor nome e CNPJ, documento, datas, valor = saldo no momento, complemento do histórico, banco/portador). A cópia é a
   prova: não muda depois, mesmo que o título mude no Consistem.
6. **Status**: `rascunho` → `autorizada` (só gestor) → fim; `rascunho`/`autorizada` → `cancelada` (gestor ou quem montou,
   motivo obrigatório). Nada é apagado (gatilho de bloqueio de delete); toda mudança vai para `auditoria`.
7. **Um lançamento não pode estar em duas autorizações ativas** ao mesmo tempo. Cancelada a primeira, pode entrar em outra.
8. Ao autorizar, nasce a pendência **"Executar autorização de pagamento nº N — R$ X"** (módulo `financeiro.contas-pagar`,
   link para a autorização, prazo = menor vencimento dos itens ou hoje se já venceu, criticidade alta se vence em ≤ 3 dias).
   O financeiro conclui a pendência pela Fila do dia. Cancelar a autorização cancela a pendência.
9. **Sem "marcar como pago"**: a baixa é no Consistem. Na sincronização seguinte, o item cuja origem saiu dos abertos recebe
   `baixado_consistem_em`; a autorização mostra "baixados no Consistem X de N". Na antecipação o rótulo é "abatida por NF em",
   porque é isso que o saldo zero significa.
10. **Totais** sempre por tipo (títulos, antecipações) e geral, na tela e no relatório.
11. Limite de 500 itens por autorização. Valores em `numeric(14,2)`; datas no fuso America/Cuiaba.
12. **Pagamentos extras (fora do Consistem)** (11/10/2026): a diretoria pode mandar pagar algo que não existe no Consistem
    (frete avulso, reembolso, taxa, fornecedor ainda sem título). Entram num **terceiro bloco** da autorização, com
    **descrição, favorecido e valor** (`cap_autorizacao_extras`), e somam no total autorizado, no caixa/excedente, na pendência
    e no relatório. Qualquer um do Financeiro (operador) inclui e remove, **só em rascunho** (remoção com motivo; nunca delete).
    Uma autorização pode ter **só extras**; autorizar exige ao menos 1 item do Consistem ou 1 extra. O lançamento desses
    pagamentos no Consistem continua por conta do financeiro.
13. **Montagem na tela de seleção** (11/10/2026): "rascunho em montagem" = a autorização mais recente da empresa em `rascunho`.
    Na barra fixa da tela Autorizar pagamento, três botões em sequência: **Salvar parcial** (grava os marcados no rascunho em
    montagem, ou cria um, e a pessoa continua na tela; pode fechar e voltar), **Extras** (inclui o pagamento fora do Consistem
    direto no rascunho; se houver itens marcados, salva-os junto), **Gerar autorização** (acrescenta os marcados, abre a página
    da autorização; gestor pode "Autorizar agora"). A barra mostra "Rascunho 111026 em montagem: N itens · R$ X + E extras ·
    R$ Y" e compara com o caixa o total do rascunho + marcados. Itens já salvos aparecem "Na autorização 111026 (rascunho)".
    Função de banco `cap_montar_rascunho` (uma transação); `cap_adicionar_itens` concentra as validações de inclusão.

## 6. Saídas e automações
- **Relatório de autorização de pagamento** (Fase 3): página de impressão (A4) com cabeçalho da empresa (razão social e CNPJ),
  número e data, observação, tabela de **Títulos** e tabela de **Antecipações** (fornecedor, CNPJ, documento, vencimento ou
  pagamento programado, **complemento do histórico**, valor), **subtotal por tipo e total geral**, "Montada por / Autorizada
  por" e selo RASCUNHO ou CANCELADA quando não autorizada. "Salvar como PDF" pelo navegador. Opcional: anexar o PDF assinado.
- **Pendência** "Executar autorização de pagamento nº N" na Fila do dia (regra 8).
- **Botões Simular / Atualizar do Consistem** na tela (operador). Agendamento diário da sincronização na Fase 4.
- Falha na sincronização abre uma pendência "Falha na atualização do contas a pagar" (como em Recebíveis).

## 7. Telas (rota `/financeiro/contas-pagar`, menu Financeiro > Contas a pagar)
| Tela | O que mostra |
| --- | --- |
| **Autorizar pagamento** (`/financeiro/contas-pagar`) | Três cartões (Títulos, Antecipações, Total: quantidade e R$); filtros (fornecedor/documento, tipo, vencimento de/até, mostrar já autorizados); tabela unificada com caixa de marcação e **títulos de coluna clicáveis para ordenar** (crescente ↔ decrescente): Tipo, Fornecedor, Documento, Vencimento (antecipação: pagamento programado), Valor, Saldo, Histórico — sem CNPJ, código do lançamento, emissão ou situação (linhas não pendentes ficam apagadas com uma linha pequena "na autorização X", "paga (borderô)" ou "paga fora"); barra fixa "N itens · R$ X" + caixa disponível + rascunho em montagem + botões **Salvar parcial · Extras · Gerar autorização** (diálogo: data (só ao criar), caixa, observação; gestor vê "Autorizar agora"); "Atualizado do Consistem em …" + Simular/Atualizar |
| **Autorizações** (`/autorizacoes`) | Histórico: nº, data, status, itens, total títulos, total antecipações, montada por, autorizada por, baixados no Consistem X/N; filtro por status |
| **Autorização** (`/autorizacoes/[id]`) | Cabeçalho e status; seção Títulos e seção Antecipações com totais, colunas Fornecedor · Documento · Vencimento/Pagamento programado · Histórico · Valor, ordenáveis pelo título (sob o valor, só quando há algo a dizer: "baixado no Consistem em dd/mm" ou "já paga (tem borderô)"); seção Pagamentos extras; botões Autorizar (gestor), Cancelar (motivo), Remover item (só rascunho), Imprimir / salvar PDF |
| **Impressão** (`/imprimir/contas-pagar/autorizacao/[id]`) | O relatório da seção 6, sem a moldura do sistema |
| **Antecipações** e **Parâmetros** (Fase 4) | Todas as antecipações com saldo e sua situação; data de corte com prévia |

## 8. Dados (prefixo `cap_`, tudo em `public`)
| Tabela / objeto | Papel |
| --- | --- |
| `cap_fornecedores` | Espelho do cadastro de fornecedores do Consistem (`unique (empresa_id, cod_fornecedor)`) |
| `cap_lancamentos` | Espelho dos lançamentos C/A/D (`unique (empresa_id, cod_lancamento)`); `valor_atualizado` = saldo; `baixado_em` |
| `cap_autorizacoes` | Cabeçalho da autorização (número, data, status, quem/quando) — prova |
| `cap_autorizacao_itens` | Cópia dos lançamentos autorizados — prova |
| `cap_antecipacoes_tratadas` | Antecipações marcadas como pagas fora do Neo Admin (motivo, quem; desfazível) |
| `cap_autorizacao_extras` | Pagamentos extras (fora do Consistem) da autorização: descrição, favorecido, valor; só em rascunho — prova |
| `cap_vw_pendentes` | View: abertos C/A com fornecedor, autorização ativa, tratada, fora do corte (a tela lê daqui) |
| Funções | `cap_criar_autorizacao`, `cap_adicionar_itens`, `cap_montar_rascunho`, `cap_autorizar`, `cap_cancelar`, `cap_remover_item`, `cap_incluir_extra`, `cap_remover_extra`, `cap_marcar_antecipacao_tratada`, `cap_desfazer_antecipacao_tratada`, `cap_salvar_parametros` |
| Configuração | `financeiro.contas-pagar.antecipacoes_a_partir_de` |
Migrations: `0121_cap_base.sql` (Fase 1), `0122_cap_autorizacoes.sql` (Fase 2), `0123_cap_fornecedores_contrapartes.sql` (Fase 4).
Edge Function: `cap-sincronizar-consistem` (ações `medir`, `simular`, `sincronizar`; `detalhar` na Fase 3).

## 9. Permissões (área Financeiro)
| Nível | Pode |
| --- | --- |
| consulta | ver lista, autorizações e imprimir |
| operador | atualizar do Consistem, montar rascunho, remover item de rascunho, marcar antecipação como tratada |
| gestor (diretoria) | tudo acima + **autorizar**, cancelar, alterar a data de corte |
Quem monta pode autorizar a própria autorização (fluxo real: a diretoria monta e autoriza).

## 10. Pontos em aberto
1. A diretoria terá nível gestor no Financeiro? (premissa: sim.)
2. Uma autorização por empresa; hoje só a Neo Formas tem `codigo_erp`.
3. Títulos contestados / "não pagar por ora": sem tratamento especial por enquanto (possível extra da Fase 4).
4. Cabeçalho do relatório usa razão social + CNPJ (o cadastro de empresas não tem endereço).
5. Tempo da leitura completa da API (~27 mil registros): medir na Fase 1; se passar de ~60 s, leitura incremental por janelas de emissão/vencimento.
6. Bug da listagem `lancamentoContasPagar` (HTTP 500): reportar à Consistem; o módulo não depende dele.
7. **Escrita da confirmação (CCFFB014) pela API depende da Consistem**: texto do chamado na seção 16. Enquanto isso, a confirmação é lida e cobrada na autorização (Fase 4d).
8. Semântica de `docConfirmado` confirmada por inferência (1/0/nulo) e pelos manuais; **conferir com o Alan** no CCFFB014 ("Visualizar Documentos Confirmados = Sim", vencimento 01–31/10/2026) se os 30 títulos abertos que a API devolveu com `1` são os confirmados lá.

## 11. Fases
0. Especificação (aprovada 09/10/2026). 1. Sincronização + lista unificada só leitura (**feita**). 2. Autorização, histórico e pendência (**feita**).
3. Relatório/impressão (**feita**). 4. Extras (abas Antecipações e Parâmetros, fornecedores como contrapartes, crédito D, agendamento). 4d. Confirmação no Consistem: leitura (**feita, 12/10/2026**); escrita quando a Consistem entregar a API (4d-2).

## 12. Fase 1 — o que foi feito (09/10/2026)
- Migration `0121_cap_base.sql` (aplicada em produção em 09/10/2026): módulo `financeiro.contas-pagar` ativo, parâmetro
  `financeiro.contas-pagar.antecipacoes_a_partir_de`, tabelas `cap_fornecedores` e `cap_lancamentos` (leitura por área; só a
  service role grava). Testes em `tests/db/cap-base.test.ts`.
- Edge Function `cap-sincronizar-consistem` (publicada): ações `medir`, `sincronizar { simular }` e `amostra`; operador do
  Financeiro ou acima. Lógica pura em `supabase/functions/_shared/consistem-pagar.ts` (normalização, classificação C/A/D,
  plano novos/alterados/baixados; testes em `lib/integracoes/consistem/consistem-pagar.test.ts`). Após gravar, lê o detalhe
  (`lancamentoContasPagar/{id}`) das antecipações ainda sem detalhe (até 150 por rodada): data de pagamento programada,
  portador, código de barras, Pix. Falha real abre a pendência "Falha na atualização do contas a pagar".
- Tela `/financeiro/contas-pagar` (Autorizar pagamento): cartões Títulos / Antecipações / Vencidos / Total; filtros por texto
  (fornecedor, CNPJ, documento, histórico), tipo, situação e período; tabela unificada ordenada por data de referência
  (vencidos primeiro), 100 por página; botões Medir / Simular / Atualizar do Consistem (operador). Regras puras em
  `lib/modulos/financeiro/contas-pagar/{pendentes,parametros,sincronizacao}.ts`.
- **Medido ao vivo (09/10/2026):** 26.980 lançamentos em 135 páginas, ~21 s de leitura da API. Primeira atualização gravou
  3.535 lançamentos (2.423 títulos R$ 20.911.373,98 · 48 antecipações R$ 483.910,44 · 1.064 créditos de fornecedor) e 1.346
  fornecedores; 9 registros recusados (tipo de lançamento vazio). Sem necessidade do plano B incremental.
- Fica para a Fase 2: seleção em lote, geração da autorização, view `cap_vw_pendentes`, aba Autorizações.

## 13. Fase 2 — o que foi feito (09/10/2026)
- Migration `0122_cap_autorizacoes.sql` (aplicada em produção): enum `cap_status_autorizacao` (rascunho → autorizada | cancelada);
  `cap_autorizacoes` (número sequencial sem buracos, quem/quando montou, autorizou e cancelou, motivo), `cap_autorizacao_itens`
  (cópia do lançamento no momento: prova, imutável; remoção só em rascunho com motivo; `baixado_consistem_em` anotado pela
  sincronização), `cap_antecipacoes_tratadas` (antecipação "já paga fora do Neo Admin", com motivo; desfazível); views
  `cap_vw_pendentes` (o que a tela lista, com autorização ativa e marcação de tratada) e `cap_vw_autorizacoes` (totais e nomes);
  funções `cap_criar_autorizacao`, `cap_autorizar`, `cap_cancelar`, `cap_remover_item`, `cap_marcar_antecipacao_tratada`,
  `cap_desfazer_antecipacao_tratada`, `cap_salvar_parametros`; gatilhos de regra (transição de status, imutabilidade dos itens),
  auditoria e bloqueio de delete; RLS por área. Testes em `tests/db/cap-autorizacoes.test.ts` (13 casos) e
  `lib/modulos/financeiro/contas-pagar/autorizacao.test.ts`.
- Telas: `Autorizar pagamento` ganhou caixas de marcação, barra "N itens · R$ X — Gerar autorização" (diálogo com data,
  observação e, para gestor, "Autorizar agora"), filtro "Pendentes de autorização / Incluir já autorizados e pagos fora" (padrão:
  pendentes), botão "Já paga fora" nas antecipações (com Desfazer); aba **Autorizações** (histórico com filtro por situação,
  totais por tipo, montada/autorizada por, baixados no Consistem X de N); página da autorização
  (`/financeiro/contas-pagar/autorizacoes/[id]`: cartões, seções Títulos e Antecipações, Autorizar em dois cliques, Cancelar com
  motivo, Remover item em rascunho, lista dos removidos).
- Edge Function: após cada rodada anota `baixado_consistem_em` nos itens cujo lançamento saiu dos abertos (e limpa se reabriu).
- **Testado ao vivo (09/10/2026):** autorização nº 1 (1 título + 1 antecipação da Acofer, R$ 3.128,94) gerada como rascunho,
  autorizada (pendência "Executar autorização de pagamento nº 1 — R$ 3.128,94" na Fila do dia, criticidade alta) e cancelada com
  motivo; itens voltaram à lista; 3 registros em `auditoria`. A nº 1 fica no histórico como cancelada (teste).
- Fica para a Fase 3: impressão/PDF. Para a Fase 4: abas Antecipações e Parâmetros (hoje a data de corte só muda pela função).

## 14. Fase 3 — o que foi feito (10/10/2026)
- **Página de impressão** `/imprimir/contas-pagar/autorizacao/[id]` (grupo de rota `app/(impressao)/`, sem a moldura do painel;
  exige login e acesso ao módulo): cabeçalho com razão social e CNPJ da empresa, "Autorização de pagamento nº N", data e hora
  de emissão, selo "RASCUNHO — SEM VALIDADE" ou "CANCELADA EM dd/mm/aaaa", observação, motivo do cancelamento; tabela
  **Títulos a pagar** (fornecedor e CNPJ, documento e lançamento, vencimento, histórico, valor) e tabela **Antecipações a
  fornecedor** (idem, com pagamento programado), subtotal de cada uma, **subtotais por tipo e total geral**; rodapé com quem
  montou, autorizou e cancelou e quando. Itens removidos do rascunho não entram.
- Botão "Imprimir / salvar PDF" (`window.print()`; a barra some no papel). "Salvar como PDF" é a impressora virtual do
  navegador. CSS em `app/globals.css` (`@media print`: A4 retrato, margens, cabeçalho de tabela repetido, linha não quebra).
- Na página da autorização: botão "Imprimir / salvar PDF" (abre em nova aba) e, para operador, **"Anexar PDF assinado"**
  (PDF ou imagem; `enviarAnexo`, módulo `financeiro.contas-pagar`, tabela `cap_autorizacoes`, tipo `autorizacao_assinada`)
  com a lista "Relatório assinado" (links assinados de 15 min). Anexo é prova: não se apaga; para trocar, envia outro.
- Sem dependência nova. Se um dia for preciso PDF gerado no servidor (anexo automático, e-mail), a opção é `@react-pdf/renderer`.
- Fica para a Fase 4: abas Antecipações e Parâmetros, fornecedores como contrapartes, crédito D, agendamento.

## 15. Fase 4a — borderô pela API, tela só com filtros, caixa disponível (10/10/2026)
- **Antecipação paga = tem borderô no Consistem** (regra confirmada pelo financeiro: toda paga tem borderô). A API não devolve
  o número, mas o filtro dinâmico da listagem (`campoFiltroDinamico=codBordero&valorFiltroDinamico=%`, campo da tabela
  `Cpg.MovimentoFornecedor`) devolve só os lançamentos com borderô, e aceita `dataEmissaoIni/Fim` junto. A Edge Function, a cada
  rodada, agrupa as datas de emissão das antecipações abertas em janelas (`janelasDeDatas`) e consulta cada janela
  (~1 s / 250 lançamentos); grava `cap_lancamentos.tem_bordero` (true = paga, false = a pagar, nulo = não verificada) e
  `bordero_visto_em`. Títulos não entram (borderô em título = pagamento parcial). Nada de planilha nem digitação.
  Migration `0123_cap_bordero.sql`: colunas, view `cap_vw_pendentes` com `tem_bordero`, `cap_criar_autorizacao` recusa
  antecipação paga, `cap_marcar_antecipacao_tratada` recusa paga. A data de corte continua, mas fica secundária.
- **Tela Autorizar pagamento abre só com os filtros:** período de **vencimento** de/até (antecipação: pagamento programado;
  sem data entra em qualquer período) com atalhos "Vencidos até hoje" e "Vencidos nos últimos 7/15/30 dias" (11/10/2026: só vencidos, a diretoria não antecipa pagamento),
  mais busca, tipo, situação e "mostrar pagos e já autorizados". Cartões e lista só depois de **Consultar**, já do recorte.
  Situação da antecipação: "paga (borderô no Consistem)", "a pagar · programada para dd/mm" ou "pagamento não verificado".
- **Soma fixa e caixa disponível:** a barra de seleção fica fixa no alto da lista (soma do que está marcado); campo "Caixa
  disponível" e resumo "Sobra R$ S" / "Ultrapassa o caixa em R$ E" (vermelho). Ultrapassar **não bloqueia**. O caixa é gravado
  em `cap_autorizacoes.caixa_disponivel` (`cap_criar_autorizacao` ganhou `p_caixa`; `cap_definir_caixa` ajusta em rascunho;
  gatilho impede alteração fora do rascunho); `cap_vw_autorizacoes` calcula `excedente`. Página da autorização: cartões
  "Caixa disponível" e "Excedente/Sobra", aviso em vermelho, botão "Alterar caixa" em rascunho. Relatório impresso: linhas
  "Caixa disponível", "Total autorizado", "Excedente/Sobra" e frase de fechamento quando ultrapassa.
- Testes: `tests/db/cap-bordero.test.ts`, `lib/.../pendentes.test.ts` (atalhos, paga/pendente), `autorizacao.test.ts`
  (`parseReais`, `compararComCaixa`), `consistem-pagar.test.ts` (`janelasDeDatas`).
- **Enviar no Slack (10/10/2026):** botão ao lado de "Imprimir / salvar PDF" na página da autorização (menos em cancelada). Copia a
  mensagem pronta (nº, data, empresa, totais por tipo, total, caixa/excedente, observação, quem autorizou e o link da autorização;
  `mensagemSlack` em `autorizacao.ts`) e abre o canal do financeiro (`financeiro.contas-pagar.slack_canal_url` em
  `configuracoes`; sem ele, abre o Slack no último canal). **O sistema nunca envia: o diretor cola e envia.** Sem token nem API do Slack.
- **Enviar no Slack com o PDF (11/10/2026):** o diretor (gestor) clica em "Enviar no Slack", vê a mensagem e confirma; o app
  gera o PDF no servidor (`lib/modulos/financeiro/contas-pagar/pdf-autorizacao.tsx`, `@react-pdf/renderer`) e a Edge Function
  `cap-enviar-slack` publica mensagem + PDF no canal do financeiro como o aplicativo "Neo Admin" do Slack (`files.uploadV2`).
  Segredo `SLACK_BOT_TOKEN` (xoxb-, escopos `chat:write` e `files:write`; o app precisa estar no canal) em Edge Functions > Secrets;
  canal em `configuracoes` (`financeiro.contas-pagar.slack_canal_id`, hoje C088FV34S4A; migration `0124_cap_slack.sql`).
  Registro do envio em `cap_autorizacoes.slack_enviada_em/por/permalink` (só a service role grava). Sem token/canal, o diálogo
  oferece o plano B: copiar a mensagem e abrir o canal. **Nada é enviado sem o clique e a confirmação do gestor.**
- **Código da autorização e Slack só com o PDF (11/10/2026, pedido do Alan):** migration `0125_cap_codigo_slack.sql`.
  - `cap_autorizacoes.codigo` = **data do pagamento no formato DDMMAA** (ex.: pagamento em 10/10/2026 → `101026`); a segunda
    autorização da mesma data recebe `101026-2`, a terceira `101026-3`… (`cap_codigo_para_data`). O `numero` sequencial continua
    por baixo (ordem e prova), mas as telas, o relatório, a pendência ("Executar autorização de pagamento 101026 — R$ X"), o nome
    do arquivo (`autorizacao-pagamento-101026.pdf`) e os avisos mostram o código. Código imutável depois de criado.
  - **No Slack vai somente o PDF**, sem texto: título do arquivo "Autorização de pagamento <código> · empresa · data".
    A função guarda `slack_file_id` e `slack_message_ts` para poder retirar depois.
  - **Cancelar uma autorização já enviada:** `cap_cancelar` devolve `enviada_slack`; o app chama `cap-enviar-slack` com
    `acao: "cancelar"`, que apaga o arquivo (`files.delete`) e a mensagem (`chat.delete`) e publica o aviso curto
    "Autorização de pagamento <código> CANCELADA em dd/mm/aaaa. Motivo: … O relatório anterior não vale mais."; grava
    `slack_retirada_em`. Se o Slack falhar, a autorização fica cancelada mesmo assim e a tela pede para apagar à mão.
- **Pagamentos extras na autorização (11/10/2026, Fase 4c):** migration `0126_cap_extras.sql` — tabela `cap_autorizacao_extras`
  (gatilho `fn_cap_extra_regras`: só em rascunho, imutável, remoção com motivo; auditoria; sem delete), funções
  `cap_incluir_extra`/`cap_remover_extra`, `cap_vw_autorizacoes` com `extras`/`total_extras` e `total` somando itens + extras,
  `cap_autorizar` com o total completo na pendência, `cap_criar_autorizacao` aceita rascunho vazio (não ao autorizar na hora).
  App: bloco "Pagamentos extras (fora do Consistem)" na página da autorização com "Incluir pagamento extra" (descrição,
  favorecido, valor; mostra o novo total e o efeito no caixa) e "Remover"; cartão "Pagamentos extras"; coluna "Extras" no
  histórico; botão "Novo rascunho só com extras" no histórico; PDF e impressão com a terceira tabela e o subtotal; Slack via o PDF.
  Regras puras: `resumirItens(itens, extras)` (`extras`, `lancamentos`, `geral`), `validarExtra`, `podeEditarExtras`.
- **Montagem na própria tela de seleção (11/10/2026, Fase 4c parte 2):** o Alan achou confuso ir ao histórico para criar o
  rascunho dos extras. Migration `0127_cap_montar_rascunho.sql`: `cap_adicionar_itens` (validações de inclusão num lugar só;
  `cap_criar_autorizacao` passa a chamá-la; item removido e marcado de novo é reativado), `cap_montar_rascunho(empresa,
  lançamentos, caixa, observação, extra, data)` (acha o rascunho em montagem da empresa ou cria; tudo numa transação).
  App: `carregarPendentes` devolve `rascunhos` (um por empresa); ações `montarRascunho` e `gerarAutorizacao` (substituem
  `criarAutorizacao`); barra fixa com Salvar parcial · Extras · Gerar autorização e a linha do rascunho em montagem; aviso do
  rascunho acima dos filtros; diálogo de extra compartilhado (`dialogo-extra.tsx`) entre a tela de seleção e a página da
  autorização; botão "Novo rascunho só com extras" retirado do histórico.
- **Grades mais limpas e ordenáveis (11/10/2026, Fase 4c parte 3, pedido do Alan):** nas duas grades (lista "Autorizar
  pagamento" e Títulos/Antecipações da autorização) saem as colunas Situação/Emissão, o CNPJ sob o fornecedor e o "lanç. N" sob
  o documento; clicar no título da coluna ordena (crescente ↔ decrescente; nulos por último). Lista de pendentes: ordem pela URL
  (`?ordem=fornecedor&dir=asc`), aplicada sobre a lista inteira antes de paginar (`lib/.../ordenacao.ts`, `cabecalho-ordenavel.tsx`);
  autorização: estado local (`autorizacoes/[id]/secao-itens.tsx`). Vencido sem destaque na linha (o filtro "Só vencidos" basta).
- **Excluir da lista e fim do "Anexar PDF assinado" (11/10/2026, pedido do Alan: "nós não assinamos nada"):** saem o botão
  "Anexar PDF assinado" e a seção "Relatório assinado". Entra **"Excluir da lista"**, só para autorização **cancelada** e só
  gestor: migration `0128_cap_excluir_da_lista.sql` (`excluida_em/por`, `motivo_exclusao`; `cap_excluir_da_lista`; gatilho
  permite só essa mudança numa cancelada, uma vez). Nada é apagado: a autorização some do histórico (`listarAutorizacoes`
  filtra `excluida_em is null`) e fica no banco com quem excluiu, quando e o motivo.

## 16. Fase 4d — confirmação dos documentos no Consistem (12/10/2026)

### Por que
No Consistem da Neo Formas o Contas a Pagar trabalha com **controle de liberação** (CCFFB000, campo "Controla Apresentação Documento"
= controle simples/rígido): cada documento precisa ser **confirmado** na tela **Confirmação de Documentos a Pagar (CCFFB014)** para
poder entrar no borderô (CCFFE065 → liberação CCFFE035 → remessa CCFFE100) e ser baixado. A diretoria autoriza no Neo Admin e o
financeiro repetia a marcação, documento por documento, no ERP. O pedido do Alan foi: dá para confirmar no Consistem a partir daqui?

### O que a API permite (análise de 12/10/2026)
- **Documentação oficial** (ajuda.consistem.com.br, Consistem API > Financeiro v1.0) e **Swagger ao vivo** do ambiente
  (`https://erp.neoformas.com.br/api/`, módulo Financeiro, v1.0.15): Contas a Pagar tem `GET/PUT /contasPagar`,
  `GET/PUT/DELETE /contasPagar/{id}`, `GET/PUT /lancamentoContasPagar`, `GET/PUT/DELETE /lancamentoContasPagar/{id}`. **Nenhuma
  operação de confirmação**; nenhum campo de confirmação/situação nos corpos `ContaPagarPut`, `novoLancamentoContaPagar` e
  `LancamentoContaPagarPut`. Os PUT são "Não Gera Contabilização" e reescrevem o documento: não servem para marcar confirmação.
  Os outros serviços do módulo (Cobrança Escritural, Integração Bancos, Administração Financeira) não tratam de contas a pagar.
- **Leitura**: a coluna `docConfirmado` da tabela por trás da listagem responde ao `campoFiltroDinamico` (como `codBordero`).
  Sondagem somente leitura em 12/10/2026, vencimentos de out/2026: 679 lançamentos; `docConfirmado = 1` → 396 (30 títulos C em
  aberto); `= 0` → 108 (todos em aberto); nulo → 175 (138 títulos C em aberto). `GET /contasPagar/{id}` e
  `GET /lancamentoContasPagar/{id}` não devolvem o campo. Interpretação: **1 = confirmado no CCFFB014**, 0 = passou pela tela e não
  foi marcado, nulo = nunca passou pela tela.
- **Conclusão**: escrever **não dá** hoje; ler dá. Decisão do Alan: entregar a leitura agora e pedir a escrita à Consistem.
- **Inclusão de lançamento (13/10/2026):** `PUT /lancamentoContasPagar` (`GerarLancamentoContaPagar`) passa a ser usado pelo módulo
  Cartão de crédito para o título de encargos da fatura (única escrita no ERP; ver `financeiro-cartao.md`, regras 31 a 36). A ação
  `exemplos_encargos` desta Edge Function (só leitura) devolve os encargos de cartão já lançados, com o detalhe completo.

### O que foi feito
- Migration `0129_cap_confirmacao.sql`: `cap_lancamentos.confirmado_consistem` (true/false/nulo = não verificado) e
  `confirmacao_vista_em`; `cap_autorizacao_itens.confirmado_consistem_em` (anotado/limpo pela sincronização; o gatilho de
  imutabilidade dos itens passa a aceitar essa coluna da service role, além de `baixado_consistem_em`); `cap_vw_pendentes` com as
  duas colunas; `cap_vw_autorizacoes` com `confirmados` (itens confirmados **e ainda não baixados**); `cap_autorizar` devolve
  `confirmados` e a pendência diz "confirme os documentos no Consistem (CCFFB014), monte o borderô, faça os pagamentos e dê baixa".
- Edge Function `cap-sincronizar-consistem`, passo **6d** (depois do borderô, antes do detalhe): universo = lançamentos em
  autorização ativa (sempre) + abertos C/A com vencimento em [hoje − 45, hoje + 30] (`DIAS_CONFIRMACAO_ATRAS/A_FRENTE`); títulos
  consultados por janelas de **vencimento** e antecipações (sem vencimento) por janelas de **emissão** (`janelasDeDatas`), sempre com
  `FILTRO_CONFIRMADO`; `planejarConfirmacoes` decide o que muda; anota `confirmado_consistem_em` nos itens das autorizações ativas.
  Resultado em `importacoes.mapeamento.confirmacoes` (janelas, chamadas, segundos, verificados, confirmados, não confirmados, não
  verificados, itens marcados/limpos). Falha vira `avisoConfirmacoes`; a rodada segue. **Nada é escrito no Consistem.**
- Telas: página da autorização ganhou o cartão **"Confirmados no Consistem X de N"** (N = itens não baixados; legenda "CCFFB014 ·
  verificado em …"), o aviso âmbar (só em autorização **autorizada**) "N documentos ainda não estão confirmados no Consistem" com o
  botão **Copiar lista** (uma linha por documento: fornecedor · documento · vencimento · valor, para marcar no CCFFB014) e, sob o
  valor de cada item, "confirmado no Consistem em dd/mm" (verde) ou "falta confirmar no Consistem (CCFFB014)" (âmbar). Histórico:
  coluna "Confirmados no Consistem". Lista Autorizar pagamento: o título pendente já confirmado mostra a linha verde "confirmado no Consistem (CCFFB014)" sob o
  fornecedor, e a situação dos não pendentes ganha o sufixo " · confirmado no Consistem" (só informação; não muda o que é pendente). PDF e impressão não mudam (confirmação é operação, não prova).
- Regras puras: `FILTRO_CONFIRMADO`, `planejarConfirmacoes` (`consistem-pagar.ts`); `resumirItens` com `confirmados` e
  `faltaConfirmar`, `situacaoDoItem`, `textoFaltaConfirmar` (`autorizacao.ts`); `descreverSituacao` (`pendentes.ts`). Testes nos
  três `.test.ts` e em `tests/db/cap-confirmacao.test.ts` (view, gatilho, contagem, pendência).
- **Publicado em 12/10/2026** (migration 0129 aplicada e registrada; função publicada). A primeira publicação quebrou na
  inicialização (`DIAS_CONFIRMACAO_ATRAS` faltava no módulo compartilhado: a função não sobe, não grava rodada nem pendência, e a
  tela só diz "Não foi possível atualizar do Consistem"). Lição: rodar `npx -y deno check supabase/functions/<função>/index.ts`
  antes de todo `functions deploy` (o `tsc` do app não cobre as funções).
- **Medição da primeira rodada (12/10/2026, 15:04 UTC):** leitura da API 20,7 s; borderôs 16 janelas/16 chamadas; **confirmação
  3 janelas, 3 chamadas, 2 s**, 416 títulos verificados (66 confirmados, 350 não confirmados, 0 não verificados). Os 30 títulos
  abertos de out/2026 com `docConfirmado = 1` da sondagem batem com o espelho. Antecipações (48 abertas) ficam "não verificadas"
  até entrarem numa autorização ativa (sem vencimento, só entram por essa via); não havia autorização ativa nessa rodada.

### Chamado à Consistem (texto para o Alan enviar)
> **Assunto:** API REST Financeiro v1.0 — confirmar documento do Contas a Pagar (CCFFB014) por API
>
> Usamos a API REST (`/api/financeiro/v10`, ambiente erp.neoformas.com.br, Swagger v1.0.15) para ler o Contas a Pagar e montamos
> fora do ERP a autorização de pagamento da diretoria. Nosso Contas a Pagar usa controle de liberação (CCFFB000), então cada
> documento autorizado precisa ser confirmado no CCFFB014 antes de entrar no borderô (CCFFE065). Hoje isso é redigitado.
>
> Pedido: uma forma de **confirmar/desconfirmar um documento por API**, por exemplo `PUT /financeiro/v10/contasPagar/{id}/confirmacao`
> (ou o campo `docConfirmado` aceito em `LancamentoContaPagarPut`), equivalente ao Gravar do CCFFB014, respeitando as mesmas regras de
> senha/usuário do controle rígido (CCFFB000F/CCFFB110). Observamos que a coluna `docConfirmado` já é visível pelo
> `campoFiltroDinamico` do `GET /contasPagar` (1/0/nulo), mas não é devolvida no `GET /{id}` nem aceita nos PUT.
>
> Enquanto isso: (1) há previsão para isso no roadmap da API? (2) existe no CCFFB014 ou em outra rotina uma importação de arquivo com
> os documentos a confirmar? (3) o `GET /lancamentoContasPagar` (lista) devolve HTTP 500 ("UNDEFINED … paginacao") no nosso ambiente
> desde 09/10/2026 — podem verificar?

### Fica para a 4d-2 (quando a Consistem responder)
Confirmação disparada por `cap_autorizar` (Edge Function `cap-confirmar-consistem`, item a item, com registro de sucesso/falha em
`cap_autorizacao_itens` e reprocesso pela sincronização). Descartado por ora: testar escrita não documentada via
`PUT /contasPagar/{id}` + `dadosCustomizados`.
- **Sincronização diária agendada (12/10/2026, migration `0134_crt_ciclos.sql`):** o pg_cron `cap-sincronizar-consistem-diario`
  chama a Edge Function todos os dias às 07:30 de Cuiabá (`cap_chamar_sincronizacao`, mesmo segredo do Vault do agendamento de
  Recebíveis). Necessário para o módulo Cartão de crédito detectar sozinho o pagamento da fatura (o título provisório some).
  A mesma Edge Function ganhou a ação só de leitura `titulos_vencimento` (nível consulta), usada pela conciliação do cartão.
