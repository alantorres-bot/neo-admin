import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Edge Functions rodam em Deno, fora do projeto Next
    "supabase/functions/**",
    // Apartment Studio 3D: projeto Vite independente, com configuração própria
    "apartment-studio/**",
  ]),
]);

export default eslintConfig;
