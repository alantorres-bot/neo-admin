// Carga dos DADOS FICTÍCIOS de demonstração do Fiscal Control (supabase/demo/fiscal_creditos_demo.sql).
// Nunca roda sozinho e nunca deve ser usado em produção (o SQL recusa base com créditos reais ou marcada como produção).
//
// Uso:
//   node scripts/fiscal-demo.mjs --banco "postgresql://usuario:senha@host:5432/banco" --confirmar   (psql; Postgres local)
//   node scripts/fiscal-demo.mjs --ref <ref-do-projeto-de-TESTE> --confirmar                          (Supabase CLI logada)
// Em produção, bloqueie de vez: insert into configuracoes (chave, valor) values ('fiscal.creditos.bloquear_demonstracao', 'true');
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const arquivo = join(process.cwd(), "supabase", "demo", "fiscal_creditos_demo.sql");
const banco = arg("banco"), ref = arg("ref");

if (!process.argv.includes("--confirmar") || (!banco && !ref)) {
  console.error("Carrega dados FICTÍCIOS de demonstração. Informe o destino (--banco <url> ou --ref <projeto de teste>) e --confirmar.");
  process.exit(1);
}
const r = banco
  ? spawnSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-1", "-f", arquivo], { stdio: "inherit" })
  : spawnSync("npx", ["supabase", "db", "query", "--linked", "--project-ref", ref, "--agent", "no", "-f", arquivo], { stdio: "inherit", shell: process.platform === "win32" });
if (r.status !== 0) {
  console.error("A carga falhou (nada foi gravado: o script roda numa transação). Veja a mensagem acima.");
  process.exit(r.status ?? 1);
}
console.log("Demonstração fictícia carregada.");
