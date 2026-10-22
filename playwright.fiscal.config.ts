import { defineConfig, devices } from "@playwright/test";

// Fluxos do Fiscal Control contra um ambiente COM banco (Supabase local ou projeto de TESTE já com as migrations, a carga
// de demonstração e os usuários de teste — ver docs/fiscal-control/README.md, seção "Testes de interface"). Não sobe servidor:
// FISCAL_E2E_URL aponta para a aplicação em execução.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /fiscal-creditos\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 90_000,
  use: { baseURL: process.env.FISCAL_E2E_URL ?? "http://127.0.0.1:3000", locale: "pt-BR", timezoneId: "America/Cuiaba", screenshot: "only-on-failure" },
  // PLAYWRIGHT_CHROMIUM: navegador já instalado (ex.: /opt/pw-browsers/chromium/chrome) quando a versão do pacote não tem o seu.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {} } }],
});
