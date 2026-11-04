// Publicação do Neo Admin a partir de um COMMIT IDENTIFICADO (política D-08, ADR-004 do arquiteto). Antes, o deploy era
// `gcloud run deploy --source .` na pasta de trabalho: subia branch não mesclado, alteração sem commit e arquivo não rastreado
// de qualquer sessão, e ninguém sabia que código estava no ar. Aqui o código publicado é sempre um commit que já está em
// origin/main (conferido contra o GitHub), extraído numa cópia limpa (git worktree) e verificado nela; a revisão do Cloud Run
// leva o commit no nome e na etiqueta.
//
// Uso (de qualquer clone; a pasta de trabalho atual NÃO é publicada; o script não faz git fetch, rode-o você antes):
//   node scripts/publicar.mjs plano    --commit <sha> [--funcoes a,b] [--sem-app]   confere e mostra o que seria feito (nada remoto)
//   node scripts/publicar.mjs executar --commit <sha> [--funcoes a,b] [--sem-app]   cópia limpa, npm ci, npm run verificar, publica
//   node scripts/publicar.mjs consultar                                             últimas revisões do Cloud Run e o commit de cada uma
//
// `executar` publica o app (Cloud Run) e, com --funcoes, as Edge Functions indicadas, sempre nos projetos fixados abaixo.
// Migrations NÃO são aplicadas aqui (seguem `docs/PUBLICACAO.md`, seção 2). Não há rollback automático: se um passo de
// publicação falhar depois de outro ter publicado, o erro lista o que já foi ao ar (recuperação em PUBLICACAO.md §4.1).
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJETO_SUPABASE = "chdszjpbtfpstjrqnmmm"; // neo-admin-sp
export const PROJETO_GCP = "neo-admin-neoformas"; // ID do projeto do Cloud Run (o gcloud run recusa o número no --project)
export const NUMERO_GCP = "474748357673"; // número do mesmo projeto: só aparece na URL (neo-admin-474748357673…run.app)
export const SERVICO = "neo-admin";
export const REGIAO = "southamerica-east1";
export const RAMO_PUBLICAVEL = "origin/main";

const aspas = (s) => `"${s}"`;

function git(pasta, args) {
  const r = spawnSync("git", ["-C", pasta, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, saida: (r.stdout ?? "").trim(), erro: (r.stderr ?? "").trim() };
}

/** origin/main local tem de ser igual ao main do GitHub agora (ls-remote só lê; não mexe em refs do clone). */
export function conferirAtualidade(pasta) {
  const local = git(pasta, ["rev-parse", "--verify", "--quiet", RAMO_PUBLICAVEL]);
  if (!local.ok) return { ok: false, motivo: `${RAMO_PUBLICAVEL} não existe neste clone.` };
  const remoto = git(pasta, ["ls-remote", "origin", "refs/heads/main"]);
  const shaRemoto = remoto.saida.split(/\s/)[0];
  if (!remoto.ok || !/^[0-9a-f]{40}$/.test(shaRemoto)) return { ok: false, motivo: "Não foi possível ler o main do GitHub (git ls-remote): sem prova de atualidade, nada é publicado." };
  if (shaRemoto !== local.saida) {
    return { ok: false, motivo: `${RAMO_PUBLICAVEL} local (${local.saida.slice(0, 12)}) difere do GitHub (${shaRemoto.slice(0, 12)}): rode git fetch origin e confira de novo.` };
  }
  return { ok: true, sha: shaRemoto };
}

/** Resolve o commit e exige que ele já esteja em origin/main (enviado e mesclado). */
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
 * A cópia está exatamente no commit autorizado, sem arquivo rastreado alterado. Antes do `npm ci` também não pode haver
 * `node_modules` (nem junção/link): o `npm ci` apaga o que encontra ali, inclusive o destino de uma junção.
 */
export function conferirCopia(copia, sha, { antesDoNpm = false } = {}) {
  const head = git(copia, ["rev-parse", "HEAD"]);
  if (!head.ok || head.saida !== sha) return { ok: false, motivo: `A cópia ${copia} não está no commit ${sha.slice(0, 12)}.` };
  const sujos = git(copia, ["status", "--porcelain", "--untracked-files=no"]);
  if (!sujos.ok || sujos.saida) return { ok: false, motivo: `A cópia tem arquivos rastreados alterados:\n${sujos.saida}` };
  if (antesDoNpm) {
    let existe = false;
    try { lstatSync(join(copia, "node_modules")); existe = true; } catch { /* ausente, como deve ser */ }
    if (existe) return { ok: false, motivo: `${join(copia, "node_modules")} já existe (pasta, junção ou link): npm ci não roda aqui.` };
  }
  return { ok: true };
}

/**
 * O serviço que o gcloud enxerga com --project/--region fixos tem de ser o do Neo Admin. O `describe` devolve a URL curta
 * (neo-admin-<hash>-rj.a.run.app; rj = southamerica-east1); a URL com o número do projeto também vale.
 */
export function destinoCloudRunValido(url) {
  const u = url.trim();
  return new RegExp(`^https://${SERVICO}-${NUMERO_GCP}\\.${REGIAO}\\.run\\.app/?$`).test(u)
    || new RegExp(`^https://${SERVICO}-[a-z0-9]+-rj\\.a\\.run\\.app/?$`).test(u);
}

const sufixoRevisao = (curto, agora) => `c${curto}-${agora.toISOString().slice(0, 16).replace(/\D/g, "")}`;

/**
 * Passos de `executar`, na ordem. `cwd` é sempre a cópia limpa, nunca a pasta de trabalho. Tipos: preparo (local),
 * conferencia (bloqueia se falhar; nada publicado ainda) e publicacao (efeito em produção).
 * @param {{ sha: string, curto: string, copia: string, funcoes?: string[], semApp?: boolean, agora?: Date }} opcoes
 */
export function montarPassos({ sha, curto, copia, funcoes = [], semApp = false, agora = new Date() }) {
  const passos = [
    { tipo: "preparo", titulo: "Cópia limpa do commit", cmd: "git", args: ["-c", "core.autocrlf=false", "worktree", "add", "--detach", aspas(copia), sha], cwd: null },
    { tipo: "conferencia", titulo: "Cópia no commit, sem alteração e sem node_modules", conferir: () => conferirCopia(copia, sha, { antesDoNpm: true }) },
    { tipo: "preparo", titulo: "Dependências do lock", cmd: "npm", args: ["ci"], cwd: copia },
    { tipo: "preparo", titulo: "Typecheck, lint e testes", cmd: "npm", args: ["run", "verificar"], cwd: copia },
    { tipo: "conferencia", titulo: "Cópia continua no commit, sem arquivo rastreado alterado", conferir: () => conferirCopia(copia, sha) },
  ];
  if (!semApp) {
    passos.push({
      tipo: "conferencia",
      titulo: "Destino do Cloud Run",
      cmd: "gcloud",
      args: ["run", "services", "describe", SERVICO, `--project=${PROJETO_GCP}`, `--region=${REGIAO}`, aspas("--format=value(status.url)")],
      cwd: copia,
      validarSaida: (s) => destinoCloudRunValido(s) || `O gcloud não devolveu o serviço esperado (${SERVICO}, projeto ${PROJETO_GCP}).`,
    });
  }
  if (funcoes.length) {
    passos.push({ tipo: "publicacao", titulo: `Edge Functions: ${funcoes.join(", ")}`, cmd: "npx", args: ["supabase", "functions", "deploy", ...funcoes, "--project-ref", PROJETO_SUPABASE], cwd: copia });
  }
  if (!semApp) {
    passos.push({
      tipo: "publicacao",
      titulo: "App no Cloud Run",
      cmd: "gcloud",
      args: ["run", "deploy", SERVICO, "--source", ".", `--project=${PROJETO_GCP}`, `--region=${REGIAO}`, "--allow-unauthenticated",
        "--min-instances=0", "--max-instances=2", "--memory=512Mi", `--revision-suffix=${sufixoRevisao(curto, agora)}`, `--update-labels=commit=${curto}`],
      cwd: copia,
    });
  }
  return passos;
}

const texto = (p) => (p.cmd ? `${p.cmd} ${p.args.join(" ")}` : "(conferência local)");

/** Roda os passos em ordem; no primeiro erro para e diz o que JÁ foi publicado (sem rollback automático). */
export function executarPassos(passos, rodar) {
  const publicados = [];
  for (const p of passos) {
    try {
      rodar(p);
    } catch (e) {
      const estado = publicados.length
        ? `JÁ PUBLICADO antes da falha: ${publicados.join("; ")}. Estado parcial: veja docs/PUBLICACAO.md §4.1 (recuperação).`
        : "Nada foi publicado.";
      throw new Error(`Falhou: ${p.titulo}: ${e instanceof Error ? e.message : e}\n${estado}`);
    }
    if (p.tipo === "publicacao") publicados.push(p.titulo);
  }
  return publicados;
}

function rodarDeVerdade(p, pastaRepo) {
  console.log(`\n== ${p.titulo}\n   ${texto(p)}`);
  if (p.conferir) {
    const r = p.conferir();
    if (!r.ok) throw new Error(r.motivo);
    return;
  }
  const r = spawnSync(p.cmd, p.args, { cwd: p.cwd ?? pastaRepo, shell: true, encoding: "utf8", stdio: p.validarSaida ? ["ignore", "pipe", "inherit"] : "inherit" });
  if (r.status !== 0) throw new Error(`código ${r.status}`);
  if (p.validarSaida) {
    const v = p.validarSaida(r.stdout ?? "");
    if (v !== true) throw new Error(v);
  }
}

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function principal() {
  const acao = process.argv[2];
  const pastaRepo = fileURLToPath(new URL("..", import.meta.url));

  if (acao === "consultar") {
    const r = spawnSync("gcloud", ["run", "revisions", "list", "--service", SERVICO, `--project=${PROJETO_GCP}`, `--region=${REGIAO}`, "--limit", "5",
      aspas("--format=table(metadata.name,metadata.labels.commit,metadata.creationTimestamp)")], { stdio: "inherit", shell: true });
    process.exit(r.status ?? 1);
  }
  if (acao !== "plano" && acao !== "executar") {
    console.error("Uso: node scripts/publicar.mjs plano|executar --commit <sha> [--funcoes a,b] [--sem-app]  |  consultar");
    process.exit(2);
  }

  const a = conferirAtualidade(pastaRepo);
  if (!a.ok) { console.error(a.motivo); process.exit(1); }
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
  console.log(`Commit: ${c.sha}\n        ${assunto}\n${RAMO_PUBLICAVEL} = GitHub (${a.sha.slice(0, 12)}) e contém o commit: sim\nCópia limpa: ${copia}`);

  if (acao === "plano") {
    passos.forEach((p, i) => console.log(`${i + 1}. [${p.tipo}] ${p.titulo}\n   ${texto(p)}`));
    console.log("\nPlano apenas: nada foi executado. Para publicar: troque `plano` por `executar`.");
    return;
  }
  try {
    executarPassos(passos, (p) => rodarDeVerdade(p, pastaRepo));
    console.log(`\nPublicado o commit ${c.curto}. Registre em docs/PUBLICACAO.md (data, commit, revisão) e confira com: node scripts/publicar.mjs consultar`);
  } finally {
    if (existsSync(copia)) git(pastaRepo, ["worktree", "remove", "--force", copia]);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { principal(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
}
