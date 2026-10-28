#!/usr/bin/env node
// GED — confere, sem revelar nada, se o segredo que o agendamento manda (Vault: rec_sincronizar_segredo, usado por
// ged_chamar_indexacao) é o mesmo que a Edge Function nucleo-ged-indexar espera (SINCRONIZACAO_SEGREDO).
//
//   node scripts/ged-conferir-segredo.mjs --ref chdszjpbtfpstjrqnmmm
//
// Compara só os resumos SHA-256: o do Vault é calculado no banco (pgcrypto) e o do Supabase vem de `supabase secrets list`, que
// já devolve o resumo, nunca o valor. Nenhum resumo nem valor é impresso: a saída é só IGUAL, DIFERENTE ou NAO_COMPROVADO.
// Saída: 0 = IGUAL; 1 = DIFERENTE; 2 = NAO_COMPROVADO (qualquer falha ou formato inesperado). Não chama a função e não indexa nada.
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SHA256 = /^[0-9a-f]{64}$/;

/** Veredito a partir das duas saídas JSON (lista de segredos da CLI e linha do banco). Puro, para teste. */
export function compararResumos(segredosJson, vaultJson) {
  try {
    const lista = JSON.parse(segredosJson);
    const segredos = Array.isArray(lista) ? lista : lista?.secrets;
    const doSupabase = Array.isArray(segredos) ? segredos.find((s) => s?.name === "SINCRONIZACAO_SEGREDO")?.value : undefined;
    const linhas = JSON.parse(vaultJson);
    const doVault = Array.isArray(linhas) && linhas.length === 1 ? linhas[0]?.resumo : undefined;
    if (typeof doSupabase !== "string" || typeof doVault !== "string") return "NAO_COMPROVADO";
    if (!SHA256.test(doSupabase) || !SHA256.test(doVault)) return "NAO_COMPROVADO";
    return doSupabase === doVault ? "IGUAL" : "DIFERENTE";
  } catch {
    return "NAO_COMPROVADO";
  }
}

const SQL_VAULT =
  "select encode(extensions.digest(decrypted_secret, 'sha256'), 'hex') as resumo from vault.decrypted_secrets where name = 'rec_sincronizar_segredo'";

/**
 * Busca as duas saídas por `rodar(args) -> texto` e devolve só o veredito. Qualquer falha (CLI ausente, erro, tempo esgotado, saída
 * estranha) vira NAO_COMPROVADO. Nada do que a CLI devolve é repassado.
 */
export function conferir(rodar, ref) {
  try {
    const segredos = rodar(["secrets", "list", "--project-ref", ref, "-o", "json"]);
    const vault = rodar(["db", "query", "--linked", "--project-ref", ref, "--agent", "no", "-o", "json", SQL_VAULT]);
    return compararResumos(segredos, vault);
  } catch {
    return "NAO_COMPROVADO";
  }
}

function main() {
  const i = process.argv.indexOf("--ref");
  const ref = i >= 0 ? process.argv[i + 1] : "";
  if (!/^[a-z0-9]{20}$/.test(ref ?? "")) {
    console.error("Uso: node scripts/ged-conferir-segredo.mjs --ref <ref do projeto>");
    process.exit(2);
  }
  // A CLI do projeto chamada direto pelo Node, sem shell (no Windows, o shell quebraria a SQL nos espaços); 60 s por comando.
  const cli = fileURLToPath(new URL("../node_modules/supabase/dist/supabase.js", import.meta.url));
  const rodar = (args) => execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 });
  const veredito = conferir(rodar, ref);
  console.log(`segredo do agendamento x SINCRONIZACAO_SEGREDO: ${veredito}`);
  process.exit(veredito === "IGUAL" ? 0 : veredito === "DIFERENTE" ? 1 : 2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
