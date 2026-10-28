# Plano técnico — Fase A0 do GED (conexão) — versão consolidada

Data: 24/10/2026 · Situação: **PLANO, não executado.** Não há migration, função, segredo nem conexão criados.

**Esta é a versão de referência.** Ela incorpora a revisão de segurança (`REVISAO_SEGURANCA_A0_GED_2026-10-24.md`). A proposta
original foi preservada no **Anexo A**, só como histórico, e não deve ser usada.

**Pré-requisitos para executar:**
- GED-P3 e GED-P17 aprovadas (revisão 4 aplicada, com aprovador, data e evidência);
- decisões D-REV, D-TROCA e D-URL (`RESPOSTAS_PENDENTES_CONTRATOS_GED_2026-10-24.md`);
- **autorização expressa da fase A0**, separada da aprovação documental (GED 13).

**Base:** padrões reais conferidos em:
- `0153_gmail_por_usuario_kit_enviado.sql`;
- `0001`/`0002` (`fn_auditoria`, `auditoria_ler`);
- `0007` (`acesso_liberado`, `eh_admin_geral`);
- `supabase/functions/nucleo-gmail-conectar/index.ts`;
- `tests/db/filial-gmail-envio.test.ts` (Vault mínimo);
- `docs/PUBLICACAO.md`.

Os pontos inseguros do Gmail **não** foram copiados (seção 10).

**Legenda:** **[código]** conferido no repositório · **[lab]** comprovado em `tests/db/ged-laboratorio.test.ts` · **[proposta]**
desenho a implementar · **[V]** só verificável no Supabase real · **⟦PENDENTE⟧** decisão do responsável.

## 1. Escopo

| A0-conexão (este plano) | Fora deste plano |
|---|---|
| conexão OAuth da conta dedicada, guarda do token no Vault, situação da conexão, desconexão, registro de erro, auditoria saneada | **A0-verificação**: verificação das raízes e cadastro da raiz candidata. É A0 pela GED 13, depende da GED-P13 e do PENDENTE 1 e terá plano próprio. **A fase A0 só se completa com as duas partes** |
| | A1a (tabelas do índice), A1b (indexação, carga inicial, incremental, reconciliação) |
| | **nenhuma chamada à Drive API** acontece na A0-conexão |

## 2. Migration `0801_ged_conexao.sql` [proposta]

Numeração [código]: a faixa 0800–0899 é do núcleo estendido; a `0800_nucleo_apps_pendencias.sql` é a última; a GED 8 prevê 0801.

```sql
insert into modulos (codigo, area, nome, ativo) values ('administrativo.ged', 'administrativo', 'Central de Documentos', false)
  on conflict do nothing;
insert into configuracoes (chave, valor, descricao) values
  ('administrativo.ged.conta', 'null', 'E-mail da conta dedicada do GED (GED-P3). Só ela conclui a conexão.')
  on conflict (chave) do nothing;

create table ged_conexao (
  id uuid primary key default gen_random_uuid(),            -- uuid: o fn_auditoria do projeto exige [lab]
  unica boolean not null default true unique check (unica),  -- uma linha só [lab]
  email text not null,
  google_sub text not null,                                  -- conta Google estável
  segredo_id uuid,                                           -- vault.secrets.id; nulo depois de desconectar
  escopos text[] not null,
  conectado_em timestamptz not null,
  conectado_por uuid not null references perfis(id),
  desconectado_em timestamptz,
  desconectado_por uuid references perfis(id),
  revogacao_remota text check (revogacao_remota in ('ok','falhou','nao_tentada')),   -- usado só se D-REV = sim
  ultimo_erro text check (ultimo_erro in ('invalid_grant','escopo_divergente','conta_divergente','identidade_invalida',
                                           'token_ausente','http','recusado')),
  ultimo_erro_em timestamptz
);
alter table ged_conexao enable row level security;              -- SEM políticas
revoke all on ged_conexao from anon, authenticated;
create trigger trg_ged_conexao_sem_delete before delete on ged_conexao for each row execute function fn_bloquear_delete();
-- SEM fn_auditoria: copiaria segredo_id para a auditoria lida pelo admin geral [lab]. Auditoria saneada, seção 4.

create table ged_conexao_estados (
  state text primary key,                                     -- 64 hex (2 × gen_random_uuid sem hífens)
  perfil_id uuid not null references perfis(id),
  destino text not null check (destino ~ '^/(?!/)[a-z0-9_-]+(/[a-z0-9_-]+)*$'),       -- [lab no Postgres]
  code_verifier text not null,                                -- PKCE; 64 hex (dentro de 43 a 128, alfabeto permitido)
  criado_em timestamptz not null default now(),
  consumido_em timestamptz,                                   -- marcado ANTES da troca do código
  concluido_em timestamptz
);
alter table ged_conexao_estados enable row level security;
revoke all on ged_conexao_estados from anon, authenticated;
```

## 3. Funções SQL [proposta]

**Regras para todas:**
- `security definer`, porque as tabelas estão revogadas;
- `set search_path = public` (convenção do projeto), com `vault.` qualificado. **[V]** Conferir que `authenticated` não tem `create`
  em `public`; se tiver, usar `search_path = ''`;
- **`revoke all on function … from public, anon, authenticated`** e `grant execute` só ao papel da tabela. Revogar só de `PUBLIC` não
  basta: os privilégios padrão do Supabase dão `execute` a `anon` e `authenticated` [lab];
- exceções sem e-mail, ID, `state` nem valor recebido.

| Função | Papel | Autorização | Comportamento |
|---|---|---|---|
| `ged_iniciar_conexao(p_destino text)` → `text` | `authenticated` | `eh_admin_geral()` (já inclui `acesso_liberado`, 0007) | valida o destino (o `check` da tabela é a segunda barreira); apaga estados com mais de 1 dia; recusa se o perfil tiver 5 ou mais estados abertos; gera `state` e `code_verifier`; devolve o `state` |
| `ged_validar_estado(p_state text)` → `jsonb` | `service_role` | perfil do estado ativo, `admin_geral` e `acesso_liberado(perfil_id)`; **por `perfil_id`**, porque não há `auth.uid()` na Edge Function | só na **ida**, sem consumir: devolve `code_verifier` (a Edge Function calcula o desafio S256), o destino e a conta configurada. Estado inválido, vencido (15 minutos) ou consumido: nulo |
| `ged_consumir_estado(p_state text)` → `jsonb` | `service_role` | a mesma revalidação do perfil | na **volta**, **antes** da troca do código: `update … set consumido_em = now() where state = $1 and consumido_em is null and criado_em > now() - interval '15 minutes' returning …` (atômico; o segundo uso devolve nulo). Devolve o perfil, o destino e o `code_verifier` |
| `ged_concluir_conexao(p_state, p_email, p_sub, p_escopos text[], p_refresh_token)` → `text` | `service_role` | `state` consumido há no máximo 2 minutos e não concluído (`for update`); perfil ainda admin e ativo | e-mail igual à conta configurada; escopos iguais ao conjunto exato (seção 5); refresh token presente; conexão ativa com outro `google_sub`: recusa (⟦D-TROCA⟧). Vault: `update_secret` se houver segredo, senão `create_secret`. Upsert da linha; `concluido_em`; auditoria saneada. **Uma transação**: se algo falhar, o segredo é desfeito junto [lab]. **[V]** confirmar que o Vault real é transacional |
| `ged_refresh_token()` → `jsonb` | `service_role` | — | `{refresh_token}` da conexão ativa, ou nulo. Para as fases seguintes |
| `ged_registrar_erro_conexao(p_codigo text)` | `service_role` | — | só códigos da lista (`check`). Com `invalid_grant`: situação `com_erro`; apagar o segredo inútil depende de ⟦D-INVALID⟧ |
| `ged_situacao_conexao()` → `table(email, escopos, conectado_em, desconectado_em, revogacao_remota, ultimo_erro, ultimo_erro_em, situacao)` | `authenticated` | `eh_admin_geral()`; os demais recebem **vazio** | `situacao` ∈ `conectada`/`com_erro`/`desconectada` (GED 8.1). Nunca devolve `segredo_id`, `google_sub` nem token |
| `ged_desconectar(...)` | ⟦D-REV⟧: **não** → `authenticated` com `eh_admin_geral()`, sem parâmetros; **sim** → `service_role`, `(p_perfil uuid, p_revogacao text)`, com a conferência do perfil admin | | **idempotente**: sem conexão ativa, retorna sem erro. Apaga o segredo, marca `desconectado_*` e grava a auditoria saneada, numa transação |

## 4. Auditoria saneada [proposta]

As funções inserem diretamente em `auditoria` (`CLAUDE.md`, regra 5):
- `tabela = 'ged_conexao'`, `registro_id = id`;
- `acao` ∈ {`conectou`, `substituiu`, `desconectou`, `erro`};
- `depois = {email, escopos, revogacao_remota?, codigo_erro?}`;
- `usuario_id` = o perfil que iniciou, porque o padrão `auth.uid()` é nulo na `service_role` [código].

**Nunca** entram `segredo_id`, `google_sub`, token, `state` nem `code_verifier`.

## 5. Edge Function `nucleo-ged-conectar` [proposta]

**Organização:** a lógica fica em `supabase/functions/_shared/ged.ts`, sem imports, com dependências injetadas (`rpc`, `fetch`, `env`,
`agora`). O `index.ts` só liga as peças. Assim, tudo é testável no Vitest. O desafio S256 é calculado com `crypto.subtle.digest`
(Web Crypto, disponível no Deno e no Node).

**Configuração obrigatória, sem fallback.** Faltando qualquer item, a resposta é 500 genérico, sem redirecionar.
- `GED_DRIVE_CLIENT_ID`, `GED_DRIVE_CLIENT_SECRET`;
- `GED_DRIVE_REDIRECT_URI`: **exatamente** o URI cadastrado no Google; nunca vem da requisição;
- `NEO_ADMIN_URL` (⟦D-URL⟧): variável **nova**, não existe hoje [código];
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

**Ida** (`GET ?state=`):
1. Só GET (405 para os outros). `state` no formato `^[0-9a-f]{64}$` (400 sem consultar o banco).
2. `ged_validar_estado`; nulo: 400, "A autorização expirou".
3. Redirecionamento ao Google com:
   - `scope = openid email https://www.googleapis.com/auth/drive.readonly`;
   - `access_type=offline`, `prompt=consent`;
   - `code_challenge` (S256), `code_challenge_method=S256`;
   - `login_hint` e `hd=neoformas.com.br` (**só orientação, não provam identidade**);
   - **sem** `include_granted_scopes`.
4. **[melhoria]** Cookie `HttpOnly; Secure; SameSite=Lax`, no domínio da função, com o hash do `state`, conferido na volta.

**Volta** (`GET ?code=&state=` ou `?error=&state=`):
1. Formato do `state`, depois `ged_consumir_estado` (atômico). Nulo: 400, "expirou".
2. `error`: `ged_registrar_erro_conexao('recusado')` e redirecionamento com `?ged=recusado`.
3. Troca do código: POST a `https://oauth2.googleapis.com/token`, com `code_verifier` e timeout de 10 s. Este é o único POST do fluxo,
   e vai ao OAuth, não ao Drive.
4. **Identidade.** O `id_token` vem direto do endpoint de token, por TLS, então a assinatura pode ser dispensada (OIDC Core 3.1.3.7,
   item 6). É **obrigatório** conferir:
   - `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`};
   - `aud` = `GED_DRIVE_CLIENT_ID`;
   - `exp` > agora;
   - `email_verified === true` (ausente = recusa);
   - `hd === "neoformas.com.br"`;
   - `email` = conta configurada (minúsculas);
   - `sub` presente.

   Qualquer falha: `identidade_invalida` ou `conta_divergente`.
5. **Escopos.** O conjunto (separado por espaço) tem de conter `…/auth/drive.readonly`, e **só** itens de {`openid`, `email`,
   `https://www.googleapis.com/auth/userinfo.email`, `…/auth/drive.readonly`}. Escopo a mais, ou a falta do `drive.readonly`
   (consentimento parcial): `escopo_divergente`.
6. Refresh token ausente: `token_ausente`.
7. `ged_concluir_conexao`, depois redirecionamento com `?ged=conectado`.

**Redirecionamento final:** `new URL(destino, NEO_ADMIN_URL)`, com a **origem conferida** igual à de `NEO_ADMIN_URL`. A query leva
**só códigos fixos** (`ged=conectado|recusado|erro`, `codigo=<lista>`), **nunca** o texto da exceção.

**Nunca** vão a log, URL, resposta ou exceção:
- `code`, access e refresh tokens, `id_token`;
- corpo da resposta do Google;
- `client_secret`, `code_verifier`, `segredo_id`, `google_sub`;
- e-mail.

**Compensação do `verify_jwt = false`** (necessário, como no Gmail, porque o Google redireciona sem JWT):
- só GET;
- formato do `state` e consumo atômico;
- PKCE;
- revalidação do perfil admin na ida, na volta e na conclusão;
- identidade e escopos conferidos;
- respostas genéricas.

## 6. Desconexão, revogação e falhas

| Cenário | Comportamento |
|---|---|
| Reconexão com a mesma conta (mesmo `sub`) | `update_secret`; auditoria `substituiu`; nenhum segredo novo |
| Outra conta com conexão ativa | recusa (`conta_divergente`); a troca exige desconectar e trocar a configuração antes (⟦D-TROCA⟧) |
| Falha do OAuth antes do `concluir` | nenhum segredo criado; `ultimo_erro` registrado; `state` consumido |
| Falha entre gravar o segredo e gravar a linha | impossível ficar parcial: as duas coisas estão na mesma transação [lab]. **[V]** Vault real |
| Desconexão repetida | a segunda não faz nada e não dá erro |
| O Google revoga, ou chega `invalid_grant` no próximo uso | `com_erro`; o segredo fica ou é apagado conforme ⟦D-INVALID⟧; a pendência "Reautorizar" depende do PENDENTE 15 (na A0, a situação aparece só na tela do admin) |
| **Revogação remota** (se ⟦D-REV⟧ = sim) | a Edge Function lê o token (`service_role`) e faz o POST a `https://oauth2.googleapis.com/revoke` (timeout de 10 s; `400 invalid_token` conta como `ok`). **Sempre** em seguida, `ged_desconectar(perfil, resultado)`. O estado local termina **sempre** desconectado. Falha remota: `revogacao_remota = 'falhou'` e aviso ao admin ("revogue em myaccount.google.com"). Se a gravação local falhar depois de revogar, o token já está morto, e repetir a desconexão acerta |
| Revogação remota não aprovada | desconexão só local; revogação no Google manual, documentada |

## 7. Configuração por ambiente

Há **um único** projeto Supabase (`neo-admin-sp`) [código, `docs/PUBLICACAO.md`]: não existe homologação.

| Item | Onde | Valor |
|---|---|---|
| `GED_DRIVE_CLIENT_ID`, `GED_DRIVE_CLIENT_SECRET` | segredos da função (`scripts/gravar-segredo.mjs`) | cliente OAuth "Aplicativo da Web", **Interno** ⟦novo ou existente: resposta 3⟧ |
| `GED_DRIVE_REDIRECT_URI` | segredo (obrigatório) | `https://<ref>.supabase.co/functions/v1/nucleo-ged-conectar`, idêntico ao cadastrado no Google |
| `NEO_ADMIN_URL` | segredo (obrigatório) | ⟦D-URL⟧ |
| `administrativo.ged.conta` | `configuracoes` (admin geral) | ⟦resposta 2⟧ |
| `[functions.nucleo-ged-conectar] verify_jwt = false` | `supabase/config.toml` | como no Gmail, com as compensações da seção 5 |

**Testes:** só PGlite, Vitest e fetch simulado, sem segredo real.

## 8. Testes obrigatórios antes da migration ser aplicada

| # | Caso | Ambiente |
|---|---|---|
| 1 | admin conecta; não-admin é recusado em `ged_iniciar_conexao` | PGlite |
| 2 | inativo ou troca de senha pendente recusado ao iniciar; perfil que perdeu o admin entre a ida e a volta recusado em `validar`, `consumir` e `concluir` | PGlite |
| 3 | `state` inválido, vencido (16 minutos), consumido ou concluído; segundo `consumir` dá nulo | PGlite; concorrência real **[V]** |
| 4 | conta divergente; `sub` divergente com conexão ativa | PGlite + Vitest |
| 5 | `id_token` com `aud`, `iss` ou `hd` errados, `exp` vencido, `email_verified` ausente ou falso | Vitest |
| 6 | escopo a mais (`drive`, `drive.file`), a menos, texto que só contém o trecho | Vitest + PGlite |
| 7 | volta com `error`: `recusado`, sem trocar o código | Vitest |
| 8 | refresh token ausente | Vitest + PGlite |
| 9 | falha do Vault (exceção no `create_secret` do Vault mínimo): nada gravado | PGlite |
| 10 | falha depois do segredo e antes da linha: tudo desfeito | PGlite |
| 11 | desconexão repetida: sem erro e sem efeito | PGlite |
| 12 | revogação remota `200`, `400 invalid_token`, `500`, timeout: estado local sempre desconectado, resultado registrado | Vitest (se D-REV = sim) |
| 13 | vazamento: nenhuma resposta, `Location`, log simulado ou exceção com `code`, tokens, `client_secret`, `code_verifier`, `segredo_id` ou e-mail; nenhuma linha de `auditoria` com `segredo_id` | Vitest + PGlite |
| 14 | open redirect: `//evil`, `/\evil`, `%2F%2F`, CRLF, `https://…`, `..` recusados no banco e na função | PGlite + Vitest (padrões comprovados em lab) |
| 15 | privilégios: matriz `has_function_privilege` (todas as funções × `anon`/`authenticated`/`service_role`); `has_table_privilege` falso para usuários; varredura das migrations por `grant` indevido | PGlite (padrão comprovado em lab) |
| 16 | PKCE: `code_challenge` S256 correto na ida; `code_verifier` correto na troca; nunca no navegador | Vitest |
| 17 | configuração ausente: 500 genérico | Vitest |
| 18 | primeira conexão real: escopo concedido, logs sem token nem `code` visível, Vault cifrado | **manual, em produção**, depois da autorização |

**Verificações reservadas ao Supabase real [V]:**
- a cifragem e a transação do Vault;
- a concorrência real do consumo do `state`;
- se os logs da plataforma registram a query string do callback (o PKCE neutraliza o `code`);
- `create` em `public` para `authenticated`;
- o comportamento do consentimento granular do Google.

## 9. Ativação e critérios de aceite

**Ativação**, depois de todas as aprovações:
1. `npm run verificar` com os testes 1 a 17.
2. **Responsável:**
   - conta dedicada, com leitor só nas raízes (quando o PENDENTE 1 for confirmado);
   - cliente OAuth Interno, com o URI exato;
   - aplicar a `0801` (`docs/PUBLICACAO.md`, seção 2: `db query -f` e o insert em `schema_migrations`);
   - gravar os segredos;
   - deploy com `--project-ref`.
3. Admin geral: grava `administrativo.ged.conta`, clica em "Conectar" e entra **com a conta dedicada**.
4. Teste 18.

**Critérios de aceite:**
1. Testes 1 a 17 verdes e `npm run verificar` verde.
2. Ninguém lê `ged_conexao` nem `ged_conexao_estados` diretamente; o admin vê só a projeção.
3. Refresh token só no Vault. `segredo_id`, token e e-mail fora de URL, log e auditoria.
4. Só a conta configurada, com o `sub` coerente, e só o escopo `drive.readonly` completam a conexão.
5. `state` de uso único, consumido antes da troca, válido por 15 minutos. PKCE S256. Destino relativo com a origem conferida.
6. Desconexão idempotente, que preserva o registro.
7. `invalid_grant` e falhas aparecem como `com_erro`, por código, sem dado sensível.
8. Nenhuma chamada à Drive API nesta fase.

**Desfazer:**
- desconectar e revogar o acesso (no Google ou manualmente);
- remover os segredos;
- módulo inativo.

As tabelas ficam. Removê-las exige uma migration nova, aprovada, que nunca apaga registro de prova. Se a `0801` falhar ao aplicar, a
transação é desfeita e nada é registrado em `schema_migrations`.

## 10. Acompanhamento separado: `nucleo-gmail-conectar` (em uso)

**Fora do escopo desta tarefa. Nada foi alterado.** Os achados abaixo foram confirmados no código e precisam de uma **tarefa
específica**, com autorização do responsável:

| Achado | Onde | Impacto potencial |
|---|---|---|
| destino aceita qualquer host (`^https?://[^/]+/`) | `gmail_iniciar_conexao` (0153) | um usuário logado pode montar um link de conexão que termina num site externo (open redirect, útil para phishing) |
| escopo conferido por substring (`includes("gmail.compose")`) | `index.ts` | aceita uma autorização com escopos adicionais |
| `email_verified` ausente conta como verificado; sem conferência de `aud`/`iss`/`exp` | `emailDoIdToken` | proteção de identidade mais fraca do que o necessário (o risco prático é baixo, porque o token vem direto do Google) |
| texto da exceção (com o e-mail do perfil) na URL de volta | `comAviso(…, error.message)` | e-mail no histórico do navegador e em logs |
| `state` consumido só depois da troca do código | `gmail_concluir_conexao` | replay do callback dentro de 15 minutos dispara nova troca (o Google recusa o `code` repetido) |

**Necessidade:** uma tarefa "Endurecer o Gmail por usuário", com migration própria (faixa 01xx) e testes no padrão da seção 8.

---

## Anexo A — Proposta original (24/10/2026), SUPERADA

> Preservada só como histórico. **Não usar.** Pontos superados: `id smallint`; `fn_auditoria` na conexão; destino `^/[a-z0-9/_-]*$`; revoke ambíguo das funções; sem PKCE nem consumo antecipado do `state`; identidade e escopo conferidos como no Gmail; `NEO_ADMIN_URL`/`GED_DRIVE_REDIRECT_URI` com fallback.

Data: 24/10/2026 · Situação: **PLANO, não executado.** Não há migration, função, segredo nem conexão criados.

- **Pré-requisitos para executar:** a aprovação da GED-P3 e da GED-P17 (revisão 4), as respostas 1 a 3, 7 e 15 de
  `RESPOSTAS_PENDENTES_CONTRATOS_GED_2026-10-24.md` e a autorização expressa da fase.
- **Base:** o padrão real do projeto, conferido nos arquivos:
  - `0153_gmail_por_usuario_kit_enviado.sql` (Vault, `state` de uso único, funções só para `service_role`);
  - `supabase/functions/nucleo-gmail-conectar/index.ts` (fluxo de ida e volta, `verify_jwt = false`);
  - `tests/db/filial-gmail-envio.test.ts` (Vault mínimo no PGlite);
  - `docs/PUBLICACAO.md` (como aplicar migration e registrar em `schema_migrations`).

### A.0. Escopo

| Entra na A0-conexão (este plano) | Fica fora |
|---|---|
| conexão OAuth da conta dedicada, guarda do token, situação da conexão, desconexão, registro de erro | **verificação das raízes e cadastro da raiz candidata**: também é A0 pela GED 13, mas depende da GED-P13 (prazo, persistência) e do PENDENTE 1 (IDs). Fica num plano próprio, A0-verificação |
| | indexação, carga inicial, incremental, reconciliação (A1b) |
| | tabelas `ged_*` do índice (A1a) |

### A.1. Migration `0801_ged_conexao.sql`

**Numeração confirmada:** a faixa 0800–0899 é do núcleo estendido (`CLAUDE.md`); a `0800_nucleo_apps_pendencias.sql` é a última que
existe; a GED 8 prevê "0801 em diante".

**Conteúdo previsto (esboço, não SQL final):**

```sql
-- Módulo (inativo até a publicação)
insert into modulos (codigo, area, nome, ativo) values ('administrativo.ged', 'administrativo', 'Central de Documentos', false)
  on conflict do nothing;
insert into configuracoes (chave, valor, descricao) values
  ('administrativo.ged.conta', 'null', 'E-mail da conta dedicada do GED (GED-P3). Só ela pode concluir a conexão.')
  on conflict (chave) do nothing;

-- Conexão: uma linha só. Tabela INTEIRA protegida (GED-P17): sem política, revoke all.
create table ged_conexao (
  id smallint primary key default 1 check (id = 1),
  email text not null,
  segredo_id uuid not null,                 -- vault.secrets.id (refresh token cifrado)
  escopos text[] not null,
  conectado_em timestamptz not null default now(),
  conectado_por uuid not null references perfis(id),
  desconectado_em timestamptz,
  desconectado_por uuid references perfis(id),
  ultimo_erro text,                          -- código genérico (ex.: 'invalid_grant'), nunca token ou corpo da resposta
  ultimo_erro_em timestamptz
);
alter table ged_conexao enable row level security;      -- sem políticas
revoke all on ged_conexao from anon, authenticated;
create trigger ... before delete on ged_conexao ... fn_bloquear_delete();
create trigger ... fn_auditoria() ...;                 -- decisão humana (conectar/desconectar) vai para a auditoria

create table ged_conexao_estados (
  state text primary key,                    -- 64 hex, gerado no banco
  perfil_id uuid not null references perfis(id),
  destino text not null,                     -- caminho RELATIVO do app (ex.: '/configuracoes/documentos')
  criado_em timestamptz not null default now(),
  usado_em timestamptz
);
alter table ged_conexao_estados enable row level security;
revoke all on ged_conexao_estados from anon, authenticated;
```

**Funções** (todas `security definer set search_path = public`, com `revoke all … from public, anon[, authenticated]` explícito):

| Função | Quem executa | O que faz |
|---|---|---|
| `ged_iniciar_conexao(p_destino text) returns text` | `authenticated` | exige `eh_admin_geral()` e `acesso_liberado(auth.uid())`; exige `p_destino ~ '^/[a-z0-9/_-]*$'` (relativo, **sem host**); limpa estados com mais de 1 dia; grava e devolve o `state` (2 × uuid sem hífens) |
| `ged_validar_conexao(p_state text) returns jsonb` | `service_role` | `state` existe, não usado, com menos de 15 minutos, e o perfil continua ativo e admin geral; devolve o destino e a conta esperada (`administrativo.ged.conta`) |
| `ged_concluir_conexao(p_state, p_email, p_escopos text[], p_refresh_token) returns text` | `service_role` | trava o `state` (`for update`) e o marca como usado; exige `p_email` = conta configurada, `p_escopos` = exatamente `drive.readonly` (mais `openid`/`email`) e refresh token presente; cria ou atualiza o segredo no Vault; faz o upsert da linha `id = 1`, limpando `desconectado_*` e `ultimo_erro` |
| `ged_refresh_token() returns jsonb` | `service_role` | `{email, refresh_token}` da conexão ativa, ou nulo. Para as funções futuras (verificação, A1b) |
| `ged_registrar_erro_conexao(p_codigo text)` | `service_role` | grava `ultimo_erro` e `ultimo_erro_em`. Aceita só códigos da lista (`invalid_grant`, `escopo_divergente`, `conta_divergente`, `http_<n>`) |
| `ged_situacao_conexao() returns table(email, escopos, conectado_em, desconectado_em, ultimo_erro, ultimo_erro_em, situacao)` | `authenticated` | **só o admin geral** recebe linha; os demais recebem vazio. **Nunca devolve `segredo_id`**. `situacao` ∈ `conectada`/`com_erro`/`desconectada` (GED 8.1) |
| `ged_desconectar()` | `authenticated` | exige `eh_admin_geral()`; apaga o segredo do Vault; marca `desconectado_em/por` (a linha não é apagada) |

**Diferenças deliberadas em relação ao Gmail (0153):**
1. Só o **admin geral** conecta e desconecta. A conta é **a configurada**, não "a do próprio usuário".
2. O destino é **relativo**. A 0153 aceita qualquer host (`^https?://[^/]+/`), o que permite levar o navegador para fora do app. **Esse
   ponto da 0153 fica registrado como observação, sem alteração.**
3. A lista de escopos é conferida de forma **exata**: recusa escopo a mais, como `drive` ou `drive.file` (GED 5.1.3).
4. `ged_conexao` não tem leitura nem pela própria linha (o Gmail deixa o usuário ler a dele).

### A.2. Edge Function `nucleo-ged-conectar`

**Organização para teste sem Deno:** a lógica fica em `supabase/functions/_shared/ged.ts`, sem imports, com dependências injetadas
(`rpc`, `fetch`, `env`). O `index.ts` só liga as peças (`Deno.serve`, `createClient`). Assim, o Vitest testa o fluxo inteiro com
OAuth e HTTP simulados.

```ts
// _shared/ged.ts (proposto)
export const ESCOPO_DRIVE = "https://www.googleapis.com/auth/drive.readonly";
export function urlAutorizacao(cfg, state, contaEsperada): string
// client_id, redirect_uri, response_type=code, scope="openid email "+ESCOPO_DRIVE, access_type=offline, prompt=consent,
// login_hint=contaEsperada, hd="neoformas.com.br", state; SEM include_granted_scopes (não herda escopos antigos)
export function avaliarTokens(resp): { ok: true; email; escopos; refreshToken } | { ok: false; codigo }
// recusa: escopos ≠ {openid, email/userinfo.email, drive.readonly}; e-mail ausente ou não verificado; refresh ausente
export async function tratarConexao(req, deps): Promise<{ status; location?; corpo? }>
```

**Fluxo** (`verify_jwt = false` em `config.toml`, como no Gmail; a segurança é o `state`):
1. **Início, no app.** O admin geral clica em "Conectar o Drive do GED". A action do servidor, com o cliente do usuário, chama
   `ged_iniciar_conexao('/configuracoes/documentos')` e redireciona para `…/functions/v1/nucleo-ged-conectar?state=…`.
2. **Ida.** Pedido `GET ?state=` (o `state` precisa ter o formato `^[0-9a-f]{64}$`). A função chama `ged_validar_conexao`: inválido ou
   vencido responde "A autorização expirou" (texto, 400). Válido redireciona ao Google com a `urlAutorizacao`.
3. **Volta do Google:**
   - `GET ?error=…&state=` redireciona a `APP_URL + destino ?ged=recusado`;
   - `GET ?code=…&state=`: valida o `state` de novo, troca o código no endpoint de token (POST ao OAuth, **não** à Drive API) e roda
     `avaliarTokens`. Se recusar, chama `ged_registrar_erro_conexao(codigo)` e redireciona com `?ged=erro&motivo=<mensagem genérica>`.
     Se aceitar, chama `ged_concluir_conexao` (que grava no Vault) e redireciona com `?ged=conectado`.
4. **Nunca** vão a log, resposta ou redirecionamento: código, tokens, corpo da resposta do Google, `segredo_id` (GED 5.11.11).

**Expiração, revogação e `invalid_grant`:**
- `state`: 15 minutos e uso único (`usado_em`); estados com mais de 1 dia são apagados.
- Access token: não é guardado; é obtido a cada uso (funções futuras) a partir do refresh token.
- `invalid_grant` (refresh revogado, senha trocada, conta desativada): as funções futuras chamam `ged_registrar_erro_conexao('invalid_grant')`,
  e a situação passa a `com_erro`. **Pendência "Reautorizar":** depende do PENDENTE 15. Na A0, a situação aparece só na tela do admin
  geral.
- Desconectar: `ged_desconectar()` apaga o segredo e marca a linha. Revogar também no Google exige um POST a
  `oauth2.googleapis.com/revoke`, chamada externa com efeito. **Decisão pendente** (proposta: sim, feita pela Edge Function e
  registrada). Sem ela, a revogação no Google fica manual, em myaccount.google.com.

### A.3. Configuração por ambiente

Há **um único** projeto Supabase (`neo-admin-sp`, `docs/PUBLICACAO.md`): não existe homologação.

| Item | Onde | Valor |
|---|---|---|
| `GED_DRIVE_CLIENT_ID`, `GED_DRIVE_CLIENT_SECRET` | segredos da Edge Function (`scripts/gravar-segredo.mjs`) | cliente OAuth "Aplicativo da Web", **Interno**, projeto `neo-admin-neoformas` ⟦novo ou existente: resposta 3⟧ |
| `GED_DRIVE_REDIRECT_URI` (opcional) | segredo | padrão: a URL da própria função |
| `NEO_ADMIN_URL` | segredo | URL pública do app, base do destino relativo ⟦a confirmar⟧ |
| `administrativo.ged.conta` | `configuracoes` (o admin geral grava) | ⟦resposta 2⟧ |
| URI de redirecionamento | Google Cloud, no cliente OAuth | `https://<ref>.supabase.co/functions/v1/nucleo-ged-conectar` |
| `[functions.nucleo-ged-conectar] verify_jwt = false` | `supabase/config.toml` | igual ao Gmail |

**Testes:** só PGlite e fetch simulado, sem nenhum segredo real.

### A.4. Testes

**Banco** (PGlite, `tests/db/ged-conexao.test.ts`, com o Vault mínimo de `filial-gmail-envio.test.ts`):
1. `ged_iniciar_conexao`:
   - recusa quem não é admin geral, o usuário inativo e a sessão por senha com troca de senha pendente (`acesso_liberado`);
   - recusa destino com host (`https://exemplo.invalid/`), `//host` e `/../`.
2. `state`:
   - vencido (16 minutos), usado ou inexistente: `ged_validar_conexao` devolve nulo;
   - a segunda conclusão com o mesmo `state` é recusada.
3. `ged_concluir_conexao`:
   - recusa conta diferente da configurada, escopo a mais (`drive`), escopo a menos e refresh vazio;
   - aceita o caso certo, com o segredo no Vault e só o `segredo_id` na tabela.
4. **Acesso negado (GED-P17, 11.5 itens 13 e 14):**
   - `authenticated` não lê nem grava `ged_conexao` e `ged_conexao_estados` (select, insert, update);
   - `anon` também não;
   - `ged_validar_conexao`, `ged_concluir_conexao`, `ged_refresh_token` e `ged_registrar_erro_conexao` não podem ser executadas por
     `authenticated`.
5. `ged_situacao_conexao`:
   - o admin vê a situação **sem `segredo_id`**; o não-admin recebe vazio;
   - `invalid_grant` muda a situação para `com_erro`.
6. `ged_desconectar`:
   - só o admin geral;
   - apaga o segredo e marca a linha, que não é apagada (`fn_bloquear_delete`);
   - entra na auditoria.
7. **Regressão:** varrer `supabase/migrations/*.sql` por `grant … on ged_conexao…` para `anon` ou `authenticated`.

**Edge Function** (Vitest, `lib/nucleo/ged/conexao.test.ts`, `tratarConexao` com `rpc` e `fetch` simulados):
1. Pedido que não é GET: 405. `state` mal formado: 400 sem consultar o banco.
2. Ida: a URL do Google tem `access_type=offline`, `prompt=consent`, só `drive.readonly`, `login_hint` da conta configurada e não tem
   `include_granted_scopes`.
3. Volta com `error`: redireciona com `recusado`, sem trocar código.
4. Volta com `code`:
   - troca no endpoint de token (o único POST permitido, e para o OAuth);
   - escopo divergente, e-mail não verificado ou refresh ausente: registra o erro e redireciona com mensagem genérica, sem conectar.
5. Sucesso: `ged_concluir_conexao` é chamada com o e-mail e os escopos.
6. Nada vaza: nenhuma resposta, `Location` ou log simulado contém `code`, token, `client_secret` ou `segredo_id`.
7. Configuração ausente (`GED_DRIVE_CLIENT_*`): 500 com mensagem genérica, sem redirecionar.
8. A varredura de escrita atual (`drive-http.test.ts`) é ampliada: o único POST permitido no `_shared/ged.ts` é para
   `oauth2.googleapis.com/token` (e `/revoke`, se aprovado).

### A.5. Procedimento de ativação (só depois das aprovações)

1. Revisão 4 do GED aplicada; autorização expressa da A0; `npm run verificar` passando, com os testes acima.
2. **Responsável:**
   - cria ou indica a conta dedicada;
   - dá a ela **leitor** só nas raízes, quando o PENDENTE 1 estiver confirmado. A conexão funciona sem isso, mas a verificação não;
   - cria ou ajusta o cliente OAuth Interno, com o URI de redirecionamento.
3. **Responsável:** aplica a `0801` em produção (`docs/PUBLICACAO.md`, seção 2: `db query -f` e o insert em
   `supabase_migrations.schema_migrations`).
4. **Responsável:** grava os segredos (`gravar-segredo.mjs`) e faz o deploy de `nucleo-ged-conectar` com `--project-ref`.
5. O admin geral grava `administrativo.ged.conta` e clica em "Conectar". No Google, entra **com a conta dedicada** e autoriza.
6. Conferência: a situação fica `conectada`, com escopo só `drive.readonly`; `ged_conexao` não aparece pela API para nenhum usuário; os
   logs da função não têm token.
7. **Nenhuma** chamada à Drive API acontece na A0-conexão.

### A.6. Critérios de aceite

1. Os testes de banco 1 a 7 e os da Edge Function 1 a 8 passando; `npm run verificar` verde.
2. Nenhum usuário (nem o admin geral) lê `ged_conexao` ou `ged_conexao_estados` diretamente; o admin vê só a projeção, sem `segredo_id`.
3. O refresh token existe **só** no Vault; não aparece em tabela, resposta, redirecionamento nem log.
4. Só a conta configurada e só o escopo `drive.readonly` completam a conexão.
5. `state` de uso único, válido por 15 minutos; destino só relativo.
6. Desconectar remove o segredo e preserva o registro (auditoria e `fn_bloquear_delete`).
7. `invalid_grant` gera a situação `com_erro`, visível ao admin geral, sem dado sensível.
8. Nada de indexação, verificação de raiz ou chamada à Drive API nesta fase.

### A.7. Rollback

- **Funcional, sem migration:**
  - `ged_desconectar()`, que remove o segredo;
  - revogar o acesso da conta em myaccount.google.com;
  - remover os segredos `GED_DRIVE_CLIENT_*`;
  - deixar o módulo `administrativo.ged` inativo.
- **Estrutural:** as tabelas ficam (sem dado sensível depois da desconexão). Remover tabelas exige uma migration nova, aprovada, que
  nunca apaga registro de prova (`CLAUDE.md`, regra 4).
- **Se a 0801 falhar ao aplicar:** a migration roda em transação única (padrão do projeto). Nada é registrado em `schema_migrations`;
  corrigir e reaplicar.

### A.8. Dependências que impedem criar a migration hoje

| Dependência | Por quê |
|---|---|
| GED-P3 aprovada (respostas 1 a 3) | define a conta, o cliente e a regra de "conta configurada" |
| GED-P17 aprovada (resposta 7) | define `ged_conexao` inteira protegida e a função de projeção |
| Aprovador e evidência (resposta 15), revisão 4 aplicada | processo do projeto: nova revisão e nova aprovação |
| Autorização expressa da fase A0 | GED 13: a aprovação documental não libera fase |
| Revogação no Google na desconexão (decisão) | define se a Edge Function faz um segundo POST ao OAuth |
| PENDENTE 15 (destino da pendência "Reautorizar") | **não bloqueia a A0-conexão**: sem ela, a situação aparece só na tela do admin |
