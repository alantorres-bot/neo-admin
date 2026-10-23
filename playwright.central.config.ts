import { defineConfig, devices } from "@playwright/test";

// Central de Gestão contra o Supabase LOCAL com a carga fictícia (scripts/local-sem-docker/central-demo.sh). Não sobe
// servidor: CENTRAL_E2E_URL aponta para a aplicação em execução (npm run dev com o .env.local do Supabase local).
export default defineConfig({
  testDir: "./e2e",
  testMatch: /central-gestao\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: { baseURL: process.env.CENTRAL_E2E_URL ?? "http://127.0.0.1:3000", locale: "pt-BR", timezoneId: "America/Cuiaba", screenshot: "only-on-failure" },
  // PLAYWRIGHT_CHROMIUM: navegador já instalado (ex.: /opt/pw-browsers/chromium) quando a versão do pacote não tem o seu.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {} } }],
});
