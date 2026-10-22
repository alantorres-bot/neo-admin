#!/usr/bin/env bash
# SOMENTE NO SUPABASE LOCAL (iniciar.sh): usuários e pendências FICTÍCIOS para ver e testar a Central de Gestão.
# Uso (como root ou com sudo, depois do iniciar.sh): bash scripts/local-sem-docker/central-demo.sh
# Usuários (senha CENTRAL_E2E_SENHA, padrão Teste-local-123): gestor.teste (gestor em todas as áreas),
# operador.financeiro.teste e operador.fiscal.teste @neoformas.com.br. Pendências com o prefixo [DEMO]. Pode rodar de novo.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
set -a; . "$RAIZ/.local-supabase/chaves.env"; set +a
SENHA="${CENTRAL_E2E_SENHA:-Teste-local-123}"
criar() {
  curl -s -o /dev/null -X POST http://127.0.0.1:54321/auth/v1/admin/users -H "Authorization: Bearer $SERVICE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$SENHA\",\"email_confirm\":true,\"user_metadata\":{\"nome\":\"$2\"}}" || true
}
# Um admin antes de tudo: o primeiro usuário do banco vira admin_geral (migration 0003).
criar admin.teste@neoformas.com.br "Admin Teste"
criar gestor.teste@neoformas.com.br "Gestor Geral Teste"
criar operador.financeiro.teste@neoformas.com.br "Operador Financeiro Teste"
criar operador.fiscal.teste@neoformas.com.br "Operador Fiscal Teste"
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d neo" < "$RAIZ/e2e/central-gestao.semente.sql"
echo "Central de Gestão: dados fictícios carregados. Entre com gestor.teste@neoformas.com.br e abra /gestao."
