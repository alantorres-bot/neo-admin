# Checklist de ativação — A0-GED (conexão com o Google Drive)

Data: 24/10/2026. Branch `auditoria-contratos-ged`, sobre `d2e643b`. A implementação ainda **não tem commit**.
**Situação: NADA APROVADO E NADA APLICADO.** Este roteiro só é executado depois das etapas 1 a 3. Nenhuma etapa foi feita ao
preparar este documento.

Referências: `docs/PUBLICACAO.md` (seção 2), `supabase/migrations/0801_ged_conexao.sql`,
`supabase/functions/nucleo-ged-conectar/index.ts`, `supabase/functions/_shared/ged.ts` (`configConexao`),
`docs/auditoria/PLANO_FASE_A0_GED_2026-10-24.md`, `docs/auditoria/IMPLEMENTACAO_A0_CONEXAO_GED_2026-10-24.md`.

## Valores fixos (conferidos no código)

| Item | Valor |
|---|---|
| Projeto Supabase de produção | `chdszjpbtfpstjrqnmmm` (São Paulo), conforme `docs/PUBLICACAO.md` |
| Migration | `0801_ged_conexao.sql`: versão `0801`, nome `ged_conexao`. É a única `0801`; a anterior na faixa é a `0800` |
| Edge Function | `nucleo-ged-conectar`, com `verify_jwt = false` no `supabase/config.toml`. A função confere o JWT por conta própria no POST; o GET é a volta do Google |
| URI de retorno (Google e segredo) | `https://chdszjpbtfpstjrqnmmm.supabase.co/functions/v1/nucleo-ged-conectar` |
| Segredos obrigatórios (sem valor padrão) | `GED_DRIVE_CLIENT_ID`, `GED_DRIVE_CLIENT_SECRET`, `GED_DRIVE_REDIRECT_URI`, `NEO_ADMIN_URL` |
| Segredos que o Supabase já fornece | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` |
| Escopos pedidos | `openid email https://www.googleapis.com/auth/drive.readonly` (só leitura) |
| Domínio exigido no `id_token` (`hd`) | `neoformas.com.br` |
| Parâmetros criados pela 0801 | `administrativo.ged.conta` (vazio) e `administrativo.ged.revogar_no_google` (`true`, recomendação de D-REV) |
| Tela | Configurações > Google Drive (GED), `/configuracoes/documentos`, só para o admin geral |

Se qualquer etapa for interrompida, siga a etapa 12 do ponto em que parou. Em caso de dúvida, **pare**: nenhuma etapa tem prazo
que justifique seguir com falha.

---

### 1. Aprovação documental da revisão 4 do GED
- **Responsável:** Alan, ou o aprovador que ele designar. O aprovador ainda **não está definido**.
- **Pré-requisitos:** `MINUTA_GED_REV4_2026-10-24.md` e `PREPARACAO_APROVACAO_REV4_REV6_CONTRATOS_GED_2026-10-24.md` lidos.
  GED-P3 e GED-P17 incluídas.
- **Ação:** aprovar ou recusar a revisão 4. Registrar o aprovador, a data e a evidência (e-mail ou ata) no documento da
  especificação do módulo.
- **Resultado esperado:** especificação do GED na revisão 4, com aprovação registrada.
- **Prosseguir se:** houver aprovação registrada com evidência. **Interromper se:** houver recusa ou pedido de mudança na conta,
  no escopo ou na proteção da `ged_conexao`. Nesses casos, a 0801 volta para revisão.

### 2. Autorização expressa da fase A0
- **Responsável:** Alan.
- **Pré-requisitos:** etapa 1 concluída.
- **Ação:** autorizar por escrito a fase A0-conexão, com o escopo de `PLANO_FASE_A0_GED_2026-10-24.md`: só a conexão, sem
  indexação e sem Drive API. Registrar junto da aprovação da etapa 1.
- **Resultado esperado:** autorização com data e escopo.
- **Prosseguir se:** a autorização estiver registrada. **Interromper se:** a autorização limitar o escopo (por exemplo, sem
  revogação ou com outra conta). Nesse caso, ajuste antes de aplicar.

### 3. Decisão formal sobre a revogação no Google (D-REV)
- **Responsável:** Alan.
- **Pré-requisitos:** nenhum além das etapas 1 e 2.
- **Ação:** decidir se "Desconectar" também revoga o acesso no Google. A recomendação técnica é que sim, e a 0801 já cria
  `administrativo.ged.revogar_no_google = true`. Registrar a decisão. Se for "não", depois da etapa 8 rodar:
  `update configuracoes set valor = 'false' where chave = 'administrativo.ged.revogar_no_google';`.
  Esse comando é auditado pelo gatilho do núcleo.
- **Resultado esperado:** decisão registrada. O parâmetro fica coerente com a decisão (conferir na etapa 10: a tela mostra o
  texto correspondente).
- **Prosseguir se:** a decisão estiver registrada. A D-TROCA (trocar de conta só depois de desconectar) segue a recomendação e
  está garantida no banco e na tela.

### 4. Conta corporativa dedicada e cliente OAuth
- **Responsável:** Alan, com o administrador do Google Workspace.
- **Pré-requisitos:** etapas 1 a 3.
- **Ação:**
  1. Criar ou escolher a conta **dedicada** `@neoformas.com.br`, que não seja a conta pessoal de ninguém. Ela precisa ter acesso
     de leitura às pastas que o GED vai ler. O endereço **ainda não foi definido**: não presuma.
  2. No Google Cloud, projeto do Neo Admin, tela de consentimento **Interna**.
  3. Criar o cliente OAuth "Aplicativo da Web", **separado** dos clientes do Gmail e do login.
  4. Anotar o ID e o segredo do cliente **sem colar em chat, documento ou Git**. Eles vão direto para a etapa 9.
- **Resultado esperado:** conta ativa, com login testado no navegador, e cliente criado, com o tipo de consentimento Interno.
- **Prosseguir se:** a conta for do domínio, o consentimento for Interno e o cliente for exclusivo do GED.
  **Interromper se:** o cliente só puder ser Externo, porque o `drive.readonly` exige verificação do Google. Nesse caso, reavalie.

### 5. URI de retorno cadastrado no Google
- **Responsável:** Alan.
- **Pré-requisitos:** etapa 4.
- **Ação:** em "URIs de redirecionamento autorizados", cadastrar **exatamente**
  `https://chdszjpbtfpstjrqnmmm.supabase.co/functions/v1/nucleo-ged-conectar`, sem barra final, sem parâmetros e em https.
  Não cadastrar nenhum outro URI.
- **Resultado esperado:** um único URI, idêntico ao que vai no segredo `GED_DRIVE_REDIRECT_URI`.
- **Prosseguir se:** o URI for idêntico caractere a caractere. **Interromper se:** houver diferença. O Google recusa a volta com
  `redirect_uri_mismatch`, e a função também confere o valor.

### 6. Disponibilidade e nomes exatos dos segredos
- **Responsável:** Alan.
- **Pré-requisitos:** etapas 4 e 5.
- **Ação:** ter em mãos, fora do chat, os quatro valores:
  - `GED_DRIVE_CLIENT_ID` e `GED_DRIVE_CLIENT_SECRET`: vêm da etapa 4.
  - `GED_DRIVE_REDIRECT_URI`: o valor da etapa 5.
  - `NEO_ADMIN_URL` (decisão **D-URL**): a origem pública do app, sem caminho e sem barra final. O candidato documentado é
    `https://neo-admin-474748357673.southamerica-east1.run.app` (`docs/LOGIN_GOOGLE.md`). **Confirmar** que é a URL usada hoje.
    A volta do Google só redireciona para essa origem.
- **Resultado esperado:** os quatro valores, com os nomes **exatamente** como acima: maiúsculas, `_` e sem prefixo.
- **Prosseguir se:** os quatro estiverem definidos. **Interromper se:** faltar algum. A função não tem valor padrão e, sem os
  quatro, responde 500 genérico.

### 7. Revisão final da migration 0801 e das instruções
- **Responsável:** Alan (o Claude pode reler junto, sem aplicar).
- **Pré-requisitos:** etapas 1 a 3. Se a aprovação mudou algo, a 0801 deve refletir a mudança.
- **Ação:**
  1. Conferir que o arquivo é o mesmo testado: rodar localmente `npx vitest run tests/db/ged-conexao.test.ts tests/db/ged-laboratorio.test.ts`.
  2. Rodar as consultas **só de leitura** em produção:
     ```
     npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no "select version from supabase_migrations.schema_migrations where version in ('0800','0801')"
     npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no "select to_regclass('public.ged_conexao') as conexao, to_regclass('public.ged_conexao_estados') as estados, (select count(*) from pg_extension where extname = 'supabase_vault') as vault, (select count(*) from modulos where codigo = 'administrativo.ged') as modulo, (select count(*) from configuracoes where chave like 'administrativo.ged.%') as parametros"
     ```
- **Resultado esperado:** `0801` ausente; `conexao` e `estados` nulos; `vault` = 1; `modulo` = 0; `parametros` = 0.
  A `0800` pode estar ausente: a memória do projeto registra que ela não foi aplicada, e a 0801 não depende dela.
- **Prosseguir se:** tudo estiver como esperado. **Interromper se:** a `0801` já estiver registrada, se as tabelas existirem ou se
  não houver Vault. Nesses casos, o ambiente não é o esperado e é preciso investigar antes.

### 8. Aplicação em produção e registro em `schema_migrations`
- **Responsável:** Alan, que faz as publicações em produção.
- **Pré-requisitos:** etapas 1 a 3 registradas e etapa 7 sem pendência.
- **Ação:** seguir o roteiro de `docs/PUBLICACAO.md`, seção 2, **logo em seguida e nesta ordem**:
  ```
  npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no -f supabase/migrations/0801_ged_conexao.sql
  npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no "insert into supabase_migrations.schema_migrations (version, name) values ('0801','ged_conexao') on conflict do nothing"
  ```
  Conferência, só de leitura:
  ```
  npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no "select has_function_privilege('anon','public.ged_iniciar_conexao(text)','execute') as anon_inicia, has_function_privilege('authenticated','public.ged_iniciar_conexao(text)','execute') as auth_inicia, has_function_privilege('authenticated','public.ged_refresh_token()','execute') as auth_token, has_function_privilege('service_role','public.ged_conta_configurada()','execute') as servico_conta, has_table_privilege('authenticated','public.ged_conexao','select') as auth_le_tabela"
  ```
- **Resultado esperado:** o primeiro comando roda sem erro e a 0801 fica registrada. A conferência dá
  `anon_inicia = false`, `auth_inicia = true`, `auth_token = false`, `servico_conta = false` e `auth_le_tabela = false`.
- **Prosseguir se:** for exatamente isso. **Interromper se:** houver erro no primeiro comando. Nesse caso, **não** rode o
  `insert` e vá para a etapa 12, item "a 0801 falhou". Se a conferência der diferente, também vá para a etapa 12.

### 9. Segredos, Edge Function e publicação do aplicativo
- **Responsável:** Alan.
- **Pré-requisitos:** etapa 8 concluída e etapa 6 com os quatro valores.
- **Ação:**
  1. Gravar os segredos com entrada oculta, um por vez, sem colar valores em chat:
     ```
     node scripts/gravar-segredo.mjs GED_DRIVE_CLIENT_ID --ref chdszjpbtfpstjrqnmmm
     node scripts/gravar-segredo.mjs GED_DRIVE_CLIENT_SECRET --ref chdszjpbtfpstjrqnmmm
     node scripts/gravar-segredo.mjs GED_DRIVE_REDIRECT_URI --ref chdszjpbtfpstjrqnmmm
     node scripts/gravar-segredo.mjs NEO_ADMIN_URL --ref chdszjpbtfpstjrqnmmm
     ```
     Conferir apenas os **nomes**: `npx supabase secrets list --project-ref chdszjpbtfpstjrqnmmm`.
  2. Publicar a função:
     `npx supabase functions deploy nucleo-ged-conectar --project-ref chdszjpbtfpstjrqnmmm`.
     O `verify_jwt = false` vem do `supabase/config.toml`; conferir no painel que a função ficou **sem** a exigência de JWT.
  3. Publicar o aplicativo com a tela (Configurações > Google Drive). Isso exige o commit e o push autorizados deste trabalho e a
     publicação na hospedagem (`docs/PUBLICACAO.md`, seção 4). Sem esta etapa, a aba não existe em produção, e a etapa 10 só pode
     ser feita pelo caminho manual.
- **Resultado esperado:** os quatro nomes aparecem na lista; a função fica publicada; a aba "Google Drive (GED)" aparece só para
  o admin geral e mostra "Desconectado", com o aviso de conta não configurada.
- **Prosseguir se:** for isso. **Interromper se:** a tela disser "ainda não está disponível neste ambiente". Isso indica que o app
  aponta para outro banco ou que a 0801 não foi aplicada.

### 10. Configuração da conta (`administrativo.ged.conta`)
- **Responsável:** Alan, como admin geral.
- **Pré-requisitos:** etapas 8 e 9; conta da etapa 4 definida.
- **Ação (caminho padrão):** na tela Configurações > Google Drive (GED), preencher **Conta dedicada do GED** e clicar
  **Salvar conta**.
  - Só o admin geral grava. A ação confere o admin e a RLS `configuracoes_admin` exige de novo.
  - A tela só aceita `@neoformas.com.br` e grava em minúsculas.
  - Com conexão ativa, a tela recusa a troca (D-TROCA).
  - O gatilho do núcleo registra o antes, o depois e o usuário na `auditoria`.
- **Caminho manual** (só se a etapa 9.3 ainda não tiver sido feita):
  `update configuracoes set valor = to_jsonb('<conta>'::text) where chave = 'administrativo.ged.conta';`, com a conta real, em
  minúsculas. Nesse caso, a auditoria registra a mudança **sem usuário**; anote quem fez e quando.
- **Resultado esperado:** a tela mostra a conta e o botão "Conectar Google Drive" habilitado.
- **Prosseguir se:** a conta exibida for exatamente a da etapa 4.

### 11. Primeira conexão e testes reais
- **Responsável:** Alan, com o Claude acompanhando se quiser (sem ver tokens).
- **Pré-requisitos:** etapas 1 a 10.
- **Ação e resultado esperado de cada teste:**
  1. **Conectar com a conta dedicada:** aceitar só o acesso pedido. Esperado: volta para a tela com "Google Drive conectado.", a
     situação "Conectado", "Somente leitura do Drive" e a data em horário de Cuiabá.
  2. **Conta errada:** com outra conta do domínio, desconectar e conectar de novo. Esperado: "não é a conta configurada" e nada
     conectado com ela. Reconectar com a correta.
  3. **Recusa:** clicar "Cancelar" no Google. Esperado: "A autorização foi recusada".
  4. **Reuso da volta:** recarregar a URL de retorno do Google, com o mesmo `state`. Esperado: erro, sem nova conexão.
  5. **Usuário comum:** um usuário sem admin geral não vê a aba e, pela URL direta, volta ao Início.
  6. **Nada sensível**, por consulta só de leitura:
     `select acao, depois from auditoria where tabela in ('ged_conexao','ged_conexao_estados') order by em desc limit 5`.
     A coluna `depois` **não** pode ter `segredo_id`, `google_sub`, token, `state` nem `code_verifier`. Nos logs da Edge Function,
     no painel, não pode haver token nem código.
  7. **Desconectar**, com a confirmação. Esperado: mensagem com o resultado da revogação. Se D-REV = sim, o app some de
     myaccount.google.com > Segurança > Apps de terceiros da conta dedicada. Esperado também: situação "Desconectado" e registro
     preservado.
  8. **Reconectar** e deixar conectado.
- **Prosseguir se:** os 8 passarem. A fase A0 está concluída quando isso for registrado no documento de implementação.
- **Interromper se:** qualquer teste falhar. Desconecte e siga a etapa 12. Não "consertar em produção".

### 12. Interrupção e recuperação
| Onde parou | O que fazer |
|---|---|
| Etapas 1 a 7 | Nada foi alterado. Registrar o motivo e parar. |
| **A 0801 falhou** (etapa 8) | **Não** registrar em `schema_migrations`. Rodar a consulta da etapa 7.2 para ver o que ficou criado. O arquivo não tem `begin`/`commit` explícitos, então não presuma que nada ficou. Se algo ficou, **não** reaplicar por cima, porque o `create table` falharia. Trazer a saída para análise e montar uma correção específica, sem apagar dado. |
| Conferência da etapa 8 diferente | Manter a função **sem publicar** (etapa 9) e a conta **sem configurar**: sem conta, `ged_iniciar_conexao` recusa e nada conecta. Analisar a permissão divergente e corrigi-la com uma migration nova, aprovada. |
| Segredo errado ou faltando (etapa 9) | Gravar de novo o segredo com o mesmo script e testar de novo. Se a mudança não aparecer, publicar a função outra vez. |
| Função com erro (etapa 9) | Deixar a conta sem configurar. Corrigir e publicar de novo. Nada fica conectado nesse meio-tempo. |
| Teste real falhou (etapa 11) | 1) "Desconectar" na tela, que apaga o segredo do Vault e marca desconectada. 2) Revogar manualmente em myaccount.google.com, se D-REV = não ou se a revogação falhou. 3) Esvaziar a conta: `update configuracoes set valor = 'null' where chave = 'administrativo.ged.conta';`. Isso bloqueia novas conexões. 4) Se for preciso parar de vez, remover os segredos `GED_DRIVE_CLIENT_ID` e `GED_DRIVE_CLIENT_SECRET` (`npx supabase secrets unset ... --project-ref chdszjpbtfpstjrqnmmm`). |
| Suspeita de vazamento do segredo do cliente | Gerar um novo segredo no Google Cloud e invalidar o antigo; gravar com o script; desconectar e reconectar. |

As tabelas `ged_conexao` e `ged_conexao_estados` e a auditoria **não são apagadas** (CLAUDE.md, regra 4). Depois de desconectar,
não guardam dado sensível. Removê-las exige uma migration nova e aprovada.

## Ainda fora da A0 (não ativar junto)
- Indexação, verificação da raiz e qualquer chamada à Drive API (A0-verificação, GED-P13).
- D-INVALID e a melhoria do cookie ligado ao navegador.
- O endurecimento da conexão Gmail, que é uma tarefa separada. Nada aqui altera o `nucleo-gmail-conectar`.
