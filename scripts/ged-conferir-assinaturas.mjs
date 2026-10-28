#!/usr/bin/env node
// GED — compara o que está INSTALADO no banco de produção com o que as migrations do repositório produzem (scripts/ged-assinaturas.json).
// Só leitura: roda scripts/ged-assinaturas.sql e lista as migrations registradas a partir de 0801. Não grava nada.
//
//   node scripts/ged-conferir-assinaturas.mjs --ref chdszjpbtfpstjrqnmmm
//
// Para cada função, tabela e política do GED: OK, DIVERGENTE (quais campos), AUSENTE (está no repositório e não no banco) ou
// SO_NO_BANCO. Antes de aplicar uma migration, as divergências devem ser exatamente as que ela corrige; depois, tudo OK.
// Saída: 0 = tudo OK; 1 = há diferenças; 2 = não foi possível conferir.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const chaveFuncao = (f) => `${f.nome}(${f.args})`;
const chaveTabela = (t) => t.tabela;
const chavePolitica = (p) => `${p.tabela}.${p.politica}`;

/** Diferenças entre a assinatura esperada (repositório) e a instalada (banco). Pura, para teste. */
export function compararAssinaturas(esperada, instalada) {
  const linhas = [];
  for (const [grupo, chave] of [["funcoes", chaveFuncao], ["tabelas", chaveTabela], ["politicas", chavePolitica]]) {
    const no = new Map((instalada[grupo] ?? []).map((x) => [chave(x), x]));
    const esp = new Map((esperada[grupo] ?? []).map((x) => [chave(x), x]));
    for (const [k, e] of esp) {
      const i = no.get(k);
      if (!i) { linhas.push({ grupo, item: k, situacao: "AUSENTE" }); continue; }
      const campos = Object.keys(e).filter((c) => JSON.stringify(e[c]) !== JSON.stringify(i[c]));
      linhas.push({ grupo, item: k, situacao: campos.length ? "DIVERGENTE" : "OK", campos });
    }
    for (const k of no.keys()) if (!esp.has(k)) linhas.push({ grupo, item: k, situacao: "SO_NO_BANCO" });
  }
  return linhas;
}

function main() {
  const i = process.argv.indexOf("--ref");
  const ref = i >= 0 ? process.argv[i + 1] : "";
  if (!/^[a-z0-9]{20}$/.test(ref ?? "")) {
    console.error("Uso: node scripts/ged-conferir-assinaturas.mjs --ref <ref do projeto>");
    process.exit(2);
  }
  const cli = fileURLToPath(new URL("../node_modules/supabase/dist/supabase.js", import.meta.url));
  const consulta = (sql) =>
    JSON.parse(execFileSync(process.execPath, [cli, "db", "query", "--linked", "--project-ref", ref, "--agent", "no", "-o", "json", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120_000 }));
  try {
    const esperada = JSON.parse(readFileSync(new URL("./ged-assinaturas.json", import.meta.url), "utf8"));
    const sql = readFileSync(new URL("./ged-assinaturas.sql", import.meta.url), "utf8").replace(/^--.*$/gm, "");
    const instalada = consulta(sql)[0].assinatura;
    const versoes = consulta("select version from supabase_migrations.schema_migrations where version >= '0801' order by version")
      .map((r) => r.version);
    const linhas = compararAssinaturas(esperada, typeof instalada === "string" ? JSON.parse(instalada) : instalada);
    for (const l of linhas) console.log(`${l.situacao.padEnd(11)} ${l.grupo.padEnd(9)} ${l.item}${l.campos?.length ? `  [${l.campos.join(", ")}]` : ""}`);
    console.log(`migrations registradas (>= 0801): ${versoes.join(", ") || "nenhuma"}`);
    process.exit(linhas.every((l) => l.situacao === "OK") ? 0 : 1);
  } catch {
    console.log("NAO_CONFERIDO: falha ao consultar o banco ou ao ler a referência.");
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
