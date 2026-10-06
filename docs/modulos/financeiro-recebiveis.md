# Módulo: Financeiro / Recebíveis

Status: aprovado para construção — versão 1, 02/10/2026
Código do módulo: `financeiro.recebiveis` · Prefixo das tabelas: `rec_`

## 1. Objetivo e premissas

A aplicação executa a rotina de contas a receber de ponta a ponta: recebe os títulos, envia boletos, confirma pagamentos, cobra atrasos e controla renegociações, pedindo decisão humana só onde há risco.

1. **Títulos:** sincronizados da **API do Consistem** (contas a receber em aberto; ver seção 9), com importação de relatório CSV/XLSX como plano B, ou lançados manualmente.
2. **Boletos:** sem API bancária. O boleto é gerado no banco/Consistem; o PDF é anexado na aplicação, que cuida do envio e do acompanhamento.
3. **Pagamentos:** sem retorno bancário. A API lista só títulos em aberto: o que some da lista vira pendência "Possível baixa" para conferência humana (data e valor). Baixa também por importação do relatório de títulos pagos ou manual com comprovante.
4. **Canais:** e-mail e WhatsApp.

## 2. Escopo

| Entra no MVP | Fica fora (fase 2) |
| --- | --- |
| Sincronização da carteira pela API do Consistem, importação de relatório (plano B) e cadastro manual | Baixa automática pela API (depende de a API expor títulos pagos) |
| Clientes, contatos de cobrança e contratos | Emissão automática de boletos |
| Upload do PDF do boleto e vínculo com o título | Baixa automática por retorno bancário (CNAB) |
| Envio de boleto por e-mail e WhatsApp, com registro | Negativação e protesto automático |
| Confirmação prévia de pagamento com o cliente | Portal do cliente |
| Régua de cobrança automática | Cobrança de locação com medição |
| Cálculo de encargos e carta de cobrança em PDF | |
| Simulação, aprovação e controle de renegociações | |
| Baixa por importação de títulos pagos ou manual | |
| Painel: aging, inadimplência, previsão | |
| Pendências na Fila do dia (núcleo) e, se configurado, no ClickUp | |

Títulos **cedidos** ficam marcados e fora da régua automática.

## 3. Ciclo de vida do título (estágios)

1. `importado` — verifica duplicidade (empresa + documento + parcela).
2. `aguardando_boleto` — falta PDF; alerta a partir de D-10.
3. `boleto_enviado` — registra canal, data, destinatário.
4. `confirmado_cliente` — cliente confirmou que o pagamento está programado.
5. `vencido` — passou da data sem baixa; entra na régua.
6. `promessa` — régua pausa até a data prometida; retoma se não houver baixa.
7. `em_renegociacao` — régua suspensa.
8. `renegociado` — substituído pelas parcelas do acordo.
9. `pago` — baixa por importação ou manual.
10. `juridico` — fora da cobrança administrativa.
11. `cancelado`.

Marcadores paralelos: `cedido` (fora da régua), `contestado` (régua pausada), cliente `estrategico` (toda cobrança exige aprovação).

## 4. Régua padrão (editável, pode variar por cliente)

| Marco | Ação | Canal | Aprovação |
| --- | --- | --- | --- |
| D-7 | Envio do boleto (se não enviado) | E-mail + WhatsApp | Automático |
| D-3 | Pedido de confirmação de programação do pagamento | WhatsApp | Automático |
| D-1 | Sem confirmação: pendência para contato telefônico | Interno | — |
| D+1 | Lembrete cordial de vencimento | E-mail + WhatsApp | Automático |
| D+5 | Segundo aviso, pedindo previsão | WhatsApp | Automático |
| D+10 | Cobrança formal com demonstrativo de encargos | E-mail | Operador |
| D+15 | Carta de cobrança em PDF (encargos + dados bancários) | E-mail | Gestor |
| D+30 | Proposta de renegociação ou notificação extrajudicial | E-mail | Gestor |
| D+45 | Encaminhamento ao jurídico | Interno | Gestor |

Regras:
- Vários títulos do mesmo cliente no mesmo marco = **uma** mensagem.
- Pausa: promessa, renegociação, contestação, cedido.
- Envios em dias úteis, 8h–18h (America/Cuiaba).
- **Início controlado:** nas primeiras semanas todos os marcos geram rascunho (configuração global `modo_rascunho = true`).

## 5. Renegociação

1. Simulação: saldo atualizado na data-base; cenários à vista com desconto, parcelado, entrada + parcelas.
2. Alçadas: desconto e prazo máximos por perfil (valores configuráveis, a definir).
3. Aprovação registrada.
4. Termo de acordo gerado de modelo (texto fornecido pelo jurídico — não redigir cláusulas por conta própria).
5. Títulos originais → `renegociado`; novas parcelas criadas com `origem = 'acordo'` e pendência para lançar no Consistem.
6. Quebra: atraso acima de `dias_tolerancia_quebra` → acordo `quebrado`, alerta ao gestor.

## 6. Telas

1. **Fila do dia** (inicial): boletos faltando, mensagens aguardando aprovação, clientes sem resposta, promessas vencendo, acordos em risco. Ação direta em cada item.
2. **Painel:** aging (a vencer, 1–15, 16–30, 31–60, +60), inadimplência %, previsão de recebimento por semana, top 10 devedores. Filtros por empresa, cliente, contrato.
3. **Carteira:** lista de títulos com estágio, vencimento, valor, valor atualizado, último contato; ações em lote.
4. **Ficha do cliente:** contatos, títulos, histórico de mensagens/interações, promessas, acordos, contratos.
5. **Boletos:** upload em lote; extrair linha digitável, valor e vencimento do PDF e sugerir o título correspondente.
6. **Renegociações:** simulador, propostas, aprovações, acordos ativos/quebrados.
7. **Importações:** títulos em aberto e pagos, com pré-visualização (novos, alterados, baixados, divergentes) antes de gravar.
8. **Configurações:** régua, modelos de mensagem, encargos padrão, alçadas, usuários.

Permissões (núcleo, área `financeiro`): `gestor` aprova cartas e acordos; `operador` opera; `consulta` só lê.

## 7. Modelo de dados

Ver `supabase/migrations/0100_financeiro_recebiveis.sql`.

- **Do núcleo:** empresas, contrapartes (clientes), contatos, mensagens, interações, anexos (PDF do boleto), pendências, importações, auditoria.
- **Do módulo:** rec_reguas, rec_regua_marcos, rec_clientes_config, rec_contratos, rec_titulos, rec_acordos, rec_acordo_titulos, rec_promessas, rec_mensagem_titulos.
- **View:** `rec_vw_titulos` (dias de atraso, faixa, valor atualizado).

## 8. Automações (Edge Functions + pg_cron)

| Função | Gatilho | Faz |
| --- | --- | --- |
| importar-titulos | Upload | Cria/atualiza pela chave de conciliação; aponta divergências |
| importar-pagos | Upload | Baixa títulos, encerra régua, cumpre promessas/parcelas de acordo |
| motor-regua | Dias úteis 8h | Calcula marco de cada título; gera mensagens agrupadas (rascunho ou envio) |
| enviar-mensagem | Mensagem aprovada | Gmail e/ou WhatsApp com boleto anexo; grava status/erro |
| webhook-whatsapp | Resposta do cliente | Registra interação; botões "Já programei", "2ª via", "Quero negociar" atualizam estágio |
| resumo-semanal | Segunda 7h30 | Aging, recebido x previsto, acordos em risco; rascunho no Gmail |

## 9. Integração com o Consistem (API de contas a receber)

Decisão do usuário (06/10/2026): usar a API REST do Consistem, a mesma já em produção no **gestor-akf** (`consistem_api.py`) e no NEOControl.

- **Acesso:** base `https://erp.neoformas.com.br/api`; header `Authorization: <token do CSMEN050>` (sem "Bearer") e header `empresa: <código>`. Paginação por `continuationToken`; retry em HTTP 429.
- **Endpoints:** `GET /financeiro/v10/contasReceber?tipoTitulo=0` (0 = em aberto: `codTitulo, codCliente, codPortador, dataEmissao, dataVenc, valorTitulo`) e `GET /cadastrosgerais/v10/cliente?situacao=1` (nome e CPF/CNPJ; a API de títulos só traz o código do cliente).
- **Segredo:** `CONSISTEM_API_KEY` em *Supabase > Edge Functions > Secrets* (nunca em arquivo versionado nem no chat). Opcional: `CONSISTEM_BASE_URL`.
- **Empresa:** `empresas.codigo_erp` (migration 0101) liga a empresa do Neo Admin ao código dela no Consistem. Sem código, não sincroniza.
- **Função:** `supabase/functions/rec-sincronizar-consistem` (lógica pura e testada em `supabase/functions/_shared/consistem-receber.ts`). Chamável por gestor do Financeiro ou pelo agendamento diário (seção 12). Ações: `sincronizar` (com `simular: true` só mostra o que faria) e `amostra` (nomes e tipos dos campos da API, sem valores).
- **Regras:**
  - Chave de conciliação: empresa + `codTitulo` (+ parcela, hoje sempre `1`). Título novo entra como `importado`; título existente só tem emissão, vencimento e valor atualizados.
  - Cliente: casa por `contrapartes.codigo_erp`; senão por CPF/CNPJ (e passa a ter o código); senão cria como `cliente`. Documento inválido ou repetido entra sem documento.
  - **Nunca baixa sozinho.** Título aberto (origem importação) que a API deixou de listar vira pendência "Possível baixa: <título>" na Fila do dia; se voltar à lista, a pendência é cancelada.
  - Lista vazia da API com títulos abertos no banco = provável falha: nada é alterado.
  - Pago, renegociado, cancelado e origem manual/acordo nunca são alterados pela sincronização; se a API ainda os lista como abertos, só contam como divergência.
  - Cada execução grava em `importacoes` (`arquivo = 'api:consistem'`; `linhas_baixadas` = possíveis baixas).
- **Plano B (relatório):** o importador genérico (CSV/XLSX, modelo de mapeamento salvo) continua para títulos pagos e para contingência. Amostra real em `docs/amostras/` (fora do Git).

## 10. Fases internas do módulo

1. **Fase 1 — Base do módulo:** migration 0100, configuração de clientes no módulo, contratos (encargos, cedido), menu Financeiro > Recebíveis. (Login, empresas e contrapartes já vêm do núcleo.)
2. **Fase 2 — Carteira:** sincronização pela API (Edge Function `rec-sincronizar-consistem`, **feita**), tela Carteira e botão "Sincronizar agora" (**feitos**, `app/(plataforma)/financeiro/recebiveis`), agendamento (pg_cron, **feito**; de hora em hora em dias úteis desde a etapa 1a), entrada do título pela NF e pendência "Anexar boleto" (**feitas**, seção 14), anexo do boleto, mensagem pronta e registro do envio (**feitos**, seção 15), rascunho no Gmail (código pronto, falta autorizar a caixa, seção 16), confirmação de pagamento (**feita**, seção 17), importação de títulos pagos, contratos (percentuais de multa e juros por cliente) e testes de encargos.
3. **Fase 3 — Boletos:** upload, leitura do PDF, vínculo com títulos.
4. **Fase 4 — Régua e e-mail:** modelos, motor da régua, Fila do dia, rascunhos no Gmail.
5. **Fase 5 — Painel e ficha do cliente.**
6. **Fase 6 — Renegociação.**
7. **Fase 7 — WhatsApp** (depende de número e modelos aprovados pela Meta).
8. **Fase 8 — Carga real e testes com 3 a 5 clientes.**

## 11. Pontos em aberto

- Alçadas de desconto e prazo.
- Modelo do termo de acordo e da notificação (validar com advogado).
- Provedor/número do WhatsApp Business.
- Quem aprova mensagens no dia a dia.
- Empresas do grupo incluídas no início.
- Títulos de locação mensal no MVP ou depois.

## 11. Tela Carteira (Financeiro > Recebíveis)

Feita em 06/10/2026. Rota `/financeiro/recebiveis`; lê a view `rec_vw_titulos` (dias de atraso, faixa e valor atualizado) pela RLS do usuário.

- **Quem vê:** qualquer nível na área Financeiro. **Quem sincroniza:** gestor ou acima (botões "Simular" e "Sincronizar agora"; a ação de servidor e a Edge Function conferem de novo).
- **Cartões:** carteira em aberto, a vencer, vencido e vencido atualizado (multa + juros até hoje). Somados em centavos, sobre TODA a carteira em aberto, independente do filtro da lista.
- **Aging:** a vencer, 1–15, 16–30, 31–60 e mais de 60 dias (faixas da view); clicar numa faixa filtra a lista.
- **Lista:** 50 por página, ordenada por vencimento (mais antigos primeiro); busca por cliente, código do Consistem ou documento, e filtro por faixa. Mostra estágio, "Cedido" e "Contestado".
- **Valor atualizado:** usa multa 2% + juros 2% a.m. pro rata dia quando não há contrato cadastrado (padrão da view). Fica sinalizado na tela com asterisco até os contratos serem cadastrados.
- **Pendente:** a transição automática do estágio `importado` para `vencido` é da régua (fase 4); hoje os vencidos continuam como "Importado".

## 12. Agendamento diário da sincronização

Feito em 06/10/2026 (migration `0102`). Todo dia às **07:00 de Cuiabá** (cron `0 11 * * *`, UTC-4, sem horário de verão) o `pg_cron` executa `rec_chamar_sincronizacao()`, que faz um POST (`pg_net`) na Edge Function. Para trocar o horário ou pausar: `select cron.schedule('rec-sincronizar-consistem-diario', '<cron em UTC>', 'select public.rec_chamar_sincronizacao()')` ou `select cron.unschedule('rec-sincronizar-consistem-diario')`.

- **Autenticação do agendamento:** cabeçalho `x-sincronizacao-segredo`, valor aleatório (64 hex) guardado em dois lugares: Vault do banco (`rec_sincronizar_segredo`) e segredo de Edge Functions `SINCRONIZACAO_SEGREDO`. A service role NÃO fica no banco. A função tem `verify_jwt = false` (em `supabase/config.toml`) e faz toda a conferência sozinha (segredo do agendamento, service role ou gestor logado).
- **Falha:** sincronização real que falha (API fora, token inválido, empresa recusada) cria a pendência **"Falha na sincronização com o Consistem"** (criticidade alta, módulo Recebíveis, sem responsável), uma só por vez; a próxima sincronização bem-sucedida a cancela sozinha. Os dados nunca são alterados quando a API falha ou devolve lista vazia.
- **Registro:** cada execução grava em `importacoes` (`arquivo = 'api:consistem'`, sem usuário quando agendada). O retorno HTTP do último disparo fica em `net._http_response`.

**Configurar em um projeto novo (produção)** — uma vez, depois de `supabase db push` (0101 e 0102):
1. Segredo `CONSISTEM_API_KEY` (token do CSMEN050) em Edge Functions > Secrets, e `empresas.codigo_erp` preenchido.
2. Gerar um segredo aleatório e gravá-lo como `SINCRONIZACAO_SEGREDO` (`npx supabase secrets set SINCRONIZACAO_SEGREDO=<valor>`).
3. No SQL do banco: `select vault.create_secret('<url da função>', 'rec_sincronizar_url');` e `select vault.create_secret('<mesmo valor do passo 2>', 'rec_sincronizar_segredo');`.
4. Publicar a função: `npx supabase functions deploy rec-sincronizar-consistem`.
5. Conferir: `select jobname, schedule, active from cron.job;` e disparar uma vez com `select public.rec_chamar_sincronizacao();` (ver `net._http_response` e `importacoes`).

## 13. Entrada por pedido/NF — Etapa 0 (vínculo provado com dados reais, 06/10/2026)

Ação `amostra_notas` da Edge Function `rec-sincronizar-consistem` (só leitura; devolve contagens, formatos e nomes de campos, nunca dados de cliente). Janela de 30 dias, Neo Formas:

| Medida | Resultado |
| --- | --- |
| NFs de saída emitidas (situação 2) | 68; 35 com chave NF-e; 37 ligam a títulos em aberto |
| Títulos em aberto | 157; 134 com `notaFiscal`; 60 com chave NF-e; 45 emitidos na janela |
| **Título ↔ NF na janela** | **88,9% (40 de 45)**: 8 por chave NF-e, 32 por nº da nota + cliente; 0 ambíguos |
| Sem casamento (5) | títulos da série `Z…` sem `notaFiscal` (23 no total): lançamentos que não vêm de NF |
| `codTitulo` | = nº da nota + sufixo de parcela (letra; `U` = única). 40 de 40 casados contêm o nº da nota |
| `numeroDuplicatas` | sempre vazio: não serve como vínculo |
| Valor do título | ≤ valor total da NF em 40 de 40 (parcelas somam a NF) |

**Pedido (correção de 06/10/2026, depois de gravar os dados).** O cabeçalho da NF (`codPedido`) só vem preenchido em 28 das 68 NFs (11 das 45 NFs ligadas a títulos). As NFs do tipo 12, que são 32 das 37 que geram título, **não trazem pedido**: os itens têm a estrutura `itemPedidoAgrupado[]` (`codPedido`, `itemPedido`, `qtdFaturadaItemPedido`), mas o `codPedido` e o `itemPedido` dentro dela vêm **vazios** nas 83 NFs sem pedido no cabeçalho (janela de 60 dias). A primeira leitura da Etapa 0 contou só a presença da lista e concluiu o contrário; o teste com valores preenchidos desfez isso. Logo, **o pedido só é conhecido para as NFs que o trazem no cabeçalho**; para as demais o vínculo termina na NF.

Cadeia que funciona hoje: `notaFiscalSaida` (`codNumNota`, `chaveAcesso`, `codPedido` quando existe) → `contasReceber` (`chaveNfeNotaFiscal`; senão `notaFiscal` + `codCliente`). Para ligar as NFs sem pedido ao pedido seria preciso outro caminho (listar `pedidoVenda` e casar por cliente, data e valor; ou um filtro por NF que a API não mostrou), a investigar só se o pedido virar necessário.

Consequências para o desenho:
- O gatilho da esteira é a **NF emitida / título novo**, não o pedido; o pedido entra como informação ligada à NF **quando a NF o traz** (lista de pedidos por NF, vazia nas demais). Nada na esteira (boleto, confirmação, cobrança) depende do pedido.
- Vínculo título → NF em dois degraus provados (chave da NF-e; nº da nota + cliente; ambíguo não liga). O prefixo de `codTitulo` não foi usado: não foi provado para os títulos sem `notaFiscal`. Títulos sem NF (série `Z…`) entram na esteira sem pedido e sem NF.
- Tipos de nota que geram duplicata: 7 de 22 (`possuiDuplicata`); nem toda NF vira título.

## 14. Entrada do título pela NF — Etapa 1a (feita em 06/10/2026)

- **Gatilho:** a sincronização roda de **hora em hora, segunda a sexta, 08:00–18:00 de Cuiabá** (migration 0104; substituiu o job diário das 07:00). Título novo = NF emitida no Consistem; o atraso máximo é uma hora.
- **O que cada rodada faz a mais:** consulta as NFs de saída (situação 2) dos últimos 7 dias (ou desde a emissão do título mais antigo ainda sem nota ligada, até 60 dias), liga cada título à sua NF (chave da NF-e; senão nº da nota + cliente; ambíguo não liga), guarda a NF em `rec_notas_saida` com os pedidos que ela traz e completa em `rec_titulos` a nota, a chave, o portador e o tipo de cobrança. Se a consulta de NFs falhar, a rodada inteira falha sem gravar nada (para o título não entrar na esteira sem NF e deixar de ser "novo").
- **Entrada na esteira:** título novo a partir da data `financeiro.recebiveis.esteira_a_partir_de` (tabela `configuracoes`; hoje `2026-10-06`) nasce em `aguardando_boleto` com `entrou_esteira_em`. **Trava:** mais de 50 títulos novos de uma vez (banco vazio, reimportação) não entram na esteira nem abrem pendência. Títulos anteriores à data nunca abrem pendência.
- **Pendência "Anexar boleto(s): NF 1395 — Cliente (4 parcelas)":** uma por NF (título sem NF, uma por título), calculada do banco para **todo título em `aguardando_boleto` sem pendência aberta** (idempotente: uma rodada que falhou no meio é consertada pela seguinte). Prazo = vencimento mais próximo menos 8 dias (o envio da régua é D-7); se já passou, hoje. Criticidade: até 3 dias do vencimento crítica, até 10 alta, depois normal. A descrição lista documento, vencimento e valor de cada parcela e os pedidos da NF. Quem conclui a pendência e move o estágio é a etapa 1b (anexo do boleto).
- **Tela:** coluna "Pedido / NF" e filtro "Aguardando boleto (n)" em Financeiro > Recebíveis.
- **Testado com a API real:** os 156 títulos em aberto foram completados (60 ligados a NFs na janela de 60 dias; os 74 mais antigos não têm a NF na janela e ficam sem vínculo); NF 1395 (4 parcelas) apagada e recriada pela sincronização entrou em `aguardando_boleto` com uma pendência (alta, prazo D-8, pedido 199), e a 2ª rodada não duplicou nada.
- **Produção:** ajustar `esteira_a_partir_de` para o dia da virada antes de ligar o job horário (o job só roda onde há `pg_cron`; os segredos do agendamento estão na seção 12).

## 15. Boleto, mensagem pronta e registro do envio — Etapa 1b (feita em 06/10/2026)

Ficha da NF em `/financeiro/recebiveis/<id de uma parcela>` (a pendência "Anexar boleto" e a coluna Documento da Carteira levam até ela). Mostra as parcelas da mesma NF juntas.

- **Anexar boleto** (operador ou acima): um PDF ou imagem por parcela, enviado ao bucket privado `anexos` (caminho `financeiro.recebiveis/rec_titulos/<id>/…`, tipo `boleto`) e registrado em `anexos`. Anexo não se apaga: "Substituir" envia outro e vale o mais recente. Link de abertura assinado (15 min). **Linha digitável** opcional, validada só pelo tamanho (47 dígitos, ou 48 em convênio); não confere dígito verificador.
- **Mensagem pronta:** modelos `Envio de boleto — e-mail` (assunto + corpo, termina em "Atenciosamente," sem assinatura) e `Envio de boleto — WhatsApp`, semeados na migration 0105 em `modelos_mensagem` (editáveis). Variáveis: `{contato} {cliente} {referencia} {parcelas} {linhas_digitaveis} {total} {qtd_parcelas}`. O contato é o que tem a finalidade `boleto` (ou o primeiro ativo; com vários, há seletor). Botões "Copiar E-mail" / "Copiar WhatsApp". **O sistema não envia nada**; o rascunho no Gmail está na seção 16.
- **Registrar o envio** ("Marcar como enviado"): função de banco `rec_marcar_boleto_enviado` (migration 0105, SECURITY INVOKER, numa transação, com a RLS de quem chama). Exige parcelas em `aguardando_boleto` **e com boleto anexado**; passa para `boleto_enviado` (+ `boleto_enviado_em`), grava uma `interacoes` (canal, descrição com contato e observação, usuário) por parcela e **conclui a pendência "Anexar boleto"** da NF quando nenhuma parcela dela continua aguardando. Pendência que está com outra pessoa não é concluída por operador (o envio fica registrado); gestor conclui. Pode-se enviar parcelas em momentos diferentes.
- **Fora desta etapa:** leitura da linha digitável a partir do PDF e confirmação de pagamento (etapa 1c). O rascunho no Gmail é a etapa 1b-2 (seção 16).
- **Testado:** 10 testes de banco da função (permissões, transação, pendências), 27 de lógica pura, e na interface com a API real: 4 boletos anexados, linha digitável inválida recusada, envio parcial (pendência segue aberta) e envio do restante (pendência concluída com data e autor).

## 16. Rascunho no Gmail — Etapa 1b-2 (feita e testada em 06/10/2026)

Botão **Criar rascunho no Gmail** na ficha da NF (operador ou acima). **O sistema nunca envia:** a única chamada de escrita é `drafts.create` (escopo `gmail.compose`, que não lê nem envia e-mails). Uma pessoa confere o rascunho e envia no Gmail; depois registra o envio na ficha (seção 15).

- **Fluxo:** a ação de servidor valida (parcelas aguardando, **todas com boleto anexado**, contato com e-mail, modelo ativo), grava a mensagem em `mensagens` como `rascunho` (autor carimbado pelo banco) e chama a Edge Function `rec-rascunho-gmail`. Ela confere que quem chama é operador e autor da mensagem, baixa os boletos do bucket, monta o e-mail (MIME UTF-8, assunto codificado, boletos em anexo, limite de 20 MB), renova o token de acesso e cria o rascunho. Depois guarda o id do rascunho em `mensagens.id_externo`, liga as parcelas em `rec_mensagem_titulos` e grava uma interação "Rascunho do e-mail do boleto criado no Gmail" por parcela. Falhou (Gmail, credencial): a mensagem vira `descartada` e a tela mostra o motivo.
- **Texto:** é exatamente o que a ficha mostra (mesmo modelo, mesmas parcelas); o remetente é `GMAIL_REMETENTE`, o destinatário é o e-mail do contato escolhido.
- **Credenciais:** segredos de Edge Functions `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_REMETENTE`. O rascunho aparece na caixa de quem autorizou. Passo a passo e script em `docs/GMAIL_CREDENCIAIS.md` / `scripts/gmail-autorizar.mjs` (o token é obtido no terminal do usuário e gravado direto no Supabase; não passa por chat nem arquivo). Cliente OAuth do tipo "App para computador", tela de consentimento **Interna** (Workspace).
- **Testado:** 19 testes de lógica pura (MIME, cabeçalhos sem injeção, renovação do token, `drafts.create`, erros sem vazar segredos) e, na interface com a API real, o caminho completo até o Gmail: botão desabilitado com o motivo enquanto falta boleto, e depois do anexo a função devolve "O Gmail ainda não está configurado (faltam: …)" e a mensagem é descartada. **Teste real (caixa `alantorres@neoformas.com.br`, cliente de teste):** o botão criou o rascunho com assunto, corpo, destinatário e o PDF em anexo (conferido no MIME, `application/pdf`); a mensagem ficou em `mensagens` (`rascunho`, com o id do rascunho), a parcela ligada em `rec_mensagem_titulos` e a interação no histórico. A caixa que recebe os rascunhos é a de quem autorizou: para mudar, rode o script de novo.

## 17. Confirmação de pagamento — Etapa 1c (feita em 06/10/2026)

Traz para dentro do Neo Admin a rotina que existe hoje no ClickUp (skill `confirmacoes-pagamento`): contatar os clientes de **maior valor** 3–4 dias antes do vencimento para confirmar a programação do pagamento. **O ClickUp não é alterado:** a skill mensal continua criando as tarefas "Confirmação - <Cliente>" na lista `901326573943`; o espelho no ClickUp fica para quando o usuário decidir aposentar a skill (evita tarefas duplicadas).

- **Quem entra:** a cada rodada da sincronização, o cliente cuja soma de parcelas **em aberto, ainda sem confirmação, não cedidas nem contestadas, vencendo de hoje a 7 dias** chega a `financeiro.recebiveis.confirmacao_valor_minimo` (R$ 25.000, o corte da skill) ganha **uma** pendência "Confirmar pagamento: <Cliente> — vence DD/MM" (vencimento mais próximo). Estágios considerados: `importado`, `aguardando_boleto`, `boleto_enviado`. Nunca repete para o mesmo cliente e vencimento, nem depois de concluída.
- **Pendência:** prazo = vencimento − 4 dias (se já passou, hoje); criticidade alta quando faltam até 2 dias. A descrição traz as parcelas, uma observação para quem envia (parcelas de vencimentos seguintes, que **não** vão na mensagem) e a **mensagem de WhatsApp pronta**, com o texto da skill (sem emojis; "Olá, <Nome>!" quando o cliente tem contato com finalidade `confirmacao` ou `cobranca`). Uma parcela, ou várias do mesmo vencimento (lista e total).
- **Tela** `/financeiro/recebiveis/confirmar/<cliente>` (o link da pendência): parcelas da janela, mensagem com botão **Copiar WhatsApp** (o sistema não envia), e o resultado do contato:
  - **Cliente confirmou:** parcelas marcadas passam para `confirmado_cliente`, a interação fica no histórico e a pendência é concluída.
  - **Sem resposta:** o estágio não muda, a interação fica no histórico, a pendência de confirmação é concluída e abre **"Ligar para confirmar pagamento: <Cliente> — vence DD/MM"** (alta, prazo hoje), o contato telefônico previsto como D-1 da régua.
  - Ambos pela função de banco `rec_registrar_confirmacao` (migration 0106), numa transação, com a RLS de quem chama (operador do Financeiro ou acima). Pendência que está com outra pessoa só o gestor conclui; o registro vale mesmo assim.
- **Fora desta etapa:** data prometida em `rec_promessas` (a tabela ainda não tem política de acesso; a data vai na observação), envio automático por WhatsApp (fase 7), espelho no ClickUp.
- **Testado:** 12 testes de lógica pura, 9 de banco da função e, na interface com a API real, dois clientes reais da janela: "Cliente confirmou" (2 parcelas) e "Sem resposta" (abre a ligação); a 2ª sincronização não repetiu as pendências. Os registros de teste foram desfeitos (as interações não se apagam; ficou uma nota de "teste" no histórico).

**Credenciais criadas em 06/10/2026:** cliente OAuth "App para computador" `Neo Admin Gmail` no projeto Google Cloud do Gestor AKF (público Interno, Gmail API ativada), autorizado pela caixa `alantorres@neoformas.com.br`; segredos `GMAIL_*` gravados nos segredos de Edge Functions do Supabase de teste. Lição: o Google só mostra o segredo do cliente na janela de criação; "Add secret" em cliente existente não mostrou o valor, então a troca de segredo foi feita excluindo o cliente e criando outro.

## 18. Baixa de títulos — Etapa 2 (feita em 06/10/2026)

Quando um título sai da lista de abertos do Consistem, a sincronização abre a pendência **"Possível baixa: <título>"**. A tela **Baixas a conferir** (`/financeiro/recebiveis/baixas`, botão na Carteira com a contagem) mostra esses títulos. **O sistema nunca dá baixa sozinho:** ele só reúne a evidência; quem confirma é uma pessoa (operador do Financeiro ou acima).

- **Evidência do Consistem:** a sincronização consulta `contasReceber?tipoTitulo=1` (pagos) só para os títulos que saíram da lista e guarda `consistem_pago_em`, `consistem_valor_pago` (título + juros − desconto), `consistem_tipo_baixa` e `consistem_verificado_em`. Data inválida (`0`, `0001-01-01`) é ausência de evidência. Havendo mais de um pagamento para o mesmo `codTitulo`, vale o mais recente.
- **Dois grupos na tela:**
  - **O Consistem informa o pagamento:** lista com caixas de seleção e **Dar baixa nos marcados (n)**. Vem marcado só o pagamento recente (até 7 dias) e de valor igual ao do título. Valor diferente (juros ou desconto) e pagamento antigo (possível baixa lançada com atraso, ou código de título reutilizado) vêm **desmarcados, com aviso**.
  - **Sem informação de pagamento:** um a um, em **Resolver**: *Pago* (data e valor; observação obrigatória se o valor difere) ou *Cancelado* (motivo obrigatório).
- **Banco (migration 0107):** `rec_registrar_baixa` (um título) e `rec_baixar_titulos` (lote de até 100, **tudo ou nada**, o erro cita o título). Validam: data obrigatória, não futura, não anterior à emissão; valor > 0; título ainda não encerrado. Gravam estágio, data e valor, uma `interacoes` (`baixa` ou `cancelamento`, com o autor) e concluem a pendência "Possível baixa". `SECURITY INVOKER`: vale a RLS de quem chama. Na baixa em lote, data e valor vêm do **banco**, não da tela.
- **Hoje (06/10/2026):** 19 títulos (R$ 3,77 mi) aguardam conferência: 18 com evidência (3 recentes, 15 antigos, com aviso) e 1 sem informação de pagamento. Nenhum foi baixado: a decisão é do usuário.
- **Testado:** 14 testes de banco (validações, permissões, tudo ou nada, pendências) e 16 de lógica pura da evidência; na interface, com títulos do cliente de teste: baixa em lote marcando só o de teste, baixa manual (erro "Informe a data do pagamento." e depois sucesso), cancelamento (erro sem motivo e depois sucesso). Os 19 títulos reais ficaram intactos.

## 19. Régua de cobrança — D+1, D+5 e D+10 (feita em 06/10/2026)

Primeira entrega da Fase 4 (seção 10). **O sistema nunca envia:** a cada sincronização ele abre a pendência **"Cobrar D+n: <Cliente> — venc. DD/MM"** na Fila do dia, com o texto pronto; uma pessoa copia a mensagem (ou cria o rascunho no Gmail), envia e **registra o resultado** na tela `/financeiro/recebiveis/cobrar/<cliente>`.

- **Marcos desta entrega:** D+1 lembrete cordial (e-mail e WhatsApp), D+5 segundo aviso pedindo previsão (WhatsApp), D+10 cobrança formal com **demonstrativo de multa e juros** (e-mail, prioridade alta). D+15 (carta PDF), D+30 (proposta de renegociação) e D+45 (jurídico) ficam para a etapa seguinte: dependem de textos do jurídico.
- **Quem entra:** título vencido, **com vencimento a partir da data de corte** (`financeiro.recebiveis.regua_a_partir_de`, hoje 06/10/2026; vazio = régua desligada), nos estágios `importado`, `aguardando_boleto`, `boleto_enviado`, `confirmado_cliente`, `vencido`, e `promessa` depois de vencida a promessa. A **carteira antiga** (61 títulos, R$ 16,3 mi, 48 com mais de 60 dias, na data da entrega) fica **fora da régua automática**: a tela do cliente avisa quantos títulos antigos ele tem, para decidir caso a caso (cedido, contestado, acordo).
- **Não cobra:** cedido, contestado, em renegociação, jurídico, pago/cancelado, régua pausada (promessa até a data, inclusive) e **título que saiu da lista de abertos do Consistem** ("Possível baixa" em aberto: provavelmente já pagou).
- **Um título, o maior marco atingido** (7 dias de atraso = D+5). Vários títulos do mesmo cliente no mesmo marco viram **uma** pendência. Não se repete para o mesmo cliente, marco e vencimento mais antigo, nem depois de concluída. Se o cliente deixa de ter o que cobrar (pagou, contestou, prometeu), as pendências "Cobrar" abertas são canceladas.
- **Trava:** mais de 40 pendências novas de uma vez = provável erro de configuração (data de corte antiga): nada é aberto e o aviso fica no registro da execução (`importacoes.mapeamento.regua`).
- **Passa a `vencido`:** na sincronização, o título `importado`, `boleto_enviado` ou `confirmado_cliente` com vencimento passado vira `vencido` (`aguardando_boleto` fica como está: o boleto ainda é a pendência). Ao ligar, 61 títulos mudaram de estágio.
- **Encargos:** `calcularEncargos` (TypeScript puro, `_shared/cobranca.ts`) usa a mesma conta da view `rec_vw_titulos` (multa 2% + juros 2% ao mês pro rata dia, sobre o valor original; total arredondado uma vez); **teste de paridade com o banco**. O D+10 usa o padrão 2% + 2% enquanto não há contratos com percentuais próprios (`rec_contratos` já é lido quando existir); a tela e a pendência avisam para **confirmar no contrato antes de enviar**.
- **Tela do cliente:** uma seção por marco com a mensagem de WhatsApp (botão copiar, contato com WhatsApp), o e-mail (assunto e corpo, botão copiar, contato com e-mail, "Criar rascunho no Gmail" com o boleto de cada parcela que o tiver em anexo), o demonstrativo por título no D+10 e o formulário de resultado. E-mails terminam em "Atenciosamente," sem assinatura.
- **Resultado (`rec_registrar_cobranca`, migration 0108, `SECURITY INVOKER`, tudo ou nada):** *Enviei a cobrança* (fica no histórico); *Cliente prometeu pagar* (data futura, até 90 dias: títulos viram `promessa`, a régua pausa até a data e `rec_promessas` guarda o valor); *Cliente contestou* (motivo obrigatório: títulos marcados como contestados, régua pausada). Conclui a pendência do marco. A migration também criou as políticas de `rec_promessas` (leitura no Financeiro, escrita de operador; sem exclusão).
- **Fora desta entrega:** modelos de mensagem editáveis na tela (os textos estão em `_shared/cobranca.ts`), carta PDF, retomada automática de promessa não cumprida além de voltar a cobrar após a data, marcação de `rec_promessas.cumprida`, WhatsApp oficial, ficha do cliente completa.
- **Testado:** 31 testes de lógica pura (marcos, encargos, elegibilidade, agrupamento, textos), 12 de banco (resultados, validações, permissões, tudo ou nada, paridade dos encargos com a view) e, ao vivo no Supabase de teste, com o **cliente de teste**: a sincronização abriu a pendência "Cobrar D+1" só para ele, a tela mostrou WhatsApp e e-mail, o rascunho foi criado no Gmail (só rascunho), "promessa" sem data foi recusada e com data pausou a régua e concluiu a pendência. Para o teste, a data de corte foi baixada por alguns minutos e dois títulos reais de 05/10 foram pausados e **restaurados em seguida** (ficam na auditoria); hoje, com o corte em 06/10, nenhum cliente real tem pendência de cobrança. A primeira cobrança real será para vencimentos de 06/10 (D+1 em 07/10).
