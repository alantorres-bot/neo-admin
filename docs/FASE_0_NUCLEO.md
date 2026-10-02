# Fase 0 — Núcleo

Status: construída e verificada **sem Supabase real** (ver "O que ainda não foi testado") — aguardando aprovação para a Fase 1.

## 1. O que foi entregue

| Item | Onde |
| --- | --- |
| Projeto Next.js 16 (App Router, TypeScript, Tailwind 4, shadcn/ui), Vitest e Playwright | raiz |
| Supabase CLI como dependência (`npx supabase ...`) e `supabase/config.toml` | `supabase/` |
| RLS de todas as tabelas do núcleo + regras de transição | `supabase/migrations/0002_nucleo_rls.sql` |
| Perfil no primeiro acesso; o primeiro usuário vira `admin_geral` | `0003_nucleo_primeiro_acesso.sql` |
| Bucket privado `anexos` + políticas por módulo | `0004_nucleo_storage_anexos.sql` |
| Ajustes da revisão: troca obrigatória de senha, segregação na aprovação, modelos só para gestor | `0005_nucleo_ajustes_fase0.sql` |
| Login (e-mail e senha), proteção de rotas (`proxy.ts`), sessão | `app/(auth)`, `proxy.ts`, `lib/nucleo/sessao.ts` |
| Menu lateral por área; só áreas e módulos ativos que o usuário pode ver | `components/plataforma/casca.tsx`, `lib/nucleo/permissoes.ts` |
| Início (Fila do dia) | `app/(plataforma)/inicio` |
| Configurações: empresas, contrapartes e contatos, usuários e permissões | `app/(plataforma)/configuracoes` |
| Gestão de usuários com service role (única) | `supabase/functions/nucleo-gerir-usuarios` |
| Importador genérico CSV/XLSX com mapeamento salvo | `lib/integracoes/importador`, `configuracoes/importador` |
| Anexos: caminho, envio, URL assinada (sem tela) | `lib/nucleo/anexos.ts` |

## 2. Regras de acesso implementadas (RLS)

Nível por área: `sem_acesso < consulta < operador < gestor < administrador`. `admin_geral` é administrador em todas as áreas.
Usuário inativo não enxerga nada. `anon` (sem login) não acessa nenhuma tabela.

| Tabela | Leitura | Escrita |
| --- | --- | --- |
| `areas`, `modulos` | usuário ativo | admin_geral |
| `configuracoes` | quem tem alguma área | admin_geral |
| `perfis` | o próprio; os demais, quem tem alguma área | admin_geral (update). Criação só pelo gatilho; sem delete |
| `permissoes` | as próprias; admin_geral lê todas | admin_geral |
| `empresas` | quem tem alguma área | admin_geral |
| `contrapartes` | consulta em alguma área. **Tipo `colaborador`: só quem tem a área `rh`** | operador em alguma área (colaborador: operador em `rh`). Sem delete |
| `contatos` | herda a visibilidade da contraparte | herda a regra da contraparte |
| `pendencias` | consulta na área do módulo | insere: operador. Altera: ver abaixo |
| `anexos`, `interacoes` | consulta na área do módulo | operador insere em seu nome. Sem update e sem delete |
| `modelos_mensagem` | consulta | **gestor** da área ou acima (operador só lê). Sem delete (desative) |
| `mensagens` | consulta | ver abaixo |
| `importacoes` | consulta | operador insere/atualiza as próprias. Sem delete |
| `importacao_modelos` | consulta | operador (inclui excluir; é configuração, não prova) |
| `auditoria` | só admin_geral | **ninguém** diretamente; só o gatilho `security definer`. Imutável até para a service role |
| Storage `anexos` | consulta no módulo do 1º segmento do caminho | operador. Sem update/delete. URL assinada |

**Pendências** (gatilho `fn_pendencias_regras`): o responsável conclui as próprias; operador pode assumir pendência sem dono (só para si);
só o gestor da área reatribui, edita dados ou reabre pendência encerrada. `concluido_por/em` são carimbados pelo banco.

**Mensagens** (gatilho `fn_mensagens_regras`): operador cria e edita só em `rascunho` e `aguardando_aprovacao`; `aprovada` exige gestor da área
(o banco carimba `aprovado_por/em`, o cliente não escolhe); mensagem aprovada não muda de conteúdo, só pode ser descartada;
`enviada`, `falhou` e `respondida` só a service role grava. Mensagens nunca são apagadas.
**Segregação (0005):** `mensagens.criado_por` guarda o autor (o banco carimba; o usuário não forja nem troca). Quem criou não aprova a própria.
Mensagem sem autor humano (`criado_por` nulo: régua/service role) não entra na regra. O `admin_geral` é isento, e cada uso da exceção grava
`APROVACAO_PROPRIA_ISENTA` na `auditoria`. Consequência prática: com um único gestor na área, as mensagens que ele criar só podem ser aprovadas por outro gestor ou pelo admin.

**Troca obrigatória de senha (0005):** `perfis.deve_trocar_senha`. Usuário criado ou com senha redefinida pelo admin chega com a marca ligada.
Enquanto ela estiver ligada o **banco** nega acesso a qualquer dado (as funções de acesso devolvem "sem acesso"; só lê o próprio perfil e as próprias permissões)
e o app leva a `/conta`. A marca só desliga quando a senha realmente muda no Auth (gatilho em `auth.users`); o usuário não consegue se liberar sozinho.
O primeiro usuário (criado no painel) e o admin que redefine a própria senha não são forçados.

Convenção dos gatilhos: `auth.uid()` nulo = origem de serviço (Edge Function, pg_cron, migration); preenchido = usuário logado.

## 3. Achado na migration 0001 (corrigido na 0002)

`fn_auditoria()` lia `new.id`/`old.id`, coluna que não existe em `permissoes` (chave composta) e `configuracoes` (chave = `chave`).
Qualquer insert em `permissoes` falharia. A 0002 recria a função lendo o id via `to_jsonb(...)->>'id'` (nulo quando não há).

## 4. Como colocar no ar (o que só você pode fazer)

1. **GitHub:** repositório privado; `git remote add origin ...` e `git push` (o repositório local já foi iniciado em `C:\dev\neo-admin`).
2. **Supabase:** criar o projeto **de teste** (supabase.com). Em *Project Settings > API*, copiar a URL e a chave `anon`.
3. Copiar `.env.example` para `.env.local` e preencher `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`. **Nunca** colar chaves no chat nem commitar.
4. No terminal da pasta do projeto:
   ```
   npx supabase login
   npx supabase link --project-ref <ref-do-projeto>
   npx supabase db push                                   # aplica 0001 a 0005 e 0100
   npx supabase functions deploy nucleo-gerir-usuarios
   ```
5. **Primeiro usuário:** painel do Supabase > Authentication > Users > *Add user* (e-mail e senha, marcar "Auto Confirm"). O gatilho cria o perfil e o torna `admin_geral`.
6. **Desativar o cadastro público:** Authentication > Sign In / Providers > desmarcar *Allow new users to sign up*. (O `config.toml` já traz `enable_signup = false` para o ambiente local.)
7. `npm run dev` e entrar em http://localhost:3000.
8. Repetir 2 a 6 no projeto de **produção** só depois de validar no de teste.

## 5. Como testar

**Automático** (não precisa de conta nem de Docker):
```
npm run verificar        # tipos + lint + mais de 100 testes (banco com PGlite, regras puras)
npx playwright test      # fumaça: rotas protegidas e login (sobe o app com variáveis falsas)
```
Os testes de banco rodam as **migrations reais** em um Postgres em memória (PGlite) com papéis `anon/authenticated/service_role`
e simulam cada nível de acesso. Foi feita uma checagem de mutação (remover o gatilho de mensagens e a regra de colaborador) para
confirmar que os testes realmente falham quando a proteção some.

**Manual, depois do passo 4** (o roteiro conduzido, com os testes de senha e de aprovação, está na conversa da revisão):
1. Entrar como o admin. Em *Configurações > Empresas*, cadastrar a Neo Formas (CNPJ inválido deve ser recusado).
2. *Usuários e permissões* > Novo usuário (operador do Financeiro) e outro (gestor do Financeiro).
3. Entrar com cada um: o menu mostra só Financeiro > Recebíveis; Jurídico e RH/SST não aparecem; *Usuários* não aparece.
4. Em *Contrapartes*: criar um cliente com contato (WhatsApp com DDD). Criar um colaborador só com um usuário que tenha RH.
5. Criar pendências de teste (SQL no painel, módulo `financeiro.recebiveis`) e conferir a Fila do dia: atrasadas primeiro, "Assumir", "Concluir", "Minha equipe" para o gestor e reatribuição.
6. *Importador*: enviar um CSV (Windows-1252, `;`) e um XLSX de amostra, mapear, salvar o modelo, reimportar e ver o modelo reaproveitado.

## 6. O que ainda não foi testado (sem projeto Supabase)

- Fluxos logados da interface (login real, Fila do dia com dados, formulários) e a **Edge Function** (`nucleo-gerir-usuarios`, código Deno, não executado).
- As migrations foram executadas e testadas em PGlite (Postgres 18 em WebAssembly) com stubs de `auth` e `storage`. Falta rodar `db push` num Supabase real,
  principalmente o gatilho em `auth.users` e as políticas do Storage.
- `@supabase/ssr`: `getClaims()` no `proxy.ts` e `functions.invoke` pelo cliente de servidor dependem do projeto real.

## 7. Pontos de atenção

- **Senha inicial:** definida pelo admin, com troca obrigatória no primeiro acesso. Convite por e-mail exigiria SMTP e uma tela de definição de senha (não feito).
- **Tabelas `rec_*` (0100):** só `rec_titulos` tem política; as demais têm RLS ligada e **nenhuma política** (bloqueadas). Completar na Fase 1 usando `tem_acesso_area('financeiro', ...)`; aprovar acordos exige `gestor`.
- **Anexos:** se o registro em `anexos` falhar depois do upload, o arquivo fica órfão no bucket (o usuário não pode apagar). Limpeza por rotina de admin, a definir.
- **Bucket `anexos`:** limite de 25 MB por arquivo; sem restrição de tipo. Ajustar se o jurídico/RH pedirem.
- **Reatribuição de pendência:** lista de candidatos = operador ou acima na área (função `usuarios_da_area`, só para gestor).
- **Tipos do banco:** `lib/nucleo/tipos.ts` é manual. Com o projeto criado, `npx supabase gen types typescript --linked` pode substituí-lo.
- **Valores do Excel:** XLSX entrega números com ponto decimal (`1234.56`) e datas em `dd/mm/aaaa`; CSV do Consistem traz `1.234,56`. O módulo que consome a importação precisa tratar os dois.
