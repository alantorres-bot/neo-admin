# Supabase local sem Docker (somente desenvolvimento/teste)

O caminho oficial é `npx supabase start` (Docker). Onde não há Docker, `iniciar.sh` monta um equivalente suficiente para rodar o
Neo Admin e os testes de interface do Fiscal Control:

| Peça | Origem | Porta |
| --- | --- | --- |
| Postgres 16 | instalado na máquina (`pg_ctlcluster 16 main`) | 5432 (banco `neo`) |
| PostgREST 12.2.3 | binário oficial (GitHub) | 3001 |
| Supabase Auth (GoTrue) v2.164.0 | binário oficial (GitHub) | 9999 |
| `proxy.mjs` | este repositório: rotas `/rest/v1`, `/auth/v1` e um **Storage mínimo** | 54321 |

O Storage mínimo grava a linha em `storage.objects` pelo PostgREST **com o token do usuário** (as políticas RLS do bucket valem)
e guarda o arquivo em `.local-supabase/arquivos`; a URL assinada é um HMAC com validade. Não há Edge Functions, e-mail nem Realtime.

```
sudo bash scripts/local-sem-docker/iniciar.sh     # 1ª vez: cria o banco, aplica as migrations e mostra as chaves para o .env.local
sudo -u postgres node scripts/fiscal-demo.mjs --banco postgresql:///neo --confirmar   # dados fictícios
```
Chaves e segredo são fixos e públicos (`chaves.mjs`): **nunca** use este ambiente para dados reais nem exponha as portas.
