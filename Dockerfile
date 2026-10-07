# Imagem do Neo Admin (Next.js 16) para o Google Cloud Run, região de São Paulo (southamerica-east1).
# As duas variáveis NEXT_PUBLIC_* são públicas e entram no build (o navegador precisa delas); a chave de serviço do Supabase NUNCA
# vai para cá (regra do CLAUDE.md): ela fica só nas Edge Functions.
#
#   docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... -t neo-admin .
FROM node:24-slim AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS construcao
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEO_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim AS execucao
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
COPY --from=construcao /app/.next/standalone ./
COPY --from=construcao /app/.next/static ./.next/static
COPY --from=construcao /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
