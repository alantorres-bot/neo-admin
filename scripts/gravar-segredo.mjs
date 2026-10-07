#!/usr/bin/env node
// Grava UM segredo das Edge Functions no Supabase, lendo o valor com a entrada OCULTA (nada na tela, nada no histórico).
//
//   node scripts/gravar-segredo.mjs CONSISTEM_API_KEY --ref <ref do projeto>
//
// Use para segredos que não existem nesta máquina (ex.: o token da API do Consistem). Cole o valor quando pedir e tecle Enter.
// O valor passa por um arquivo temporário (apagado em seguida) e vai direto ao `supabase secrets set`.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const nome = process.argv[2];
const iRef = process.argv.indexOf("--ref");
const ref = iRef >= 0 ? process.argv[iRef + 1] : "";
if (!nome || !/^[A-Z][A-Z0-9_]{2,60}$/.test(nome) || nome.startsWith("SUPABASE_")) {
  console.error("Uso: node scripts/gravar-segredo.mjs NOME_DO_SEGREDO --ref <ref do projeto>   (ex.: CONSISTEM_API_KEY)");
  process.exit(2);
}

function lerOculto(pergunta) {
  return new Promise((resolve) => {
    process.stdout.write(pergunta);
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin });
      rl.once("line", (linha) => { rl.close(); process.stdout.write("\n"); resolve(linha.trim()); });
      return;
    }
    let valor = "";
    const aoReceber = (tecla) => {
      for (const c of tecla.toString("utf8")) {
        if (c === "\u0003") { process.stdin.setRawMode(false); process.stdout.write("\nCancelado.\n"); process.exit(130); }
        if (c === "\r" || c === "\n") {
          process.stdin.removeListener("data", aoReceber); process.stdin.setRawMode(false); process.stdin.pause();
          process.stdout.write("\n"); resolve(valor.trim()); return;
        }
        if (c === "\u007f" || c === "\b") { if (valor) { valor = valor.slice(0, -1); process.stdout.write("\b \b"); } continue; }
        valor += c; process.stdout.write("*");
      }
    };
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on("data", aoReceber);
  });
}

const valor = await lerOculto(`Cole o valor de ${nome} (não aparece na tela) e tecle Enter: `);
if (valor.length < 8) { console.error("Valor curto demais: nada foi gravado."); process.exit(1); }

const arquivo = path.join(os.tmpdir(), `neo-admin-segredo-${crypto.randomBytes(6).toString("hex")}.env`);
fs.writeFileSync(arquivo, `${nome}=${valor}\n`, { mode: 0o600 });
try {
  const args = ["supabase", "secrets", "set", "--env-file", `"${arquivo}"`, ...(ref ? ["--project-ref", ref] : []), "--agent", "no"];
  const r = spawnSync("npx", args, { shell: true, stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) { console.error("Não consegui gravar no Supabase."); process.exit(1); }
  console.log(`Pronto: ${nome} gravado${ref ? ` no projeto ${ref}` : ""}.`);
} finally {
  fs.rmSync(arquivo, { force: true });
}
