import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conferirCommit, conferirFuncoes, montarPassos, PROJETO_SUPABASE } from "../scripts/publicar.mjs";

// Repositório de verdade: um "origin" nu e um clone com um commit mesclado e outro só local.
let clone: string, mesclado: string, soLocal: string;
const g = (pasta: string, ...args: string[]) =>
  execFileSync("git", ["-C", pasta, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

beforeAll(() => {
  const raiz = mkdtempSync(join(tmpdir(), "publicar-"));
  const origem = join(raiz, "origem.git");
  clone = join(raiz, "clone");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origem]);
  execFileSync("git", ["clone", "-q", origem, clone], { stdio: "ignore" });
  mkdirSync(join(clone, "supabase", "functions", "nucleo-apps-pendencias"), { recursive: true });
  writeFileSync(join(clone, "supabase", "functions", "nucleo-apps-pendencias", "index.ts"), "export {};\n");
  g(clone, "add", ".");
  g(clone, "commit", "-q", "-m", "mesclado");
  g(clone, "push", "-q", "origin", "HEAD:main");
  g(clone, "fetch", "-q", "origin");
  mesclado = g(clone, "rev-parse", "HEAD");
  writeFileSync(join(clone, "local.txt"), "x\n");
  g(clone, "add", ".");
  g(clone, "commit", "-q", "-m", "so local");
  soLocal = g(clone, "rev-parse", "HEAD");
});

describe("conferirCommit", () => {
  it("aceita commit que já está em origin/main", () => {
    const r = conferirCommit(clone, mesclado.slice(0, 9));
    expect(r).toMatchObject({ ok: true, sha: mesclado, curto: mesclado.slice(0, 12) });
  });
  it("recusa commit que não foi enviado/mesclado", () => {
    const r = conferirCommit(clone, soLocal);
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain("não está em origin/main");
  });
  it("recusa ausente, inválido e inexistente", () => {
    expect(conferirCommit(clone, undefined).ok).toBe(false);
    expect(conferirCommit(clone, "HEAD").ok).toBe(false); // nome de ref não identifica o commit
    expect(conferirCommit(clone, "main; rm -rf /").ok).toBe(false);
    expect(conferirCommit(clone, "abcdef1234").motivo).toContain("não existe");
  });
});

describe("conferirFuncoes", () => {
  it("aceita função que existe no commit", () => {
    expect(conferirFuncoes(clone, mesclado, ["nucleo-apps-pendencias"]).ok).toBe(true);
  });
  it("recusa função ausente e nome com caracteres de shell", () => {
    expect(conferirFuncoes(clone, mesclado, ["nao-existe"]).motivo).toContain("não existe");
    expect(conferirFuncoes(clone, mesclado, ["a&&b"]).motivo).toContain("inválido");
    expect(conferirFuncoes(clone, mesclado, ["../x"]).ok).toBe(false);
  });
});

describe("montarPassos", () => {
  const base = { sha: "a".repeat(40), curto: "a".repeat(12), copia: "C:/tmp/copia" };
  it("verifica antes de publicar e publica só da cópia limpa, com o commit na etiqueta", () => {
    const passos = montarPassos({ ...base, funcoes: ["x"] });
    const titulos = passos.map((p) => p.titulo);
    expect(titulos.indexOf("Typecheck, lint e testes")).toBeLessThan(titulos.findIndex((t) => t.startsWith("Edge")));
    expect(titulos.at(-1)).toBe("App no Cloud Run");
    for (const p of passos.slice(1)) expect(p.cwd).toBe(base.copia);
    expect(passos[0].args).toContain(base.sha);
    const app = passos.at(-1)!;
    expect(app.args).toContain(`--update-labels=commit=${base.curto}`);
    expect(passos.find((p) => p.titulo.startsWith("Edge"))!.args).toEqual(expect.arrayContaining(["--project-ref", PROJETO_SUPABASE]));
  });
  it("--sem-app publica só as funções", () => {
    const passos = montarPassos({ ...base, funcoes: ["x"], semApp: true });
    expect(passos.some((p) => p.cmd === "gcloud")).toBe(false);
  });
});
