# Publicação e migração para São Paulo (Neo Admin)

Estado em 07/10/2026. Objetivo: banco e aplicativo em São Paulo, sem custo mensal, acessíveis de qualquer máquina e do celular.

## 1. Projetos Supabase
| | Ref | Região | Situação |
|---|---|---|---|
| Antigo (reserva) | `uhujocnxvupsroijgtss` | Canadá (Central) | congelado em 07/10/2026 (virada feita); manter ~2 semanas e depois pausar |
| **Novo** (`neo-admin-sp`) | `chdszjpbtfpstjrqnmmm` | **São Paulo (sa-east-1)** | pronto e com os dados copiados; agendamento horário **desligado** até a virada |

No projeto novo já estão: 23 migrations (registradas em `supabase_migrations.schema_migrations`), as 3 Edge Functions, o segredo `SINCRONIZACAO_SEGREDO` (e no Vault `rec_sincronizar_url` / `rec_sincronizar_segredo`), cadastro público desligado e senha mínima de 8. Faltam os segredos que só o usuário tem (seção 3).

A senha do banco novo e o segredo de sincronização foram gerados no computador e ficam em `C:\Users\alant\.neo-admin\` (fora do Git). **Guarde uma cópia no gerenciador de senhas.**

## 2. Scripts (sem Docker, sem `pg_dump`)
- `node scripts/banco-copia.mjs exportar --ref <ref>`: grava um `.json` por tabela (e os usuários do login) em `backups/<ref>-<data>/` (pasta fora do Git). Leva ~2,5 min.
- `node scripts/banco-copia.mjs conferir --ref <ref> --pasta <pasta>`: compara a contagem de cada tabela com a cópia.
- `node scripts/banco-copia.mjs importar --ref <destino> --pasta <pasta> --mesclar`: só insere/atualiza (nada é apagado). `--sim` apaga as tabelas do destino antes (recuperação de desastre; use por sua conta).
- Anexos (bucket `anexos`): `npx supabase storage cp -r "ss:///anexos/financeiro.recebiveis" backups/anexos --linked --project-ref <ref> --experimental` e o caminho inverso para subir.
- `node scripts/gravar-segredo.mjs NOME --ref <ref>` e `node scripts/gmail-autorizar.mjs --ref <ref>`: gravam segredos com entrada oculta.
- **Aplicar uma migration nova em produção** (o CLI local está ligado ao projeto antigo; o `--project-ref` é obrigatório):
  ```
  npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no -f supabase/migrations/NNNN_nome.sql
  npx supabase db query --linked --project-ref chdszjpbtfpstjrqnmmm --agent no "insert into supabase_migrations.schema_migrations (version, name) values ('NNNN','nome') on conflict do nothing"
  ```
  O `db query` não registra a migration; sem o segundo comando o registro fica defasado (aconteceu com 0118–0120, regularizado em 09/10/2026).

## 3. O que só o usuário pode fazer (uma vez)
1. Token do Consistem no projeto novo: `node scripts/gravar-segredo.mjs CONSISTEM_API_KEY --ref chdszjpbtfpstjrqnmmm` (cole o token quando pedir; ele não aparece na tela).
2. Autorizar o Gmail: `node scripts/gmail-autorizar.mjs --ref chdszjpbtfpstjrqnmmm` (pede o ID e o segredo do cliente OAuth "Neo Admin Gmail" e abre o login do Google).
3. Criar a conta da hospedagem escolhida (seção 4).
4. Login com Google: criar o cliente OAuth "Neo Formas Login" no Google Cloud e ligar o provedor Google no Supabase
   (Authentication > Providers), com Site URL e Redirect URLs do Cloud Run. Passo a passo em `docs/LOGIN_GOOGLE.md`, seção 4.

## 4. Hospedagem do aplicativo
O servidor Next gasta ~160 ms de CPU por requisição, então o plano gratuito da Cloudflare Workers (10 ms) **não serve**. Opções sem custo:
- **Google Cloud Run, São Paulo** (cota gratuita; uso comercial permitido; exige cartão na conta Google). Há `Dockerfile` pronto. Roteiro: criar/escolher um projeto com cobrança ativa; definir **alerta de orçamento** (ex.: R$ 10) e `--max-instances=2`; publicar com
  `gcloud run deploy neo-admin --source . --region southamerica-east1 --allow-unauthenticated --min-instances=0 --max-instances=2 --memory=512Mi --set-build-env-vars NEXT_PUBLIC_SUPABASE_URL=https://chdszjpbtfpstjrqnmmm.supabase.co,NEXT_PUBLIC_SUPABASE_ANON_KEY=<chave pública do projeto novo>`.
  Para evitar a "partida a frio" depois de inatividade, um ping gratuito a cada 5 min em `/login` (ex.: cron-job.org) mantém a instância ligada dentro da cota.
- **Vercel Hobby** (grátis, sem cartão; `vercel.json` já fixa `gru1` = São Paulo): basta importar o repositório do GitHub e definir as duas variáveis `NEXT_PUBLIC_*`. **Atenção:** os termos do plano Hobby são para uso pessoal/não comercial.
A chave pública (anon/publishable) do projeto novo é obtida com `npx supabase projects api-keys --project-ref chdszjpbtfpstjrqnmmm`. **Nunca** coloque a chave de serviço (`service_role`) na hospedagem.

## 4.1 Publicar sempre a partir de um commit identificado (D-08, desde 28/10/2026)
O `gcloud run deploy --source .` publica a **pasta onde for rodado**: branch não mesclado, alteração sem commit e arquivo não
rastreado de outra sessão iam junto (o `.gcloudignore` não existe; vale só o `.gitignore`), e não havia como saber que código
estava no ar. A partir de agora, **não rode o deploy à mão**; use:
```
node scripts/publicar.mjs plano    --commit <sha> [--funcoes nome1,nome2] [--sem-app]   # confere e mostra os comandos
node scripts/publicar.mjs executar --commit <sha> [--funcoes nome1,nome2] [--sem-app]   # publica
node scripts/publicar.mjs consultar                                                     # revisões no ar e o commit de cada uma
```
O que o script garante, nesta ordem (qualquer falha interrompe os passos seguintes; a cópia é removida no fim):
1. `origin/main` do clone é **igual ao main do GitHub agora** (`git ls-remote`, só leitura). O script **não faz `git fetch`**:
   se diferir, rode `git fetch origin` você mesmo e repita. Sem acesso ao GitHub, não publica.
2. O commit **já está em `origin/main`** (enviado e mesclado). Commit só local ou de branch não mesclado é recusado.
   Um commit antigo da main é aceito (é assim que se volta para uma versão anterior).
3. Cópia limpa do commit (`git worktree`, pasta temporária), conferida: HEAD = commit, nenhum arquivo rastreado alterado e
   **nenhum `node_modules`** (pasta, junção ou link: o `npm ci` apagaria o destino de uma junção para outro clone).
4. `npm ci` e `npm run verificar` na cópia; depois, de novo: HEAD = commit e nada rastreado alterado.
5. Destino do Cloud Run conferido (`gcloud run services describe` com `--project=neo-admin-neoformas` fixo tem de devolver a URL
   do neo-admin) antes de qualquer publicação.
6. Publica da cópia: Edge Functions com `--project-ref chdszjpbtfpstjrqnmmm`; app com `--project` fixo, revisão
   `neo-admin-c<sha12>-<AAAAMMDDhhmm UTC>` e etiqueta `commit=<sha12>`. `consultar` lista as revisões com o commit.

Migrations continuam pela seção 2. Depois de publicar, anote aqui (data, commit, revisão).

**Falha no meio (não há rollback automático).** Se as Edge Functions foram publicadas e o deploy do app falhou, o script para
com "JÁ PUBLICADO antes da falha: …": as funções estão no commit novo e o app continua na revisão anterior. Conferir:
`node scripts/publicar.mjs consultar` (app) e `npx supabase functions list --project-ref chdszjpbtfpstjrqnmmm` (versão e data
de cada função). Recuperar: corrigir a causa e rodar `executar` de novo com o mesmo commit (as funções são republicadas iguais) ou, para voltar as funções, `executar --commit <anterior> --funcoes …
--sem-app`. Reversão do app: `gcloud run services update-traffic neo-admin --project=neo-admin-neoformas
--region=southamerica-east1 --to-revisions <revisão anterior>=100`, ou `executar` com o commit anterior.

| Data | Commit | Revisão Cloud Run | Funções | Quem |
|---|---|---|---|---|

## 5. Virada (quando tudo acima estiver pronto)
1. Combinar um horário sem uso. Avisar que as alterações feitas no sistema antigo depois do passo 2 não serão copiadas.
2. `exportar` do projeto antigo (`uhujocnxvupsroijgtss`) e `importar --mesclar` no novo; `conferir`; repetir a cópia dos anexos.
3. Religar o agendamento no projeto novo: `select cron.alter_job(jobid, active := true) from cron.job where jobname = 'rec-sincronizar-consistem-horario';` e rodar "Sincronizar agora": deve dar **0 novos**.
4. Publicar o aplicativo apontando para o projeto novo (seção 4) e testar login, uma baixa simulada em título de teste, upload de anexo, rascunho do Gmail e sincronização.
5. Avisar o pessoal do endereço novo. Desligar o agendamento do projeto antigo e **mantê-lo por ~2 semanas como reserva**; só depois pausar.
Volta atrás: apontar o aplicativo de novo para o projeto antigo e religar o agendamento dele.

## 6. Cópia de segurança
O plano gratuito do Supabase **não faz backup diário**. Rode `exportar` todo dia (tarefa agendada do Windows, se a máquina ficar ligada) e guarde `backups/` num lugar privado, fora do Git (contém dados financeiros e hashes de senha). Teste a restauração em um projeto de teste antes de depender dela.

**Agendamento diário (precisa de autorização do usuário):** o Claude tentou criar a tarefa do Windows e foi bloqueado pela proteção contra "persistência não autorizada"; por isso o comando fica aqui. Se quiser, rode no PowerShell (como você mesmo, uma vez):
```powershell
$acao = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c cd /d C:\dev\neo-admin && node scripts\banco-copia.mjs exportar --ref chdszjpbtfpstjrqnmmm >> backups\backup.log 2>&1'
Register-ScheduledTask -TaskName "NeoAdmin-Backup-Diario" -Action $acao -Trigger (New-ScheduledTaskTrigger -Daily -At 7:30PM) -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)) -Force
```
A máquina precisa estar ligada e com a CLI do Supabase logada nesse horário. Alternativa sem agendar: rodar `node scripts/banco-copia.mjs exportar --ref chdszjpbtfpstjrqnmmm` à mão de vez em quando.

## 7. Segurança para a internet
Já feito: cabeçalhos de segurança em `next.config.ts` (HSTS, nosniff, quadros só do próprio site, CSP enxuta), cadastro público desligado, RLS em todas as tabelas, bucket privado com URL assinada, chave de serviço só nas Edge Functions. Em aberto (opcionais): MFA, "esqueci a senha" (exige SMTP próprio), limite de tentativas de login no firewall da hospedagem.
