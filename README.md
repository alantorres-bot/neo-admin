# Neo Admin

Plataforma interna do Administrativo do grupo Neo Formas. Leia primeiro o `CLAUDE.md` e `docs/VISAO_GERAL.md`.

```
npm install
cp .env.example .env.local     # preencher as chaves do Supabase (nunca commitar)
npm run dev                    # http://localhost:3000
npm run verificar              # tipos + lint + testes
npx playwright test            # fumaça e2e
```

Status e instruções de implantação: `docs/FASE_0_NUCLEO.md`.

## Módulos com documentação própria
- **Fiscal > Créditos tributários (Fiscal Control):** `docs/fiscal-control/README.md` (instalação, migrations 0200–0203, dados de
  demonstração fictícios, testes, permissões, backup e limitações), `docs/fiscal-control/STATUS.md` e `docs/fiscal-control/ARCHITECTURE.md`.
