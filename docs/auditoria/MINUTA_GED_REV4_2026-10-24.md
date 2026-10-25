# MINUTA — `docs/modulos/administrativo-ged.md`, revisão 4

**Situação: MINUTA, NÃO APROVADA.** Este arquivo não altera a especificação vigente: a **revisão 3**, aprovada documentalmente em
24/10/2026, continua valendo. A minuta só será aplicada depois de uma aprovação expressa do responsável, com aprovador, data e evidência
registrados no histórico do documento. É o processo do projeto: `PREPARACAO_APROVACAO_CONTRATOS_GED_2026-10-24.md`, linha 73, com o
precedente em `APROVACAO_FORMAL_CONTRATOS_GED_2026-10-24.md`.

**Decisões cobertas:** GED-P3, GED-P13 e GED-P17. A análise completa está em `PROPOSTAS_DECISOES_CONTRATOS_GED_2026-10-24.md`.

**Marcadores usados no texto proposto:**
- **⟦PENDENTE: …⟧** é ponto que a aprovação precisa preencher ou decidir. Enquanto existir um, aquele trecho não está decidido.
- **[Rev. 4 — GED-Pn]** marca o texto novo, como se fez na revisão anterior com [R4-P4].

**O que a revisão 4 NÃO faz:**
- não libera fase;
- não encerra os itens 1, 2, 12, 14, 15, 16, 18 e 19 da seção 14;
- não confirma IDs de raiz;
- não cria nada no Drive nem no Google Cloud.

---

## M1. Cabeçalho: nova entrada no histórico (depois do bloco "Aprovação documental")

**Texto proposto:**
> **Revisão 4 (⟦PENDENTE: data da aprovação⟧):** incorporação das decisões **GED-P3** (conta e autenticação), **GED-P13** (prévia
> antes da persistência) e **GED-P17** (separação de dados operacionais e protegidos), aprovadas por ⟦PENDENTE: aprovador⟧ (evidência:
> ⟦PENDENTE⟧). Detalhes em `docs/auditoria/PROPOSTAS_DECISOES_CONTRATOS_GED_2026-10-24.md`.
> - Responde, nos termos aprovados, aos itens 3, 13 e 17 da seção 14. **As partes que continuam abertas ficam registradas nos próprios
>   itens.**
> - Muda o desenho de proteção de colunas das seções 5.11.10, 8 e 9: de "mesma tabela com leitura direta só do admin + projeção" para
>   **tabelas separadas**. É uma mudança de arquitetura.
> - Acrescenta a seção **5.12 — Conexão com o Drive** e reestrutura `ged_conexao` e `ged_conexao_estados` (seção 8), conforme a
>   revisão de segurança (`REVISAO_SEGURANCA_A0_GED_2026-10-24.md`): PKCE, consumo atômico do `state`, identidade e escopos
>   conferidos, auditoria saneada, privilégios explícitos. Decisões ⟦D-REV⟧, ⟦D-TROCA⟧, ⟦D-URL⟧ e ⟦D-INVALID⟧.
> - **Não libera fase.** A A0 continua dependendo dos PENDENTES 1 e 12, dos controles mínimos da 5.2.4.5 implementados e testados, e
>   de autorização expressa (seção 13).
> - Status: **aprovada em ⟦PENDENTE⟧** (revisão 4).

A linha **Status** do topo também passa a citar a revisão 4, no mesmo padrão.

## M2. Seção 4.2: autenticação (GED-P3)

**Texto atual (último parágrafo):**
> Pode-se usar um cliente OAuth novo ou o "Neo Admin Gmail (rascunhos)" com mais um URI de redirecionamento [PENDENTE 3].

**Texto proposto (substitui o parágrafo):**
> **[Rev. 4 — GED-P3] Decisão:** opção **A**, conta corporativa **dedicada** ao GED, autorizada por OAuth com o escopo
> `https://www.googleapis.com/auth/drive.readonly`.
> - **Conta:** ⟦PENDENTE: endereço da conta⟧. Dono no Workspace: ⟦PENDENTE⟧. Guarda da recuperação: ⟦PENDENTE⟧. A conta recebe
>   **leitor** só nas raízes confirmadas (item 1 da seção 14), e nada além disso.
> - **Cliente OAuth:** ⟦PENDENTE: novo (recomendado, isola revogação e escopos do Gmail) ou o "Neo Admin Gmail (rascunhos)" com
>   mais um URI⟧. Tela de consentimento **Interna**, como no Gmail.
> - **Tokens:**
>   - o refresh token vai no Vault, e `ged_conexao` guarda só `segredo_id`, no padrão da 0153;
>   - a leitura do segredo é feita só por função `security definer` com `grant execute` para `service_role`;
>   - o access token é obtido a cada rodada, só na Edge Function, e nunca vai a log nem a resposta (5.11.11).
> - **Conexão:**
>   - `state` de uso único (`ged_conexao_estados`), padrão de `gmail_conexoes`;
>   - só o admin geral inicia e encerra;
>   - escopo diferente na volta é recusado (5.1.3).
> - **Revogação e reconexão:**
>   - a função "Desconectar" (só admin geral) remove o segredo do Vault e marca a desconexão, sem apagar o histórico;
>   - `invalid_grant` interrompe a rodada, grava `ultimo_erro` sem dados sensíveis e abre a pendência "Reautorizar o acesso ao Drive".
>     O destino dessa pendência depende do item 15;
>   - o índice existente continua consultável (seção 10).
> - **Ambientes:** há um só projeto Supabase (`docs/PUBLICACAO.md`). Testes só com PGlite e fetch simulado. A primeira conexão real
>   acontece em produção, depois da A0 aprovada, e sem indexar.
> - Segredos do cliente: `GED_DRIVE_CLIENT_ID` e `GED_DRIVE_CLIENT_SECRET`, gravados com `scripts/gravar-segredo.mjs` [EXISTE].
> - **Fluxo detalhado** (PKCE, identidade, escopos, desconexão, erros): seção nova **5.12 — Conexão com o Drive (A0-conexão)**, minuta
>   M10.

*(Atualizado depois da revisão de segurança: `REVISAO_SEGURANCA_A0_GED_2026-10-24.md` e `PLANO_FASE_A0_GED_2026-10-24.md`, versão
consolidada.)*

## M3. Seção 5.2.4.4: verificação sem persistir (GED-P13)

**Texto atual (o item "lacuna em aberto"):**
> **lacuna em aberto:** o mecanismo seguro de exibir sem persistir não está especificado. Opções a decidir: resposta efêmera da Edge
> Function só para o admin geral, ou tabela legível só pelo admin geral. **Enquanto não houver decisão, isso bloqueia a implementação
> da A0** [PENDENTE 13]. Esta especificação não escolhe a solução.

**Texto proposto (substitui o item):**
> **[Rev. 4 — GED-P13] Prévia efêmera e confirmação explícita.**
> 1. **Prévia.**
>    - A Edge Function de verificação, chamada só pelo admin geral (checagem **antes** de qualquer chamada ao Drive), lê a árvore e
>      devolve a prévia **na resposta**, sem gravar nada.
>    - Conteúdo: o resumo da 5.2.4.1 (contagens por nível, subpastas de 1º e 2º nível, extensões, temporários, raízes sobrepostas),
>      mais os avisos (sem acesso, limite atingido, profundidade truncada, erro HTTP genérico) e o `startPageToken` obtido **antes** da
>      leitura.
> 2. **Prévia com erro ou incompleta não pode ser confirmada.** Repete-se a verificação.
> 3. **Confirmação.**
>    - Ação explícita do admin geral, "Confirmar raiz".
>    - Só se confirma raiz em `em_verificacao`. Confirmar de novo uma raiz `ativa` não muda nada.
>    - A função recusa a prévia **vencida**:
>      - (a) passou do prazo de ⟦PENDENTE: prazo de validade⟧; ou
>      - (b) há mudanças nas raízes desde o `startPageToken` da prévia (`changes.list`, GET).
> 4. **O que é gravado ao confirmar:**
>    - ID, finalidade, áreas, situação `ativa`, quem confirmou e quando;
>    - ⟦PENDENTE: gravar também o resumo **só com contagens**, sem nomes?⟧.
>    - **Nomes de pastas e de arquivos não são gravados** até a A1a estar aprovada e as tabelas protegidas da 5.11.10 (GED-P17) existirem.
> 5. **Nada da prévia vira classificação, cliente, versão nem vínculo.**

## M4. Seção 5.11.10: proteção por coluna (GED-P17)

**Texto atual (item "por coluna", final):**
> …por **projeção de campos autorizados** (view ou função que devolve só as colunas liberadas), por **permissão por coluna** do
> Postgres, ou por mecanismo equivalente. **O mecanismo é decisão técnica a validar** [GED PENDENTE 17];

**Texto proposto:**
> …**[Rev. 4 — GED-P17]** Os campos protegidos ficam em **tabelas separadas**, sem política e com `revoke all` para `anon` e
> `authenticated` (padrão `gmail_conexoes`, 0153).
> - **Leitura:** só por funções `security definer` que checam a autorização (ex.: `eh_admin_geral()`) **antes** de ler, e pela
>   indexação (Edge Function).
> - **Tabelas operacionais:** não guardam campo protegido.
> - **Não se usam:**
>   - **permissão por coluna:** uma migration posterior com `grant select` na tabela a desfaz em silêncio. Isso foi comprovado em
>     `tests/db/ged-laboratorio.test.ts`;
>   - **view `security_invoker` como barreira:** quem lê a view lê a tabela base inteira.
> - **Views `security_invoker`** só sobre tabelas operacionais, por conveniência.
> - **Teste de regressão:** varre as migrations procurando `grant` para `anon` ou `authenticated` nas tabelas protegidas.

## M5. Seção 8: modelo de dados (GED-P17)

**Linhas novas na tabela:**

| Tabela | Campos principais | Observações |
|---|---|---|
| `ged_pastas_raiz_controle` | `raiz_id` (pk → `ged_pastas_raiz`), `page_token`, `verificacao jsonb` (só contagens até a A1a), `verificada_por/em`, `indexada_em`, `reconciliada_em` | `revoke all` para usuários; só funções e indexação [Rev. 4 — GED-P17] |
| `ged_indexacoes_erro` | `indexacao_id` (pk → `ged_indexacoes`), `erro`, `resumo_detalhado jsonb` | `revoke all` para usuários; leitura do admin geral por função [Rev. 4 — GED-P17] |

**Linhas alteradas:**
- **`ged_pastas_raiz`:** saem `verificacao`, `verificada_por/em`, `page_token`, `indexada_em` e `reconciliada_em`, que vão para
  `_controle`.
- **`ged_indexacoes`:** sai `erro`, e o `resumo` fica só com as contagens (novos, alterados, removidos, ignorados). O detalhe vai para
  `_erro`.
- **`ged_conexao` e `ged_conexao_estados`:** continuam sem nenhuma leitura direta por usuários (já estava assim), mas **mudam de
  estrutura** pela revisão de segurança.

| Tabela | Texto vigente (GED 8) | Texto proposto |
|---|---|---|
| `ged_conexao` | `id` (uma linha), `email`, `segredo_id` (Vault), `escopos text[]`, `conectado_em`, `conectado_por`, `desconectado_em`, `ultimo_erro`, `ultimo_erro_em` | `id uuid` (o `fn_auditoria` do projeto exige uuid), `unica boolean unique check (unica)` (uma linha só), `email`, `google_sub`, `segredo_id` (nulo depois de desconectar), `escopos text[]`, `conectado_em/por`, `desconectado_em/por`, `revogacao_remota` (⟦D-REV⟧), `ultimo_erro` (lista fechada de códigos), `ultimo_erro_em`. RLS sem política, `revoke all`, `fn_bloquear_delete`, **sem `fn_auditoria`** (auditoria saneada, 5.12) |
| `ged_conexao_estados` | `state` (pk), `perfil_id`, `destino`, `criado_em`, `usado_em` | `state` (pk, 64 hex), `perfil_id`, `destino` (só caminho relativo: `check (destino ~ '^/(?!/)[a-z0-9_-]+(/[a-z0-9_-]+)*$')`), `code_verifier` (PKCE), `criado_em`, `consumido_em`, `concluido_em`. RLS sem política, `revoke all` |

## M6. Seção 9: permissões (GED-P17)

| Tabela | Texto atual (leitura) | Texto proposto (leitura) |
|---|---|---|
| `ged_pastas_raiz` | "leitura direta da tabela: só admin geral. Demais usuários: só por projeção…" | RLS com `ged_pode_ler_raiz(id)`; a tabela não tem campo protegido |
| `ged_pastas_raiz_controle` (nova) | — | nenhuma leitura direta; admin geral por função; indexação |
| `ged_indexacoes` | "leitura direta: só admin geral. Demais: projeção sem `erro`…" | RLS: rodadas das raízes que a pessoa lê, só com contagens |
| `ged_indexacoes_erro` (nova) | — | nenhuma leitura direta; admin geral por função |

A nota **[AF-4]** passa a dizer que a restrição de coluna é feita por **tabelas separadas** (5.11.10, revisão 4).

## M7. Seção 13: bloqueios da A0

**Texto atual (início da linha A0):**
> [PENDENTE 1] IDs exatos; [PENDENTE 3] conta e cliente OAuth; [PENDENTE 13] forma de exibir a verificação sem persistir metadados;
> controles mínimos da 5.2.4.5 [AF-6]; **[GED PENDENTE 17] mecanismo de proteção por coluna**: …

**Texto proposto:**
> [PENDENTE 1] IDs exatos; [PENDENTE 3, parte restante] conta exata, dono e cliente OAuth; [PENDENTE 13, parte restante] prazo de
> validade da prévia e o que se grava ao confirmar; controles mínimos da 5.2.4.5 [AF-6] **implementados conforme a 5.11.10 (revisão
> 4, tabelas separadas)**; testes da 11.5, itens 13 e 14, passando com dados fictícios; autorização expressa da fase.
> **Só para a parte de conexão (5.12):** decisões ⟦D-REV⟧, ⟦D-TROCA⟧ e ⟦D-URL⟧; os grupos de testes 1 a 17 da conexão passando
> (plano A0, seção 8). A parte de verificação continua dependendo do PENDENTE 1 e da GED-P13.

## M8. Seção 14: itens 3, 13 e 17 (não removidos, não renumerados)

Cada item ganha uma linha ao fim:
- **3:** "**Rev. 4 (GED-P3):** decidida a conta dedicada por OAuth, `drive.readonly`, Vault. Continuam abertos: o endereço da conta, o
  dono, a guarda da recuperação e o cliente OAuth (novo ou existente)."
- **13:** "**Rev. 4 (GED-P13):** decidida a prévia efêmera com confirmação explícita do admin geral e recusa de prévia vencida.
  Continuam abertos: o prazo de validade e a gravação do resumo só com contagens."
- **17:** "**Rev. 4 (GED-P17):** decidido o mecanismo: tabelas separadas, mais funções `security definer`, mais RLS. Nada continua
  aberto neste item. A proteção das colunas de elaboração em `ctr_minutas` continua no item 14 (= Contratos, item 17)."

## M9. Seção 11.5: testes de autorização novos

- usuário comum: `select`, `insert` e `update` em `ged_pastas_raiz_controle`, `ged_indexacoes_erro`, `ged_conexao` e
  `ged_conexao_estados` são negados;
- a função de projeção, chamada por quem não é admin, devolve vazio;
- nenhuma função devolve `segredo_id` nem `page_token` a `authenticated`;
- teste de regressão: as migrations não dão `grant` a `anon` nem a `authenticated` nessas tabelas;
- confirmação de raiz: recusa quem não é admin, prévia vencida (prazo ou mudanças desde o token), prévia com erro, e raiz que não está
  `em_verificacao`.

## M10. Nova seção 5.12: Conexão com o Drive (A0-conexão) [Rev. 4 — GED-P3, GED-P17]

Origem: `PLANO_FASE_A0_GED_2026-10-24.md`, versão consolidada, com a revisão de segurança. **Texto proposto:**

> ### 5.12 Conexão com o Drive (A0-conexão)
>
> 1. **Escopo da fase.**
>    - A A0 tem duas partes:
>      - **conexão** (esta seção);
>      - **verificação das raízes** (5.2.4, GED-P13).
>    - A fase só se completa com as duas.
>    - Nenhuma chamada à Drive API acontece na conexão.
>    - Indexação (A1b) e tabelas do índice (A1a) são fases posteriores.
> 2. **Quem conecta:** só o admin geral (`eh_admin_geral()`), revalidado na ida, na volta e na conclusão pelo `perfil_id` do `state`.
>    Perfil inativo ou que perdeu o admin no meio do fluxo é recusado.
> 3. **OAuth com PKCE (S256).**
>    - **`state`:** 64 hex, gerado no banco, de uso único, válido por 15 minutos, consumido de forma **atômica antes** da troca do
>      código.
>    - **`code_verifier`:** fica só no servidor (`ged_conexao_estados`, tabela revogada). O desafio S256 é calculado na Edge Function.
>    - **Pedido de autorização:** `scope = openid email …/drive.readonly`, `access_type=offline`, `prompt=consent`, sem
>      `include_granted_scopes`.
>    - **`login_hint` e `hd`:** só orientam a tela do Google; não são prova de identidade.
> 4. **Identidade.** O `id_token`, recebido direto do endpoint de token, tem de trazer:
>    - `iss` do Google, `aud` = cliente do GED e `exp` válido;
>    - `email_verified = true` e `hd = neoformas.com.br`;
>    - `email` = conta configurada (`administrativo.ged.conta`);
>    - `sub`, guardado.
>
>    Conexão ativa com outro `sub` é recusada ⟦D-TROCA⟧.
> 5. **Escopos:** o conjunto concedido tem de conter `drive.readonly` e só itens de {`openid`, `email`, `userinfo.email`,
>    `drive.readonly`}. Escopo a mais ou a menos é recusado.
> 6. **Tokens:**
>    - o refresh token vai só no Vault;
>    - a gravação do segredo e da linha acontece numa única transação;
>    - o access token não é guardado.
> 7. **Redirecionamento:**
>    - o destino é só caminho relativo, validado no banco (`check`) e na Edge Function, que confere a origem contra
>      `NEO_ADMIN_URL` ⟦D-URL⟧;
>    - `GED_DRIVE_REDIRECT_URI` é obrigatório e idêntico ao cadastrado no Google; nunca vem da requisição;
>    - a query de volta leva só códigos fixos.
> 8. **Privilégios:**
>    - toda função: `security definer`, `revoke all … from public, anon, authenticated` e `grant execute` só ao papel necessário;
>    - `authenticated`: `ged_iniciar_conexao`, `ged_situacao_conexao` (só o admin recebe linha) e, se ⟦D-REV⟧ = não,
>      `ged_desconectar`;
>    - `service_role`: o resto.
> 9. **Auditoria saneada:**
>    - as funções gravam em `auditoria` `conectou`, `substituiu`, `desconectou` e `erro`, com e-mail, escopos e código, e com
>      `usuario_id` = o perfil que iniciou;
>    - **nunca** `segredo_id`, `google_sub`, token, `state` nem `code_verifier`;
>    - a tabela da conexão **não** usa o `fn_auditoria` genérico, que copiaria a linha inteira.
> 10. **Desconexão:**
>     - idempotente; apaga o segredo e preserva o registro;
>     - revogação no Google ⟦D-REV⟧: se adotada, é feita antes da desconexão local, que acontece sempre, e o resultado (`ok`/`falhou`)
>       fica registrado; na falha, aviso ao admin para revogar manualmente.
> 11. **Erros e situação:**
>     - `ultimo_erro` numa lista fechada (`invalid_grant`, `escopo_divergente`, `conta_divergente`, `identidade_invalida`,
>       `token_ausente`, `http`, `recusado`);
>     - situação `conectada`/`com_erro`/`desconectada`, vista só pelo admin geral;
>     - `invalid_grant`: `com_erro`; o segredo é apagado conforme ⟦D-INVALID⟧; a pendência "Reautorizar" segue o PENDENTE 15;
>     - mensagens, URLs e logs nunca contêm `code`, tokens, `client_secret`, `code_verifier`, `segredo_id` nem e-mail.

**Acréscimo à M9 (testes da 11.5):** os 18 grupos de testes de segurança da conexão, na seção 8 do plano consolidado. Os grupos 1 a 17 rodam em PGlite e Vitest; o 18 é manual, em produção, depois da autorização.
