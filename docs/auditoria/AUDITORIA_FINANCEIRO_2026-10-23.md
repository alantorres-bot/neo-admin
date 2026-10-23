# Auditoria técnica e funcional — Recebíveis, Cobrança, Faturamento Filial, Filial e AKF

Data: 23/10/2026 · Escopo: só investigação e documentação (nenhum código, dado ou configuração foi alterado).
Base: código do branch `main` (commit `11b3f54` + alterações locais não commitadas, que não tocam estes módulos).

**Legenda das marcações**
- **[CÓDIGO]** comportamento confirmado lendo o código (arquivo:linha).
- **[DOC]** está só na especificação (`docs/modulos/*.md`), sem confirmação no código.
- **[INFERIDO]** dedução a partir do código, ainda não confirmada com dados ou execução.
- **[FALHA]** defeito comprovado pela leitura do código (cenário concreto descrito).
- **[RISCO]** hipótese ou fragilidade que precisa de validação com dados reais ou com o Consistem.

**Testes executados (locais, banco em memória, sem tocar produção):** `lib/modulos/financeiro/recebiveis`, `lib/modulos/financeiro/cobranca`
(10 arquivos, 110 testes) e `tests/db/baixa-titulos`, `regua-cobranca`, `forma-pagamento` (39 testes): **todos passam**. Os testes
cobrem as regras puras e as funções de banco isoladas; **nenhum** cobre a Edge Function de sincronização ponta a ponta, execuções
simultâneas ou a resposta real da API do Consistem.

---

## 1. Visão geral: quem é dono de quê

| Pergunta | Resposta |
|---|---|
| Fonte da informação financeira | **O Consistem (ERP).** O Neo Admin não emite título nem boleto, não recebe retorno bancário e não dá baixa sozinho. [CÓDIGO] `supabase/functions/rec-sincronizar-consistem/index.ts:15-19` |
| Onde o título vive no Neo Admin | Uma cópia em `rec_titulos` (migration `0100_financeiro_recebiveis.sql:69-94`), atualizada pela sincronização. |
| O que é "Cobrança" | **Não é uma entidade.** É um conjunto de telas (`app/(plataforma)/financeiro/cobranca/`) que calcula filas na hora a partir de `rec_titulos`, mais as **pendências** "Cobrar D+n" que a sincronização grava em `pendencias`, mais o **histórico** em `interacoes` (`tipo` = `cobranca`, `promessa`, `posicao`, `contestacao`). Não existe tabela de "cobrança", nem saldo próprio. [CÓDIGO] |
| Granularidade da cobrança | Uma pendência/linha de fila = **cliente + unidade + marco** (D+1, D+5, D+10…), agrupando vários títulos. [CÓDIGO] `supabase/functions/_shared/cobranca.ts:189-214` |
| Recebíveis × Cobrança | Mesmo dado, mesmas tabelas, mesma permissão (área Financeiro). A separação de 08/10/2026 é só de menu/rotas (migration `0118_modulo_cobranca.sql`, 5 linhas). As pendências de cobrança continuam gravadas com `modulo = 'financeiro.recebiveis'` e só são **exibidas** em Cobrança pelo gatilho `fn_fin_pendencias_cobranca` (`0180_fin_pendencias_cobranca.sql:16-25`). |

### Fluxo ponta a ponta (confirmado no código)

```
Consistem (contasReceber tipoTitulo=0, a cada 30 min, seg–sex 07:00–18:30 Cuiabá)
   │  pg_cron → rec_chamar_sincronizacao() → pg_net POST → Edge rec-sincronizar-consistem
   ▼
planejarSincronizacao(API × banco)  ── novos / alterados / enriquecidos / presentes / possíveis baixas / divergentes
   │
   ├─ novos → rec_titulos (aguardando_boleto se ≤ 50 novos e data ≥ esteira_a_partir_de; senão importado)
   ├─ alterados → UPDATE vencimento / valor / emissão (silencioso: só auditoria)
   ├─ sumiu da lista → busca na lista de PAGOS (tipoTitulo=1) → evidência → pendência "Possível baixa"
   ├─ voltou à lista → apaga evidência, cancela "Possível baixa", interação voltou_aberto
   ├─ 5b pendência "Anexar boleto" (janela 30 dias) ─────────────► Cobrança > Boletos a anexar / A enviar
   ├─ 5c pendência "Confirmar pagamento" (≥ R$ 25 mil em 7 dias) ─► Cobrança > Confirmar pagamento
   ├─ 7b estágio → vencido; pendência "Cobrar D+n" ───────────────► Cobrança > Cobrar
   └─ 7c pendências "Cadastrar contato"/"Conferir cadastro"
   ▼
Pessoa: anexa boleto, cria rascunho no Gmail (nunca envia), registra envio / confirmação / cobrança / promessa / posição / contestação
   ▼
Pessoa: "Baixas a conferir" → rec_registrar_baixa / rec_baixar_titulos → estágio pago ou cancelado (fim)
```

---

## 2. Recebíveis

### 2.1 Origem e criação dos títulos [CÓDIGO]

- **Única origem automática:** a Edge Function `rec-sincronizar-consistem`. Os endpoints são `financeiro/v10/contasReceber?tipoTitulo=0`
  (abertos), `comercial/v10/notaFiscalSaida` (NFs de 7 a 60 dias), `cadastrosgerais/v10/cliente` (só quando há título novo) e
  `contasReceber?tipoTitulo=1` (pagos, só quando algum título sumiu) (`index.ts:267`, `321`, `386`, `642`).
- **Chave de conciliação:** `empresa_id + documento + parcela` (único em `0100:91`). A parcela é **sempre `'1'`**: a API não traz
  campo de parcela e o sufixo do `codTitulo` (A, B, U…) já distingue as parcelas (`_shared/consistem-receber.ts:161-163`).
- **Inserção idempotente:** `upsert ... ignoreDuplicates` (`index.ts:438`): duas execuções ao mesmo tempo não duplicam o título.
- **Cliente:** casa por `contrapartes.codigo_erp`, depois por CPF/CNPJ; se não achar, cria. Documento inválido ou repetido entra
  **sem documento** (`index.ts:201-251`), o que gera a pendência "Conferir cadastro" (passo 7c).
- **Entrada na esteira:** `decidirEntrada` (`consistem-receber.ts:400-406`): o título novo nasce `aguardando_boleto` só se a
  configuração `esteira_a_partir_de` estiver preenchida, já tiver chegado **e** a rodada tiver no máximo 50 títulos novos
  (`LIMITE_ENTRADA_LOTE`, `:392`); caso contrário nasce `importado`.
- **Lançamento manual e por acordo:** a coluna `origem` aceita `manual` e `acordo` (`0100:85`), mas **não há tela nem função que
  crie esses títulos**. A sincronização ignora esses títulos (`consistem-receber.ts:314`).
- **Importação por planilha (plano B):** [DOC] só (spec §1, §9). Não há importador de títulos abertos ou pagos ligado a `rec_titulos`.

### 2.2 Entidades

| Entidade | Tabela | Observação |
|---|---|---|
| Título/parcela | `rec_titulos` | valor, vencimento, estágio, `cedido`, `contestado`, `regua_pausada_ate`, `data_pagamento`, `valor_pago`, `forma_pagamento` (0116), `unidade` (coluna calculada, 0109/0110), evidência `consistem_*` (0107), `nota_saida_id` (0103) |
| Cliente | `contrapartes` (núcleo) + `rec_clientes_config` | `confirmar_pagamento`, `exige_carta_cessao` |
| NF de saída | `rec_notas_saida` | só as NFs ligadas a algum título |
| Boleto | `anexos` (tipo `boleto`) + `rec_titulos.linha_digitavel` | vale o anexo mais recente |
| Histórico | `interacoes` (núcleo) | nunca apagado (regra 4) |
| Promessa/posição | `rec_promessas` | `cumprida` **nunca é preenchida** [CÓDIGO: nenhuma escrita no repositório] |
| Mensagem/rascunho | `mensagens` + `rec_mensagem_titulos` | `status` fica `rascunho` para sempre (o sistema não sabe se foi enviado) |
| Contrato (multa/juros) | `rec_contratos` | existe, lido pela régua; **sem tela de cadastro** e hoje sem linhas [DOC §39] |
| Acordos/renegociação | `rec_acordos`, `rec_acordo_titulos` | **sem uso**: nenhuma tela, função ou leitura no código |
| View de leitura | `rec_vw_titulos` | `dias_atraso`, `faixa`, `valor_atualizado` |

### 2.3 Estágios e transições efetivamente implementados

Enum `rec_estagio` (`0100:7-9`). Transições que existem no código:

| De | Para | Quem/onde | Condição |
|---|---|---|---|
| (novo) | `aguardando_boleto` ou `importado` | sincronização (`index.ts:435`) | `decidirEntrada` |
| `aguardando_boleto`, `importado` | `boleto_enviado` | `rec_marcar_boleto_enviado` (0115/0116), `rec_marcar_dados_enviados` | boleto anexado (ou forma transferência) |
| `importado`, `aguardando_boleto`, `boleto_enviado` | `confirmado_cliente` | `rec_registrar_confirmacao` (0117) | janela de confirmação |
| `importado`, `boleto_enviado`, `confirmado_cliente` | `vencido` | sincronização 7b (`index.ts:717-718`) | `vencimento < hoje` |
| cobráveis | `promessa` | `rec_registrar_cobranca` resultado `promessa`/`posicao` (`0167`) | data futura (≤ 90 dias) ou posição (−30 a +90 dias) |
| qualquer não encerrado | `pago` / `cancelado` | `rec_registrar_baixa` (`0107:41-108`) | data ≤ hoje e ≥ emissão; valor > 0; motivo se valor difere |

**Não implementados** (o enum existe, nada grava): `em_renegociacao`, `renegociado`, `juridico`. Não há **reabertura** de título
pago/cancelado, **estorno** de baixa, **baixa parcial**, nem forma de **desfazer a contestação** (`contestado = true` só é gravado,
nunca volta a `false`: grep em migrations e `app/`).

Observações:
- `aguardando_boleto` **não** vira `vencido` (de propósito, `cobranca.ts:106`). Um título com vencimento prorrogado para o futuro
  continua `vencido` (não há transição de volta); a Carteira classifica pela data (`carteira.ts:144`), então o efeito visual é pequeno.
- `promessa` não volta a `vencido`: depois da data, continua `promessa` e volta a ser cobrável (`cobranca.ts:183-184`).

### 2.4 Valores, saldo e encargos

- **Valor do título** = `valorTitulo` da API, gravado em `rec_titulos.valor`. Quando o Consistem muda o valor, a sincronização
  **sobrescreve** o valor (`consistem-receber.ts:297`, `index.ts:444`), sem interação no histórico (só a auditoria genérica).
- **Saldo em aberto:** não existe coluna de saldo. Para o Neo Admin, saldo = `valor` enquanto o estágio não é encerrado; ao dar
  baixa, o título sai inteiro da carteira. A única dedução é a da AKF (antecipação parcial, `akf_vw_valor_restante`), usada na
  confirmação e na cobrança (`index.ts:114-122`, `cobranca/dados.ts:124`).
- **Encargos:** multa 2% + juros 2% a.m. pro rata dia sobre o valor original, sem carência, quando não há `rec_contratos`
  (view `0107:19-38`; `cobranca.ts:166-173`, com teste de paridade). Os percentuais padrão são **suposição declarada** do módulo,
  sinalizada na tela (`cobrar/[id]/page.tsx:118`) e na pendência. Pela regra 7 do projeto, precisam de confirmação contratual.
- **Valor recebido:** `valor_pago` gravado na baixa; na baixa em lote vem de `consistem_valor_pago` = título + juros − desconto
  informado pela API (`consistem-receber.ts:538-546`).

### 2.5 Baixa, cancelamento e reabertura

- **Detecção:** o título de origem `importacao` que não volta na lista de abertos vira "Possível baixa" (`consistem-receber.ts:313-316`).
  Se a API devolver lista **vazia** com títulos abertos no banco, a rodada aborta (`index.ts:296-300`).
- **Evidência:** procurada na lista de pagos por `codTitulo`; havendo vários registros, vale o **mais recente**
  (`consistem-receber.ts:549-559`). Gravada uma vez; não é atualizada depois (`index.ts:637`).
- **Baixa:** sempre humana, por `rec_registrar_baixa` (um) ou `rec_baixar_titulos` (lote de até 100, tudo ou nada). Na baixa em lote
  a data e o valor vêm do banco, não da tela (`cobranca/baixas/acoes.ts:27-63`). Conclui a pendência "Possível baixa".
- **Cancelamento:** mesma função, resultado `cancelado`, motivo de 5+ caracteres exigido na ação (`baixas/acoes.ts:79`).
- **Sem exclusão:** não há política de DELETE em `rec_titulos` (`0100:164`).

### 2.6 Sincronização: frequência, erros, idempotência

- **Agenda:** `0,30 11-22 * * 1-5` UTC = a cada 30 min, seg–sex, 07:00–18:30 de Cuiabá (`0166:19`). Além disso, o gestor pode
  "Sincronizar agora". **Sem trava** entre as duas: podem rodar ao mesmo tempo.
- **Autenticação do job:** segredo próprio no Vault + `SINCRONIZACAO_SEGREDO` (`index.ts:958-961`); a service role não fica no banco.
- **Transação:** **não há.** A rodada é uma sequência de dezenas de gravações independentes pelo PostgREST. As etapas 7b (régua) e 7c
  (cadastro) e a busca de evidência engolem o erro e seguem (`index.ts:656-659`, `808-811`, `882-885`); o resto aborta no meio,
  deixando gravado o que já foi feito, e abre a pendência "Falha na sincronização" (`index.ts:1073-1076`).
- **Pendências duplicadas:** o índice único `uq_pendencia_origem (modulo, referencia_tabela, referencia_id, titulo)` só para as
  **abertas** (`0001_nucleo.sql:122-123`) impede duplicata aberta. Em duas rodadas simultâneas, a segunda falha no INSERT e vira
  "Falha na sincronização" (não duplica, mas gera alarme falso).
- **Registro:** cada rodada grava em `importacoes` (`index.ts:888-903`).

---

## 3. Cobrança

### 3.1 O que é cobrado e quando [CÓDIGO]

- **Elegível (`cobravel`, `cobranca.ts:179-186`):** estágio em `importado, aguardando_boleto, boleto_enviado, confirmado_cliente,
  vencido, promessa`; não contestado; não em "Possível baixa"; vencimento ≥ data de corte (`regua_a_partir_de`) e < hoje; promessa só
  depois da data de pausa. Cedido à AKF **entra** desde 15/10/2026.
- **Marco:** o maior marco atingido pelos dias de atraso (`cobranca.ts:152-156`). Um título descoberto com 7 dias de atraso vai
  direto para D+5 (o D+1 não aparece).
- **Agrupamento:** cliente + unidade + marco = uma pendência e uma mensagem.
- **Marcos editáveis:** `rec_regua_marcos` (0120), lidos a cada rodada; falha de leitura = marcos padrão (`index.ts:735`).
- **Trava:** mais de 40 pendências novas numa rodada = nenhuma é aberta (`index.ts:767-770`).

### 3.2 Duas fontes de verdade para "o que cobrar"

1. **Pendências "Cobrar D+n"** (Fila do dia/Central), gravadas pela sincronização. Não se repetem para o mesmo **texto de título**
   (`Cobrar D+5: <Cliente> — venc. dd/mm`), aberto ou concluído (`index.ts:757-765`).
2. **Fila "Cobrar" da tela** (`cobranca/dados.ts`), recalculada a cada abertura. Tira a parcela que já tem interação daquele marco
   (`tarefas.ts:150-160`, `dados.ts:172-182`).

As duas usam a mesma regra pura, mas cortam o "já feito" de forma diferente (texto da pendência × histórico por parcela), por isso
podem divergir (ver F4 e F5).

### 3.3 Resultado registrado (`rec_registrar_cobranca`, versão vigente em `0167`)

| Resultado | Efeito |
|---|---|
| `enviada` | só interação `cobranca` |
| `promessa` | estágio `promessa`, `regua_pausada_ate` = data, linha em `rec_promessas` |
| `posicao` | estágio `promessa`, pausa até data (ou hoje) + 5 dias, linha em `rec_promessas` |
| `contestou` | `contestado = true` (permanente) |

Em todos: uma interação por parcela e **conclusão de todas as pendências "Cobrar D+n" abertas daquele cliente e unidade**, qualquer
que seja o vencimento (`0167:248-251`), mesmo que a pessoa tenha marcado só parte das parcelas.

### 3.4 Envio e integrações

- **O sistema nunca envia** [CÓDIGO]: WhatsApp = link `wa.me` com o texto (`tarefas.ts:262-270`); e-mail = **rascunho** no Gmail
  (`rec-rascunho-gmail`, só `drafts.create`). Cada clique cria um novo rascunho; criar o rascunho **não** registra a cobrança.
- **Sem integração bancária, CNAB, gateway, WhatsApp oficial ou ClickUp** nestes módulos. [CÓDIGO]

### 3.5 Valores apresentados

- Total da mensagem = soma do `valor` (ou do restante com a Neo quando há antecipação parcial). D+10 informa o total atualizado com
  encargos (contrato, se houver; senão 2% + 2% a.m.).
- O texto da **pendência** é congelado na criação; a **tela** recalcula na hora. Valor diferente entre os dois é esperado quando o
  título muda depois da pendência.

---

## 4. Integração Cobrança × Recebíveis — respostas às 14 perguntas

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Responsável pela informação financeira original | Consistem; no Neo Admin, `rec_titulos` (Recebíveis). Cobrança não tem dado próprio. [CÓDIGO] |
| 2 | Tempo real ou cópia | As telas leem `rec_titulos` em tempo real; `rec_titulos` é cópia do Consistem com atraso de até 30 min (só em dias úteis, 07:00–18:30). As **pendências** são fotografias com texto congelado. [CÓDIGO] |
| 3 | Identificadores | Pendência de cobrança: `referencia_tabela='contrapartes'`, `referencia_id` = cliente; o vínculo com os títulos está **só no texto** da descrição. Interação: `referencia_id` = título. Rascunho: `rec_mensagem_titulos` (sem `marco_id`). [CÓDIGO] |
| 4 | Título pago depois de criada a cobrança | Some do Consistem → "Possível baixa" na rodada seguinte → sai da régua e da fila Cobrar; se o cliente não tem mais o que cobrar, a pendência é cancelada (`index.ts:792-807`). **Rascunho já criado no Gmail continua lá e pode ser enviado.** [CÓDIGO] |
| 5 | Baixa parcial | **Não modelada.** Ver F2. [RISCO] |
| 6 | Cancelado / estornado / prorrogado / renegociado | Cancelado no ERP: some → "Possível baixa" sem evidência → pessoa cancela. Estorno de baixa no ERP: o título volta aberto, mas o Neo Admin não reabre (F1). Prorrogação: vencimento sobrescrito sem histórico; régua recalcula; pendência antiga pode ficar (F5). Renegociação no Neo Admin: inexistente. [CÓDIGO] |
| 7 | Pagamento por outro canal durante a cobrança | Igual ao item 4, com atraso de até 30 min **e** dependente de o Consistem já ter dado baixa. Fim de semana: nada atualiza. |
| 8 | Impedir cobrança após quitação | Exclusão de "Possível baixa" + estágio encerrado. Não há conferência no momento de criar o rascunho além do recálculo da fila. |
| 9 | Eventos repetidos / simultâneos / falhas | Upsert de títulos idempotente; pendências protegidas pelo índice único das abertas; funções de registro em transação; **sincronização sem transação nem trava**; baixa sem `FOR UPDATE` (F8). |
| 10 | Rotinas de sincronização | Uma: a cada 30 min, seg–sex, 07:00–18:30. Erro → pendência "Falha na sincronização" (uma por vez), cancelada pela próxima rodada bem-sucedida. Falhas da régua/cadastro/evidência só ficam em `importacoes.mapeamento` (F7). |
| 11 | Histórico atualizado quando o recebível muda | Só para troca de portador e volta à lista de abertos (`index.ts:468-483`). Mudança de valor e de vencimento **não** entra no histórico. |
| 12 | Valor da cobrança diferente do saldo | Sim: pendência com texto antigo; valor do ERP com baixa parcial (F2); D+10 com encargos padrão sem contrato. |
| 13 | Mais de uma cobrança ativa para o mesmo título | Sim, sem ser intencional (F5). |
| 14 | Idempotência, transações, restrições | Ver item 9 e §2.6. |

---

## 5. Constatações — Recebíveis e Cobrança (por severidade)

**F1 · [FALHA → corrigida na 0184] Título encerrado no Neo Admin nunca é reaberto, mesmo voltando em aberto no Consistem.**
`planejarSincronizacao` manda o encerrado presente na API para `divergentes` e segue (`consistem-receber.ts:289-291`); o número só vai
para `importacoes.linhas_divergentes` (`index.ts:900`). Sem pendência, sem aviso na tela.
*Cenário:* operador baixa por engano um título em "Baixas a conferir" (ou o Consistem estorna a baixa) → o título continua aberto no
ERP, mas sai da Carteira, do Painel, da régua e das filas para sempre. Não existe função de reabertura.

**F2 · [RISCO alto] Baixa parcial e saldo.** Não há saldo nem baixa parcial no modelo. Dois caminhos, ambos ruins, dependendo de como
a API se comporta (a validar com o Consistem):
- se `valorTitulo` da lista de abertos for o **saldo**, o valor do título é reduzido em silêncio (`index.ts:444`), sem histórico, e a
  Carteira perde o valor original;
- se for o **valor original**, o pagamento parcial é invisível: o título segue cobrado pelo valor cheio.
Quando o título finalmente sai da lista, a evidência pega **só o pagamento mais recente** (`consistem-receber.ts:556`), e a baixa em
lote grava esse valor como `valor_pago` do título inteiro (`baixas/acoes.ts:44-49`). Há aviso "valor difere" na tela, mas a baixa
passa.

**F3 · [FALHA] Deduplicação de pendências pelo texto, sem o cliente.** A checagem de existência de "Cobrar D+n" e "Confirmar
pagamento" filtra só pelo título da pendência (`index.ts:595`, `761-762`), sem `referencia_id`.
*Cenário:* dois cadastros com o mesmo nome (a própria sincronização cria cliente duplicado "sem documento" quando o CNPJ é repetido,
`index.ts:238-241`) com títulos no mesmo marco e mesmo vencimento → só o primeiro recebe pendência. Também: o título usa `dd/mm` sem o
ano (`cobranca.ts:144`, `218`), então em outubro de 2027 uma pendência concluída de 2026 com o mesmo cliente, marco e dia bloqueia a
nova.

**F4 · [FALHA] Pendência "Cobrar" não volta quando o mais antigo é pago, mas uma nova abre com outro texto.** A identidade da
pendência inclui o vencimento mais antigo do grupo (`cobranca.ts:217-219`). Se o título mais antigo é baixado e sobram outros no mesmo
marco, o texto muda e a sincronização abre **outra** "Cobrar D+5" para o mesmo cliente, enquanto a antiga continua aberta (só é
cancelada se o cliente sair da régua, `index.ts:800-802`).

**F5 · [FALHA] Pendências de marcos anteriores não são encerradas quando o título avança de marco.** Quem não registrou o D+1 continua
com "Cobrar D+1" aberta quando o título chega ao D+5 (o cliente ainda está na régua e o marco D+1 ainda existe, `index.ts:800-802`).
Resultado: duas ou três pendências abertas de cobrança para os mesmos títulos. A tela "Cobrar", por outro lado, mostra só o marco
atual. Fila do dia e aba Cobrar ficam com números diferentes.

**F6 · [RISCO] Rascunhos no Gmail sem vínculo com o estado do título.** O rascunho é uma fotografia; se o cliente paga antes de a
pessoa enviar, o rascunho continua na caixa e pode ser enviado. Cada clique cria um novo rascunho (sem bloqueio por marco), e criar o
rascunho não registra a cobrança: a fila continua mostrando o cliente até alguém clicar em "Enviei". `mensagens.status` fica
`rascunho` para sempre. Risco de cobrança dupla ou de cobrar quem já pagou.

**F7 · [RISCO] Falhas silenciosas e execução parcial da sincronização.**
- Régua, cadastro e evidência engolem erros e só gravam o aviso em `importacoes.mapeamento` (`index.ts:656-659`, `808-811`, `882-885`):
  um erro persistente na régua para toda a cobrança automática **sem** pendência de falha.
- Sem transação: erro no meio (ex.: passo 5c) deixa títulos e pendências da rodada pela metade; com várias empresas, uma que falha
  interrompe as seguintes (`index.ts:1064-1066`).
- O job chama a função por `pg_net` com timeout de 120 s (`0102:44`); se a Edge Function morrer por tempo, nem a pendência de falha é
  aberta. Ninguém lê `net._http_response`.
- Lista **parcial** da API (página faltando, registros recusados por valor zero) não é barrada: só a lista totalmente vazia é
  (`index.ts:298`). Os títulos faltantes viram "Possível baixa" e **saem da cobrança** até voltarem.

**F8 · [RISCO → corrigido na 0184] Concorrência na baixa.** `rec_registrar_baixa` lê o estágio sem `FOR UPDATE` (`0107:58`) e atualiza sem condição de
estágio (`0107:83`). Duas baixas simultâneas do mesmo título passam as duas: a última sobrescreve data e valor, e ficam duas
interações "baixa".

**F9 · [RISCO → corrigido na 0184] Atualização direta de `rec_titulos` pela RLS.** A política `rec_titulos_alterar` libera UPDATE de qualquer coluna para
operador do Financeiro (`0100:162-163`). Valor, vencimento ou estágio podem ser mudados fora das funções (só fica a auditoria
genérica); as validações de `rec_registrar_baixa` podem ser contornadas. O gatilho de campos existe só para o usuário restrito à
unidade (spec §35).

**F10 · [FALHA] Contestação sem volta.** `contestado = true` não tem caminho de retorno (nenhuma função ou tela). O título contestado
fica fora da régua para sempre, inclusive depois de a contestação ser resolvida.

**F11 · [RISCO] Títulos que nunca entram na esteira.** Rodada com mais de 50 títulos novos (`LIMITE_ENTRADA_LOTE`) grava todos como
`importado` (`consistem-receber.ts:404`), e não há reprocessamento: esses títulos nunca terão "Anexar boleto". Ex.: volta após uma
semana de API fora do ar, ou faturamento grande de fim de mês.

**F12 · [RISCO] Limites de leitura nas telas.** Leituras com `.limit(500)` / `.limit(1000)` sem paginação: lista de "Possível baixa"
na tela do cliente (`cobrar/[id]/dados.ts:51`, todos os clientes, limite 500) e na fila (`cobranca/dados.ts:75`), histórico por lote
de 100 títulos (`dados.ts:176`). Passando do limite, título que saiu do Consistem volta a aparecer para cobrar, ou o "já cobrado"
some e a cobrança reaparece. Hoje os volumes estão longe (19 possíveis baixas na spec §18).

**F13 · [RISCO] Mudanças do ERP sem histórico.** Mudança de valor ou de vencimento (prorrogação) entra só na auditoria genérica, não em
`interacoes` (`index.ts:442-465`). A ficha do título não mostra que o vencimento mudou.

**F14 · [DOC × CÓDIGO] Funcionalidades da especificação que não existem.** Renegociação/acordos (§5, tabelas sem uso), jurídico,
carta D+15/D+30/D+45, importação de títulos pagos (plano B), lançamento manual, `rec_promessas.cumprida`, ficha de contratos,
webhook e envio de WhatsApp, resumo semanal. Os estágios `em_renegociacao`, `renegociado` e `juridico` aparecem na Carteira
(`carteira.ts:141`), mas nada leva um título a eles.

---

## 6. Faturamento Filial e Filial

### 6.1 Faturamento: quem cria o recebível [CÓDIGO]

- **O Neo Admin não cria título a partir de faturamento.** O único INSERT em `rec_titulos` no código é o upsert da sincronização
  (`rec-sincronizar-consistem/index.ts:438`). A NF da Matriz é emitida no Consistem; a da Filial, no Syslock, e Cuiabá a **implanta**
  no Consistem (CCFT040). Nos dois casos o título só existe no Neo Admin depois que o Consistem o lista em aberto.
- **NF × título (Matriz e Filial):** `ligarTituloNota` (`_shared/consistem-receber.ts:380-389`) liga pela chave da NF-e, depois por nº
  da nota + cliente; se a NF for ambígua, não liga. Só olha NFs de 7 a 60 dias (`index.ts:315-317`). Títulos da série `Z…` não têm NF.
- **Comercial/Pedidos não se liga a Recebíveis.** Tem cópia própria das NFs e parcelas (`com_notas`, `com_nota_parcelas`,
  `0701:69-100`), lida por outro endpoint, sem FK nem consulta cruzada com `rec_titulos`/`rec_notas_saida`. [INFERIDO] Parcelas e
  pagamentos existem duas vezes e podem divergir.
- **Descontos, retenções, frete, impostos:** nada é tratado no kit, no leitor ou na sincronização. Na implantação, o preço da CCFT040 é a
  **soma das parcelas informadas** (`lib/modulos/financeiro/filial/implantacao.ts:66,105`), não o total da NF. [RISCO]
- **À vista/parcelado/meio de pagamento:** as parcelas são as que o Consistem lista; o meio (boleto × transferência) é marcado à mão por
  parcela (`forma_pagamento`, 0116).

### 6.2 Kit da Filial (`rec_kits`) [CÓDIGO]

- **Ligação kit ↔ título** pela NF contida no documento (`rec_nota_filial`, `0146:23-26`: `400` + NF de 6 dígitos), nos dois sentidos:
  kit novo procura títulos (`rec_kit_ligar_titulos`, `0146:160-174`); título novo/alterado procura o kit (`fn_rec_titulos_kit`,
  `0146:186-205`). `rec_kit_titulos.titulo_id` é único.
- **Estágios** (`rec_kit_atualizar_estagio`, versão vigente `0167:36-104`): `recebida` (sem título ativo) → `implantada` → `pronta`
  (toda parcela com boleto ou transferência, e carta de cessão quando exigida) → `enviada` (só por `rec_kit_marcar_enviado`);
  `cancelada` a partir de qualquer estágio, exceto `enviada`. `enviada` e `cancelada` não mudam mais.
- **Registro repetido:** `rec_kit_registrar` devolve o kit vivo da mesma NF (idempotente; corrida bate no índice único parcial, `0146:53`).
- **Conferência com o Consistem** (`divergencias`, `lib/modulos/financeiro/filial/remessa.ts:76-93`): só **mostra** diferenças de
  quantidade, total, vencimento e valor; não bloqueia nada.
- **Job `rec-kits-envio-janela-diario`** (06:05 de Cuiabá, `0167:107-128`): recalcula só os kits `pronta`, num laço sem tratamento de
  erro (um kit com erro interrompe todos).

### 6.3 Filial / unidade [CÓDIGO]

- **Não há cadastro de filiais.** Há uma empresa (`empresas`) e a unidade é uma **coluna gerada** em `rec_titulos`:
  `documento like '400%'` → `contagem`, senão `matriz` (`0110:10-11`; paridade com `unidadeDoDocumento`, `_shared/cobranca.ts:14`).
  `rec_kits` e `rec_remessas` são sempre `contagem`. Interações, pendências, promessas, mensagens, notas e partes AKF **herdam** a
  unidade pelo título (`0158`). Pendência de cliente é da Filial quando o texto contém "(Filial Contagem)" (`pendencia_da_unidade`,
  `0158:69-75`; `unidadeDaPendencia`, `cobranca.ts:18`).
- **Consolidação:** como a unidade é binária e calculada, "Todas" = Matriz + Contagem na Carteira e no Painel. Não há título "sem
  unidade".
- **Usuário restrito à unidade** (`perfis.unidade_restrita`, 0152): sem nível em área nenhuma; vê Faturamento Filial, Cobrança (abas A
  enviar, Confirmar, Cobrar, Confirmados) e Recebíveis só de Contagem, por políticas RLS próprias (`0152`, `0158`). As telas também
  forçam `contagem` (`recebiveis/page.tsx:61`, `painel/page.tsx:56`). O rascunho no Gmail da filial recusa parcela de outra unidade
  (`rec-rascunho-gmail/index.ts:70-73`).
- **Regras por unidade:** confirmação em Contagem só para cliente marcado (sem corte de valor); "Cadastrar contato" só Matriz
  (`index.ts:825`); na Filial, Cuiabá só anexa o boleto e o envio é da filial (`cobranca/dados.ts:214`).

### 6.4 Constatações — Faturamento Filial e Filial

**G1 · [FALHA] Kit recriado depois de cancelado nunca se liga aos títulos.** Cancelar não desfaz a ligação em `rec_kit_titulos`.
O kit novo pula títulos já ligados (`0146:169`), e o gatilho do título acha a ligação antiga e recalcula o kit **cancelado**, que
retorna sem fazer nada (`0146:191`; `0167:38-40`).
*Cenário:* kit da NF 002400 cancelado por dados errados e registrado de novo → kit novo fica "A implantar" para sempre; Cuiabá pode
implantar de novo no Consistem e criar título duplicado no ERP.

**G2 · [FALHA → corrigida na 0184] A usuária da filial pode mudar o estágio do título para qualquer valor.** O gatilho `fn_rec_titulos_campos_unidade` libera
o campo `estagio` sem restringir os valores (`0158:45-58`) e a política permite UPDATE direto (`0158:41-43`).
*Cenário:* PATCH em `rec_titulos` com `estagio = 'pago'` ou `'cancelado'` → o título sai da carteira e da cobrança de Contagem sem
baixa, sem data/valor e sem "Possível baixa" (só a auditoria registra). Para os operadores de Cuiabá vale o mesmo, por F9.

**G3 · [FALHA] Kit "pronto" sem os documentos e sem todas as parcelas.** `pronta` só olha boleto/transferência e carta
(`0167:43-55`): não confere nota fatura, demonstrativo nem a quantidade de parcelas informada. A pendência diz "NF, demonstrativo e
boleto prontos" (`0167:95`) e `rec_kit_marcar_enviado` só exige `pronta` (`0163:90`).
*Cenário:* a nota informa 3 parcelas, o Consistem só tem a A, com boleto → kit pronto e enviado com um boleto; as parcelas B e C chegam
depois num kit `enviada` e não geram pendência de envio no kit.

**G4 · [FALHA] Parcela paga sem boleto trava o kit.** O cálculo exclui só `cancelado` e `renegociado` (`0167:49`); parcela `pago` sem
boleto conta como "sem boleto".
*Cenário:* cliente paga por PIX antes de o boleto ser anexado e a parcela é baixada → kit eternamente "Aguardando boleto", com tarefa
fantasma para Cuiabá.

**G5 · [FALHA, confirmada em produção em 23/10] Regra do prefixo `400`.** O 4000482U (NF 482 da Matriz, Canopus, série 2) foi classificado como Filial e sumiu da Matriz; a correção manual pelo gestor está na migration 0182 (aguarda publicação). (a) Na NF 010000 da filial o documento vira `4010000A`: cai em Matriz, não liga ao kit e some
da visão da filial, sem erro. Hoje a NF está em ~002354. (b) Documento curto da Matriz começando com `400` (como o `453` da NF 45, §22)
seria classificado como Contagem e ficaria visível à usuária restrita.

**G6 · [FALHA] Pendências da filial duplicadas por texto variável.** O título da pendência embute o nome do cliente ou a contagem de
NFs, e a unicidade é pelo texto: novo registro com o nome corrigido abre outra "Implantar fatura…" (`0152:165,180`); kit pronto
recalculado com outro nome abre outra "Enviar kit…" (`0167:88-97`); `rec_remessa_concluir` com outra contagem abre outra "Implantar
remessa nº N (k NFs)" (`0159:153`). Mesmo padrão de F3.

**G7 · [RISCO] Título que some do ERP continua no kit.** NF cancelada ou reimplantada no Consistem (U → A, B): U fica aberto até a
baixa manual, conta para o kit e o boleto dele pode ir no rascunho do kit (`rec-kit-rascunho-gmail/index.ts:83-86`).

**G8 · [RISCO] Regressão do kit para `recebida` sem pendência.** Se todos os títulos do kit forem cancelados, o kit volta a
"A implantar", mas nada reabre a pendência de implantação (`0167:66-71` só conclui). Kit cancelado também conta como "implantado" para
fechar a pendência da remessa (`0148:205-218`).

**G9 · [RISCO] Cuiabá pode criar rascunho de cobrança da Filial.** Para quem não é restrito, `rec-rascunho-gmail` não confere unidade,
embora a regra de §38.1 seja "Cuiabá só anexa".

Não verificado nesta parte: carta de cessão (0147) além do recálculo, fluxo OAuth do Gmail da filial (0153), `estagios.ts` em detalhe.
Os testes `tests/db/filial-*.test.ts` não foram executados nesta parte; nenhum deles cobre G1, G3 ou G4.

## 7. AKF

### 7.1 O que é [DOC + CÓDIGO]

AKF é a **AKF Securitizadora**, empresa que recebe títulos da Neo em **cessão/antecipação de recebíveis** (factoring). Fontes:
`docs/modulos/financeiro-akf.md:6`, cabeçalho de `0112_akf_base.sql:3`, contraparte "AKF Securitizadora" com e-mails `@akfsec.com.br`
semeada em `0130_akf_solicitacao.sql:39-46`. A sigla não é expandida em lugar nenhum.

O módulo substitui o antigo "Gestor AKF" (Streamlit) e serve para saber o que está cedido, o que ainda dá para antecipar, registrar
antecipações **parciais** (que o Consistem não desdobra), montar o e-mail de pedido à AKF e conferir com a planilha que a AKF manda.
As fases de borderô, passivo "por fora" e prorrogação estão só na especificação (tabelas sem uso).

### 7.2 Telas e operações [CÓDIGO]

| Rota | O que faz | Permissão |
|---|---|---|
| `/financeiro/akf` | cartões (Na AKF, A vencer, Vencidos, Disponíveis), "Antecipar um título", partes como linhas; ações `marcarNaAkf`, `desdobrarTitulo`, `encerrarParte` | ver: Financeiro; agir: operador |
| `/financeiro/akf/conferencia` | lê o .xlsx da AKF, cruza com a carteira e aplica as correções passo a passo | operador |
| `/financeiro/akf/solicitar` | escolher títulos e valores a pedir | operador |
| `/financeiro/akf/solicitacoes[/id]` | histórico, prévia, rascunho no Gmail, cancelar, excluir da lista | cancelar: operador; excluir: gestor |

O usuário restrito à unidade não vê o módulo, mas lê as partes dos títulos da unidade, para a cobrança da filial usar o restante (`0158`).

### 7.3 Dados, estados e regras [CÓDIGO]

- **Cedido:** `rec_titulos.cedido`. O gatilho `fn_rec_cedido_por_portador` (`0112:26-44`) liga quando o portador do Consistem vira
  `998` e desliga quando sai do `998`. Também se marca à mão (`akf_marcar_cedido`, até 100, tudo ou nada) ou pela conferência.
  Na tela AKF, "Na AKF" = `cedido` **ou** portador `998` (`_shared/akf.ts:37`).
- **Antecipação parcial:** `akf_desdobramentos` (ativo → encerrado com motivo; sem DELETE). `akf_vw_valor_restante` = valor do título
  − partes ativas, para título aberto e não cedido. É esse restante que a confirmação e a cobrança usam. O gatilho encerra as partes
  quando o título vira pago, cancelado ou renegociado.
- **Solicitação à AKF:** `akf_operacoes` (rascunho → solicitada | cancelada) e `akf_operacao_titulos` (imutável).
  `akf_criar_solicitacao` trava a tabela (numeração e repetição) e valida disponibilidade e valor ≤ restante. A solicitação **não**
  marca o título como cedido nem lança a parte: isso continua manual ou pela conferência. "Excluir da lista" é exclusão lógica
  (DELETE bloqueado), compatível com a regra 4.
- **Testes:** `tests/db/akf-*` e `lib/modulos/financeiro/akf`: 7 arquivos, 81 testes, todos passam.

### 7.4 Constatações — AKF

As marcadas com *sonda* foram reproduzidas num teste descartável em banco em memória, fora do repositório.

**H1 · [FALHA, sonda] Restante negativo.** Se o Consistem reduz o valor do título abaixo da soma das partes, a sincronização reescreve
`valor` e a view devolve restante negativo; a régua e a confirmação usam o número sem limitar a zero (`rec-sincronizar-consistem/index.ts:584,749`).
*Cenário:* título de R$ 1.000 com parte de R$ 400 na AKF; o valor cai para R$ 300 → restante −R$ 100 na mensagem de cobrança.

**H2 · [FALHA, sonda] Parte antecipada "ressuscita" depois da recompra.** Com parte ativa, o título vai ao portador `998` (cedido) e as
partes continuam ativas. Quando sai do `998` (recompra), `cedido` volta a `false` (`0112:36-37`) e a parte volta a descontar.
*Cenário:* título de R$ 1.000, parte de R$ 400, cessão total e recompra → a Neo cobra só R$ 600 de um título que voltou inteiro.

**H3 · [FALHA] Conferência com a planilha não é atômica.** "Aplicar ajuste" roda várias ações em sequência, cada uma na sua transação
(`akf/conferencia/componentes.tsx:84-122`). Se lançar a parte falhar depois de retirar o cedido e encerrar as partes, o título fica
sem cedido e sem partes: volta a "Disponível" e à cobrança pelo valor cheio, embora esteja na AKF.

**H4 · [FALHA, sonda] Dupla contagem na tela AKF.** "Retirar da AKF" com portador ainda `998` grava `cedido = false`; a função de parte
só olha `cedido` e aceita lançar parte. "Na AKF" soma o título inteiro (portador `998`) **e** a parte (`akf/page.tsx:110,122-128`).
*Cenário:* título de R$ 1.000 + parte de R$ 400 → "Na AKF" mostra R$ 1.400.

**H5 · [FALHA → corrigida na 0184] Reabertura não restaura as partes.** As partes encerradas na baixa não voltam se o título for reaberto. Hoje não existe
reabertura (F1); passa a valer quando ela for criada.

**H6 · [RISCO] Rascunho duplicado à AKF.** Se o rascunho é criado no Gmail mas a gravação de "solicitada" falha, a tela responde ok
com aviso (`akf-rascunho-gmail/index.ts:148-152`); novo clique cria outro rascunho. Dois cliques simultâneos também passam.

**H7 · [RISCO] Painel × tela AKF divergem.** O Painel separa "caixa Neo" × "AKF" só por `cedido` (`painel.ts:77,84`): antecipação
parcial entra 100% como caixa da Neo, e título com portador `998` e `cedido = false` é Neo no Painel e AKF na tela AKF.

**H8 · [RISCO] Solicitação sem desfecho.** Depois de "solicitada" não há estado "operada"; o título fica preso a novas solicitações
até alguém cancelar, e o restante cobrado só cai quando alguém lança a parte à mão. "Cancelar" vale também para solicitação já
enviada à AKF.

**Outros riscos:** `akf_desdobrar_titulo` soma e insere sem `FOR UPDATE` (corrida entre duas partes simultâneas); o gatilho que encerra
as partes roda com a RLS de quem baixa (baixa feita por usuário restrito deixa as partes ativas sem erro); a carta de cessão da filial
só é exigida para título `cedido`, não para o parcialmente antecipado (a confirmar com o Financeiro); documentação desatualizada:
spec AKF §5.2 e cabeçalho da `0112` ainda dizem que cedido sai da régua, o que mudou em 15/10/2026.

---

## 8. Prioridades sugeridas para a próxima etapa (correções; nada foi feito)

Ordem por dano financeiro e por quanto o erro passa despercebido:

1. **Integridade do título:** reabertura/estorno e aviso para encerrado que volta em aberto no ERP (F1, H5); fechar o UPDATE direto de
   `rec_titulos` e restringir os valores de estágio da filial (F9, G2).
2. **Valor cobrado:** decidir com o Consistem como saldo e baixa parcial aparecem na API (F2) e corrigir restante negativo e parte que
   volta (H1, H2).
3. **Pendências duplicadas ou presas:** identidade da pendência pelo `referencia_id` e não pelo texto (F3, F4, F5, G6); limpar
   marcos anteriores.
4. **Kit da filial:** religação após cancelamento, `pronta` conferindo documentos e parcelas, parcela paga sem boleto (G1, G3, G4).
5. **Sincronização:** trava contra execução simultânea, alarme quando régua/cadastro falham, aviso de lista parcial, reprocessar
   títulos que ficaram fora da esteira (F7, F11).
6. **Conferência AKF atômica** (H3) e dupla contagem (H4, H7).

Cada item deve começar por um teste de banco que reproduza o cenário descrito.

## 9. O que não foi verificado

- Nenhum dado real foi consultado: as contagens citadas vêm da especificação.
- Não foi confirmado com o Consistem se `valorTitulo` em aberto é saldo ou valor original, nem como a API representa baixa parcial,
  estorno e prorrogação (decisivo para F2).
- Não foram verificados os jobs ativos em produção (`cron.job`) nem o histórico de `net._http_response`.
- Testes executados nesta auditoria (todos passam): Recebíveis/Cobrança 110 + 39; Filial 105 (1 arquivo de calibração pulado,
  depende de PDFs reais); AKF 81. Nenhum cobre os cenários F1–F14, G1–G9 ou H1–H8.
