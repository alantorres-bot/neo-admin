# Módulo: Administrativo / GED — Central de Documentos

Status: **rascunho** (Fase 0, 24/10/2026), aguardando aprovação. Nada implementado.
Origem: `docs/auditoria/AUDITORIA_CONTRATOS_GED_2026-10-24.md`, seções C, D, E e G.

Código proposto: `administrativo.ged` · rota proposta `/documentos` · migrations no núcleo estendido (0801 em diante;
a 0800 já é de `nucleo_apps_pendencias`) · prefixo `ged_` · Edge Functions `nucleo-ged-<funcao>`.

Marcação usada neste documento:
- **[EXISTE]** verificado no repositório (com o arquivo);
- **[PROPOSTA]** a construir;
- **[PENDENTE n]** decisão do responsável, ver a seção 14.

---

## 1. Objetivo
Localizar, consultar e vincular a processos do Neo Admin os documentos que a empresa já guarda no Google Drive, sem copiar,
mover nem renomear nada. O GED é um **índice com vínculos**: o arquivo continua no Drive; o Neo Admin sabe onde ele está, de
qual cliente é, que tipo de documento é e a qual registro (operação, contrato, título, pedido…) pertence.

É um componente do núcleo, compartilhável por qualquer módulo (Contratos primeiro; depois Financeiro, Fiscal, Jurídico).

## 2. Como é feito hoje
- **Onde ficam os documentos** [amostra de 24/10/2026, PENDENTE 1]:
  - `02 - COMERCIAL / 01 - CLIENTES / <cliente>`: uma pasta por cliente, com nome curto (às vezes com o ano: "<cliente> - 2026"),
    arquivos soltos, sem subpastas;
  - `04 - CONTRATOS E CLIENTES`: subpastas `01 - CONTRATOS DIGITALIZADOS`, `02 - ADITAMENTOS`, `03 - TERMOS DE QUITACAO`,
    `04 - CLIENTES SEM CADASTRO NO SISTEMA`.
- **Nomes de arquivo** (exemplos reais, sem o cliente):
  - `229 - CONTRATO DE VENDA FÔRMAS - <cliente>.docx` e `.pdf`;
  - `… - <cliente> V2.pdf`;
  - `26.199 V Rev03 - <cliente> - <obra> - <cidade>.pdf` (proposta);
  - `Cartão de CNPJ <cliente>.pdf`.
- **Versões:** ficam no **nome** do arquivo (`V2`, `Rev03`), não no histórico de versões do Drive.
- **Busca:** feita pela pessoa, no próprio Drive, pelo nome do cliente.
- **CNPJ:** nenhuma pasta nem arquivo da amostra traz o CNPJ no nome, e nenhum código do Consistem.

## 3. Escopo

| Entra na v1 | Fica fora da v1 |
|---|---|
| Indexar (só leitura) as pastas-raiz configuradas e suas subpastas | Criar, mover, renomear, excluir ou compartilhar arquivos/pastas no Drive |
| Mapear pasta → cliente (`contrapartes`) com sugestão e **confirmação humana** | Criar cliente automaticamente a partir de pasta |
| Classificar o tipo do documento por regras explícitas de nome, com correção manual | Ler o conteúdo dos arquivos (OCR, extração, IA) |
| Busca por cliente, CNPJ, nome de arquivo, tipo, pasta e data | Baixar ou cachear os arquivos no Neo Admin |
| Abrir no Drive (`webViewLink`) | Conceder acesso ao Drive a quem não tem |
| Vincular documento a registros do Neo Admin e registrar a versão de negócio | Usar o histórico de revisões do Drive como versão de negócio |
| Atualização incremental do índice (`changes`) + reconciliação completa periódica | Indexar o Drive inteiro da empresa |
| Fila de conferência: pastas sem cliente, documentos sem tipo | Gravar no Drive anexos capturados do Gmail (Fase 4b do plano, outra especificação) |
| Preparar a listagem dos anexos do Supabase Storage no mesmo índice (seção 5.8, Fase B) | Migrar anexos do Storage para o Drive |

## 4. Entradas

### 4.1 Google Drive API v3 [PROPOSTA]
Somente chamadas `GET`. O escopo pedido é `https://www.googleapis.com/auth/drive.readonly`.

| Uso | Chamada | Parâmetros/campos |
|---|---|---|
| Metadados da pasta-raiz | `files.get` | `fileId`, `fields=id,name,mimeType,driveId,parents,trashed,webViewLink`, `supportsAllDrives=true` |
| Listar o conteúdo de uma pasta | `files.list` | `q="'<pasta>' in parents and trashed=false"`, `fields=nextPageToken,files(id,name,mimeType,size,md5Checksum,createdTime,modifiedTime,parents,webViewLink,headRevisionId,trashed,shortcutDetails)`, `pageSize=1000`, `supportsAllDrives=true`, `includeItemsFromAllDrives=true` (+ `corpora=drive&driveId=` em Drive compartilhado) |
| Ponto de partida das mudanças | `changes.getStartPageToken` | `supportsAllDrives=true` (+ `driveId`) |
| Mudanças desde a última rodada | `changes.list` | `pageToken`, `fields=nextPageToken,newStartPageToken,changes(fileId,removed,file(...mesmos campos...))`, `includeItemsFromAllDrives=true`, `supportsAllDrives=true` (+ `driveId`) |

Observações técnicas:
- **Google Docs/Sheets nativos** não têm `md5Checksum` nem `size`; a duplicidade deles é só pelo `id`.
- **Atalhos** (`application/vnd.google-apps.shortcut`) são indexados como atalho e apontam para `shortcutDetails.targetId`;
  não se segue o atalho para fora das pastas-raiz.
- O `changes.list` traz mudanças do Drive inteiro da conta (ou do Drive compartilhado). O índice só aceita o arquivo cuja
  pasta-mãe já está indexada (5.3).

### 4.2 Autenticação com o Google [PENDENTE 3]
Mecanismos que já existem no projeto:
- consentimento OAuth **Interno** no projeto `neo-admin-neoformas` [EXISTE, `docs/GMAIL_POR_USUARIO.md`];
- refresh token guardado no **Vault**, com a tabela guardando só o id do segredo [EXISTE, `gmail_contas.segredo_id`, migration 0153];
- fluxo de conexão com `state` de uso único [EXISTE, `gmail_conexoes`, `gmail_iniciar_conexao()`, Edge Function `nucleo-gmail-conectar`].

| Opção | Como | Avaliação |
|---|---|---|
| **A. Conta técnica por OAuth (recomendada)** | Uma conta do Workspace com acesso de leitor às pastas-raiz autoriza `drive.readonly` uma vez. Refresh token no Vault (`ged_conexao.segredo_id`) | Mesmo padrão do Gmail por usuário; acesso limitado ao que a conta enxerga; revogável em myaccount.google.com |
| B. Conta de serviço com delegação de domínio | Configurada pelo admin do Workspace | Mais ampla: pode agir como qualquer usuário; maior risco; desnecessária para leitura |
| C. Token de cada usuário | Cada pessoa conecta o próprio Drive | Índice diferente por pessoa; não serve para índice compartilhado |

`drive.file` **não serve**: esse escopo só enxerga arquivos criados ou abertos pelo app, e não os que já existem.
Segredos novos (nomes propostos): `GED_DRIVE_CLIENT_ID` e `GED_DRIVE_CLIENT_SECRET`, gravados com `scripts/gravar-segredo.mjs` [EXISTE].
Pode-se usar um cliente OAuth novo ou o "Neo Admin Gmail (rascunhos)" com mais um URI de redirecionamento [PENDENTE 3].

### 4.3 Dados do Neo Admin [EXISTE]
- `contrapartes`: `nome`, `documento` (CNPJ/CPF **com máscara**, único), `codigo_erp` (único, 0114) e `tipos`.
  RLS: lê quem tem alguma área; o tipo `colaborador` só é lido pelo RH (0002).
- `anexos`: `modulo`, `referencia_tabela`, `referencia_id`, `arquivo_path`, `nome_arquivo`, `tipo`, `enviado_em`, no bucket privado
  `anexos`. Leitura por `tem_acesso_modulo(modulo)`.
- Funções `tem_acesso_area()`, `tem_acesso_modulo()`, `nivel_area()`, `eh_admin_geral()`, `usuario_ativo()`,
  `fn_auditoria()`, `fn_bloquear_delete()`, `fn_bloquear_alteracao()`, `fn_atualizado_em()` (0001, 0002, 0007, 0152).
- Normalização de documento: `lib/nucleo/documentos.ts` (`normalizarDocumento`, `formatarCnpj`, `validarCnpj`).

## 5. Regras de negócio

### 5.1 Só leitura no Drive (v1)
1. A integração só faz `GET` em `www.googleapis.com/drive/v3/*`. Qualquer outro método falha no cliente HTTP do GED, antes de sair.
2. Um teste automatizado faz uma varredura no código das funções do GED e garante que não há `POST`, `PATCH`, `PUT` nem `DELETE`
   para a Drive API. É o mesmo padrão do teste "nenhuma rota de criação de adiantamento" das Intimações.
3. O escopo autorizado é só `drive.readonly`. Se o token voltar com outro escopo, a conexão é recusada e registrada como erro.

### 5.2 Pastas-raiz
1. Só o `admin_geral` cadastra uma pasta-raiz (`ged_pastas_raiz`), informando o ID ou link do Drive, a **área** dona e o **papel** da raiz:
   - `clientes`: cada subpasta de 1º nível é a pasta de um cliente;
   - `tematica`: as subpastas são temas (ex.: "01 - CONTRATOS DIGITALIZADOS").
2. Ao cadastrar, o sistema lê `files.get` e grava nome, `driveId` (quando é Drive compartilhado) e link.
   Se a conta técnica não enxerga a pasta, o cadastro é recusado.
3. A raiz pode ser desativada, mas não é excluída. Desativada, os documentos dela somem da busca e continuam no índice com
   `situacao = fora_do_escopo`.

### 5.3 Indexação
1. **Carga inicial:** percorre a raiz em largura, com `files.list` por pasta, até a profundidade máxima configurada
   (`administrativo.ged.profundidade_max`, padrão proposto 4). Grava pastas (`ged_pastas`) e arquivos (`ged_documentos`).
   No fim, guarda o `startPageToken`.
2. **Incremental:** a cada rodada, chama `changes.list` a partir do token salvo. Para cada mudança:
   - arquivo com pasta-mãe indexada: insere ou atualiza;
   - `removed=true`, `trashed=true` ou pasta-mãe fora do índice: o documento passa a `removido_no_drive` ou `fora_do_escopo`.
     **Nunca há `delete`.**
3. O token novo (`newStartPageToken`) só é gravado **depois** de tudo da rodada ter sido salvo. Se a rodada falhar no meio, a
   próxima recomeça do mesmo token e reprocessa: a gravação é idempotente pelo `drive_id`.
4. **Reconciliação completa** semanal, configurável (`administrativo.ged.reconciliar_dias`, proposto 7): refaz a listagem e marca o
   que sumiu. Protege contra mudança perdida.
5. Uma rodada por vez, controlada por trava em tabela, como em `rec_sincronizacao_trava` (0186) [EXISTE o padrão].
6. Limite por rodada (`administrativo.ged.max_itens_rodada`, proposto 5.000): o que passar fica para a rodada seguinte, como o
   `MAX_POR_RODADA` das Intimações.
7. O agendamento usa pg_cron chamando a Edge Function com `x-sincronizacao-segredo`, no padrão de `com_chamar_sincronizacao()`
   (0701) [EXISTE o padrão]. Vem **desligado** (`administrativo.ged.indexar = false`). Há também o botão "Atualizar índice agora"
   para o gestor.
8. Proposta de frequência: a cada 30 minutos nos dias úteis, das 07h às 19h de Cuiabá.

### 5.4 Pasta → cliente
1. A regra vale para as pastas de 1º nível de uma raiz `clientes` e para qualquer pasta que o usuário marcar como "pasta de cliente".
2. **Sugestão** (função pura `sugerirCliente`, testada):
   - normaliza o nome: sem acento, minúsculo, sem sufixos de ano (`- 2026`), sem `ltda`, `s/a`, `sa`, `me`, `eireli`, `construtora`,
     `construcoes`, `engenharia` (lista configurável);
   - compara com `contrapartes.nome` (tipo `cliente`, `ativo`) por semelhança de palavras;
   - se o nome da pasta ou de um arquivo dela tiver um CNPJ válido (`validarCnpj`), compara com `contrapartes.documento`;
   - devolve até 3 candidatos com nota de 0 a 100 e o motivo ("mesmo CNPJ no nome do arquivo", "nome igual após normalização"…).
3. **Nada é confirmado automaticamente**, nem com nota 100. A pasta fica `sugerida` ou `sem_sugestao` até uma pessoa:
   - **confirmar** um candidato ou escolher outro cliente;
   - ou **ignorar** a pasta, com motivo (ex.: "pasta de fornecedor").
4. Uma pasta tem no máximo um cliente. Um cliente pode ter várias pastas (ex.: uma por ano), e os documentos de todas aparecem juntos.
5. Trocar o cliente de uma pasta já confirmada exige gestor e motivo. Tudo vai para a `auditoria`.
6. Documentos de uma pasta confirmada herdam o `contraparte_id`; nas subpastas, vale a pasta de cliente mais próxima acima.
7. Cliente que não está em `contrapartes` (ex.: `04 - CLIENTES SEM CADASTRO NO SISTEMA`): o GED **não cria** o cadastro. A pasta fica
   `sem_cliente_cadastrado` e entra na fila de conferência [PENDENTE 5].

### 5.5 Tipo documental
1. Catálogo `ged_tipos` (admin geral edita). Os códigos propostos estão na tabela abaixo. A lista final depende do [PENDENTE 6].
2. Cada tipo pode ter regras de nome (`ged_regras_tipo`):
   - **expressão regular** sobre o nome normalizado (sem acento, minúsculo);
   - **prioridade**;
   - opcionalmente, **papel da raiz** ou nome da pasta-mãe.
   A primeira regra que casa, na ordem de prioridade, define o tipo **sugerido**. Nenhuma regra casando: `sem_tipo`.
3. A correção manual sempre vence: o tipo **confirmado** por uma pessoa não é sobrescrito pela reindexação, nem se o nome mudar.
   Uma regra nova só altera documentos ainda `sugerido` ou `sem_tipo`.
4. Rodar as regras de novo é idempotente (`ged_reclassificar()`, só gestor).

Exemplos de regras **ilustrativas**, a validar com os nomes reais [PENDENTE 6]:

| Tipo (código) | Nome | Regra de nome proposta |
|---|---|---|
| `proposta_comercial` | Proposta comercial | `^\d{2}\.\d{3} ?[vl]\b` (ex.: "26.199 V Rev03 …") |
| `contrato_minuta` | Minuta de contrato | `contrato` **e** extensão `.docx`/Google Docs, ou `minuta` |
| `contrato_assinado` | Contrato assinado | `contrato` **e** (`assinad` ou pasta "contratos digitalizados") |
| `aditamento` | Aditamento | `aditament\|aditivo` ou pasta "aditamentos" |
| `termo_quitacao` | Termo de quitação | `quitac` ou pasta "termos de quitacao" |
| `cartao_cnpj` | Cartão CNPJ | `cartao (de )?cnpj` |
| `contrato_social` | Contrato social / alteração | `contrato social\|alteracao contratual\|consolidad` |
| `procuracao` | Procuração | `procurac` |
| `autorizacao_bancaria` | Autorização de faturamento (banco) | `autorizac.*faturament` |
| `nf_venda`, `nf_remessa` | Nota fiscal | **sem regra de nome na v1**: a distinção depende do Fiscal (ver Contratos, PENDENTE) |
| `boleto`, `comprovante` | Financeiro | `boleto`, `comprovante` |
| `termo_entrega` | Termo de entrega | `termo de entrega` |
| `outro` | Outro | — |

A versão em `.pdf` de uma minuta `.docx` com o mesmo nome **não** vira contrato assinado automaticamente; vai como `sugerido` para conferência.

### 5.6 Versão de negócio
1. Cada arquivo do Drive é um documento (`drive_id` único). O histórico do Drive (`headRevisionId`, `modifiedTime`) é guardado como
   informação ("alterado no Drive em …").
2. A **versão de negócio** é declarada por uma pessoa: "este arquivo substitui aquele" (`substitui_id`, com motivo opcional).
   O substituído passa a `substituido`, mas continua consultável. É o mesmo modelo de `fis_documentos` (0201) [EXISTE o padrão].
3. O sistema pode **sugerir** a substituição, sem aplicar, quando dois arquivos da mesma pasta têm o mesmo nome-base e diferem só por
   `V\d+`, `Rev\d+` ou `(\d+)`.

### 5.7 Vínculos
1. Um documento pode ter vários vínculos (`ged_vinculos`), cada um com:
   - **módulo** dono do alvo;
   - **tabela-alvo**;
   - **id do alvo**;
   - **papel** opcional (ex.: "proposta original", "evidência de assinatura").
2. Para vincular, é preciso ser operador da área do documento (5.9) **e** operador do módulo do alvo (`tem_acesso_modulo(modulo, 'operador')`).
3. Desvincular é remoção lógica: grava quem removeu, quando e o motivo. Não há `delete`.
4. Duplicidade: há um vínculo ativo, no máximo, por documento + alvo + papel.
5. Cada módulo publica a lista de tabelas que aceita como alvo (`ged_alvos`: módulo, tabela, rótulo, rota do registro), para o GED
   montar o link de volta. Na v1 entram `contrapartes` (núcleo) e as tabelas `ctr_*` de Contratos.
6. O GED não lê as tabelas internas dos módulos: guarda só módulo, tabela e id. A tela do alvo é que lista os documentos vinculados,
   pela função `ged_documentos_do_alvo(modulo, tabela, id)` (5.10).

### 5.8 Anexos do Supabase Storage (Fase B, integração futura)
1. Os anexos continuam onde estão: tabela `anexos` e bucket `anexos`, ou `fis_documentos` e bucket `fiscal`.
2. Uma view `ged_vw_documentos` (`security_invoker`) une os documentos do Drive e os registros de `anexos`, com colunas comuns:
   origem (`drive`/`storage`), id, nome, tipo, cliente, data, link. Assim a busca alcança os dois **sem copiar linhas**.
   A RLS de `anexos` continua valendo para o que vem do Storage.
3. O tipo dos anexos (`anexos.tipo`, texto livre hoje: boleto, comprovante, contrato…) é traduzido para `ged_tipos` por uma tabela de
   equivalência. `anexos` não muda.
4. `fis_documentos` (Fiscal, privado) **não entra** na view sem decisão do Fiscal [PENDENTE 8].

### 5.9 Permissões e acesso aos arquivos
1. **Leitura no Neo Admin:** quem tem pelo menos `consulta` na **área da pasta-raiz** do documento (`ged_pastas_raiz.area`) vê o
   registro: nome, tipo, cliente, datas e link.
2. **Abrir o arquivo:** o botão leva ao `webViewLink`, e o Google exige que a pessoa tenha acesso ao arquivo no Drive.
   O Neo Admin **não** baixa nem repassa o arquivo, então **não amplia** o acesso de ninguém.
   Quem vê o registro mas não tem acesso no Drive recebe a tela de "Solicitar acesso" do próprio Google.
3. Áreas sensíveis (Jurídico, RH): a raiz delas só aparece para quem tem a área (regra global 6). O texto do índice também segue a RLS.
4. A conta técnica tem só leitura nas pastas-raiz. Quem administra as permissões no Drive continua sendo o dono das pastas.
5. LGPD: guardam-se só metadados (nome, tipo, tamanho, datas, hash e link). Nenhum conteúdo de arquivo é armazenado.

### 5.10 Funções e interfaces públicas do GED (para outros módulos) [PROPOSTA]
| Função | Quem chama | O que faz |
|---|---|---|
| `ged_documentos_do_alvo(p_modulo, p_tabela, p_id)` | telas dos módulos | documentos vigentes vinculados ao alvo, respeitando a RLS |
| `ged_documentos_do_cliente(p_contraparte)` | dossiê, ficha do cliente | documentos das pastas do cliente + vínculos ao cliente |
| `ged_vincular(p_documento, p_modulo, p_tabela, p_id, p_papel)` | telas | cria o vínculo (checa 5.7.2) |
| `ged_desvincular(p_vinculo, p_motivo)` | telas | remoção lógica |
| `ged_tipos_presentes(p_modulo, p_tabela, p_id)` | motor de obrigações (Contratos) | tipos confirmados vinculados ao alvo, para o "documento exigido" |

## 6. Saídas e automações
- **Rodada de indexação**, agendada ou manual, com registro em `ged_indexacoes`.
- **Pendências** pela função do núcleo `publicar_pendencia(jsonb)` [EXISTE, 0097/0099], módulo `administrativo.ged`:

  | Pendência | Chave de origem | Responsável |
  |---|---|---|
  | "Confirmar cliente de N pastas" | `ged:pastas_sugeridas` | gestor da área da raiz |
  | "Classificar N documentos sem tipo" | `ged:sem_tipo:<raiz>` | gestor da área da raiz |
  | "Reautorizar o acesso ao Drive" | `ged:conexao` | admin geral |

  As pendências de contagem são **agregadas**, uma por fila, e não uma por item.
  Quando a contagem zera, são encerradas por `encerrar_pendencia(modulo, chave, status)` [EXISTE, 0097].
- **Atividades:** regras em `atividade_regras` [EXISTE, 0094] para "Confirmou o cliente da pasta {nome}", "Classificou {nome} como
  {tipo}" e "Vinculou {nome} a …".

## 7. Telas [PROPOSTA]
Todas as grades usam `components/ui/table.tsx` (regra global 10).

1. **Central de Documentos** (`/documentos`):
   - busca única por nome do cliente, CNPJ (com ou sem máscara, normalizado por `normalizarDocumento`), nome do arquivo e número
     de proposta ou contrato contido no nome;
   - filtros por tipo, situação do tipo (sem tipo / sugerido / confirmado), pasta-raiz, cliente, período de modificação e "sem vínculo";
   - grade com nome, tipo (selo "sugerido" quando não confirmado), cliente, pasta, alterado em (dd/mm/aaaa), vínculos e ação
     **Abrir no Drive**;
   - painel lateral do documento: metadados, histórico (tipo, versões, vínculos), e ações corrigir tipo, declarar versão,
     vincular e desvincular.
2. **Pastas** (`/documentos/pastas`): árvore das raízes e lista das pastas de cliente com a situação (sugerida, confirmada, ignorada,
   sem sugestão, sem cliente cadastrado). Na pasta sugerida, a pessoa vê os candidatos com a nota e o motivo, confirma ou escolhe outro.
3. **Conferência** (`/documentos/conferencia`): três abas.
   - Pastas a confirmar.
   - Documentos sem tipo.
   - Versões sugeridas.
4. **Configuração** (`/documentos/configuracao`, só admin geral):
   - pastas-raiz;
   - conexão com o Drive (conectar e desconectar, conta, data);
   - tipos e regras, com o botão "testar regra" sobre os nomes já indexados;
   - parâmetros.
5. **Componente `<DocumentosDoRegistro>`** para os módulos usarem no próprio registro (dossiê, ficha do cliente em
   `configuracoes/contrapartes/[id]`): lista os documentos vinculados e traz "Vincular documento", que busca no índice.

## 8. Dados [PROPOSTA] (migrations 0801+)

Toda tabela tem:
- RLS ligada;
- `fn_auditoria` nas tabelas de decisão humana (pastas de cliente, tipos, vínculos, conexão), mas não nas linhas reescritas pela
  indexação, para não inundar a auditoria (5.3);
- `fn_bloquear_delete` em todas;
- `fn_atualizado_em` onde houver `atualizado_em`.

| Tabela | Campos principais | Observações |
|---|---|---|
| `ged_conexao` | `id` (uma linha), `email`, `segredo_id` (Vault), `escopos text[]`, `conectado_em`, `conectado_por`, `desconectado_em`, `ultimo_erro`, `ultimo_erro_em` | usuários não leem `segredo_id`; só funções `security definer` |
| `ged_conexao_estados` | `state` (pk), `perfil_id`, `destino`, `criado_em`, `usado_em` | mesmo desenho de `gmail_conexoes` |
| `ged_pastas_raiz` | `id`, `drive_id` (único), `drive_compartilhado_id`, `nome`, `papel` (`clientes`/`tematica`), `area` → `areas`, `ativa`, `page_token`, `indexada_em`, `reconciliada_em`, `criada_por/em` | — |
| `ged_pastas` | `id`, `raiz_id`, `drive_id` (único), `nome`, `mae_drive_id`, `profundidade`, `situacao` (`ativa`/`removida_no_drive`/`fora_do_escopo`), `web_link`, `visto_em` | estrutura espelhada |
| `ged_pastas_cliente` | `pasta_id` (pk), `situacao` (`sugerida`/`sem_sugestao`/`confirmada`/`ignorada`/`sem_cliente_cadastrado`), `contraparte_id`, `candidatos jsonb` (até 3: id, nota, motivo), `motivo_ignorada`, `confirmado_por/em`, `atualizado_em` | `contraparte_id` obrigatório quando `confirmada` |
| `ged_tipos` | `codigo` (pk), `nome`, `area`, `descricao`, `ativo`, `ordem` | — |
| `ged_regras_tipo` | `id`, `tipo` → `ged_tipos`, `expressao`, `papel_raiz`, `pasta_contem`, `extensoes text[]`, `prioridade`, `ativa` | validação da regex na gravação |
| `ged_documentos` | `id`, `origem` (`drive`), `drive_id` (único), `pasta_id`, `raiz_id`, `nome`, `nome_normalizado`, `mime`, `extensao`, `tamanho_bytes`, `md5`, `drive_revisao`, `criado_no_drive_em`, `alterado_no_drive_em`, `web_link`, `atalho_para`, `contraparte_id` (herdado, 5.4.6), `tipo`, `tipo_situacao` (`sem_tipo`/`sugerido`/`confirmado`), `tipo_regra_id`, `tipo_confirmado_por/em`, `substitui_id`, `situacao` (`vigente`/`substituido`/`removido_no_drive`/`fora_do_escopo`), `primeiro_visto_em`, `visto_em` | busca por `ilike` sobre `nome_normalizado`. O projeto hoje não usa extensões de texto: a 0131 normaliza sem `unaccent`. `pg_trgm` só se aprovado (ponto 9) |
| `ged_vinculos` | `id`, `documento_id`, `modulo` → `modulos`, `tabela`, `alvo_id`, `papel`, `criado_por/em`, `removido_por/em`, `removido_motivo` | único parcial `(documento_id, modulo, tabela, alvo_id, coalesce(papel,''))` onde `removido_em is null` |
| `ged_alvos` | `modulo`, `tabela`, `rotulo`, `rota` (ex.: `/contratos/operacoes/{id}`) | pk `(modulo, tabela)` |
| `ged_indexacoes` | `id`, `raiz_id`, `tipo` (`inicial`/`incremental`/`reconciliacao`), `agendada`, `usuario_id`, `iniciada_em`, `concluida_em`, `resumo jsonb` (novos, alterados, removidos, ignorados), `erro` | mesmo desenho de `com_sincronizacoes` |
| `ged_trava` | uma linha: `tomada_em`, `por` | padrão de `rec_sincronizacao_trava` |

Módulo: `insert into modulos ('administrativo.ged', 'administrativo', 'Central de Documentos', false)`. Fica ativo na publicação.

Relacionamentos:
```
ged_pastas_raiz 1─N ged_pastas 1─N ged_documentos N─1 ged_tipos
ged_pastas 1─0..1 ged_pastas_cliente N─1 contrapartes
ged_documentos 1─N ged_vinculos ─→ (modulo, tabela, alvo_id) registrado em ged_alvos
ged_documentos 0..1─1 ged_documentos (substitui_id)
anexos ─(view ged_vw_documentos, Fase B)─ ged_documentos
```

### 8.1 Estados
| Entidade | Estados | Transições |
|---|---|---|
| Pasta de cliente | `sem_sugestao`, `sugerida`, `confirmada`, `ignorada`, `sem_cliente_cadastrado` | sistema: sem_sugestao↔sugerida (pode reavaliar só essas duas). Pessoa: sugerida/sem_sugestao/sem_cliente → confirmada/ignorada. Gestor: confirmada → outra confirmada (troca, motivo) ou ignorada |
| Tipo do documento | `sem_tipo`, `sugerido`, `confirmado` | sistema: sem_tipo↔sugerido. Pessoa: qualquer → confirmado (e corrige o tipo confirmado, com auditoria) |
| Documento | `vigente`, `substituido`, `removido_no_drive`, `fora_do_escopo` | sistema: vigente ↔ removido/fora (volta a vigente se reaparecer). Pessoa: vigente → substituido (ao declarar versão); substituído não volta a vigente |
| Vínculo | ativo, removido | removido não volta; vincular de novo cria outra linha |
| Conexão | conectada, com_erro, desconectada | `invalid_grant` → com_erro + pendência |

## 9. Permissões
| Nível | Pode |
|---|---|
| `consulta` (na área da raiz) | buscar, ver metadados e vínculos, abrir no Drive (sujeito ao Drive) |
| `operador` | confirmar ou ignorar pasta sugerida, confirmar ou corrigir o tipo, declarar versão, vincular e desvincular (com acesso de operador ao módulo do alvo) |
| `gestor` | trocar o cliente de pasta já confirmada, reclassificar em lote, rodar "Atualizar índice agora" |
| `admin_geral` | pastas-raiz, conexão com o Drive, catálogo de tipos e regras, parâmetros |

RLS de cada tabela:

| Tabela | Leitura | Escrita |
|---|---|---|
| `ged_documentos` | `tem_acesso_area(raiz.area)` | só a função de indexação (service role) e as funções de decisão |
| `ged_vinculos` | quem lê o documento **e** tem `tem_acesso_modulo(modulo)` | pelas funções `ged_vincular`/`ged_desvincular` |
| `ged_conexao` | admin geral | só funções `security definer`; `segredo_id` nunca vai ao navegador |

## 10. Tratamento de erros
| Situação | Comportamento |
|---|---|
| `invalid_grant` (token revogado/expirado) | rodada para; `ged_conexao.ultimo_erro`; pendência "Reautorizar o acesso ao Drive"; índice existente continua consultável |
| 403 numa pasta | a pasta fica marcada com erro na rodada; as demais seguem; aviso na tela de configuração |
| 404 na pasta-raiz | raiz marcada com erro; nada é removido do índice até a reconciliação confirmar |
| 429 / 5xx | novas tentativas com espera exponencial (como o retry de 429 do Consistem, `_shared/consistem-receber.ts`); persistindo, a rodada termina com erro parcial e o token não avança |
| `pageToken` inválido (expirou) | rodada de reconciliação completa automática |
| Duas rodadas ao mesmo tempo | a segunda sai sem fazer nada (trava) |
| Regex inválida no cadastro | recusada na gravação |
| Documento muda de pasta | atualiza `pasta_id`/cliente herdado; vínculos e tipo confirmado ficam |

Mensagens de erro em português na tela. O detalhe técnico fica no registro da rodada (`ged_indexacoes.erro`), sem token nem segredo.
Erros do app usam o padrão de `lib/nucleo/erros.ts` [EXISTE].

## 11. Testes

### 11.1 Vitest (regras puras, em `lib/nucleo/ged/` ou `supabase/functions/_shared/ged.ts`)
1. Normalização de nome:
   - acentos, caixa, sufixo de ano e termos societários;
   - "Amorim Coutinho - 2026" e "AMORIM COUTINHO ENGENHARIA E CONSTRUCOES LTDA" chegam ao mesmo núcleo.
2. `sugerirCliente`:
   - CNPJ válido no nome do arquivo dá nota máxima, com motivo;
   - CNPJ inválido é ignorado;
   - dois clientes parecidos: os dois aparecem nos candidatos;
   - sem candidatos: `sem_sugestao`.
3. Regras de tipo:
   - prioridade;
   - primeira regra que casa;
   - nome sem regra: `sem_tipo`;
   - tipo confirmado nunca é alterado;
   - o exemplo `26.199 V Rev03 - x.pdf` vira `proposta_comercial`.
4. Sugestão de versão: `… - X.pdf` × `… - X V2.pdf` são sugeridos; nomes diferentes não são.
5. Aplicação das mudanças do Drive:
   - inserção;
   - alteração;
   - remoção;
   - lixeira;
   - mudança para fora do escopo;
   - a mesma mudança aplicada duas vezes não muda o resultado (idempotência).
6. Cliente HTTP do GED:
   - só `GET`;
   - `POST`, `PATCH` e `DELETE` lançam erro antes do fetch;
   - **varredura do código** sem chamadas de escrita à Drive API;
   - token nunca aparece em log nem em mensagem de erro.
7. Paginação: `nextPageToken` em várias páginas; o `newStartPageToken` só é gravado no fim.

### 11.2 SQL (PGlite, `tests/db`)
1. RLS:
   - sem a área da raiz, o documento não aparece;
   - com consulta, aparece;
   - vínculo a um módulo sem acesso não aparece.
2. Não há `delete` em nenhuma tabela `ged_*`.
3. Vínculo duplicado ativo é recusado; depois de removido, pode ser recriado.
4. Pasta `confirmada` sem cliente é recusada; a troca de cliente sem gestor é recusada.
5. O tipo confirmado não é sobrescrito pela função de reclassificação.

### 11.3 Edge Function (fetch simulado registrando cada chamada)
1. Carga inicial de uma raiz com duas pastas de clientes e cinco arquivos: o índice fica correto e todas as chamadas são `GET`.
2. Rodada incremental com uma remoção e uma renomeação.
3. `invalid_grant` gera erro, abre a pendência e não altera o índice.
4. Rodar duas vezes seguidas: não há registros duplicados.

### 11.4 Playwright
1. Buscar pelo número de uma proposta e ver o documento.
2. Buscar pelo CNPJ sem máscara e ver os documentos do cliente.
3. Usuário sem a área: a Central aparece vazia ou sem acesso.
4. Confirmar uma pasta sugerida: os documentos passam a mostrar o cliente.

## 12. Critérios de aceite

**Fase A (índice e consulta)**
1. Com a conexão feita e uma raiz cadastrada, a carga inicial indexa todas as subpastas até a profundidade configurada. A contagem
   de pastas e arquivos bate com o Drive, conferida por amostragem de 3 pastas.
2. O registro de atividade do Drive mostra **nenhuma** alteração feita pela conta técnica.
3. Toda pasta de cliente termina como confirmada, ignorada ou sem cliente cadastrado. Nenhuma é confirmada sem pessoa.
4. A busca acha um documento por cliente, por CNPJ (com e sem máscara), por número de proposta e por tipo.
5. Renomear um arquivo no Drive aparece no índice na rodada seguinte, mantendo vínculos e tipo confirmado.
6. Um arquivo enviado à lixeira no Drive passa a "removido no Drive" e não some dos vínculos já feitos.
7. `npm run verificar` passa.

**Fase B (anexos do Storage)**
1. A busca lista os anexos do Storage a que o usuário tem acesso, sem duplicar linhas e sem copiar arquivos.

## 13. Fases deste módulo
| Fase | Escopo | Corresponde no plano da auditoria |
|---|---|---|
| A0 | Conexão (OAuth da conta técnica, Vault) + teste que lista uma raiz e devolve contagens, sem gravar | Fase 1 |
| A1 | Tabelas, carga inicial, incremental, reconciliação, pastas → cliente, tipos e regras, telas 1 a 4 | Fase 2 |
| A2 | Vínculos, versões, componente `<DocumentosDoRegistro>`, funções públicas (5.10) | Fase 2 (fim) / Fase 3 |
| B | View `ged_vw_documentos` com os anexos do Storage | após A2 |
| C | Escrita no Drive (arquivamento de anexos capturados), com especificação e escopo próprios | Fase 4b |

## 14. Pontos em aberto
1. **Pastas-raiz oficiais:** `02 - COMERCIAL / 01 - CLIENTES`, `04 - CONTRATOS E CLIENTES`, ou ambas? Estão em Drive compartilhado
   ou no "Meu Drive" de alguém? Isso muda o `corpora`/`driveId` das chamadas.
2. **Área dona de cada raiz:** Comercial, Contratos ou Administrativo? O Financeiro e o Fiscal devem ver os documentos comerciais?
3. **Autenticação:** conta técnica por OAuth (recomendada) ou conta de serviço? Qual conta? Cliente OAuth novo ou o existente?
4. **Profundidade e frequência:** a profundidade máxima (proposta 4) e a frequência (30 min, dias úteis) servem?
5. **Clientes sem cadastro:** a pasta `04 - CLIENTES SEM CADASTRO NO SISTEMA` deve gerar uma pendência de cadastro no Consistem ou em
   `contrapartes`? Recomendação: só pendência; o cadastro segue o fluxo atual, que liga pelo código do Consistem.
6. **Tipos e regras:** validar a lista de tipos e as regras de nome com uma amostra maior de arquivos.
7. **Rota:** `/documentos` (núcleo, como `/gestao`) ou dentro de uma área (`/administrativo/documentos`)?
8. **Fiscal:** os documentos privados do Fiscal (`fis_documentos`) entram na busca geral? Recomendação: não.
9. **`pg_trgm`:** nenhuma migration usa extensões de texto hoje. A v1 busca com `ilike` sobre o nome normalizado, gravado pela
   indexação. Ligar `pg_trgm` só se o volume exigir, depois de confirmar que a extensão está disponível no `neo-admin-sp`.
