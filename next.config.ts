import type { NextConfig } from "next";

// Cabeçalhos de segurança para o app na internet. HSTS só vale sob HTTPS (o navegador ignora em http://localhost). Quadros só do
// próprio site (`SAMEORIGIN`/`frame-ancestors 'self'`): nenhum outro site pode embutir o Neo Admin. A CSP é propositalmente enxuta
// (sem `script-src`), porque o Next injeta scripts em linha; ela já fecha os usos de maior risco (embutir, <base>, <object>, formulários
// para fora do site).
const CABECALHOS_DE_SEGURANCA = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  // Só desenvolvimento: permite abrir o servidor local por 127.0.0.1 (testes Playwright).
  allowedDevOrigins: ["127.0.0.1"],
  // Pasta de saída do build (padrão `.next`): permite compilar sem mexer no servidor que está rodando.
  distDir: process.env.NEO_DIST_DIR ?? ".next",
  // Imagem de contêiner (Dockerfile): servidor autônomo em `.next/standalone`. Fora do contêiner o `next start` segue normal.
  output: process.env.NEO_STANDALONE === "1" ? "standalone" : undefined,
  async headers() {
    return [{ source: "/:path*", headers: CABECALHOS_DE_SEGURANCA }];
  },
};

export default nextConfig;
