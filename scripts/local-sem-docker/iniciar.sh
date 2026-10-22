#!/usr/bin/env bash
# SOMENTE DESENVOLVIMENTO/TESTE LOCAL, sem Docker: Postgres 16 já instalado + PostgREST + Supabase Auth (binários oficiais)
# + proxy que imita as rotas do Supabase (inclui um Storage mínimo que respeita as políticas RLS do bucket).
# Caminho oficial (com Docker): `npx supabase start`. Uso: bash scripts/local-sem-docker/iniciar.sh  (como root ou com sudo)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; AQUI="$RAIZ/scripts/local-sem-docker"; DADOS="$RAIZ/.local-supabase"
mkdir -p "$DADOS/bin" "$DADOS/arquivos"
cd "$DADOS"
[ -x bin/postgrest ] || { curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar xJ -C bin; }
[ -x bin/auth/auth ] || { mkdir -p bin/auth && curl -sSL https://github.com/supabase/auth/releases/download/v2.164.0/auth-v2.164.0-x86.tar.gz | tar xz -C bin/auth; }
[ -f chaves.env ] || node "$AQUI/chaves.mjs" > chaves.env
set -a; . ./chaves.env; set +a
pg_ctlcluster 16 main start 2>/dev/null || true
if ! su postgres -c "psql -tAc \"select 1 from pg_database where datname='neo'\"" | grep -q 1; then
  su postgres -c "psql -q -c 'create database neo'"
  su postgres -c "psql -q -d neo" < "$AQUI/preparo.sql"
  NOVO=1
fi
GOTRUE_API_HOST=127.0.0.1 PORT=9999 API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 GOTRUE_DB_DRIVER=postgres \
DATABASE_URL="postgres://supabase_auth_admin:auth@127.0.0.1:5432/neo?search_path=auth&sslmode=disable" GOTRUE_SITE_URL=http://127.0.0.1:3000 \
GOTRUE_JWT_SECRET="$SEGREDO" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_MAILER_AUTOCONFIRM=true \
GOTRUE_DB_MIGRATIONS_PATH="$DADOS/bin/auth/migrations" GOTRUE_LOG_LEVEL=warn nohup bin/auth/auth > auth.log 2>&1 &
sleep 6
if [ "${NOVO:-0}" = 1 ]; then
  for f in "$RAIZ"/supabase/migrations/*.sql; do su postgres -c "psql -q -v ON_ERROR_STOP=1 -d neo" < "$f" > /dev/null; done
  echo "Migrations aplicadas. Dados fictícios: node scripts/fiscal-demo.mjs --banco postgresql:///neo --confirmar (como usuário postgres)"
fi
cat > postgrest.conf <<CONF
db-uri = "postgres://authenticator:auth@127.0.0.1:5432/neo"
db-schemas = "public,storage"
db-anon-role = "anon"
jwt-secret = "$SEGREDO"
server-host = "127.0.0.1"
server-port = 3001
CONF
nohup bin/postgrest postgrest.conf > postgrest.log 2>&1 &
PASTA_ARQUIVOS="$DADOS/arquivos" nohup node "$AQUI/proxy.mjs" > proxy.log 2>&1 &
sleep 2
echo "Supabase local em http://127.0.0.1:54321. Em .env.local:"
echo "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"
echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON"
echo "Criar usuário: curl -X POST http://127.0.0.1:54321/auth/v1/admin/users -H \"Authorization: Bearer \$SERVICE\" -H 'Content-Type: application/json' -d '{\"email\":\"voce@neoformas.com.br\",\"password\":\"...\",\"email_confirm\":true}'  (SERVICE está em .local-supabase/chaves.env)"
