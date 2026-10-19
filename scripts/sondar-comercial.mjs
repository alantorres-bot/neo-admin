#!/usr/bin/env node
// Roda a sondagem da API Comercial do Consistem (Edge Function com-pedidos-sincronizar, Fase 0 do módulo Comercial / Pedidos).
// SÓ LÊ: a função não grava nada e devolve apenas contagens, formatos e nomes de campos.
//
//   node scripts/sondar-comercial.mjs [dias] [codigo-da-lista-de-transporte]
//   node scripts/sondar-comercial.mjs aaaa-mm      extrato de comissões + títulos pagos do mês (COM valores), para
//                                                comparar com as planilhas; grava extrato-comissoes-aaaa-mm.json
//
// Lê NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do .env.local (a chave não aparece na tela) e grava a resposta
// em sondagem-comercial.json (fora do git: só números, mas não precisa ir para o repositório).
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, "")]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY; // ou do ambiente (ex.: tirada da CLI)
if (!url || !chave) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local.");
  process.exit(2);
}

const mes = /^\d{4}-\d{2}$/.test(process.argv[2] ?? "") ? process.argv[2] : null;
const corpo = mes ? { acao: "extrato_comissoes", mes } : { acao: "amostra", dias: Number(process.argv[2]) || 90 };
if (!mes && process.argv[3]) corpo.lista_transporte = process.argv[3];
const arquivo = mes ? `extrato-comissoes-${mes}.json` : "sondagem-comercial.json";

console.log(mes ? `Lendo o extrato de comissões de ${mes}… pode levar alguns minutos.` : `Sondando a API Comercial (últimos ${corpo.dias} dias)… pode levar alguns minutos.`);
const resp = await fetch(`${url.replace(/\/+$/, "")}/functions/v1/com-pedidos-sincronizar`, {
  method: "POST",
  headers: { Authorization: `Bearer ${chave}`, apikey: chave, "Content-Type": "application/json" },
  body: JSON.stringify(corpo),
});
const texto = await resp.text();
fs.writeFileSync(arquivo, texto);
console.log(`HTTP ${resp.status}. Resposta gravada em ${arquivo}`);
if (!resp.ok) console.log(texto.slice(0, 500));
