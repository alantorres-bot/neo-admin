# Auditoria e plano: ciclo de vida dos contratos e GED

Data: 24/10/2026 · Escopo: só leitura (código, migrations, documentação, uma amostra da caixa do Gmail e da estrutura do Drive).
Nenhum código, migration, e-mail ou arquivo do Drive foi alterado.

Legenda de evidência: **[CÓDIGO]** visto no repositório · **[DOC]** só na documentação · **[AMOSTRA]** observado no Gmail/Drive
em 24/10/2026 (poucos exemplos, não é regra) · **[PROPOSTA]** sugestão desta auditoria · **[CONFIRMAR]** depende do responsável.

---

## Resumo executivo

1. **O módulo Contratos não existe.** Há só a área `contratos` e o módulo `contratos.contratos` cadastrados e **inativos**
   (0001), o ícone no menu e a página provisória "Módulo ainda não disponível". Nenhuma migration na faixa 0300–0399, nenhuma
   rota, nenhuma regra em `lib/modulos/contratos`.
2. **Não há integração com o Google Drive.** Nenhum escopo, credencial ou chamada à Drive API no projeto. O "arquivo" do Neo Admin
   é o Supabase Storage (`anexos`, `fiscal`).
3. **O Gmail existe em três formas reaproveitáveis:** rascunho por caixa global (`gmail.compose`), rascunho por usuário (Vault,
   0153) e **leitura** de caixa (`gmail.readonly`, Intimações de cartório, com deduplicação por `message_id`). Esta última é o
   molde direto para capturar propostas.
4. **A base para o dossiê já existe e deve ser reaproveitada:** `contrapartes` (cliente único, por CNPJ e código do Consistem),
   `com_pedidos`/`com_notas`/`com_nota_parcelas` (pedido, NFs e parcelas lidos do Consistem), `rec_titulos` (boletos e cobrança),
   `pendencias` com `publicar_pendencia` e bloqueio por dependência (Central de Gestão), `auditoria`, `atividades`, e o padrão de
   documento versionado com vínculos de `fis_documentos`.
5. **Recomendação:** a entidade central é a **Operação comercial** (não o contrato). O contrato é opcional e só existe nas modalidades
   que o exigem. Os documentos ficam no Drive e o Neo Admin guarda um **índice** com vínculos à operação, ao cliente e aos registros já
   existentes. As obrigações saem de **modelos de fluxo configuráveis por modalidade**, nunca de inferência.
6. **Primeira entrega sugerida (baixo risco):** índice somente leitura da pasta de clientes do Drive + Central de Documentos com
   busca, sem gravar nada no Drive.

---

## A. Diagnóstico atual

### A.1 Arquitetura relevante

| Camada | Situação | Evidência |
|---|---|---|
| App | Next.js 16 (App Router), uma pasta de rotas por módulo em `app/(plataforma)/<area>/<modulo>` | [CÓDIGO] |
| Banco | Supabase/Postgres, RLS em tudo com `tem_acesso_area()`/`nivel_area()`; faixa 0300–0399 reservada a Contratos, vazia | [CÓDIGO] |
| Segundo plano | Edge Functions (Deno) + pg_cron chamando por `x-sincronizacao-segredo` (Vault `rec_sincronizar_url/segredo`); chaves `configuracoes` ligam/desligam cada rotina | [CÓDIGO] `fin-intimacoes-ler-gmail`, `com-pedidos-sincronizar` |
| Regras puras | `lib/modulos/<area>/<modulo>` e `supabase/functions/_shared/*.ts`, com Vitest (178 arquivos de teste) e PGlite para SQL | [CÓDIGO] |
| E2E | Playwright: acesso, Central de Gestão, Fiscal Créditos | [CÓDIGO] `e2e/` |
| Grades | `components/ui/table.tsx` (classificação, filtro, busca) obrigatório | [CÓDIGO] |

Atenção a nomes: o prefixo `crt_` **já é do Cartão de crédito** (0131+). O módulo Contratos não pode usá-lo. Sugestão: `ctr_`. [PROPOSTA]

### A.2 O que já existe, por situação

| Item | Situação | Observação |
|---|---|---|
| Área e módulo Contratos | **Planejado** (cadastro inativo, página provisória) | `0001_nucleo.sql`, `app/(plataforma)/[area]/[modulo]/page.tsx` |
| Cadastro de clientes (`contrapartes`) | **Implementado** | CNPJ/CPF único com máscara (`uq_contrapartes_documento`), `codigo_erp` único (0114), criado/ligado pela sincronização do Recebíveis (casa por código do Consistem, depois CNPJ). Contatos com `finalidades` (inclui `contrato`) |
| Contratos no Financeiro (`rec_contratos`) | **Parcial** | Tabela com número, tipo (venda/locação/serviço), multa/juros e cessão; usada só para encargos da cobrança. Sem tela de cadastro, sem documentos, sem etapas |
| Pedidos de venda (`com_pedidos`, itens, NFs, parcelas, MDF-e) | **Implementado (só leitura do Consistem)** | Espelho a cada 30 min; `contraparte_id` quando há cliente. `numeroUltimaNF` vem vazio; NFs tipo 12 sem `codPedido` |
| Títulos/boletos (`rec_titulos`) | **Implementado** | Boleto em `anexos`, régua, cessão AKF |
| Kit de documentos da filial (`rec_kits`) | **Implementado** | Exemplo pronto de "estágio calculado por documentos presentes" (NF + boleto + carta de cessão) |
| Anexos do núcleo | **Implementado** | Storage privado, 25 MB, caminho `<modulo>/<tabela>/<id>/...`, sem exclusão |
| Documento versionado com vínculos (`fis_documentos`) | **Implementado (só Fiscal)** | `versao`, `raiz_id`, `substitui_id`, `sha256`, imutável, vínculos com remoção lógica. Melhor molde para o GED |
| Pendências / Fila do dia | **Implementado** | `publicar_pendencia(modulo, chave_origem, …)` idempotente; `encerrar_pendencias`; bloqueio com `bloqueio_dependencia_id` |
| Auditoria | **Implementado** | `fn_auditoria` (antes/depois); só o admin geral lê; `atividades` traduz em ações legíveis |
| Notificações Slack / ClickUp | **Parcial** | Preparados; dependem de token e configuração (Central de Gestão, pontos 5 e 6) |
| Gmail rascunho (global e por usuário) | **Implementado** | `gmail.compose`; refresh token no Vault por usuário (0153) |
| Gmail leitura | **Implementado no código, autorização pendente** | `gmail.readonly`, caixa única por segredo `GMAIL_LEITURA_*`; dedup por `message_id`; cron desligado por chave |
| Login Google | **Implementado** | Cliente "Neo Formas Login", só `@neoformas.com.br`, consentimento Interno |
| Google Drive | **Inexistente** | Nenhum escopo, credencial ou código |
| Assinatura eletrônica (ForSign etc.) | **Inexistente** | Nada no código ou docs |
| Elaboração de minuta | **Fora do repositório** | Existem skills `contrato-neoformas` (análise da proposta → cláusulas → minuta), usadas no Claude, sem ligação com o Neo Admin |
| WhatsApp | **Planejado** | Citado na stack; não usado neste fluxo |

### A.3 Integrações reutilizáveis

- **Gmail leitura** (`supabase/functions/fin-intimacoes-ler-gmail`, `_shared/intimacoes.ts`, `_shared/gmail.ts`):
  listar por consulta, ler `format=full`, classificar, deduplicar, limite por rodada, cron por chave, botão "ler agora".
  Limitação: **uma caixa por conjunto de segredos** e escopo de leitura geral da caixa.
- **Conta Google por usuário no Vault** (0153, `nucleo-gmail-conectar`): `state` de uso único, conta tem de ser a do usuário.
  Pode ser estendido para outro escopo (Drive) sem novo mecanismo.
- **Projeto Google Cloud `neo-admin-neoformas`**, consentimento Interno: adicionar a Drive API e o escopo não exige verificação do Google.
- **API do Consistem** (`_shared/consistem-comercial.ts`, `cadastrosgerais/v10/cliente`): pedido, NFs, títulos, DANFE/XML, cliente por CNPJ.

### A.4 Amostra do processo real (24/10/2026, só metadados)

Ajuda a calibrar, não substitui a confirmação com o responsável.

- **Pedido de contrato** chega do CEO ou do representante para o administrativo, com assunto no padrão
  `Contrato Locação 26.177 L - <cliente> <obra>` ou `Orçamento 26.199 V Rev03 - <cliente> - <obra> - <cidade> e Documentação`.
  O número da proposta tem **ano.sequencial + V (venda) / L (locação) + RevNN**. O corpo traz condições ("Prazo 13 meses",
  "Antecipação 1 mês"). Alguns e-mails já recebem marcadores do Gmail.
- **Existe locação**, não só venda: contratos de locação com número próprio ("137/2026") e de venda com outra numeração ("229").
- **Minuta** sai por e-mail com assunto "Minuta Contratual – Proposta nº … – <razão social>". O **contrato assinado** volta na mesma
  conversa, junto com os dados da 1ª parcela.
- **Financiamento**: há tratativas com CAIXA (com contrato BNDES), BNB. Na amostra da CAIXA, o fluxo foi: prévia da NF enviada ao
  banco → banco pede ajustes → banco autoriza → NF definitiva. Também aparece "termo de entrega assinado" e o banco pedindo a NF
  "tão logo as formas sejam enviadas". **As regras variam por banco.**
- **Drive**: há `02 - COMERCIAL / 01 - CLIENTES / <cliente>` (pasta por nome curto, às vezes com ano: "<cliente> - 2026") e
  outra árvore `04 - CONTRATOS E CLIENTES` com `01 - CONTRATOS DIGITALIZADOS`, `02 - ADITAMENTOS`, `03 - TERMOS DE QUITACAO`,
  `04 - CLIENTES SEM CADASTRO NO SISTEMA`. Dentro da pasta do cliente, os arquivos são **planos** (sem subpastas) e as versões
  ficam no **nome do arquivo** (`… V2.pdf`, `.docx` + `.pdf`), não no histórico de versões do Drive.
  Ex.: `229 - CONTRATO DE VENDA FÔRMAS - <cliente>.docx`, `26.199 V Rev03 - <cliente> - <obra>.pdf`, `Cartão de CNPJ <cliente>.pdf`.

Consequência: **o nome da pasta não traz CNPJ nem código do Consistem**. A ligação pasta ↔ `contrapartes` precisará de sugestão
(semelhança de nome, CNPJ achado dentro do cartão CNPJ) e **confirmação humana uma única vez por cliente**.

### A.5 Lacunas

| Lacuna | Impacto |
|---|---|
| Sem entidade "operação comercial" que una proposta, contrato, pedido, NFs e títulos | Não há dossiê; o vínculo hoje está na cabeça de quem faz |
| Sem acesso ao Drive | Não dá para indexar nem abrir documentos pelo Neo Admin |
| `rec_contratos` isolado no Financeiro, sem cadastro | Risco de dois cadastros de contrato se o módulo novo criar outro sem ligar |
| Pedido ↔ NF incompleto no Consistem (`numeroUltimaNF` vazio, NF tipo 12 sem pedido) | A ligação NF → operação vai precisar de regra e às vezes de confirmação manual |
| Identificação de NF de venda para entrega futura × remessa não está documentada | Não se pode inferir; o fiscal precisa informar o tipo de nota/CFOP que distingue |
| Sem registro de assinatura eletrônica | Evidência de assinatura só como documento anexado (v1) |
| `pendencias` deduplicadas por texto nos módulos antigos | Módulo novo deve usar `publicar_pendencia` com `chave_origem` (contrato da Central) |
| Leitura do Gmail com caixa única | Propostas chegam à caixa de quem recebe; definir caixa ou marcador de entrada |
| Auditoria só visível ao admin geral | O histórico do dossiê precisa de linha do tempo própria, legível por quem tem a área |

---

## B. Mapeamento dos processos

### B.1 Etapas comuns (todas as modalidades)

1. Recebimento da proposta fechada (e-mail do comercial com anexo).
2. Identificação/conferência do cliente (`contrapartes`; consulta de CNPJ quando novo).
3. Arquivamento da proposta na pasta do cliente.
4. Abertura da operação no Neo Admin, com modalidade escolhida **por uma pessoa**.
5. Faturamento conforme as condições (NF emitida no Consistem).
6. Cobrança (títulos/boletos → Recebíveis).
7. Arquivamento final e encerramento da operação.

### B.2 Venda para entrega futura

```
Proposta recebida → Solicitação de contrato → Minuta em elaboração → Minuta enviada ao cliente
   ↺ Ajustes solicitados (novas versões)                      ↓
Minuta aprovada pelo cliente → Em assinatura (ForSign / certificado) → Contrato assinado e arquivado
   → NF de venda para entrega futura* → Cobranças/boletos* → Remessas conforme cronograma* → Encerrada
```
\* ordem e gatilhos vêm das condições da operação (ex.: NF só após sinal pago? boleto antes ou depois da NF?). [CONFIRMAR]

Específico: versões da minuta, aprovação do cliente, assinatura de todas as partes, cronograma de remessas com saldo a remeter.

### B.3 Financiamento sujeito à autorização bancária

```
Proposta/documentação → (contrato, quando houver) → Documentos ao banco → [prévia da NF ao banco, se o banco exigir]
   → AUTORIZAÇÃO DE FATURAMENTO RECEBIDA E VALIDADA POR PESSOA → NF → [envio da NF / termo de entrega ao banco]
   → Recebimento do banco → Remessas/entrega → Encerrada
```
Específico: **trava de faturamento** (a operação não fica "liberada para faturar" sem a autorização anexada e validada),
banco/linha como parâmetro, eventuais documentos pós-faturamento exigidos pelo banco. As diferenças por banco/linha
(CAIXA, BNB, BNDES/FINAME…) entram como **variantes configuráveis** do modelo (B.5), nunca codificadas.

### B.4 Proposta avulsa (sem contrato)

```
Proposta recebida → Associada ao cliente e arquivada → Liberada para faturamento → NF → Cobranças → Encerrada
```
Específico: **nenhuma obrigação de contrato é criada**. Documentos fiscais e financeiros entram por vínculo conforme surgem.

### B.5 Comparativo

| Obrigação | Entrega futura | Financiamento | Avulsa | Locação (existe; [CONFIRMAR] escopo) |
|---|---|---|---|---|
| Arquivar proposta | ✔ | ✔ | ✔ | ✔ |
| Elaborar minuta / versões | ✔ | conforme banco/caso | — | ✔ |
| Aprovação do cliente | ✔ | conforme caso | — | ✔ |
| Assinatura de todas as partes | ✔ | conforme caso | — | ✔ |
| Autorização bancária | — | **✔ (bloqueia NF)** | — | — |
| NF de venda/faturamento | ✔ (entrega futura) | ✔ (após autorização) | ✔ | faturas mensais |
| Remessas por cronograma | ✔ | conforme caso | conforme caso | REM × RET (módulo próprio planejado) |
| Cobranças/boletos | ✔ | parcela do cliente, se houver | ✔ | ✔ |
| Arquivamento final | ✔ | ✔ | ✔ | ✔ + termo de quitação |

---

## C. Arquitetura proposta do GED

Princípio: **o Drive continua sendo o arquivo; o Neo Admin é o índice, os vínculos e o controle.** Nada é copiado, movido ou renomeado.

1. **Pastas-raiz configuradas** (`configuracoes` / tabela própria): os IDs das pastas que o Neo Admin indexa
   (ex.: `01 - CLIENTES`, `01 - CONTRATOS DIGITALIZADOS`). Só o admin cadastra.
2. **Indexação somente leitura** (Edge Function agendada + botão "atualizar"): percorre as pastas pela Drive API
   (`files.list` com `fields` mínimos; depois `changes.list` com `startPageToken` para só o que mudou). Grava id do arquivo,
   nome, pasta, tipo MIME, tamanho, `md5Checksum`, datas, `webViewLink`, `headRevisionId`. **Não baixa conteúdo** na v1.
3. **Pasta ↔ cliente**: tabela de mapeamento. O sistema **sugere** (nome parecido com `contrapartes.nome`, mesmo CNPJ quando
   achado) e uma pessoa **confirma**. Pasta sem cliente vai para a fila "Pastas sem cliente".
4. **Classificação do documento** (tipo: proposta, minuta, contrato assinado, cartão CNPJ, autorização bancária, NF, boleto…):
   v1 por **regras explícitas de nome** configuráveis (ex.: começa com `\d{2}\.\d{3} [VL]` → proposta, contém "CONTRATO" → contrato)
   com status `sugerido` até alguém confirmar. Nada de IA na v1.
5. **Vínculos**: um documento pode estar ligado a vários alvos (cliente, operação, contrato, obrigação, pedido, NF, título), no
   mesmo padrão de `fis_documentos_vinculos` (remoção lógica, auditoria).
6. **Versões**: duas camadas. (a) a do Drive (`headRevisionId`, mostrada como informação); (b) a **de negócio**: "esta minuta V2
   substitui a V1", registrada pelo usuário ao vincular, como `substitui_id` de `fis_documentos`. O histórico do Drive não é usado
   como verdade porque a prática atual é salvar outro arquivo.
7. **Abrir**: botão leva ao `webViewLink`. O Drive aplica as permissões dele; o Neo Admin aplica as suas (RLS por área).
   Quem não tem acesso ao arquivo no Drive vê o registro mas não abre — **dupla barreira, sem elevar acesso**.
8. **Gravação no Drive (fase posterior)**: anexo capturado do e-mail é enviado para a pasta do cliente já mapeada, com nome no
   padrão vigente; antes de gravar, confere `md5Checksum` contra o índice (sem duplicar). Sempre com confirmação humana na v1.
9. **Documentos que nascem no Neo Admin** (DANFE/XML do Comercial, boletos do Recebíveis) continuam no Storage; o GED os lista
   pelo mesmo índice (origem `storage`), sem copiá-los ao Drive até haver decisão.

Autenticação com o Drive (decisão pendente, H-3):
- **Opção 1 — OAuth de uma conta técnica** do Workspace com acesso às pastas, refresh token no Vault (padrão 0153),
  escopo `drive.readonly` na v1. Simples, auditável no Google, sem acesso amplo. **Recomendada.**
- **Opção 2 — conta de serviço com delegação de domínio**: mais poderosa, exige o admin do Workspace e amplia o risco.
- `drive.file` não serve para indexar o que já existe (só vê arquivos criados/abertos pelo app).

---

## D. Modelo de dados proposto (nada criado)

### D.1 O que já existe e será reaproveitado

| Entidade | Uso no dossiê |
|---|---|
| `empresas` | Empresa do grupo que vende |
| `contrapartes` / `contatos` | Cliente (CNPJ, código Consistem) e contatos com finalidade `contrato` |
| `com_pedidos`, `com_notas`, `com_nota_parcelas` | Pedido, NFs e parcelas (lidos por **view pública** do Comercial, a criar: ex. `com_vw_pedidos_cliente`) |
| `rec_titulos` / `rec_vw_titulos` | Boletos e situação de cobrança (por view pública já existente ou a documentar) |
| `rec_contratos` | Parâmetros de encargos por contrato; **ligar**, não duplicar (H-6) |
| `pendencias` + `publicar_pendencia` | Obrigações abertas na Fila do dia e na Central de Gestão |
| `mensagens`, `interacoes` | Histórico de comunicação e de eventos com o cliente |
| `auditoria`, `atividades` | Antes/depois e linha do tempo da equipe |
| `anexos` | Arquivos que nascem no sistema |

### D.2 O que precisaria ser criado

**Núcleo estendido (0800+), porque o GED é de todas as áreas:**

| Tabela | Campos principais |
|---|---|
| `ged_pastas_raiz` | id, drive_id, nome, area, ativa, `page_token` (changes), indexado_em |
| `ged_pastas_cliente` | drive_folder_id (único), nome, contraparte_id (nulo até confirmar), status (`sugerida`/`confirmada`/`ignorada`), sugerido_por_regra, confirmado_por/em |
| `ged_documentos` | id, origem (`drive`/`storage`), drive_file_id (único quando drive) ou anexo_id, nome, mime, tamanho, md5, drive_revision, web_link, pasta, contraparte_id, tipo (ref. `ged_tipos`), tipo_status (`sugerido`/`confirmado`), data_documento, versao, substitui_id, situacao (`vigente`/`substituido`/`removido_no_drive`), visto_em |
| `ged_tipos` | codigo, nome, area, regra_nome (regex configurável), obrigatorio_em (opcional) |
| `ged_vinculos` | documento_id, alvo (`contraparte`/`operacao`/`contrato`/`obrigacao`/`pedido`/`nota`/`titulo`), alvo_id, criado_por/em, removido_por/em/motivo |
| `ged_capturas` (fase 4) | origem (`gmail`), message_id (único), thread_id, remetente, assunto, recebido_em, anexos (nome, tamanho, sha256), cliente_sugerido, proposta_sugerida, status (`nova`/`em_conferencia`/`associada`/`descartada`/`duplicada`), decisão e autor |

Regras: sem `delete` (prova), auditoria em todas, RLS por área do alvo + área da pasta-raiz.

**Contratos (0300–0399, prefixo `ctr_`):**

| Tabela | Campos principais |
|---|---|
| `ctr_operacoes` | id, numero interno, empresa_id, contraparte_id, modalidade (ref. `ctr_modalidades`), variante (ex.: banco/linha), proposta_numero (`26.199`), proposta_revisao (`Rev03`), obra/descrição, valor_total, condicoes (jsonb **estruturado e validado**, só campos aprovados), responsavel_id, situacao (calculada), liberada_faturamento_em/por, encerrada_em, origem (`manual`/`captura`) + captura_id |
| `ctr_contratos` | id, operacao_id, numero (sequência por tipo, [CONFIRMAR]), tipo (venda/locação), rec_contrato_id (liga ao Financeiro), situacao, assinado_em, plataforma_assinatura |
| `ctr_minutas` | contrato_id, versao, documento_id (GED), enviada_em, retorno (`ajustes`/`aprovada`), observação |
| `ctr_assinaturas` | contrato_id, parte, signatário, meio (`forsign`/`certificado`/`fisico`), assinado_em, evidencia_documento_id |
| `ctr_autorizacoes_bancarias` | operacao_id, banco, referência do banco, documento_id, recebida_em, **validada_por/em**, ressalvas |
| `ctr_operacao_pedidos` | operacao_id, pedido (empresa + cod_pedido) — ligação ao espelho do Comercial pela view |
| `ctr_remessas_previstas` | operacao_id, data_prevista, descrição/quantidade, nota (quando emitida), situação |

**Motor de obrigações (Contratos):**

| Tabela | Campos principais |
|---|---|
| `ctr_modalidades` | codigo (`entrega_futura`, `financiamento`, `avulsa`, `locacao`…), nome, exige_contrato, ativa |
| `ctr_obrigacao_tipos` | codigo (`elaborar_minuta`, `aguardar_aprovacao_cliente`, `obter_assinaturas`, `aguardar_autorizacao_bancaria`, `emitir_nf`, `acompanhar_boletos`, `programar_remessas`, `arquivar_finais`…), nome, area responsável, documento comprobatório exigido (ref. `ged_tipos`), como conclui (`manual`, `documento_vinculado`, `evento_erp`) |
| `ctr_modelo_itens` | modalidade, variante (nula = todas), obrigacao_tipo, **condição explícita** (jsonb sobre `condicoes`, ex.: `{"tem_sinal": true}`), depende_de (lista), prazo relativo (dias a partir de quê), trava_faturamento (bool), versao_modelo |
| `ctr_obrigacoes` | operacao_id, obrigacao_tipo, modelo_item_id + versao_modelo, status (`bloqueada`/`aberta`/`concluida`/`dispensada`), responsavel, prazo, concluida_por/em, evidencia (vínculo GED), dispensa (motivo + gestor), pendencia_id |
| `ctr_obrigacao_dependencias` | obrigacao_id, depende_de_id |

### D.3 Relacionamentos

```
contrapartes 1─N ctr_operacoes 1─0..N ctr_contratos 1─N ctr_minutas / ctr_assinaturas
                       │                     └─0..1 rec_contratos (Financeiro)
                       ├─N ctr_obrigacoes ─N:N dependências ─→ pendencias (publicar_pendencia)
                       ├─0..N ctr_autorizacoes_bancarias
                       ├─N ctr_operacao_pedidos ─(view pública)→ com_pedidos → com_notas → com_nota_parcelas
                       └─N ged_vinculos ─→ ged_documentos ─→ Drive (file id) | Storage (anexo)
ged_pastas_cliente N─1 contrapartes
```
Títulos (`rec_titulos`) entram no dossiê pela NF/cliente via view pública, sem chave nova entre módulos.

---

## E. Integração com Gmail e Drive

### E.1 Fluxo de captura

1. **Fonte**: caixa(s) onde as propostas chegam + filtro explícito em `configuracoes`
   (ex.: remetentes do comercial `@neoformas.com.br` **e** (assunto com padrão de proposta `\d{2}\.\d{3} ?[VL]` ou marcador
   "Neo Admin/Contratos") **e** `has:attachment`). [CONFIRMAR caixa e filtro]
2. **Leitura** (Edge Function no molde de `fin-intimacoes-ler-gmail`, cron desligado por chave): lista, ignora `message_id` já
   registrado, lê cabeçalhos, corpo em texto e **metadados** dos anexos.
3. **Extração por regra** (pura e testada): número da proposta, revisão, V/L, nome do cliente/obra do assunto; condições do corpo
   ficam como **texto para leitura humana**, não viram campos automaticamente na v1.
4. **Identificação do cliente**: (a) proposta já conhecida → mesma operação; (b) nome do assunto × `contrapartes` e × pastas mapeadas;
   (c) CNPJ quando presente. Resultado com **grau de confiança**; abaixo do limite → **fila de conferência**.
5. **Conferência humana** (tela "Propostas recebidas"): confirma cliente, modalidade e operação (nova ou existente; revisão nova
   da mesma proposta não abre outra operação), escolhe o anexo da proposta.
6. **Arquivamento** (após o Drive com escrita, fase 4b): grava o anexo na pasta mapeada com o nome padrão; se o `md5` já existe
   no índice, só vincula.
7. **Registro**: `ged_capturas` + `ctr_operacoes` (origem `captura`) + obrigações do modelo + pendências.

### E.2 Duplicidade (três camadas, como nas Intimações)

| Camada | Chave |
|---|---|
| E-mail | `message_id` único; respostas na mesma conversa (`thread_id`) agrupadas |
| Arquivo | `sha256` do anexo e `md5Checksum` do Drive; mesmo hash = mesmo documento, novo vínculo |
| Operação | empresa + número da proposta (sem a revisão); revisão nova = nova versão do documento da proposta |

### E.3 Segurança e falhas

- Escopo mínimo: `gmail.readonly` (a API não oferece leitura restrita a marcador; por isso o filtro e a caixa precisam ser
  definidos), `drive.readonly` na indexação; escrita no Drive só depois e com escopo justificado.
- Tokens só no Vault/segredos da Edge Function; nada no app nem no relatório.
- Limite por rodada, retomada idempotente, erro por mensagem não derruba a rodada, registro da rodada (como `com_sincronizacoes`).
- `modo_rascunho` continua valendo: nada é enviado ao cliente pelo fluxo; e-mails ao cliente seguem como rascunho no Gmail.
- LGPD: guardar só o necessário (assunto, remetente, datas, nomes e hashes dos anexos); corpo do e-mail não é persistido por inteiro. [CONFIRMAR]

---

## F. Controle de etapas e obrigações

1. **Abertura**: a pessoa escolhe a modalidade (e a variante, ex.: banco). O sistema lê `ctr_modelo_itens` da modalidade/variante,
   avalia as **condições explícitas** contra `condicoes` da operação e cria só as obrigações aplicáveis, guardando a versão do modelo
   (mudança de modelo não altera operações antigas).
2. **Dependências**: obrigação com dependência aberta fica `bloqueada`; ao concluir a anterior, a seguinte abre e é publicada com
   `publicar_pendencia(modulo='contratos.contratos', chave_origem='ctr_obrigacoes:<id>')`. A pendência usa `bloqueio_dependencia_id`
   quando cabível, aparecendo na Central de Gestão.
3. **Conclusão**: por evidência — documento do tipo exigido vinculado **e** confirmação da pessoa; ou evento do ERP (ex.: NF vista
   no espelho do Comercial ligada à operação), sempre exibido para conferência.
4. **Trava de faturamento** (função `ctr_liberada_faturamento(operacao)`): verdadeira só quando todas as obrigações com
   `trava_faturamento` estão concluídas. Na modalidade financiamento isso inclui a autorização bancária **anexada e validada por um
   usuário com nível definido**. A tela mostra "Faturamento bloqueado: aguardando autorização do banco X". Se uma NF da operação
   aparecer no Consistem antes da liberação, abre-se a pendência crítica "NF emitida sem liberação" (o Neo Admin não emite NF; ele
   alerta). [PROPOSTA]
5. **Exceções**: dispensar uma obrigação exige motivo e gestor; incluir obrigação avulsa na operação é permitido (fica registrado).
6. **Situação da operação**: calculada a partir das obrigações (ex.: "Em elaboração da minuta", "Aguardando assinatura",
   "Aguardando autorização bancária", "Liberada para faturamento", "Em remessas", "Encerrada"), nunca editada à mão.
7. **Documentos faltantes**: cruzamento `ctr_obrigacao_tipos.documento_exigido` × `ged_vinculos` da operação → lista
   "faltando / aguardando conferência / ok" no dossiê.

Exemplo (venda para entrega futura, condições `{tem_sinal: true}`; valores ilustrativos, as regras reais vêm do responsável):

| # | Obrigação | Depende de | Trava NF | Conclui com |
|---|---|---|---|---|
| 1 | Arquivar proposta | — | — | proposta vinculada |
| 2 | Elaborar minuta | 1 | — | minuta vinculada |
| 3 | Aguardar aprovação do cliente | 2 | sim | confirmação + e-mail/anotação |
| 4 | Obter assinaturas | 3 | sim | contrato assinado vinculado |
| 5 | Emitir NF de venda para entrega futura | 4 (e sinal, se a condição existir) | — | NF ligada |
| 6 | Acompanhar boletos | 5 | — | títulos ligados |
| 7 | Programar e acompanhar remessas | 5 | — | remessas previstas cumpridas |
| 8 | Arquivar documentos finais | 4, 7 | — | checklist completo |

---

## G. Plano de implementação por fases

Cada fase: especificação em `docs/modulos/` aprovada antes, plano curto, testes, publicação pelo Alan. Nenhuma fase altera módulos
existentes além de views públicas novas.

| Fase | Escopo | Depende de | Riscos | Critério de aceite |
|---|---|---|---|---|
| **0. Especificação** | `docs/modulos/contratos-operacoes.md` e `docs/modulos/administrativo-ged.md` com as respostas da seção H | este relatório | decisões em aberto | specs aprovadas |
| **1. Acesso ao Drive (só leitura)** | Drive API no projeto Google; conta e escopo `drive.readonly`; segredo no Vault; Edge Function de teste que lista uma pasta e devolve contagens (sem gravar) | H-1 a H-3 | escopo mais amplo que o necessário; pasta errada | lista as pastas-raiz configuradas; nenhum arquivo alterado (verificável no log do Drive) |
| **2. Índice + Central de Documentos** | `ged_*` (pastas, documentos, tipos, vínculos); indexação incremental; mapeamento pasta ↔ cliente com sugestão e confirmação; tela de busca (cliente, CNPJ, nº proposta/contrato, tipo, data) e abrir no Drive | 1 | nomes de pasta ambíguos; volume | 100% das pastas de cliente classificadas como confirmada/ignorada; busca por nº de proposta acha o PDF; rodar 2× não duplica |
| **3. Dossiê da operação** | `ctr_operacoes`, `ctr_contratos` (ligado a `rec_contratos`), vínculo a pedidos via view pública do Comercial; tela do dossiê (cliente, documentos, pedido, NFs, títulos, linha do tempo); cadastro manual | 2 | duplicar contrato do Financeiro; ligação NF ↔ pedido incompleta | dossiê de 3 operações reais (uma por modalidade) montado sem cadastro duplicado |
| **4a. Captura de propostas (leitura)** | Leitura do Gmail com filtro, `ged_capturas`, extração por regra, fila de conferência | 3; autorização da caixa | ler e-mail fora do escopo; falso positivo | 30 dias de e-mails reprocessados sem duplicar; tudo o que não casou está na fila |
| **4b. Arquivamento no Drive** | Escrita na pasta do cliente com nome padrão, checagem de hash | 4a; decisão de escopo de escrita | gravar em pasta errada | nenhum arquivo duplicado; só grava após confirmação |
| **5. Fila de solicitações de contrato** | Operações em "elaborar minuta" como fila do administrativo, com responsável e prazo, publicadas na Central | 3 | — | pedido do comercial vira item da fila em até 1 rodada |
| **6. Versões, aprovação e assinatura** | `ctr_minutas`, `ctr_assinaturas`; registro de envio/retorno; evidência de assinatura como documento (sem API da ForSign na v1) | 5 | — | histórico V1→V2→aprovada→assinada visível no dossiê |
| **7. Motor de obrigações e trava de faturamento** | modelos por modalidade/variante, obrigações, dependências, `ctr_liberada_faturamento`, alerta "NF sem liberação", remessas previstas × NFs do espelho | 3, 6; regras da seção H | regra mal definida bloquear trabalho | testes por modalidade; financiamento sem autorização validada nunca aparece como liberado |
| **8. Automações e IA** | classificação/extração assistida (sempre sugestão), integração ForSign se houver API, ligação com as skills de minuta | 7 | erro de extração tratado como fato | toda sugestão exige confirmação; métricas de acerto |

Observação sobre a ordem sugerida no pedido: está coerente. Os únicos ajustes são: (1) a autorização do Drive vira uma fase
própria antes da Central, por ser o maior risco técnico; (2) a captura se divide em leitura e escrita no Drive; (3) o motor de
obrigações entra depois de o dossiê e as versões estarem em uso, para os modelos refletirem o processo real.

---

## H. Dúvidas e decisões pendentes

**Drive e documentos**
1. Qual é a pasta "Clientes" oficial: `02 - COMERCIAL / 01 - CLIENTES`, `04 - CONTRATOS E CLIENTES` ou ambas? Estão num Drive
   compartilhado ou no "Meu Drive" de alguém?
2. Quem pode ver cada pasta no Drive hoje? O Financeiro e o Fiscal devem ver documentos comerciais?
3. Conta técnica (OAuth, recomendado) ou conta de serviço com delegação? Qual conta é dona das pastas?
4. O Neo Admin poderá **gravar** no Drive (fase 4b)? Em qual pasta, com qual padrão de nome?
5. Pastas de clientes sem cadastro no sistema (`04 - CLIENTES SEM CADASTRO NO SISTEMA`): devem gerar cadastro em `contrapartes`?

**Processo**
6. `rec_contratos` (Financeiro) e o contrato do módulo novo: ligar um ao outro (recomendado) e quem cadastra multa/juros?
7. Locação entra neste escopo ou fica para o módulo REM × RET?
8. Numeração dos contratos: sequência própria por tipo (venda "229", locação "137/2026")? Quem atribui?
9. Na entrega futura: a NF sai após a assinatura, após o sinal, ou depende? Boleto antes ou depois da NF?
10. Qual tipo de nota/CFOP identifica, no Consistem, a NF de venda para entrega futura e a de remessa? (necessário para ligar as NFs
    do espelho às obrigações; deve vir do Fiscal)
11. Financiamento: quais bancos/linhas existem hoje e o que muda em cada um (prévia da NF, termo de entrega, documentos pós-NF,
    quem do banco autoriza)? Quem na Neo valida a autorização?
12. A ForSign tem API contratada? Ou basta registrar o PDF assinado como evidência?
13. Quem pode dispensar uma obrigação ou liberar faturamento em exceção?

**E-mail**
14. Em qual caixa chegam os pedidos de contrato (caixa pessoal do administrativo ou uma caixa compartilhada)? Pode-se usar um
    marcador do Gmail como filtro de entrada?
15. Quem envia (CEO, representantes) é sempre `@neoformas.com.br`? Há propostas que chegam direto do cliente?
16. Pode-se guardar o texto do corpo do e-mail no Neo Admin, ou só os metadados?

**Gestão**
17. Responsáveis por etapa (administrativo, comercial, fiscal, financeiro) e prazos esperados de cada etapa.
18. Área de permissão: o dossiê fica em `contratos`; o comercial terá acesso de consulta?

---

## Próximos passos

1. Responder a seção H (ao menos itens 1–4, 6, 9–11 e 14).
2. Aprovar a fase 0: redação das duas especificações a partir deste relatório.
3. Configurar no Google Cloud a Drive API e a conta da fase 1 (feito pelo Alan; nenhuma credencial em chat ou repositório).
