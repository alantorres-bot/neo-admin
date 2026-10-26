# Módulo: Administrativo / GED — Central de Documentos

Status: **aprovada em 24/10/2026** (aprovação documental da revisão 3, pelo responsável). Nada implementado; implementação **não
autorizada**: cada fase depende dos próprios pré-requisitos e de autorização expressa posterior (seção 13).
Revisão 2 (24/10/2026), pelo complemento do responsável sobre a finalidade das pastas:
- duas raízes com finalidade e permissões próprias (elaboração × dossiê de clientes);
- verificação da estrutura antes de indexar;
- cautelas de classificação (modelo, PDF, minuta × assinado);
- revisões do Drive.

Revisão 3 (24/10/2026): incorporação da **R4-P4 — Segurança do GED**, aprovada pelo responsável como **princípio obrigatório**:
- autorização efetiva no banco, nas APIs, nas funções, na busca, nas sugestões, nas atividades e na Central de Gestão (nova seção 5.11
  e seção 9 reescrita);
- limite da Fase 1 (A0) e o bloqueio sobre a persistência do resultado da verificação (5.2.4 e 13).

Os requisitos estão **especificados, não implementados nem testados**. O status continua **rascunho**.

**Correções pós-auditoria (24/10/2026, mesma revisão 3):** tratados os achados da auditoria final do diff que tocam o GED (4 a 9, 11, 13
e 22; marcas **[AF-n]**):
- proteção por linha × por coluna × por superfície de acesso;
- pendências sem expor a raiz `elaboracao`;
- segurança mínima da A0;
- reorganização das fases (A1 dividida, A2 básica);
- checagem de módulo em `ged_tipos_presentes`;
- logs.

As escolhas que dependem de decisão foram para a seção 14 (itens 15 a 19).

**Aprovação documental (24/10/2026):** a **revisão 3** foi aprovada pelo responsável como especificação. Não houve mudança de conteúdo
funcional nem de número de revisão.
- A aprovação **não** transforma propostas em regras vigentes e **não** encerra pendências: os itens 1 a 19 da seção 14 continuam como
  estavam.
- **Não autoriza a implementação** de nenhuma fase: os bloqueios da seção 13 continuam valendo.

**Fase A0: fatos e aprovações (25/10/2026).**
- **Fatos históricos:** a A0 foi implementada e publicada em produção em 24 e 25/10/2026 (migrations 0801 a 0803, Edge Functions
  `nucleo-ged-conectar` e `nucleo-ged-metadados`), com autorização expressa do responsável para cada passo, **antes** das aprovações
  formais abaixo. A conexão foi feita em 24/10/2026 com a conta `alantorres@neoformas.com.br`; as duas raízes foram verificadas
  por completo em 25/10/2026.
- **Decisões e aprovações do responsável em 25/10/2026, posteriores à implantação:**
  - PENDENTE 1 (raízes), PENDENTE 13 (verificação efêmera) e a pasta ALUTEC fora do escopo (seção 14);
  - PENDENTE 17: mecanismo aprovado tecnicamente, conforme implementado e testado na A0 (seção 14, item 17);
  - controles mínimos da 5.2.4.5 implementados e testados: aprovados;
  - cadastro persistente das raízes (`ged_pastas_raiz`) adiado para a A1a: a A0 fica limitada à conexão e à verificação efêmera de
    metadados;
  - conta: mantida a conexão atual com `alantorres@neoformas.com.br` nesta etapa, sem desconectar nem trocar (seção 4.2).
- **Não aprovado:** a revisão 4 como um todo. As propostas que dependem de decisão continuam pendentes.

**Fase A1a: aprovação parcial (25/10/2026).** O responsável aprovou a A1a **só no recorte da indexação**: raízes (0804 e 0805),
índice, rodadas e trava (0806), integração `nucleo-ged-indexar` e agendamento criado inativo (0807).
- **Fatos:** 0804 a 0806 aplicadas e `nucleo-ged-indexar` publicada em 25/10/2026, com o interruptor `administrativo.ged.indexar`
  desligado e nenhum documento indexado. Na 11.5 passam os itens 1, 2, 3, 7, 8, 9, 10, 13 e 14; o item 4, só na leitura.
- **Fica para depois, como condição da A2:** `ged_pastas_cliente`, `ged_tipos`, `ged_regras_tipo`, `ged_vinculos`, `ged_alvos` e os itens
  4 (`ged_vincular`), 5, 6, 11 (log com erro forçado), 12 e 15 da 11.5 (os dois últimos dependem dos PENDENTES 15 e 19).
- **A1b (primeira indexação) continua bloqueada pelo PENDENTE 12**, ainda sem resposta do administrador do Workspace.

Referências:
- revisão técnica: `docs/auditoria/REVISAO_CONTRATOS_REV3_2026-10-24.md` (seção 4, achados G-1 a G-9);
- especificação de Contratos: `docs/modulos/contratos-operacoes.md`, revisão 5.

Origem: `docs/auditoria/AUDITORIA_CONTRATOS_GED_2026-10-24.md`, seções C, D, E e G.

Código proposto: `administrativo.ged` · rota proposta `/documentos` · migrations no núcleo estendido (0801 em diante;
a 0800 já é de `nucleo_apps_pendencias`) · prefixo `ged_` · Edge Functions `nucleo-ged-<funcao>`.

Marcação usada neste documento:
- **[EXISTE]** verificado no repositório (com o arquivo);
- **[PROPOSTA]** a construir;
- **[PENDENTE n]** decisão do responsável, ver a seção 14;
- **[R4-P4 — Segurança do GED]** requisito obrigatório aprovado como princípio pelo responsável. Os controles estão especificados
  aqui, ainda não implementados nem validados.

---

## 1. Objetivo
Localizar, consultar e vincular a processos do Neo Admin os documentos que a empresa já guarda no Google Drive, sem copiar,
mover nem renomear nada. O GED é um **índice com vínculos**: o arquivo continua no Drive; o Neo Admin sabe onde ele está, de
qual cliente é, que tipo de documento é e a qual registro (operação, contrato, título, pedido…) pertence.

É um componente do núcleo, compartilhável por qualquer módulo (Contratos primeiro; depois Financeiro, Fiscal, Jurídico).

## 2. Como é feito hoje

### 2.1 Duas estruturas com finalidades distintas (confirmado pelo responsável em 24/10/2026)
As duas estruturas **não são duplicadas**. Elas guardam momentos diferentes do mesmo processo:

| Estrutura | Finalidade | Conteúdo típico | Como o Neo Admin usa |
|---|---|---|---|
| **Elaboração de contratos** | Arquivos de trabalho, editáveis | modelos padrão, arquivos de trabalho, minutas (`.docx`/`.doc`, às vezes o `.pdf` gerado para envio) | localizar e abrir rapidamente durante a elaboração; vincular as versões da minuta à operação |
| **Dossiê de clientes** | Arquivo documental das operações | documentação cadastral, propostas, contratos assinados, NFs, aditivos e demais documentos do cliente | consulta, dossiê e evidência das obrigações; preservar a organização atual |

### 2.2 Estrutura verificada no Drive (leitura em 24/10/2026, pelo conector do Google Drive, sem alterar nada)
As duas ficam no mesmo **Drive compartilhado** (pai `0ADGzgMWcDLTWUk9PVA`) → `ADMINISTRATIVO` (`19sfdWhV4rVbEQnsKs3pQSRV_CXO7yIOD`)
→ `02 - COMERCIAL` (`1XFf1IVi0E6e7Au3_LSS9hEsRekqNQ1Bc`).

| Raiz candidata | ID | Estrutura observada |
|---|---|---|
| Elaboração: `02 - COMERCIAL / 02 - CONTRATOS` | `1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR` | `Contratos` (`1JOh-QFYw9uwNkxSAdPa6cLzOzIuOiT56`) → `Venda` (`1nm0IYOT5IrXFqaU7HVcpJkULKllPV4E0`), `Locação` (`1JkIYWPM4vs6JSTqgQ040SJZCqDkns4WG`), `Serviços` (`1rd11xczHeKfHPF-HJu4hl41gZoTqCeoK`) |
| | | Dentro de cada tipo, há **pastas de modelos** com nomes diferentes (`Venda/0-PADRÃO`, `Locação/_Modelos`, `Serviços/Modelos`) e **pastas por ano** (`Venda/2023…2026`; `Locação/2016…2026`) |
| | | Arquivos de trabalho com o número do contrato no início: `229 - CONTRATO DE VENDA FÔRMAS - <cliente>.docx`, `228 - … .docx` + `.pdf` |
| | | Há arquivos temporários do Word na estrutura (ex.: `Locação/~WRL0006.tmp`) |
| Dossiê: `02 - COMERCIAL / 01 - CLIENTES` | `1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak` | documentação dos clientes e contratos assinados; uma pasta por cliente, com nome curto (às vezes com o ano), arquivos soltos (seção 2.3) |

Fatos que mudam o desenho:
- **O mesmo nome de arquivo existe nas duas raízes com IDs diferentes.** Exemplo:
  - `229 - CONTRATO DE VENDA FÔRMAS - <cliente>.docx` está na elaboração (`Venda/2026`) **e** na pasta do cliente;
  - são dois arquivos, não um;
  - o dossiê do cliente também tem os PDFs (`… .pdf`, `… V2.pdf`).
- A busca pelo conector é **paginada e não exaustiva**. Os IDs acima são **candidatos**: a lista completa e a confirmação ficam para a
  Fase A0 (5.2.4), antes de qualquer indexação [PENDENTE 1]. **Decisão do responsável (25/10/2026):** a raiz de elaboração é
  `02 - CONTRATOS` inteira (`1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR`), não só a subpasta `Contratos`; o dossiê é `01 - CLIENTES`, que
  guarda a documentação dos clientes **e** os contratos assinados (finalidade distinta da elaboração).
- A pasta `04 - CONTRATOS E CLIENTES` (com `01 - CONTRATOS DIGITALIZADOS`, `02 - ADITAMENTOS`, `03 - TERMOS DE QUITACAO` e
  `04 - CLIENTES SEM CADASTRO NO SISTEMA`) fica em **outra pasta de 1º nível do mesmo Drive compartilhado (`ALUTEC`)**. Não faz
  parte das duas estruturas confirmadas e **fica fora do GED** (decisão do responsável em 25/10/2026).

### 2.3 Como os arquivos são nomeados e versionados
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
| Indexar (só leitura) as pastas-raiz configuradas e suas subpastas, cada uma com finalidade própria (elaboração, dossiê) | Criar, mover, copiar, renomear, excluir, compartilhar ou reorganizar arquivos/pastas no Drive |
| Localizar modelos e arquivos de trabalho na raiz de elaboração | Decidir sozinho qual modelo vale ou qual arquivo é definitivo |
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

**Situação na A0 (25/10/2026):** cliente OAuth novo "Neo Admin GED Drive" (Interno, projeto `neo-admin-neoformas`). A conexão usa a
conta `alantorres@neoformas.com.br`, do próprio responsável, porque não houve autorização para criar uma conta técnica dedicada.
Decisão de 25/10/2026: essa conexão é mantida nesta etapa, sem desconectar nem trocar a conta. Uma troca futura significa
desconectar, configurar a nova conta e conectar de novo.

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

### 5.2 Pastas-raiz (cada uma com finalidade e permissões próprias)
1. Só o `admin_geral` cadastra uma pasta-raiz (`ged_pastas_raiz`), informando o ID ou link do Drive e mais quatro dados:
   - **finalidade**:
     - `elaboracao`: arquivos de trabalho e modelos de contrato;
     - `dossie_cliente`: cada subpasta de 1º nível é a pasta de um cliente, e é o arquivo documental das operações;
     - `tematica`: subpastas por tema, para raízes futuras de outras áreas;
   - **área dona** (`area`), que dá a leitura;
   - **áreas adicionais de leitura** (`areas_leitura`), opcional;
   - **área de operação** (`area_operacao`): quem classifica, confirma e vincula.
   Valores:
   - **elaboração:** dona e operação = `contratos`, **sem `areas_leitura`**.
     - Decisão preliminar D-6 do responsável (Contratos, seção 0): acesso restrito à área Contratos.
     - **R4-P4 — Segurança do GED:** a restrição **não pode depender só de configuração administrativa**. Fica travada no banco (5.11.1):
       uma tela de configuração não consegue ampliá-la.
     - O nível mínimo dentro da área Contratos continua [PENDENTE 14].
   - **dossiê:** dona = `contratos`, leitura adicional proposta para `comercial` e `financeiro`, operação = `contratos` [PENDENTE 2].
2. Ao cadastrar, o sistema lê `files.get` e grava nome, `driveId` (quando é Drive compartilhado) e link.
   Se a conta técnica não enxerga a pasta, o cadastro é recusado.
3. A raiz pode ser desativada, mas não é excluída. Desativada, os documentos dela somem da busca e continuam no índice com
   `situacao = fora_do_escopo`.
4. **Verificação antes de indexar (obrigatória):**
   1. O cadastro da raiz começa em `em_verificacao`. O sistema lista a árvore **só com metadados** e mostra:
      - quantidade de pastas e arquivos por nível;
      - nomes das subpastas de 1º e 2º nível;
      - extensões mais comuns;
      - arquivos temporários encontrados;
      - outras raízes cadastradas que estejam dentro desta ou acima dela.
   2. Só depois de uma pessoa (admin geral) **confirmar o ID, a finalidade e a estrutura** a raiz passa a `ativa` e entra na indexação.
   3. Raízes **sobrepostas** (uma dentro da outra) são recusadas. Uma pasta pertence a uma raiz só.
   4. **Limite da Fase 1 (A0)** [R4-P4 — Segurança do GED]:
      - o resultado da verificação inclui nomes de subpastas, que **são metadados**;
      - até os controles de acesso da 5.11 estarem incorporados e validados (testes da 11.5), o resultado:
        - é **exibido só ao admin geral**;
        - **não é persistido** em nenhum local acessível a outros usuários;
      - o campo `ged_pastas_raiz.verificacao` (seção 8) **não pode ser gravado com nomes de pastas** nesse período;
      - **mecanismo (decidido em 25/10/2026, PENDENTE 13):** resposta efêmera da Edge Function (`nucleo-ged-metadados`, ação
        `verificar_raiz`), exibida só ao admin geral e descartada ao sair da tela. Nada da árvore é gravado; a auditoria guarda só
        quem verificou, a raiz, a contagem e o resultado (migration 0803).
   5. **[AF-6] Segurança mínima da A0.** A A0 já grava e lê dados. Os controles destes itens precisam estar **definidos e aprovados
      antes de qualquer execução da A0**, sem depender das tabelas e políticas da A1a:

      | O que a A0 usa | Operação | Controle mínimo exigido antes da A0 |
      |---|---|---|
      | `ged_conexao` | gravar a conexão; ler o estado | nenhuma leitura direta por usuários; o admin geral lê por projeção sem `segredo_id`; gravação só por função `security definer` que confere o admin geral |
      | `ged_conexao_estados` | criar e consumir o `state` do OAuth | sem leitura nem escrita por usuários; só funções `security definer` (padrão de `gmail_conexoes`, 0153) |
      | Vault (refresh token) | gravar e ler o segredo | só funções `security definer` e a Edge Function; o segredo nunca vai ao navegador |
      | Cadastro da raiz candidata (`ged_pastas_raiz`) | gravar ID, finalidade e áreas, sem nomes de subpastas | leitura direta só do admin geral; gravação só por função do admin geral; a trava da `elaboracao` (5.11.1) já valendo. **Adiado para a A1a (decisão de 25/10/2026):** a A0 não grava raiz; a verificação aceita só os IDs da lista da 2.2 |
      | Edge Function de conexão e verificação | conectar; listar a árvore | recusa quem não for admin geral **antes** de qualquer chamada ao Drive; resposta e logs sem metadados para não-admin (5.11.11) |

      - Testes negativos obrigatórios antes da A0: 11.5, itens 13 e 14.
      - **A A0 não pode começar sem esses controles e sem as decisões dos PENDENTES 13 e 17.** As leituras por projeção desta
        tabela dependem do mecanismo de proteção por coluna [GED PENDENTE 17, AF-6].
      - Exibição da árvore: resposta efêmera, sem armazenamento (PENDENTE 13, decidido em 25/10/2026).
      - **Aprovação (25/10/2026, posterior à implantação da A0):** os controles das linhas `ged_conexao`, `ged_conexao_estados`, Vault e
        Edge Function, implementados e testados (testes 11.5, itens 13 e 14, e a proteção por coluna em `tests/db/ged-conexao.test.ts`),
        foram aprovados pelo responsável. O mecanismo do PENDENTE 17 usado na A0 também foi aprovado: funções de projeção
        `security definer` e nenhum acesso direto de `anon`/`authenticated` às tabelas sensíveis.
5. **As raízes não se deduplicam entre si.** Cada arquivo do Drive é um documento (`drive_id`):
   - dois arquivos com o mesmo nome, ou até o mesmo `md5`, em raízes diferentes são **dois documentos**;
   - o sistema pode exibir a marca "mesmo nome/conteúdo em <outra raiz>" como informação, mas nunca os funde nem esconde um deles.
6. **Pastas com função** (só na raiz `elaboracao`): uma pessoa marca uma subpasta como **pasta de modelos** ou **pasta de trabalho**,
   com um tipo de contrato opcional (venda, locação, serviço). A marcação é feita uma vez e auditada.
   - Não se deduz a função pelo nome da pasta, porque os nomes variam (`0-PADRÃO`, `_Modelos`, `Modelos`).
   - O sistema pode **sugerir** a função quando o nome contém `padrao` ou `modelo`.
7. **Arquivos temporários e de sistema** são registrados como `ignorado` e não aparecem na busca. São os nomes que começam com `~$`
   ou `~WRL`, ou terminam em `.tmp`. A lista de padrões é configurável (`administrativo.ged.ignorar_padroes`).

### 5.3 Indexação
0. Só entram na indexação as raízes `ativa` (verificadas, 5.2.4).
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
   (0701) [EXISTE o padrão]. Vem **desligado** (`administrativo.ged.indexar = false`). Há também a ação "Atualizar índice agora";
   **quem pode executá-la está pendente** [PENDENTE 16, AF-22].
8. Proposta de frequência: a cada 30 minutos nos dias úteis, das 07h às 19h de Cuiabá.

### 5.4 Pasta → cliente
1. A regra vale para as pastas de 1º nível de uma raiz `dossie_cliente` e para qualquer pasta que o usuário marcar como "pasta de
   cliente". Na raiz `elaboracao` **não há pasta de cliente**: os arquivos de trabalho ficam em pastas por tipo e ano. O cliente de um
   arquivo de trabalho só é conhecido pelo **vínculo à operação** (5.7), com sugestão pelo nome (5.4.8).
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
8. **Sugestão para arquivo de trabalho** (raiz `elaboracao`, só sugestão):
   - número de contrato no início do nome (`^\d+ - `), por exemplo "229 - …";
   - nome curto do cliente no fim ("… - <cliente>");
   - o sistema compara com os contratos e as operações já cadastrados no módulo Contratos, pela função pública dele (ver
     `contratos-operacoes.md`), e propõe o vínculo. A confirmação é sempre humana;
   - a função de Contratos (`ctr_alvos_por_numero`) **verifica a autorização de quem pergunta** e devolve vazio para quem não tem a
     área Contratos (5.11.3). A sugestão é calculada na hora, com a permissão do usuário, e nunca gravada fora da RLS (5.11.5).

### 5.5 Tipo documental
1. Catálogo `ged_tipos` (admin geral edita). Os códigos propostos estão na tabela abaixo. A lista final depende do [PENDENTE 6].
2. Cada tipo pode ter regras de nome (`ged_regras_tipo`):
   - **expressão regular** sobre o nome normalizado (sem acento, minúsculo);
   - **prioridade**;
   - opcionalmente, **finalidade da raiz**, **função da pasta** (modelos/trabalho) ou nome da pasta-mãe.
   A primeira regra que casa, na ordem de prioridade, define o tipo **sugerido**. Nenhuma regra casando: `sem_tipo`.
3. A correção manual sempre vence: o tipo **confirmado** por uma pessoa não é sobrescrito pela reindexação, nem se o nome mudar.
   Uma regra nova só altera documentos ainda `sugerido` ou `sem_tipo`.
4. Rodar as regras de novo é idempotente (`ged_reclassificar()`, só gestor).

Exemplos de regras **ilustrativas**, a validar com os nomes reais [PENDENTE 6]:

| Tipo (código) | Nome | Regra de nome proposta |
|---|---|---|
| `proposta_comercial` | Proposta comercial | `^\d{2}\.\d{3} ?[vl]\b` (ex.: "26.199 V Rev03 …") |
| `modelo_contrato` | Modelo de contrato | arquivo dentro de uma **pasta de modelos** marcada (5.2.6), na raiz `elaboracao` |
| `contrato_minuta` | Minuta de contrato (qualquer versão) | `^\d+ - contrato` dentro de uma **pasta de trabalho** da raiz `elaboracao`; ou `minuta` |
| `contrato_assinado` | Contrato assinado | **sem regra automática por extensão.** Sugerido só com `assinad` no nome ou numa pasta marcada para isso; sempre conferido por uma pessoa |
| `aditamento` | Aditamento | `aditament\|aditivo` ou pasta "aditamentos" |
| `termo_quitacao` | Termo de quitação | `quitac` ou pasta "termos de quitacao" |
| `cartao_cnpj` | Cartão CNPJ | `cartao (de )?cnpj` |
| `contrato_social` | Contrato social / alteração | `contrato social\|alteracao contratual\|consolidad` |
| `procuracao` | Procuração | `procurac` |
| `autorizacao_bancaria` | Autorização de faturamento (banco) | `autorizac.*faturament` |
| `nf_venda`, `nf_remessa` | Nota fiscal | **sem regra de nome na v1**: a distinção depende do Fiscal (ver Contratos, item 1) |
| `boleto`, `comprovante` | Financeiro | `boleto`, `comprovante` |
| `termo_entrega` | Termo de entrega | `termo de entrega` |
| `outro` | Outro | — |

**Regras de cautela** (exigência do responsável, 24/10/2026):
1. **Editável não significa modelo aprovado.** Um arquivo em pasta de modelos é classificado como `modelo_contrato` com
   `modelo_situacao = nao_avaliado`.
   - Só o gestor de Contratos marca `aprovado` (com data) ou `obsoleto`.
   - A tela da elaboração mostra primeiro os aprovados, e sinaliza os não avaliados.
   - Hoje existe pelo menos um caso que mostra o risco: `Venda/0-PADRÃO` tem `CONTRATO DE VENDA FÔRMAS.docx`, `… 2.docx`,
     `.doc` e `.pdf`, e qual deles vale não é sabido.
2. **PDF não significa definitivo.** A extensão `.pdf` nunca, por si só, classifica um documento como `contrato_assinado`.
   - A versão `.pdf` de uma minuta `.docx` com o mesmo nome vai como `contrato_minuta` sugerido.
   - Um PDF no dossiê do cliente com "CONTRATO" no nome vai como `sugerido`, sem tipo definitivo.
3. **Minuta, minuta aprovada e contrato assinado são coisas diferentes:**
   - **minuta** é o tipo documental de qualquer versão de trabalho;
   - **minuta aprovada** é um **estado** de uma versão específica, registrado no módulo Contratos (`ctr_minutas.situacao = aprovada`),
     e não um tipo de arquivo;
   - **contrato assinado** é outro documento (`contrato_assinado`), confirmado por uma pessoa e exigido como evidência da assinatura.
   - A tela mostra os três com selos distintos.
4. A raiz não define o tipo, mas pode **limitar** a sugestão. Na raiz `elaboracao` não se sugere `contrato_assinado`, `nf_*`, `boleto`
   nem documentação cadastral (pode-se classificar à mão). Na raiz `dossie_cliente` não se sugere `modelo_contrato`.

### 5.6 Versão de negócio
1. Cada arquivo do Drive é um documento (`drive_id` único). O histórico do Drive (`headRevisionId`, `modifiedTime`) é guardado como
   informação ("alterado no Drive em …").
   - Como um arquivo de trabalho `.docx` pode ser editado no mesmo lugar, a cada rodada em que o `headRevisionId` mudar o índice guarda
     uma linha em `ged_documento_revisoes` (revisão, data e tamanho; sem o conteúdo).
   - Assim, ao vincular uma versão de minuta, o módulo Contratos registra **qual revisão do Drive** foi a enviada ou a aprovada.
   - O conteúdo dessa revisão continua no histórico do Drive, que o Google pode descartar por idade; para guardar de fato, a evidência
     é o PDF enviado ao cliente.
     - Decisão preliminar D-4 do responsável (Contratos): registrar **as duas coisas**, a revisão do DOCX e o PDF efetivamente enviado.
     - O **estado da evidência do PDF** (`pdf_situacao`) pertence ao módulo Contratos e tem o significado definido em
       `contratos-operacoes.md`, 5.5.3. O GED só guarda o documento e o vínculo.
     - **O GED não apresenta um PDF como "vinculado" se ele não estiver confirmado** (`tipo_situacao = confirmado`) e com vínculo ativo
       [PENDENTE 10].
     - **[AF-11] Fonte de verdade da evidência: decisão pendente** [PENDENTE 18; Contratos, item 30]:
       - o Contratos guarda `ctr_minutas.pdf_documento_id`, imutável depois do envio; o GED guarda o vínculo, que admite desvínculo
         lógico (5.7.3);
       - até a decisão, a proposta é que um documento referenciado como PDF enviado de uma versão **não possa ser desvinculado** no GED,
         e que, se ele sair do Drive ou do escopo, a versão ganhe a marca "evidência indisponível", em vez de voltar a pendente;
       - nada disso está aprovado.
2. A **versão de negócio** é declarada por uma pessoa: "este arquivo substitui aquele" (`substitui_id`, com motivo opcional).
   O substituído passa a `substituido`, mas continua consultável. É o mesmo modelo de `fis_documentos` (0201) [EXISTE o padrão].
3. O sistema pode **sugerir** a substituição, sem aplicar, quando dois arquivos da mesma pasta têm o mesmo nome-base e diferem só por
   `V\d+`, `Rev\d+` ou `(\d+)`.
4. A substituição só vale **dentro da mesma raiz**. Um arquivo do dossiê nunca "substitui" um arquivo de trabalho, nem o contrário:
   - são etapas diferentes do mesmo processo;
   - a ligação entre eles é o **vínculo à mesma operação ou contrato** (5.7), com papéis distintos.

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
7. **O vínculo não depende da pasta.** A mesma operação pode reunir, por exemplo:
   - a proposta original (dossiê do cliente);
   - as versões da minuta (elaboração);
   - o contrato assinado (dossiê).
   O resultado traz a **raiz e a finalidade** de cada documento, para a tela separar "Em elaboração" de "Arquivo do cliente".

### 5.8 Anexos do Supabase Storage (Fase B, integração futura)
1. Os anexos continuam onde estão: tabela `anexos` e bucket `anexos`, ou `fis_documentos` e bucket `fiscal`.
2. Uma view `ged_vw_documentos` (`security_invoker`) une os documentos do Drive e os registros de `anexos`, com colunas comuns:
   origem (`drive`/`storage`), id, nome, tipo, cliente, data, link. Assim a busca alcança os dois **sem copiar linhas**.
   A RLS de `anexos` continua valendo para o que vem do Storage.
3. O tipo dos anexos (`anexos.tipo`, texto livre hoje: boleto, comprovante, contrato…) é traduzido para `ged_tipos` por uma tabela de
   equivalência. `anexos` não muda.
4. `fis_documentos` (Fiscal, privado) **não entra** na view sem decisão do Fiscal [PENDENTE 8].

### 5.9 Permissões e acesso aos arquivos
0. **Decisão do responsável (26/10/2026), em vigor:** dentro do Neo Admin, **só o admin geral** acessa o GED (tela, atalho e dados). Os
   demais colaboradores continuam com o acesso que já têm diretamente no Google Drive; nada muda no Drive. No banco,
   `ged_pode_ler_raiz` = `eh_admin_geral()` (migration 0809), o que vale para a RLS e as projeções. As áreas das raízes e a trava da
   elaboração continuam gravadas; a regra por área abaixo volta a valer só com nova decisão e migration.
1. **Leitura no Neo Admin** (regra por área, suspensa pela decisão do item 0):
   - quem tem pelo menos `consulta` na **área dona** da pasta-raiz (`ged_pastas_raiz.area`) **ou** numa das `areas_leitura` vê o
     registro: nome, tipo, cliente, datas e link;
   - **classificar, confirmar e vincular** exige `operador` na `area_operacao` da raiz;
   - a raiz `elaboracao` é **restrita à área Contratos, de forma travada** (5.2.1 e 5.11.1). O dossiê segue a configuração dele
     [PENDENTE 2];
   - a regra vale em **todas** as camadas, e não só na tela (5.11).
2. **Abrir o arquivo:** o botão leva ao `webViewLink`, e o Google exige que a pessoa tenha acesso ao arquivo no Drive.
   O Neo Admin **não** baixa nem repassa o arquivo, então **não amplia** o acesso de ninguém.
   Quem vê o registro mas não tem acesso no Drive recebe a tela de "Solicitar acesso" do próprio Google.
3. Áreas sensíveis (Jurídico, RH): a raiz delas só aparece para quem tem a área (regra global 6). O texto do índice também segue a RLS.
4. A conta técnica tem só leitura nas pastas-raiz. Quem administra as permissões no Drive continua sendo o dono das pastas.
5. LGPD: guardam-se só metadados (nome, tipo, tamanho, datas, hash e link). Nenhum conteúdo de arquivo é armazenado.

### 5.10 Funções e interfaces públicas do GED (para outros módulos) [PROPOSTA]
O modo de segurança de cada função é **parte do requisito** [R4-P4 — Segurança do GED]. Função sem modo definido não pode ser
implementada.

| Função | Quem chama | O que faz | Modo de segurança exigido |
|---|---|---|---|
| `ged_documentos_do_alvo(p_modulo, p_tabela, p_id)` | telas dos módulos | documentos vigentes vinculados ao alvo, respeitando a RLS | `security invoker` (vale a RLS de quem chama) |
| `ged_documentos_do_cliente(p_contraparte)` | dossiê, ficha do cliente | documentos das pastas do cliente + vínculos ao cliente | `security invoker` |
| `ged_modelos(p_tipo_contrato)` | elaboração de contrato (Contratos) | modelos da raiz `elaboracao` para o tipo, com `modelo_situacao` (aprovados primeiro) | `security invoker`; sem a área Contratos, devolve vazio pela própria RLS |
| `ged_buscar_trabalho(p_texto, p_tipo_contrato, p_ano)` | elaboração de contrato | arquivos das pastas de trabalho (ex.: pelo número "229") | `security invoker` |
| `ged_vincular(p_documento, p_modulo, p_tabela, p_id, p_papel)` | telas | cria o vínculo (checa 5.7.2) | `security definer`, **checando antes** a leitura do documento (`ged_pode_ler_raiz`) e `operador` na área de operação da raiz e no módulo do alvo; mensagem de erro única, sem revelar se o documento existe |
| `ged_desvincular(p_vinculo, p_motivo)` | telas | remoção lógica | `security definer`, com as mesmas checagens |
| `ged_tipos_presentes(p_modulo, p_tabela, p_id)` | motor de obrigações (Contratos) | tipos confirmados vinculados ao alvo, para o "documento exigido" | `security definer` que devolve **só códigos de tipo ou booleanos**, nunca nome, link ou id de documento. **[AF-13]** Antes de qualquer leitura, confere que quem chama tem acesso de operador **ao módulo do alvo informado** (`p_modulo`), pela função oficial de permissão por módulo (`tem_acesso_modulo`, 0002/0152, que já resolve a área do módulo e a `unidade_restrita`), e que `p_tabela` está registrada para esse módulo em `ged_alvos`. Sem isso, devolve vazio. A redação anterior, "Contratos ou a área do módulo chamador", foi retirada. Nomes e parâmetros exatos: a validar contra o código [PENDENTE 19] |
| `ged_pode_ler_raiz(p_raiz)` [nova] | políticas de RLS | ver 5.11.2 | `security definer`, `stable`, sem efeitos colaterais |

### 5.11 Segurança efetiva [R4-P4 — Segurança do GED]
**Princípio obrigatório, aprovado pelo responsável:** a autorização vale no banco, nas APIs, nas funções, na busca, nas sugestões, nas
atividades e na Central de Gestão. **Esconder um elemento na tela não é controle de segurança.** Todos os itens abaixo são
**requisitos especificados, ainda não implementados nem testados**.

1. **Proteção da raiz `elaboracao`, travada no banco:**
   - `finalidade = 'elaboracao'` implica `area = 'contratos'`, `area_operacao = 'contratos'` e `areas_leitura` vazio, garantido por
     `check` ou gatilho;
   - a tela de configuração não consegue mudar isso; uma mudança exige migration aprovada;
   - o nível mínimo dentro da área Contratos (consulta ou operador) continua [PENDENTE 14].
2. **Uma função de acesso, `ged_pode_ler_raiz(raiz_id)`:**
   - verdadeira para o admin geral, ou para quem tem `consulta` na área dona ou numa `areas_leitura`;
   - usada pelas políticas de **todas** as tabelas `ged_*` que carregam `raiz_id`, direta ou indiretamente (seção 9);
   - o usuário com `unidade_restrita` já fica sem nenhuma área (`nivel_area`, 0152), então não lê nenhuma raiz.
3. **Funções e endpoints:**
   - toda função com o modo de segurança declarado (5.10);
   - funções `security definer` checam a autorização **antes** de qualquer leitura e devolvem o mínimo necessário;
   - funções de outros módulos chamadas pelo GED (ex.: `ctr_alvos_por_numero`) verificam a autorização de quem pergunta e devolvem
     vazio sem ela;
   - as telas do Next usam o cliente do usuário (`lib/supabase/servidor.ts`), **nunca** a service role (CLAUDE.md, Segurança);
   - as Edge Functions do GED (service role) devolvem a quem chamou **só contagens e mensagens genéricas**, nunca nomes, ids ou links.
4. **Acesso direto por identificador e enumeração:**
   - rotas e componentes que recebem `documento_id`, `pasta_id` ou `raiz_id` buscam o registro **pela RLS do usuário**;
   - sem linha devolvida, a resposta é sempre a mesma: "não encontrado". Não se distingue "não existe" de "sem acesso";
   - as mensagens de erro das funções (ex.: `ged_vincular`) também não distinguem os dois casos;
   - o `webViewLink` só é entregue a quem lê o registro. O Drive continua sendo a última barreira (item 8).
5. **Busca e sugestões:**
   - calculadas na hora, com o cliente do usuário e a RLS;
   - contagens, facetas e "N resultados" vêm da mesma consulta com RLS: não há contagem global;
   - **nenhuma sugestão é gravada** em tabela fora da RLS dos documentos;
   - a sugestão de vínculo para quem não lê `elaboracao` não traz arquivos dessa raiz.
6. **Atividades da Central de Gestão, pendências e mensagens externas:**
   - a tabela `atividades` (0094) é lida por quem tem `acompanha_equipe`, **sem filtro de área**;
   - por isso, as descrições das regras de `atividade_regras` do GED, os títulos e descrições de pendências e as mensagens do Slack e
     do ClickUp **não contêm nome de arquivo, nome de pasta nem link** de documentos de raízes restritas;
   - usar o tipo e o alvo ("Vinculou um documento (minuta) à operação 0042");
   - as regras previstas na seção 6 com `{nome}` foram ajustadas por este requisito.
7. **Respostas sem metadados protegidos:**
   - quem não pode ver uma raiz recebe só o aviso fixo de acesso restrito, igual haja ou não documento;
   - sem nome, link, quantidade, data, tipo ou id.
8. **Permissões reais do Drive compartilhado** (validação externa, [PENDENTE 12]):
   - as duas raízes estão no mesmo Drive compartilhado (2.2);
   - se os membros desse Drive incluem pessoas de fora da área Contratos, elas abrem os arquivos de elaboração **direto no Drive**, e
     o Neo Admin não impede isso;
   - o administrador do Workspace precisa conferir os membros e decidir se a elaboração precisa de permissões próprias no Drive;
   - **sem essa validação, a restrição da elaboração vale no Neo Admin, mas não no Drive.**
   - **Decisão final do responsável (26/10/2026) — PENDENTE 12 resolvido (opção 4):**
     - **nenhuma permissão do Google Drive é alterada:** membros, compartilhamentos e permissões do Drive compartilhado ficam como estão;
     - os colaboradores continuam acessando os documentos **direto pelo Drive**, conforme as permissões atuais, inclusive a elaboração
       (`02 - CONTRATOS`) e o dossiê (`01 - CLIENTES`). Isso é aceito;
     - **dentro do Neo Admin**, só os admins gerais (Alan e Rodrigo) acessam o GED (decisão de 26/10/2026, migration 0809, 5.9.0);
     - a restrição do Neo Admin **não é** uma mudança de permissão no Drive: uma não substitui nem altera a outra;
     - a conexão do GED usa a conta do Alan, membro do Drive: a indexação não depende de mudar nada no Drive.
   - Registro anterior, substituído por esta decisão: na mesma data cogitou-se deixar só o Alan como membro do Drive; foi descartado
     porque tiraria o acesso direto de todos os demais ao Drive inteiro (`ADMINISTRATIVO`, `ALUTEC`, `01 - CLIENTES`).
9. **Pré-condição para indexar:** nenhuma raiz entra na indexação (etapa A1b) antes de os testes de autorização da 11.5 passarem.
10. **[AF-4] Proteção por linha, por coluna e por superfície de acesso:**
    - **por linha (RLS):** decide **quais linhas** alguém lê. **Não esconde colunas** da linha liberada. Quem lê a linha pela API
      (PostgREST) recebe todas as colunas a que a tabela der acesso;
    - **por coluna:** campos sensíveis de uma linha legível (ex.: `ged_pastas_raiz.verificacao` e `page_token`,
      `ged_indexacoes.erro`, `ged_conexao.segredo_id`) exigem **leitura direta da tabela restrita** a quem pode ver esses campos (ex.:
      só o admin geral). Os demais usuários leem por **projeção de campos autorizados** (view ou função que devolve só as colunas
      liberadas), por **permissão por coluna** do Postgres, ou por mecanismo equivalente. **O mecanismo é decisão técnica a validar**
      [GED PENDENTE 17];
    - **por superfície:** o mesmo controle vale para a API direta, as telas do Next, as funções, as Edge Functions, a busca, as
      sugestões, as pendências, as atividades e as mensagens externas;
    - **comprovação:** cada campo sensível tem um teste negativo (11.5, itens 9 e 10).
11. **[AF-22] Logs e mensagens técnicas:**
    - os logs das Edge Functions do GED (registro do Supabase) e `ged_indexacoes.erro` **não contêm** nomes, ids nem links de arquivos
      ou pastas de raízes restritas;
    - para diagnóstico, guardar o código do erro, a etapa, o id da raiz (só para o admin geral), as contagens e o status HTTP do Google;
    - teste: 11.5, item 11.

### 5.12 Padronização de nomes (v1, sem IA externa) [EM DESENVOLVIMENTO — 0811 só local]
Tela `Documentos > Padronização de nomes` (`/documentos/padronizacao`), só admin geral. A v1 **sugere e registra** o nome padronizado;
**nada é renomeado, movido ou apagado no Google Drive** (id e link originais preservados).
1. **Padrão:** `TIPO - IDENTIFICADOR - Assunto - Cliente - AAAA-MM-DD.ext`. Tipo em maiúsculas, do catálogo `ged_tipos`; demais
   campos sem acento, com espaços simples e sem `/ \ : * ? " < > |`; campo sem evidência é **omitido** (nunca inventado); data só
   do conteúdo (XML `dhEmi` ou data com rótulo de emissão/assinatura no texto), nunca a data do Drive; extensão original em
   minúscula; até 150 caracteres (corta o assunto primeiro); colisão na mesma pasta ganha ` (2)`, ` (3)`.
   Ex.: `NF REMESSA - 794 - Remessa 02 - Construteto - 2025-07-14.pdf`; `PROPOSTA - 26.120 Rev01 - 2o Jogo Mossoro - EC Construtora.pdf`.
2. **Tipos (catálogo inicial):** contrato de venda, de locação, de serviço, aditamento, contrato assinado (só com evidência D4Sign ou
   assinatura), modelo de contrato, proposta comercial, NF de venda, de remessa, de retorno, fatura de locação (FL), medição, carta de
   correção, DIFAL, boleto, comprovante, cartão CNPJ, contrato social, QSA, procuração, documento pessoal, inscrição estadual, termo
   de quitação, projeto e outro (`DOCUMENTO`).
3. **Análise** (Edge `nucleo-ged-analisar`, JWT de admin geral): até 20 documentos por chamada, 15 MB por arquivo, prazo de 100 s;
   o que não couber fica para a próxima (retomável pelo estado em `ged_analises`). Lê o arquivo pelo Drive (`drive.readonly`) e extrai
   o texto **na própria função**: PDF com camada de texto (até 10 páginas), DOCX, XLSX e XML de NF-e. Não lidos na v1: PDF escaneado
   e imagens (sem OCR), `.doc`, `.xls`, `.zip`, `.p7s`, atalhos e arquivos nativos do Google — ficam com sugestão só pelo nome e pasta.
   O texto **não é gravado nem vai a log**; só os campos derivados, cada um com a evidência (nome, pasta, conteúdo, cadastro).
   Cliente: CNPJ do texto no cadastro de contrapartes (excluídos os CNPJs do grupo), senão nome parecido (≥ 90), senão a pasta.
   Confiança: alta (nome e conteúdo concordam), média (um deles), baixa (só metadados).
4. **Decisão:** aprovar, editar (o nome passa pelo mesmo normalizador) ou rejeitar (motivo obrigatório), por `ged_decidir_analise`,
   com registro em `auditoria` (histórico na tela). Nova revisão do arquivo reabre a análise; a mesma revisão não sobrescreve decisão.
   Sem exclusão. Renomear no Drive, OCR e IA ficam para entregas futuras, cada uma com aprovação própria.

## 6. Saídas e automações
- **Rodada de indexação**, agendada ou manual, com registro em `ged_indexacoes`.
- **Pendências** pela função do núcleo `publicar_pendencia(jsonb)` [EXISTE, 0097/0099]. O **módulo** em que cada pendência é publicada
  (`administrativo.ged` ou o módulo da área dona da raiz) depende do PENDENTE 15 [AF-5]; só a de conexão é, desde já, de
  `administrativo.ged`:

  **[AF-5]** As duas primeiras linhas abaixo dizem **o que** precisa virar pendência, e **não** o formato. O texto, a chave de origem,
  a exposição de contagens e o **módulo responsável** dependem do PENDENTE 15. Até a decisão, nenhuma pendência pode revelar raiz
  restrita nem contagem de documentos dessa raiz.

  | Situação que precisa virar pendência | Texto, chave e módulo | Responsável |
  |---|---|---|
  | pastas de cliente aguardando confirmação | **a definir** [PENDENTE 15] (forma anterior, fora de vigência: ~~"Confirmar cliente de N pastas" / `ged:pastas_sugeridas`~~) | gestor da área da raiz |
  | documentos sem tipo aguardando classificação | **a definir** [PENDENTE 15] (forma anterior, fora de vigência: ~~"Classificar N documentos sem tipo" / `ged:sem_tipo:<raiz>`~~) | gestor da área da raiz |
  | conexão com o Drive inválida | "Reautorizar o acesso ao Drive" / `ged:conexao` (não cita raiz nem documento) | admin geral |

  As pendências dessas filas são **agregadas**, uma por fila, e não uma por item. Se o texto mostra ou não a contagem depende do
  PENDENTE 15. Quando a fila se esvazia, a pendência é encerrada por `encerrar_pendencia(modulo, chave, status)` [EXISTE, 0097].
  - **[AF-5] Visibilidade:** a leitura de pendências segue o **módulo** da pendência (`pendencias_ler`, 0002). Publicadas no módulo
    `administrativo.ged`, elas seriam lidas por quem tem a área **Administrativo**. Isso exporia a existência e a contagem de
    documentos da raiz `elaboracao` a quem não pode lê-la. Também não basta que o responsável individual a veja
    (`pendencias_ler_proprias`, 0092).
  - **Regra:** nenhuma pendência do GED revela a existência, a contagem ou a identificação de uma raiz a quem não pode ler essa raiz.
  - **Alternativas, sem escolha feita** [PENDENTE 15]:
    - (a) publicar as pendências de cada raiz no **módulo da área dona da raiz** (ex.: as da `elaboracao` em `contratos.contratos`);
    - (b) usar, em `administrativo.ged`, pendências que não revelem a raiz nem as contagens (ex.: "Há itens do GED para conferir",
      com o detalhe só na tela do GED, sob a RLS).
  - **Testes** (11.5, item 12): usuário só da área Administrativo, usuário de Contratos e usuário com `unidade_restrita`.
  - A pendência "Reautorizar o acesso ao Drive" não cita raízes nem documentos.
- **Atividades:** regras em `atividade_regras` [EXISTE, 0094], **sem nome de arquivo nem de pasta** [R4-P4 — Segurança do GED, 5.11.6].
  Exemplos: "Confirmou o cliente de uma pasta do dossiê", "Classificou um documento como {tipo}", "Vinculou um documento ({tipo}) a
  {alvo}". Os textos anteriores com `{nome}` foram retirados.

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
   - a busca tem o filtro **Finalidade** (Elaboração / Dossiê de clientes / todas) e mostra a raiz em cada linha. Arquivos com o mesmo
     nome nas duas raízes aparecem como duas linhas, com a marca informativa (5.2.5).
2. **Pastas** (`/documentos/pastas`): árvore das raízes e lista das pastas de cliente com a situação (sugerida, confirmada, ignorada,
   sem sugestão, sem cliente cadastrado). Na pasta sugerida, a pessoa vê os candidatos com a nota e o motivo, confirma ou escolhe outro.
   - Na raiz de elaboração, a árvore permite marcar a função de cada pasta (modelos / trabalho, com tipo de contrato).
3. **Elaboração** (`/documentos/elaboracao`, para quem tem a área de operação da raiz):
   - **Modelos** por tipo de contrato: aprovados primeiro, não avaliados sinalizados; o gestor aprova ou marca obsoleto;
   - **Arquivos de trabalho**: recentes, com busca por número do contrato ou cliente, e **Abrir no Drive**;
   - o mesmo conteúdo é oferecido dentro do dossiê da operação (ver Contratos).
4. **Conferência** (`/documentos/conferencia`): três abas.
   - Pastas a confirmar.
   - Documentos sem tipo.
   - Versões sugeridas.
5. **Configuração** (`/documentos/configuracao`, só admin geral):
   - pastas-raiz, com a **verificação**: árvore resumida, temporários e sobreposição; botão "Confirmar estrutura e ativar";
     finalidade e áreas (dona, leitura, operação). Na raiz `elaboracao`, as áreas aparecem **travadas** (5.11.1). O resultado da
     verificação segue o limite da 5.2.4.4: só o admin geral vê e nada é persistido de forma acessível a outros;
   - conexão com o Drive (conectar e desconectar, conta, data);
   - tipos e regras, com o botão "testar regra" sobre os nomes já indexados;
   - parâmetros.
6. **Componente `<DocumentosDoRegistro>`** para os módulos usarem no próprio registro (dossiê, ficha do cliente em
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
| `ged_pastas_raiz` | `id`, `drive_id` (único), `drive_compartilhado_id`, `nome`, `finalidade` (`elaboracao`/`dossie_cliente`/`tematica`), `area` → `areas`, `areas_leitura text[]`, `area_operacao`, `situacao` (`em_verificacao`/`ativa`/`inativa`), `verificacao jsonb` (resumo da árvore), `verificada_por/em`, `page_token`, `indexada_em`, `reconciliada_em`, `criada_por/em` | raízes sobrepostas são recusadas; raiz `elaboracao` com áreas travadas (5.11.1); **`verificacao` não guarda nomes de pastas** até a decisão da 5.2.4.4 [PENDENTE 13] |
| `ged_pastas` | `id`, `raiz_id`, `drive_id` (único), `nome`, `mae_drive_id`, `profundidade`, `funcao` (`modelos`/`trabalho`/nulo; só na raiz `elaboracao`), `funcao_tipo_contrato`, `funcao_definida_por/em`, `situacao` (`ativa`/`removida_no_drive`/`fora_do_escopo`), `web_link`, `visto_em` | estrutura espelhada; uma pasta, uma raiz |
| `ged_pastas_cliente` | `pasta_id` (pk), `situacao` (`sugerida`/`sem_sugestao`/`confirmada`/`ignorada`/`sem_cliente_cadastrado`), `contraparte_id`, `candidatos jsonb` (até 3: id, nota, motivo), `motivo_ignorada`, `confirmado_por/em`, `atualizado_em` | `contraparte_id` obrigatório quando `confirmada` |
| `ged_tipos` | `codigo` (pk), `nome`, `area`, `descricao`, `ativo`, `ordem` | — |
| `ged_regras_tipo` | `id`, `tipo` → `ged_tipos`, `expressao`, `finalidade_raiz`, `funcao_pasta`, `pasta_contem`, `extensoes text[]`, `prioridade`, `ativa` | validação da regex na gravação |
| `ged_documentos` | `id`, `origem` (`drive`), `drive_id` (único), `pasta_id`, `raiz_id`, `nome`, `nome_normalizado`, `mime`, `extensao`, `tamanho_bytes`, `md5`, `drive_revisao`, `criado_no_drive_em`, `alterado_no_drive_em`, `web_link`, `atalho_para`, `contraparte_id` (herdado, 5.4.6), `tipo`, `tipo_situacao` (`sem_tipo`/`sugerido`/`confirmado`), `tipo_regra_id`, `tipo_confirmado_por/em`, `modelo_situacao` (`nao_avaliado`/`aprovado`/`obsoleto`, só para `modelo_contrato`), `modelo_avaliado_por/em`, `substitui_id` (mesma raiz), `situacao` (`vigente`/`substituido`/`removido_no_drive`/`fora_do_escopo`/`ignorado`), `primeiro_visto_em`, `visto_em` | busca por `ilike` sobre `nome_normalizado`. O projeto hoje não usa extensões de texto: a 0131 normaliza sem `unaccent`. `pg_trgm` só se aprovado (ponto 9) |
| `ged_documento_revisoes` | `documento_id`, `drive_revisao`, `alterado_no_drive_em`, `tamanho_bytes`, `md5`, `visto_em` | pk `(documento_id, drive_revisao)`; só inserção |
| `ged_vinculos` | `id`, `documento_id`, `drive_revisao` (opcional: a revisão vinculada), `modulo` → `modulos`, `tabela`, `alvo_id`, `papel`, `criado_por/em`, `removido_por/em`, `removido_motivo` | único parcial `(documento_id, modulo, tabela, alvo_id, coalesce(papel,''))` onde `removido_em is null` |
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
| Pasta-raiz | `em_verificacao`, `ativa`, `inativa` | admin geral: em_verificacao → ativa (confirma ID, finalidade e estrutura); ativa ↔ inativa |
| Modelo (`modelo_situacao`) | `nao_avaliado`, `aprovado`, `obsoleto` | gestor da área de operação; toda mudança auditada |
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
| `gestor` | trocar o cliente de pasta já confirmada, reclassificar em lote |
| **a definir** [PENDENTE 16] | **[AF-22]** "Atualizar índice agora": o perfil e a área autorizados ainda **não foram escolhidos**. As alternativas estão no item 16 da seção 14. Qualquer que seja a decisão, a resposta traz só contagens das raízes que a pessoa lê |
| `admin_geral` | pastas-raiz, conexão com o Drive, catálogo de tipos e regras, parâmetros |

Autorização por tabela e operação [R4-P4 — Segurança do GED]. Toda tabela tem RLS ligada e **nenhuma** política de `delete`.
"Indexação" = Edge Function com service role. "Funções de decisão" = funções que checam o nível antes de gravar (5.10).

**[AF-4] Atenção:** a RLS controla **linhas**. Onde a tabela abaixo diz "sem a coluna X", a restrição de coluna **não** vem da RLS. Ela
exige leitura direta restrita mais projeção de campos autorizados, permissão por coluna ou mecanismo equivalente, **a validar**
(5.11.10, GED PENDENTE 17).

| Tabela | Leitura (`select`) | Inserção / alteração |
|---|---|---|
| `ged_pastas_raiz` | **leitura direta da tabela: só admin geral.** Demais usuários: só por projeção de campos autorizados (id, nome, finalidade, áreas, situação), apenas das raízes em que `ged_pode_ler_raiz(id)`. `verificacao` e `page_token` nunca chegam a eles [AF-4] | só admin geral, por função; as áreas da `elaboracao` são travadas |
| `ged_pastas` | `ged_pode_ler_raiz(raiz_id)` | indexação; `funcao` pela função de decisão (operador da área de operação) |
| `ged_pastas_cliente` | `ged_pode_ler_raiz` da raiz da pasta | funções de decisão (operador; troca de cliente: gestor) |
| `ged_documentos` | `ged_pode_ler_raiz(raiz_id)` (**corrige a versão anterior, que só olhava `raiz.area` e ignorava `areas_leitura`**) | indexação; tipo, versão e modelo pelas funções de decisão |
| `ged_documento_revisoes` | `ged_pode_ler_raiz` da raiz do documento | só indexação (só inserção) |
| `ged_vinculos` | quem lê o documento (`ged_pode_ler_raiz`) **e** tem `tem_acesso_modulo(modulo)` | `ged_vincular` / `ged_desvincular` |
| `ged_indexacoes` | **leitura direta: só admin geral.** Demais: projeção sem `erro` e sem `resumo` detalhado, só das rodadas de raízes que leem [AF-4] | só indexação |
| `ged_tipos`, `ged_regras_tipo` | quem tem alguma área (catálogo sem dados de cliente) | só admin geral |
| `ged_alvos` | quem tem alguma área | só por migration |
| `ged_conexao`, `ged_conexao_estados` | **nenhuma leitura direta por usuários.** O admin geral lê por projeção (email, datas, escopos, último erro), sem `segredo_id` [AF-4] | só funções `security definer`; `segredo_id` nunca vai ao navegador |
| `ged_trava` | ninguém (só service role) | só indexação |

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
4. Sugestão de versão:
   - `… - X.pdf` × `… - X V2.pdf` na mesma raiz são sugeridos;
   - nomes diferentes não são;
   - **o mesmo nome em raízes diferentes nunca é sugerido como versão.**
4a. Finalidade das raízes:
   - `229 - CONTRATO … .docx` presente nas duas raízes gera dois documentos, ambos visíveis, com a marca informativa;
   - um `.pdf` em pasta de trabalho nunca é sugerido como `contrato_assinado`;
   - um arquivo em pasta de modelos vira `modelo_contrato` com `nao_avaliado`;
   - `~WRL0006.tmp` e `~$x.docx` ficam `ignorado`;
   - raiz sobreposta é recusada;
   - raiz `em_verificacao` não é indexada.
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
5. Usuário sem a área Contratos: o dossiê e a Central mostram só o aviso fixo de acesso restrito para a elaboração; abrir pela URL o
   id de um documento de elaboração mostra "não encontrado".

### 11.5 Testes de autorização — obrigatórios antes de indexar [R4-P4 — Segurança do GED]
São planejados e não implementados. Rodam com dados fictícios (PGlite e Playwright), nunca com documentos reais, e precisam passar
na etapa A1a, antes da indexação (A1b). Os itens 13 e 14 são exigidos já antes da A0 (5.2.4.5):
1. **Varredura das políticas:** toda tabela `ged_*` tem RLS ligada, política de leitura e nenhuma de `delete`. Teste que falha se surgir
   tabela `ged_*` sem política.
2. **Raiz travada:** tentar gravar `areas_leitura` ou mudar `area` da raiz `elaboracao`, inclusive como admin geral pela função de
   configuração, é recusado.
3. **Usuário sem a área Contratos:**
   - nenhuma consulta devolve linha de `ged_documentos`, `ged_pastas`, `ged_documento_revisoes`, `ged_vinculos` ou `ged_indexacoes`
     da raiz `elaboracao`;
   - contagens e facetas da busca não mudam com a existência desses documentos.
4. **Acesso por id:** um id de documento ou pasta da `elaboracao` consultado por um usuário sem acesso devolve "não encontrado", igual
   a um id inexistente; `ged_vincular` com esse id devolve a mesma mensagem de erro de um id inexistente.
5. **Funções:**
   - `ged_tipos_presentes` nunca devolve nome, link ou id;
   - `ctr_alvos_por_numero` devolve vazio sem a área Contratos;
   - cada função tem o modo de segurança declarado em 5.10, verificado no catálogo do banco.
6. **Atividades e pendências:** vincular, classificar e confirmar não gravam nome de arquivo nem de pasta na descrição de `atividades`
   nem no título de `pendencias`; um usuário com `acompanha_equipe` e sem a área Contratos não vê nomes de arquivos de elaboração.
7. **Edge Functions:** a resposta de "Atualizar índice agora" e da verificação traz só contagens; `erro` não contém nomes nem tokens.
8. **Usuário com `unidade_restrita`:** não lê nenhuma raiz.
9. **[AF-4] Colunas sensíveis, por API direta:** um usuário que não é admin geral, consultando a API direta das tabelas (não só a tela),
   não obtém `ged_pastas_raiz.verificacao` nem `page_token`, `ged_indexacoes.erro` nem `ged_conexao.segredo_id`. A tentativa de
   leitura direta da tabela é recusada ou não devolve linhas.
10. **[AF-4] Projeções:** as views ou funções de projeção devolvem só as colunas autorizadas e respeitam a mesma regra de linha
    (`ged_pode_ler_raiz`).
11. **[AF-22] Logs:** numa rodada com documentos de raízes restritas, inclusive com erro forçado, os logs das Edge Functions e
    `ged_indexacoes.erro` não contêm nomes, ids nem links de arquivos ou pastas.
12. **[AF-5] Pendências:**
    - um usuário só da área Administrativo não vê pendência que revele a existência, a contagem ou o nome da raiz `elaboracao`;
    - um usuário de Contratos com leitura na raiz vê o que lhe cabe;
    - um usuário com `unidade_restrita` não vê nenhuma.
    O resultado esperado depende da alternativa escolhida no PENDENTE 15.
13. **[AF-6] Verificação da A0:** um usuário que não é admin geral, chamando a Edge Function de verificação ou de conexão, ou lendo
    diretamente as tabelas da A0, recebe recusa, sem nenhum nome, id ou contagem.
14. **[AF-6] Conexão:** `segredo_id` e o refresh token não aparecem em nenhuma resposta, log ou leitura de usuário.
15. **[AF-13] `ged_tipos_presentes`:** chamada por um operador de Contratos com `p_modulo` de outro módulo (ex.: RH) a que ele não tem
    acesso devolve vazio.


## 12. Critérios de aceite

**Fase A0 (conexão e verificação, somente leitura; corresponde à Fase 1 do plano)**
1. A conexão com o Drive usa só `drive.readonly`; nenhuma chamada além de `GET`.
2. A verificação das raízes candidatas é exibida só ao admin geral e não fica persistida em local acessível a outros usuários
   (5.2.4.4). Forma decidida em 25/10/2026: resposta efêmera da Edge Function [PENDENTE 13].
2a. **[AF-6]** Os controles mínimos da 5.2.4.5 estão especificados e aprovados antes da execução, e os testes 11.5, itens 13 e 14,
    passam com dados fictícios.
3. **Nenhuma indexação:** nenhuma linha em `ged_pastas`, `ged_documentos` ou `ged_documento_revisoes`.
4. O registro de atividade do Drive mostra nenhuma alteração feita pela conta técnica.

**Fase A1a (tabelas, políticas e testes, sem indexar)**
1. As tabelas `ged_*` existem com as políticas da seção 9, inclusive as projeções de colunas (5.11.10).
2. Os testes de autorização da 11.5 passam com dados fictícios. **Nenhum documento real foi indexado.**

**Fase A1b (índice e consulta)**
00. Os critérios da A1a foram cumpridos e aprovados, e o [PENDENTE 12] (Drive compartilhado) foi tratado (resolvido em 26/10/2026, opção 4: o Drive fica como está; 5.11.8).
0. Antes de indexar, as duas raízes (elaboração e dossiê) foram verificadas e ativadas pelo admin geral:
   - os IDs exatos foram confirmados;
   - a árvore resumida foi aceita;
   - a finalidade e as áreas foram definidas.
   Nenhuma outra pasta foi indexada.
0b. Arquivos com o mesmo nome nas duas raízes aparecem como documentos distintos. Nenhum modelo aparece como aprovado e nenhum PDF
    como assinado sem confirmação humana.
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
**Tabela de fases** [AF-7: as tabelas de fases e de bloqueios foram separadas]. A1a/A1b e "A2 básica"/"A2 completa" são
**subdivisões documentais** desta especificação (AF-8, AF-9). Não existem como etapas implementadas.

| Fase | Escopo | Corresponde no plano da auditoria |
|---|---|---|
| A0 | Conexão (OAuth da conta técnica, Vault) + **verificação das duas raízes**, **somente leitura e sem indexação**: lista da árvore de cada candidata, exibida só ao admin geral para confirmar IDs, finalidade e áreas; nada é gravado no índice nem persistido de forma acessível a outros (5.2.4.4). Inclui só as tabelas e os controles mínimos da 5.2.4.5 | Fase 1 |
| A1a | **Preparação, sem indexar:** cadastro persistente das raízes (`ged_pastas_raiz`, adiado da A0), tabelas `ged_*`, políticas da seção 9, projeções de colunas (5.11.10), funções com o modo de segurança da 5.10, pendências conforme o PENDENTE 15, e os testes de autorização da 11.5 com dados fictícios | Fase 2 (início) |
| A1b | **Indexação**, só depois de a A1a ser cumprida e aprovada: raízes verificadas, carga inicial, incremental, reconciliação, função das pastas de elaboração, pastas → cliente, tipos e regras, avaliação de modelos, telas 1 a 5 | Fase 2 |
| A2 básica | Vínculos, versões, componente `<DocumentosDoRegistro>`, funções públicas da 5.10, **sem** a sugestão de vínculo por número de contrato | Fase 2 (fim) / Fase 3 |
| A2 completa | Sugestão de vínculo por número de contrato (5.4.8), usando `ctr_alvos_por_numero`, que é entregue pela fase C3 do Contratos | depois da C3 do Contratos |
| B | View `ged_vw_documentos` com os anexos do Storage | após A2 básica |
| C | Escrita no Drive (arquivamento de anexos capturados), com especificação e escopo próprios | Fase 4b |

**Bloqueios por fase.** Nenhuma fase está liberada para implementação. A especificação foi aprovada documentalmente em 24/10/2026, mas
essa aprovação **não libera** fase alguma: cada uma depende dos bloqueios abaixo e de autorização expressa posterior do responsável.

| Fase | Bloqueada por | Critério para liberar |
|---|---|---|
| A0 | [PENDENTE 1] IDs exatos; [PENDENTE 3] conta e cliente OAuth; [PENDENTE 13] forma de exibir a verificação sem persistir metadados; controles mínimos da 5.2.4.5 [AF-6]; **[GED PENDENTE 17] mecanismo de proteção por coluna**: a parte da A0 que depende dele (leitura de `ged_conexao` e do cadastro da raiz sem as colunas sensíveis) **não pode ser executada** antes da decisão | IDs e conta decididos; mecanismo do GED PENDENTE 13 decidido e especificado; GED PENDENTE 17 decidido e especificado; controles mínimos aprovados; testes 11.5, itens 13 e 14, passando com dados fictícios. A A0 não fica liberada por partes, e nada disso foi implementado |
| A1a | A0 concluída; [PENDENTE 15] forma das pendências; [PENDENTE 16] quem roda "Atualizar índice agora"; [GED PENDENTE 17] projeções das tabelas novas (mecanismo já aprovado); [PENDENTE 19] assinatura da checagem de módulo; [GED PENDENTE 14 = Contratos, item 17] nível mínimo na elaboração; [PENDENTE 2] áreas do dossiê | decisões tomadas e especificadas |
| A1b | A1a cumprida e aprovada (todos os testes da 11.5 passando; **aprovada em 25/10/2026 só no recorte da indexação**, ver o registro no início); [PENDENTE 12] permissões do Drive compartilhado (**resolvido em 26/10/2026**, opção 4: nenhuma mudança no Drive) | aprovação expressa da A1a (feita no recorte da indexação) e PENDENTE 12 resolvido |
| A2 básica | A1b concluída; [PENDENTE 18] fonte de verdade da evidência do PDF (afeta o desvínculo) | A1b concluída; PENDENTE 18 decidido |
| A2 completa | A2 básica; C3 do Contratos (entrega de `ctr_alvos_por_numero` com checagem de autorização) | C3 concluída |
| B | A2 básica; [PENDENTE 8] | decisão do Fiscal sobre `fis_documentos` |
| C | especificação própria | especificação aprovada |

**Situação da A0 (25/10/2026):** os bloqueios da linha A0 foram resolvidos por decisão do responsável **depois** da implantação (ver
o registro no início): PENDENTES 1, 3 (conta da A0), 13 e 17 (mecanismo) decididos; controles mínimos aprovados; testes 11.5, itens
13 e 14, passando. O cadastro persistente das raízes passou para a A1a.

**Ordem sem dependência circular** [AF-9]: A0 → A1a → A1b → A2 básica → (Contratos C1 → C3) → A2 completa. A C1 do Contratos depende
só da A2 básica.

## 14. Pontos em aberto
1. **IDs exatos das raízes:** confirmar os candidatos da seção 2.2:
   - elaboração = `02 - COMERCIAL / 02 - CONTRATOS` (`1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR`), ou só a subpasta `Contratos`
     (`1JOh-QFYw9uwNkxSAdPa6cLzOzIuOiT56`);
   - dossiê = `02 - COMERCIAL / 01 - CLIENTES` (`1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak`).
   **Decidido em 25/10/2026:** elaboração = `02 - CONTRATOS` inteira; dossiê = `01 - CLIENTES` (documentação dos clientes e
   contratos assinados).
   As duas estão em Drive compartilhado. A pasta `ALUTEC / 04 - CONTRATOS E CLIENTES` **fica fora** (decidido em 25/10/2026).
2. **Áreas de cada raiz** (parcialmente decidido):
   - **elaboração:** só Contratos, pela decisão preliminar D-6 e travada no banco pela R4-P4 — Segurança do GED (5.11.1);
   - **dossiê:** quem lê? Proposta: Contratos, Comercial e Financeiro (pendente);
   - quem classifica e vincula em cada uma? Proposta: Contratos (pendente).
3. **Autenticação:** conta técnica por OAuth (recomendada) ou conta de serviço? Qual conta? Cliente OAuth novo ou o existente?
   **Na A0 (25/10/2026):** OAuth com cliente novo ("Neo Admin GED Drive"); conexão atual com `alantorres@neoformas.com.br` mantida
   nesta etapa (4.2). A conta definitiva (técnica dedicada ou a do responsável) continua na proposta GED-P3, sem aprovação.
4. **Profundidade e frequência:** a profundidade máxima (proposta 4) e a frequência (30 min, dias úteis) servem?
5. **Clientes sem cadastro:** a pasta `04 - CLIENTES SEM CADASTRO NO SISTEMA` deve gerar uma pendência de cadastro no Consistem ou em
   `contrapartes`? Recomendação: só pendência; o cadastro segue o fluxo atual, que liga pelo código do Consistem.
6. **Tipos e regras:** validar a lista de tipos e as regras de nome com uma amostra maior de arquivos.
7. **Rota:** `/documentos` (núcleo, como `/gestao`) ou dentro de uma área (`/administrativo/documentos`)?
8. **Fiscal:** os documentos privados do Fiscal (`fis_documentos`) entram na busca geral? Recomendação: não.
9. **`pg_trgm`:** nenhuma migration usa extensões de texto hoje. A v1 busca com `ilike` sobre o nome normalizado, gravado pela
   indexação. Ligar `pg_trgm` só se o volume exigir, depois de confirmar que a extensão está disponível no `neo-admin-sp`.
10. **Revisões do Drive** (decidido preliminarmente, D-4 do Contratos: a revisão do DOCX **e** o PDF efetivamente enviado).
    - Continua pendente, no módulo Contratos: quem regulariza um PDF pendente, o prazo, quem registra `sem_pdf_justificado` e se o
      contrato pode chegar a assinado com PDF pendente (Contratos, item 22).
11. **Pastas de modelos:** quais são os modelos aprovados hoje em `Venda/0-PADRÃO`, `Locação/_Modelos` e `Serviços/Modelos`? Há outros
    lugares com modelos?
12. **Permissões reais do Drive compartilhado** (validação externa, administrador do Workspace): quem são os membros do Drive
    compartilhado das duas raízes? A elaboração precisa de permissões próprias no Drive? Sem isso, a restrição da elaboração não vale
    no Drive (5.11.8). **Bloqueia a A1b** (indexação).
    **Resolvido em 26/10/2026 (opção 4):** o Drive fica como está — nenhuma alteração de membros, compartilhamentos ou permissões; os
    colaboradores seguem acessando os documentos direto pelo Drive, e isso é aceito. Dentro do Neo Admin, só os admins gerais acessam o
    GED (0809). A ideia de deixar só o Alan como membro do Drive foi descartada (detalhes em 5.11.8). **Não bloqueia mais a A1b.**
13. **Resultado da verificação na Fase 1 (A0):** como exibir a árvore verificada só ao admin geral sem persistir metadados de forma
    acessível a outros? **Decidido em 25/10/2026: resposta efêmera da Edge Function** (nada gravado; auditoria só com raiz, contagem
    e resultado). A opção de tabela legível só pelo admin geral foi descartada (5.2.4.4).
14. **Nível mínimo na raiz `elaboracao`:** consulta ou operador na área Contratos? (mesmo item que Contratos, item 17; não confundir com o GED PENDENTE 17, mecanismo de
    proteção por coluna)
    Depende dele a proteção dos ids e revisões de documentos de elaboração guardados em tabelas do Contratos (Contratos 5.12.7, AF-12).
15. **[AF-5] Pendências do GED sem expor raízes restritas:** (a) publicar no módulo da área dona de cada raiz, ou (b) pendência genérica
    em `administrativo.ged` sem raiz nem contagens? Decisão de arquitetura pendente. **Bloqueia a A1a.**
16. **[AF-22] Quem executa "Atualizar índice agora":** gestor da área de operação de cada raiz (só nas raízes que lê) ou só o admin
    geral? **Bloqueia a A1a.**
17. **[AF-4] Mecanismo de proteção de colunas:** views ou funções de projeção, permissão por coluna do Postgres ou outro mecanismo
    equivalente. **Mecanismo aprovado tecnicamente em 25/10/2026:** funções de projeção (`security definer`) e nenhum acesso direto às
    tabelas sensíveis, conforme implementado e testado na A0. Para a A1a, falta especificar as projeções de cada tabela nova
    (5.11.10) antes de implementar.
18. **[AF-11] Fonte de verdade da evidência do PDF** (com Contratos, item 30): qual registro é autoritativo, o bloqueio do desvínculo
    de documento referenciado, o tratamento de documento indisponível e a sincronização dos estados. **Bloqueia a A2 básica.**
19. **[AF-13] Assinatura técnica da checagem de módulo em `ged_tipos_presentes`:** confirmar contra o código os nomes e parâmetros
    (`tem_acesso_modulo`, `ged_alvos`). Validação técnica (com Contratos, item 32). **Bloqueia a A1a.**
