import { defineConfig, devices } from "@playwright/test";

// Homologação visual da Gestão de Parcelamentos contra o Supabase SIMULADO com banco real em memória (e2e/parcelamentos-simulado.mjs:
// PGlite com todas as migrations, RLS valendo). O app roda de verdade (next dev). Nada vai à produção nem ao Consistem.
// Rodar: npx playwright test -c playwright.parcelamentos.config.ts
//   PARC_CARGA=<carga.json>    lançamentos reais gravados por uma leitura só GET (sem isso, a amostra de nov/2026 dos testes)
//   PARC_CAPTURAS=<pasta>      salva as capturas de tela
const APP = 3114;
const SUPABASE = 54398;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /parcelamentos\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 180_000,
  use: { baseURL: `http://127.0.0.1:${APP}`, locale: "pt-BR", timezoneId: "America/Cuiaba", screenshot: "only-on-failure", viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `node e2e/parcelamentos-simulado.mjs ${SUPABASE}${process.env.PARC_CARGA ? ` "${process.env.PARC_CARGA}"` : ""}`,
      url: `http://127.0.0.1:${SUPABASE}/__usuarios`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `npx next dev --webpack -p ${APP}`, // webpack: o Turbopack recusa node_modules em junção (worktree)
      url: `http://127.0.0.1:${APP}/login`,
      reuseExistingServer: true,
      timeout: 240_000,
      env: { NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${SUPABASE}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "chave-falsa-para-teste" },
    },
  ],
});
