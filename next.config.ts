import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Só desenvolvimento: permite abrir o servidor local por 127.0.0.1 (testes Playwright).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
