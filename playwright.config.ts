import { defineConfig, devices } from "@playwright/test";

// Fumaça sem Supabase real: o servidor sobe com variáveis falsas e os testes só exercitam o que
// não depende do banco (proteção de rotas e tela de login). Fluxos logados entram quando houver
// projeto Supabase de teste (ver docs/FASE_0_NUCLEO.md).
const PORTA = 3112;

export default defineConfig({
  testDir: "./e2e",
  // Os fluxos com banco têm configuração própria (playwright.fiscal.config.ts e playwright.central.config.ts); a tela do GED
  // usa um Supabase simulado (playwright.ged.config.ts).
  testIgnore: [/fiscal-creditos\.spec\.ts/, /central-gestao\.spec\.ts/, /ged-conexao\.spec\.ts/],
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${PORTA}`, locale: "pt-BR", timezoneId: "America/Cuiaba" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORTA}`,
    url: `http://127.0.0.1:${PORTA}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "chave-falsa-para-teste",
    },
  },
});
