import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "lib/**/*.test.ts"],
    // Os testes de banco sobem um Postgres em memória (PGlite) por arquivo; com a máquina carregada (publicar.mjs roda a suíte
    // inteira em paralelo) 60 s/120 s estouravam sem erro de código (27/11/2026, 2 de 3 tentativas de publicar bc0607e).
    testTimeout: 180_000,
    hookTimeout: 300_000,
  },
});
