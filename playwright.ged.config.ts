import { defineConfig, devices } from "@playwright/test";

// Tela do GED (Configurações > Google Drive) contra um Supabase SIMULADO (e2e/supabase-simulado.mjs): o app roda de verdade
// (proxy, sessão, exigirAdminGeral, ações de servidor), mas auth, banco e a Edge Function são respostas de teste. Nada vai à
// produção nem ao Google. Rodar: npx playwright test -c playwright.ged.config.ts
const APP = 3113;
const SUPABASE = 54399;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /ged-conexao\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: { baseURL: `http://127.0.0.1:${APP}`, locale: "pt-BR", timezoneId: "America/Cuiaba", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `node e2e/supabase-simulado.mjs ${SUPABASE} http://127.0.0.1:${APP}`,
      url: `http://127.0.0.1:${SUPABASE}/__chamadas`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npx next dev -p ${APP}`,
      url: `http://127.0.0.1:${APP}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${SUPABASE}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "chave-falsa-para-teste",
      },
    },
  ],
});
