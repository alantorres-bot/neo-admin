# Revisão de segurança da A0 do GED (conexão), antes da implementação

Data: 24/10/2026 · Branch: `auditoria-contratos-ged` (HEAD `d2e643b`, sincronizado) · Revisão adversarial de
`PLANO_FASE_A0_GED_2026-10-24.md`.

> **Consolidado** em `PLANO_FASE_A0_GED_2026-10-24.md` (versão de referência). Divergências resolvidas na consolidação:
> 1. **Desafio S256.** Este relatório (2.2) dizia que `ged_validar_estado` devolveria o desafio S256 calculado no banco. O plano
>    consolidado devolve o `code_verifier` à Edge Function (`service_role`), que calcula o S256 com Web Crypto. Isso é mais simples e
>    testável no Vitest, e o verificador continua só no servidor.
> 2. **Postgres real.** O `check` do destino, com lookahead, e a linha única (`unica`) foram comprovados no Postgres do PGlite
>    (`ged-laboratorio.test.ts`).
> 3. **Lista de erros.** Ganhou `identidade_invalida` e `recusado`.

**Nada foi implementado:** nenhuma migration, Edge Function, especificação alterada, conexão, credencial, deploy, commit ou push.

**Classificação dos achados:**
- **[B]** bloqueador de segurança;
- **[C]** correção necessária antes da migration;
- **[M]** melhoria recomendada;
- **[D]** decisão pendente do responsável;
- **[V]** verificação necessária em ambiente real.

**Origem de cada conclusão:**
- **código:** confirmado no código do repositório;
- **lab:** confirmado por teste executado nesta rodada em `tests/db/ged-laboratorio.test.ts` (PGlite com as migrations reais);
- **proposta:** desenho a validar.

## 1. Riscos principais

1. **[B] O gatilho de auditoria do projeto quebraria a tabela da conexão.**
   - **O problema:** o `fn_auditoria` real (0002) converte `to_jsonb(new)->>'id'` para `uuid`. O plano propunha
     `ged_conexao.id smallint = 1`, e **toda gravação falharia** (lab).
2. **[B] O gatilho de auditoria vazaria o `segredo_id`.**
   - **O problema:** o `fn_auditoria` copia a linha inteira para `auditoria`, que o admin geral lê (`auditoria_ler`, 0002, linha 359).
     O `segredo_id` iria para lá (lab). Isso fere a GED 9 e a 5.11 ("`segredo_id` nunca chega a usuário").
3. **[B] Redirecionamento externo no destino.**
   - **O problema:** o padrão do plano, `^/[a-z0-9/_-]*$`, aceita `//evil`, que o navegador interpreta como outro host (lab).
   - **No Gmail atual:** `gmail_iniciar_conexao` aceita **qualquer host** (`^https?://[^/]+/`, 0153) (código).
4. **[B] Funções executáveis por quem não deve.**
   - **O problema:** o Supabase (e o harness) dá `execute` em toda função nova a `anon` e `authenticated` (`alter default
     privileges`). Revogar só de `PUBLIC` **não** tira esse acesso (lab).
   - **No plano:** "revoke … from public, anon[, authenticated]" estava ambíguo.
5. **[C] Identidade da conta conferida de forma fraca no padrão do Gmail.**
   - **O problema:** `emailDoIdToken` decodifica o `id_token` sem conferir `aud`, `iss`, `exp` nem `hd`, e aceita
     `email_verified` **ausente** como verificado (`email_verified !== false`) (código).
   - **Por que importa:** `login_hint` e `hd` na URL de autorização só orientam a tela do Google; não provam nada.
6. **[C] Escopo conferido por substring no padrão do Gmail.**
   - **O problema:** `tokens.scope?.includes("gmail.compose")` (código) aceita escopos adicionais e qualquer texto que contenha o
     trecho.
7. **[C] Mensagens de erro do banco vão para a URL no padrão do Gmail.**
   - **O problema:** `comAviso(…, error.message)` coloca o texto da exceção no redirecionamento. A exceção de `gmail_concluir_conexao`
     **inclui o e-mail** do perfil (`'Autorize com a sua própria conta (%)'`) (código). Com isso, o e-mail vai parar no histórico do
     navegador e em logs.
8. **[C] Sem PKCE.**
   - **O problema:** o `code` chega na query string do callback, que pode ser registrada em logs da plataforma [V].
   - **O que muda com PKCE:** sem o PKCE (S256), quem obtiver o `code` e o `state` dentro da validade pode tentar a troca. Com o PKCE,
     o `code` não serve sem o verificador, que nunca sai do servidor.
9. **[C] O `state` é consumido depois da troca do código.**
   - **O problema:** no Gmail, a ida e a volta só **leem** o `state` (`gmail_validar_conexao`). O consumo (`usado_em`) acontece só em
     `gmail_concluir_conexao`, **depois** da troca. Um replay do callback dentro de 15 minutos dispara nova troca: o Google recusa o
     `code` repetido, mas o fluxo deveria cortar antes (código).

## 2. Plano revisado (substitui os trechos correspondentes do plano original)

### 2.1 Tabelas

```sql
create table ged_conexao (
  id uuid primary key default gen_random_uuid(),          -- uuid: compatível com o padrão de auditoria do projeto [B1]
  unica boolean not null default true unique check (unica), -- garante uma linha só
  email text not null,
  google_sub text not null,                                -- identificador estável da conta Google [M]
  segredo_id uuid,                                         -- nulo depois de desconectar
  escopos text[] not null,
  conectado_em timestamptz not null, conectado_por uuid not null references perfis(id),
  desconectado_em timestamptz, desconectado_por uuid references perfis(id),
  revogacao_remota text check (revogacao_remota in ('ok','falhou','nao_tentada')),   -- só se a decisão D-REV for sim
  ultimo_erro text check (ultimo_erro in ('invalid_grant','escopo_divergente','conta_divergente','token_ausente','http')),
  ultimo_erro_em timestamptz
);
-- RLS ligada, SEM políticas; revoke all from anon, authenticated; fn_bloquear_delete.
-- SEM fn_auditoria genérico [B2]: as funções gravam na `auditoria` um registro SANEADO (ver 2.4).

create table ged_conexao_estados (
  state text primary key,                    -- 64 hex (2 × gen_random_uuid sem hífens), como no Gmail
  perfil_id uuid not null references perfis(id),
  destino text not null check (destino ~ '^/(?!/)[a-z0-9_-]+(/[a-z0-9_-]+)*$'),   -- [B3]
  code_verifier text not null,              -- PKCE [C8]: gerado no banco, nunca sai para o navegador
  criado_em timestamptz not null default now(),
  consumido_em timestamptz,                  -- antes da troca do código [C9]
  concluido_em timestamptz
);
-- RLS ligada, SEM políticas; revoke all from anon, authenticated.
```

### 2.2 Funções: privilégios e autorização

**Regra para todas:** `security definer` (as tabelas são revogadas, então é necessário); `set search_path = public`, na convenção do
projeto, com os nomes de `vault.` qualificados. **[M]** O ideal seria `search_path = ''` com tudo qualificado, sujeito à verificação
**[V]** de `create` em `public` para `authenticated`. Mais:
- `revoke all … from public, anon, authenticated`;
- `grant execute` **só** ao papel da tabela abaixo [B4];
- mensagens de exceção **sem** e-mail, ID ou valor recebido.

| Função | Papel | Autorização dentro da função | Pontos revisados |
|---|---|---|---|
| `ged_iniciar_conexao(p_destino)` → `text` | `authenticated` | `eh_admin_geral()`, que já inclui `acesso_liberado` (0007) | valida o destino pelo padrão revisado; gera `state` e `code_verifier`; apaga estados com mais de 1 dia; **[M]** limite de 5 estados abertos por perfil |
| `ged_consumir_estado(p_state)` → `jsonb` (**nova**, substitui o `validar` na volta) | `service_role` | perfil ativo, `admin_geral` e `acesso_liberado(perfil)`, conferidos **por `perfil_id`** (não há `auth.uid()` na Edge Function) | `update … set consumido_em = now() where state = $1 and consumido_em is null and criado_em > now() - interval '15 minutes' returning …`: consumo **atômico** antes da troca; devolve o destino, o `code_verifier` e a conta configurada |
| `ged_validar_estado(p_state)` → `jsonb` (só na ida) | `service_role` | o mesmo, sem consumir | devolve só o desafio PKCE (S256 do verificador), o destino e a conta configurada (para o `login_hint`) |
| `ged_concluir_conexao(p_state, p_email, p_sub, p_escopos, p_refresh_token)` → `text` (destino) | `service_role` | o `state` foi **consumido** há no máximo 2 minutos e não **concluído** (`for update`); o perfil continua admin e ativo | e-mail igual à conta configurada (minúsculas); se já houver conexão com outro `sub`, recusa (troca de conta só desconectando antes, **[D]**); escopos iguais ao conjunto exato; refresh token presente; Vault: `update_secret` se houver segredo, senão `create_secret`; upsert da linha; `concluido_em`; auditoria saneada. **Tudo numa transação** (lab: o segredo é desfeito junto se algo falha) |
| `ged_refresh_token()` → `jsonb` | `service_role` | — | `{refresh_token}` da conexão ativa. Nunca exposto a `authenticated` (teste de privilégio) |
| `ged_registrar_erro_conexao(p_codigo)` | `service_role` | — | só códigos da lista (`check`); **[M]** em `invalid_grant`, apagar o segredo inútil do Vault e manter a linha `com_erro` |
| `ged_situacao_conexao()` → `table(email, escopos, conectado_em, desconectado_em, revogacao_remota, ultimo_erro, ultimo_erro_em, situacao)` | `authenticated` | `eh_admin_geral()`; os demais recebem **vazio** | nunca devolve `segredo_id`, `google_sub` nem token |
| `ged_desconectar(p_perfil, p_revogacao)` → `void` | **depende de D-REV**: sem revogação remota, `authenticated` com `eh_admin_geral()`; com revogação, `service_role` (a Edge Function precisa ler o token antes) e conferência do perfil admin | | **idempotente:** sem conexão ativa, retorna sem erro. Apaga o segredo, marca `desconectado_*` e grava a auditoria saneada, numa transação |

### 2.3 Edge Function `nucleo-ged-conectar`: correções

- **Configuração obrigatória, sem fallback:**
  - `GED_DRIVE_CLIENT_ID`, `GED_DRIVE_CLIENT_SECRET`;
  - `GED_DRIVE_REDIRECT_URI`, **exatamente** o URI cadastrado no Google;
  - `NEO_ADMIN_URL`, **novo**: não existe hoje. As funções atuais usam só `SUPABASE_*`, `GMAIL_*` e outras.

  Faltando qualquer uma, a função responde 500 genérico. O `redirect_uri` **nunca** vem da requisição.
- **Destino final:** `new URL(destino, NEO_ADMIN_URL)`, com a origem conferida igual à de `NEO_ADMIN_URL`. Só **códigos fixos** vão na
  query (`?ged=conectado|recusado|erro&codigo=<lista>`) [C7].
- **Ida:** `state` no formato `^[0-9a-f]{64}$`, depois `ged_validar_estado` e o redirecionamento ao Google com:
  - `scope=openid email …/drive.readonly`;
  - `access_type=offline`, `prompt=consent`;
  - `code_challenge` (S256) e `code_challenge_method=S256`;
  - `login_hint`, `hd` (só orientação);
  - **sem** `include_granted_scopes`.
- **Volta:**
  1. formato do `state`;
  2. `ged_consumir_estado` (atômico; segundo uso: "expirou");
  3. `error` na volta: redireciona com `recusado`;
  4. troca do código com o `code_verifier` (POST ao endpoint de token do OAuth, timeout de 10 s);
  5. validação da identidade [C5], com o `id_token` recebido **direto** do endpoint de token por TLS. A assinatura pode ser
     dispensada (OIDC Core, 3.1.3.7, item 6), mas é **obrigatório** conferir:
     - `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`};
     - `aud` = `GED_DRIVE_CLIENT_ID`;
     - `exp` > agora;
     - `email_verified === true` (ausente = recusa);
     - `hd === "neoformas.com.br"`;
     - `email` = conta configurada;
     - `sub` presente;
  6. escopos [C6]: o conjunto da resposta (separado por espaço) tem de conter `drive.readonly` e **só** itens de {`openid`, `email`,
     `https://www.googleapis.com/auth/userinfo.email`, `…/drive.readonly`}. Qualquer outro, ou a falta do `drive.readonly`
     (consentimento parcial), é recusado;
  7. refresh token presente;
  8. `ged_concluir_conexao`.

  Em qualquer recusa: `ged_registrar_erro_conexao(codigo)` e redirecionamento com o código. **Nunca** vão a log, URL ou resposta:
  `code`, tokens, `id_token`, corpo da resposta do Google, `client_secret`, `code_verifier`, `segredo_id`, e-mail.
- **[M] Vínculo ao navegador:** na ida, um cookie `HttpOnly; Secure; SameSite=Lax`, no próprio domínio da função, com o hash do
  `state`, conferido na volta. Reforça o vínculo da sessão além do perfil (o `state` já exige admin, PKCE e conta configurada).
- **Compensação do `verify_jwt = false`:** só GET; formato do `state`; consumo atômico; PKCE; revalidação do perfil admin a cada passo;
  identidade e escopo conferidos; respostas genéricas. **[V]** Os logs da plataforma podem registrar a query string; o PKCE neutraliza o
  uso do `code` vazado.

### 2.4 Auditoria saneada [B2]

As funções inserem diretamente em `auditoria`:
- `tabela = 'ged_conexao'`, `registro_id = id`;
- `acao` ∈ {`conectou`, `substituiu`, `desconectou`, `erro`};
- `depois = {email, escopos, revogacao_remota?, codigo_erro?}`, **sem** `segredo_id`, `sub` nem token;
- `usuario_id` = o perfil que iniciou (o padrão `auth.uid()` é nulo na `service_role`).

Isso segue a convenção de registrar toda alteração relevante (`CLAUDE.md`, regra 5) sem copiar campo protegido.

### 2.5 Cenários de consistência

| Cenário | Comportamento revisado |
|---|---|
| Já existe conexão ativa com a mesma conta (`sub` igual) | reconexão: `update_secret` no segredo existente; auditoria `substituiu`; nenhum segredo novo |
| Nova conexão com outra conta | recusada (`conta_divergente`) enquanto a atual estiver ativa; troca só desconectando antes e trocando a configuração **[D]** |
| OAuth falha antes do `concluir` | nenhum segredo criado (só `concluir` cria); `ultimo_erro` registrado; o `state` fica consumido |
| Falha entre gravar o segredo e gravar a linha | impossível ficar parcial: as duas coisas estão na mesma função e transação (lab). **[V]** Confirmar no Supabase real que o Vault é transacional (é tabela, mas confirmar) |
| Desconexão pedida duas vezes | a segunda não faz nada e não dá erro |
| O Google revoga o token, ou chega `invalid_grant` | o próximo uso registra `invalid_grant`, e a situação fica `com_erro`; **[M]** apagar o segredo inútil; a pendência "Reautorizar" depende do PENDENTE 15 |
| Revogação remota (se aprovada) | a Edge Function lê o token (`service_role`) e faz o POST de revogação (timeout 10 s; `invalid_token` conta como `ok`). **Sempre** em seguida, `ged_desconectar(perfil, resultado)`. O estado local fica **sempre** desconectado. A falha remota fica registrada (`revogacao_remota = 'falhou'`) com o aviso ao admin: "revogue manualmente em myaccount.google.com". Se a gravação local falhar depois de revogar, o token já está morto, e repetir a desconexão (idempotente) acerta |

**Revogação remota [D-REV], avaliação:**
- **Vantagem:** o acesso morre no Google na hora.
- **Riscos:** uma segunda chamada externa com efeito (POST ao OAuth, não ao Drive); a desconexão passa a precisar da Edge Function.
- **Na falha:** coberto acima, sem estado local ambíguo.
- **Teste:** fetch simulado com `200`, `400 invalid_token`, `500` e timeout.
- **Recomendação técnica:** sim. **Não é decisão aprovada.**

## 3. Coerência com o projeto e a especificação

- **[C] Escopo da A0.** A GED 13 define a A0 como conexão **e** verificação das raízes. Este plano cobre só a conexão: a A0 só fica
  completa com a parte de verificação, que depende da GED-P13 e do PENDENTE 1.
- **[C] Modelo de dados.** O desenho revisado de `ged_conexao` acrescenta `id uuid`, `unica`, `google_sub`, `desconectado_por` e
  `revogacao_remota` ao modelo da GED 8. Isso precisa entrar na minuta da revisão 4 (M5) antes da migration.
- **[C] Testes de banco.** O harness não tem Vault: os testes usam o Vault mínimo de `tests/db/filial-gmail-envio.test.ts`. Cifragem
  real só pode ser verificada no Supabase **[V]**.
- **[C] Publicação.** A migration é aplicada pelo responsável (`docs/PUBLICACAO.md`, seção 2, com o insert em `schema_migrations`).
  `config.toml` recebe `[functions.nucleo-ged-conectar] verify_jwt = false`.

## 4. Testes de segurança obrigatórios

| # | Caso | Onde |
|---|---|---|
| 1 | Admin válido conecta; usuário sem `admin_geral` recebe recusa em `ged_iniciar_conexao` | PGlite |
| 2 | Perfil inativo ou com troca de senha pendente (sessão por senha) é recusado ao iniciar; perfil que perdeu o admin entre a ida e a volta é recusado em `consumir` e `concluir` | PGlite |
| 3 | `state` inválido, expirado (16 min), consumido, concluído; segundo `consumir` do mesmo `state` devolve nulo | PGlite (concorrência real **[V]**) |
| 4 | Conta divergente, `sub` divergente com conexão ativa | PGlite (`concluir`) + Vitest (`id_token`) |
| 5 | `id_token` com `aud`, `iss` ou `hd` errados, `exp` vencido, `email_verified` ausente ou falso | Vitest |
| 6 | Escopo a mais (`drive`, `drive.file`), a menos (sem `drive.readonly`), texto que só contém o trecho | Vitest + PGlite (`concluir` com o conjunto exato) |
| 7 | Volta com `error`: redireciona com `recusado`, sem trocar código | Vitest |
| 8 | Refresh token ausente | Vitest + PGlite |
| 9 | Falha do Vault (exceção no `create_secret` do Vault mínimo): nada é gravado | PGlite |
| 10 | Falha depois do segredo e antes da linha: tudo desfeito (padrão comprovado em lab) | PGlite |
| 11 | Desconexão repetida: sem erro e sem efeito | PGlite |
| 12 | Revogação remota `200`, `400 invalid_token`, `500` e timeout: o estado local fica sempre desconectado, e o resultado é registrado | Vitest (se D-REV for sim) |
| 13 | **Vazamento:** nenhuma resposta, `Location`, log simulado ou exceção contém `code`, tokens, `client_secret`, `code_verifier`, `segredo_id` ou e-mail; nenhuma linha de `auditoria` contém `segredo_id` | Vitest + PGlite |
| 14 | **Open redirect:** `//evil`, `/\evil`, `%2F%2F`, CRLF, `https://…`, `..` são recusados no banco (`check`) e na Edge Function (origem conferida) | PGlite + Vitest (padrão comprovado em lab) |
| 15 | **Privilégios:** a matriz `has_function_privilege` de todas as funções × {`anon`, `authenticated`, `service_role`}; `has_table_privilege` de `ged_conexao*` para `anon`/`authenticated` = falso; varredura das migrations por `grant` indevido | PGlite (padrão comprovado em lab) |
| 16 | PKCE: a URL da ida tem `code_challenge` S256; a troca envia o `code_verifier` correto; o `code_verifier` nunca aparece no navegador | Vitest |
| 17 | Configuração ausente (cliente, redirect, `NEO_ADMIN_URL`): 500 genérico | Vitest |
| 18 | Primeira conexão real: escopo concedido, logs da função sem token nem `code` visível, Vault cifrado | **manual, em produção**, pelo responsável, depois da autorização da fase |

## 5. Confirmado × proposto

- **Confirmado no código:**
  - os riscos 3 (Gmail), 5, 6, 7 e 9;
  - a ausência de `NEO_ADMIN_URL`/`APP_URL`;
  - o `fn_auditoria` e a leitura da auditoria pelo admin geral;
  - `acesso_liberado` e `eh_admin_geral`;
  - um só projeto Supabase.
- **Confirmado em laboratório (5 testes novos, executados nesta rodada):** os riscos 1, 2, 3 (padrão do plano) e 4; o segredo desfeito
  junto na transação.
- **Só proposta:** todo o desenho das seções 2.1 a 2.5. As funções e a Edge Function não existem.

## 6. Decisões pendentes do responsável

| ID | Decisão |
|---|---|
| D-REV | Revogar no Google ao desconectar? (recomendado: sim) |
| D-TROCA | Trocar a conta conectada exige desconectar antes? (recomendado: sim) |
| D-URL | Valor de `NEO_ADMIN_URL` (URL pública do app) |
| D-INVALID | Apagar o segredo do Vault ao receber `invalid_grant`? (recomendado: sim) |
| Já pendentes | conta, dono e recuperação; cliente OAuth novo ou existente (respostas 1 a 3); GED-P17 (resposta 7); aprovador e evidência (resposta 15) |

**Ação externa necessária, sem pedir alteração agora:** os riscos 3, 6 e 7 também existem no `nucleo-gmail-conectar` **em uso**.
Corrigir o Gmail é tarefa separada, fora deste escopo, e precisa da autorização do responsável.

## 7. Bloqueadores antes de criar a migration A0

1. Aprovação da GED-P3 e da GED-P17 (revisão 4), com aprovador, data e evidência, e a autorização expressa da fase A0.
2. Incorporação, na minuta da revisão 4, do desenho revisado de `ged_conexao` e `ged_conexao_estados`: uuid, `unica`, `google_sub`,
   `code_verifier`, `consumido_em`/`concluido_em`, auditoria saneada.
3. As decisões D-REV, D-TROCA e D-URL (D-INVALID pode ficar para depois).
4. O plano A0 corrigido nos pontos B1 a B4 e C5 a C9, que este relatório especifica.
