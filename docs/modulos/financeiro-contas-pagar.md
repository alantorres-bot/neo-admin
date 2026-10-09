# Módulo: Financeiro / Contas a pagar

Status: em construção — especificação aprovada em 09/10/2026; **Fase 1 entregue em 09/10/2026** (sincronização + lista unificada só leitura)

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
| Lista unificada do que está em aberto no Consistem: títulos (tipo C) e antecipações (tipo A), com filtros e totais por tipo; seleção e geração da autorização; histórico de autorizações (rascunho → autorizada → cancelada); pendência "Executar autorização" na Fila do dia; relatório para impressão/PDF; marcar antecipação como "já paga fora do Neo Admin"; data de corte para antecipações antigas | Pagar, dar baixa ou alterar qualquer coisa no Consistem (o Neo Admin só lê o ERP); "marcar como pago" no Neo Admin; conciliação da fatura do cartão (módulo futuro `financeiro.pagar_cartao`); projeções (tipo P) e baixas de antecipação (tipo B); autorização parcial de um título |

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
| **Autorizar pagamento** (`/financeiro/contas-pagar`) | Três cartões (Títulos, Antecipações, Total: quantidade e R$); filtros (fornecedor/documento, tipo, vencimento de/até, mostrar já autorizados); tabela unificada com caixa de marcação, selo Título/Antecipação, fornecedor, documento, emissão, vencimento (antecipação: pagamento programado), valor, histórico, situação ("Na autorização nº N — rascunho/autorizada", "Tratada"); barra "N itens · R$ X — Gerar autorização" (diálogo: data, observação; gestor vê "Autorizar agora"); "Atualizado do Consistem em …" + Simular/Atualizar |
| **Autorizações** (`/autorizacoes`) | Histórico: nº, data, status, itens, total títulos, total antecipações, montada por, autorizada por, baixados no Consistem X/N; filtro por status |
| **Autorização nº N** (`/autorizacoes/[id]`) | Cabeçalho e status; seção Títulos e seção Antecipações com totais; por item "baixado no Consistem em" ou "em aberto"; botões Autorizar (gestor), Cancelar (motivo), Remover item (só rascunho), Imprimir / salvar PDF |
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
| `cap_vw_pendentes` | View: abertos C/A com fornecedor, autorização ativa, tratada, fora do corte (a tela lê daqui) |
| Funções | `cap_criar_autorizacao`, `cap_autorizar`, `cap_cancelar`, `cap_remover_item`, `cap_marcar_antecipacao_tratada`, `cap_desfazer_antecipacao_tratada`, `cap_salvar_parametros` |
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

## 11. Fases
0. Especificação (aprovada 09/10/2026). 1. Sincronização + lista unificada só leitura (**feita**). 2. Autorização, histórico e pendência.
3. Relatório/impressão. 4. Extras (abas Antecipações e Parâmetros, fornecedores como contrapartes, crédito D, agendamento).

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
