// Publicação do Neo Admin a partir de um COMMIT IDENTIFICADO (política D-08, ADR-004 do arquiteto). Antes, o deploy era
// `gcloud run deploy --source .` na pasta de trabalho: subia branch não mesclado, alteração sem commit e arquivo não rastreado
// de qualquer sessão, e ninguém sabia que código estava no ar. Aqui o código publicado é sempre um commit que já está em
// origin/main, extraído numa cópia limpa (git worktree) e verificado nela; a revisão do Cloud Run leva o commit na etiqueta.
//
// Uso (de qualquer clone; a pasta de trabalho atual NÃO é publicada):
//   node scripts/publicar.mjs plano    --commit <sha> [--funcoes a,b] [--sem-app]   confere e mostra o que seria feito (nada remoto)
//   node scripts/publicar.mjs executar --commit <sha> [--funcoes a,b] [--sem-app]   cópia limpa, npm ci, npm run verificar, publica
//   node scripts/publicar.mjs consultar                                             últimas revisões do Cloud Run e o commit de cada uma
//
// `executar` publica o app (Cloud Run) e, com --funcoes, as Edge Functions indicadas, sempre no projeto de São Paulo.
// Migrations NÃO são aplicadas aqui (seguem `docs/PUBLICACAO.md`, seção 2).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJETO_SUPABASE = "chdszjpbtfpstjrqnmmm"; // neo-admin-sp
export const SERVICO = "neo-admin";
export const REGIAO = "southamerica-east1";
export const RAMO_PUBLICAVEL = "origin/main";

const aspas = (s) => `"${s}"`;

function git(pasta, args) {
  const r = spawnSync("git", ["-C", pasta, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, saida: (r.stdout ?? "").trim(), erro: (r.stderr ?? "").trim() };
}

/** Resolve o commit e exige que ele já esteja em origin/main (enviado e mesclado). Não busca no remoto: quem chama faz o fetch. */
export function conferirCommit(pasta, commit) {
  if (!commit || !/^[0-9a-f]{7,40}$/i.test(commit)) return { ok: false, motivo: "Informe --commit com o hash (7 a 40 caracteres hexadecimais)." };
  const r = git(pasta, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]);
  if (!r.ok) return { ok: false, motivo: `Commit ${commit} não existe neste clone (rode git fetch).` };
  const sha = r.saida;
  if (!git(pasta, ["rev-parse", "--verify", "--quiet", RAMO_PUBLICAVEL]).ok) return { ok: false, motivo: `${RAMO_PUBLICAVEL} não existe neste clone.` };
  if (!git(pasta, ["merge-base", "--is-ancestor", sha, RAMO_PUBLICAVEL]).ok) {
    return { ok: false, motivo: `Commit ${sha.slice(0, 12)} não está em ${RAMO_PUBLICAVEL}: envie e mescle antes de publicar.` };
  }
  return { ok: true, sha, curto: sha.slice(0, 12) };
}

/** Nomes vêm do terminal e vão para um comando com shell: só [a-z0-9-] e só funções que existem no commit. */
export function conferirFuncoes(pasta, sha, nomes) {
  for (const n of nomes) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(n)) return { ok: false, motivo: `Nome de função inválido: ${JSON.stringify(n)}` };
    if (!git(pasta, ["cat-file", "-e", `${sha}:supabase/functions/${n}/index.ts`]).ok) {
      return { ok: false, motivo: `A função ${n} não existe no commit ${sha.slice(0, 12)}.` };
    }
  }
  return { ok: true };
}

/**
 * Passos de `executar`, na ordem. `cwd` é sempre a cópia limpa, nunca a pasta de trabalho.
 * @param {{ sha: string, curto: string, copia: string, funcoes?: string[], semApp?: boolean }} opcoes
 */
export function montarPassos({ sha, curto, copia, funcoes = [], semApp = false }) {
  const passos = [
    { titulo: "Cópia limpa do commit", cmd: "git", args: ["-c", "core.autocrlf=false", "worktree", "add", "--detach", aspas(copia), sha], cwd: null },
    { titulo: "Dependências do lock", cmd: "npm", args: ["ci"], cwd: copia },
    { titulo: "Typecheck, lint e testes", cmd: "npm", args: ["run", "verificar"], cwd: copia },
  ];
  if (funcoes.length) {
    passos.push({ titulo: `Edge Functions: ${funcoes.join(", ")}`, cmd: "npx", args: ["supabase", "functions", "deploy", ...funcoes, "--project-ref", PROJETO_SUPABASE], cwd: copia });
  }
  if (!semApp) {
    passos.push({
      titulo: "App no Cloud Run",
      cmd: "gcloud",
      args: ["run", "deploy", SERVICO, "--source", ".", "--region", REGIAO, "--allow-unauthenticated", "--min-instances=0",
        "--max-instances=2", "--memory=512Mi", `--update-labels=commit=${curto}`],
      cwd: copia,
    });
  }
  return passos;
}

const texto = (p) => `${p.cmd} ${p.args.join(" ")}`;

function rodar(p, pastaRepo) {
  console.log(`\n== ${p.titulo}\n   ${texto(p)}`);
  const r = spawnSync(p.cmd, p.args, { cwd: p.cwd ?? pastaRepo, stdio: "inherit", shell: true });
  if (r.status !== 0) throw new Error(`Falhou: ${p.titulo} (código ${r.status}). Nada depois deste passo foi executado.`);
}

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function principal() {
  const acao = process.argv[2];
  const pastaRepo = fileURLToPath(new URL("..", import.meta.url));

  if (acao === "consultar") {
    const r = spawnSync("gcloud", ["run", "revisions", "list", "--service", SERVICO, "--region", REGIAO, "--limit", "5",
      aspas("--format=table(metadata.name,metadata.labels.commit,metadata.creationTimestamp)")], { stdio: "inherit", shell: true });
    process.exit(r.status ?? 1);
  }
  if (acao !== "plano" && acao !== "executar") {
    console.error("Uso: node scripts/publicar.mjs plano|executar --commit <sha> [--funcoes a,b] [--sem-app]  |  consultar");
    process.exit(2);
  }

  if (!git(pastaRepo, ["fetch", "--quiet", "origin"]).ok) { console.error("git fetch origin falhou."); process.exit(1); }
  const c = conferirCommit(pastaRepo, argumento("commit"));
  if (!c.ok) { console.error(c.motivo); process.exit(1); }
  const funcoes = (argumento("funcoes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const f = conferirFuncoes(pastaRepo, c.sha, funcoes);
  if (!f.ok) { console.error(f.motivo); process.exit(1); }
  const semApp = process.argv.includes("--sem-app");
  if (semApp && !funcoes.length) { console.error("Nada a publicar: --sem-app sem --funcoes."); process.exit(2); }

  const copia = join(tmpdir(), `neo-admin-publicacao-${c.curto}`);
  if (existsSync(copia)) { console.error(`A cópia ${copia} já existe: remova com git worktree remove antes.`); process.exit(1); }
  const passos = montarPassos({ sha: c.sha, curto: c.curto, copia, funcoes, semApp });
  const assunto = git(pastaRepo, ["log", "-1", "--format=%s (%an, %ad)", "--date=short", c.sha]).saida;
  console.log(`Commit: ${c.sha}\n        ${assunto}\nEstá em ${RAMO_PUBLICAVEL}: sim\nCópia limpa: ${copia}`);

  if (acao === "plano") {
    passos.forEach((p, i) => console.log(`${i + 1}. ${p.titulo}\n   ${texto(p)}`));
    console.log("\nPlano apenas: nada foi executado. Para publicar: troque `plano` por `executar`.");
    return;
  }
  try {
    for (const p of passos) rodar(p, pastaRepo);
    console.log(`\nPublicado o commit ${c.curto}. Registre em docs/PUBLICACAO.md (data, commit, revisão) e confira com: node scripts/publicar.mjs consultar`);
  } finally {
    if (existsSync(copia)) git(pastaRepo, ["worktree", "remove", "--force", copia]);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { principal(); } catch (e) { console.error(e.message); process.exit(1); }
}
