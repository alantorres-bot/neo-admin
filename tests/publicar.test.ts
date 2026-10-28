import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  conferirAtualidade, conferirCommit, conferirCopia, conferirFuncoes, destinoCloudRunValido, executarPassos, montarPassos,
  PROJETO_GCP, PROJETO_SUPABASE,
} from "../scripts/publicar.mjs";

// Repositórios de verdade: um "origin" nu, um clone com um commit mesclado e outro só local, e um 2º clone que avança o main.
let raiz: string, origem: string, clone: string, mesclado: string, soLocal: string;
const g = (pasta: string, ...args: string[]) =>
  execFileSync("git", ["-C", pasta, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), "publicar-"));
  origem = join(raiz, "origem.git");
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

describe("conferirAtualidade", () => {
  it("aceita quando origin/main local = main do remoto", () => {
    expect(conferirAtualidade(clone)).toMatchObject({ ok: true, sha: mesclado });
  });
  it("recusa quando o remoto andou e o clone não buscou (sem fazer fetch)", () => {
    const outro = join(raiz, "outro");
    execFileSync("git", ["clone", "-q", origem, outro], { stdio: "ignore" });
    writeFileSync(join(outro, "novo.txt"), "y\n");
    g(outro, "add", ".");
    g(outro, "commit", "-q", "-m", "avanço no remoto");
    g(outro, "push", "-q", "origin", "HEAD:main");
    const antes = g(clone, "rev-parse", "origin/main");
    const r = conferirAtualidade(clone);
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain("difere do GitHub");
    expect(g(clone, "rev-parse", "origin/main")).toBe(antes); // não mexeu nas refs do clone
    g(clone, "fetch", "-q", "origin");
    expect(conferirAtualidade(clone).ok).toBe(true);
  });
  it("recusa quando não consegue ler o remoto", () => {
    const sem = join(raiz, "sem-remoto");
    execFileSync("git", ["clone", "-q", origem, sem], { stdio: "ignore" });
    g(sem, "remote", "set-url", "origin", join(raiz, "nao-existe.git"));
    expect(conferirAtualidade(sem).motivo).toContain("sem prova de atualidade");
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

describe("conferirCopia", () => {
  it("cópia limpa no commit passa; arquivo rastreado alterado, outro commit e node_modules (pasta ou junção) bloqueiam", () => {
    const copia = join(raiz, "copia");
    g(clone, "worktree", "add", "-q", "--detach", copia, mesclado);
    expect(conferirCopia(copia, mesclado, { antesDoNpm: true }).ok).toBe(true);
    expect(conferirCopia(copia, soLocal).motivo).toContain("não está no commit");

    writeFileSync(join(copia, "solto.txt"), "não rastreado\n"); // ignorado: não é arquivo rastreado
    expect(conferirCopia(copia, mesclado).ok).toBe(true);
    writeFileSync(join(copia, "supabase", "functions", "nucleo-apps-pendencias", "index.ts"), "export const x = 1;\n");
    expect(conferirCopia(copia, mesclado).motivo).toContain("rastreados alterados");
    g(copia, "checkout", "--", ".");

    const alvo = join(raiz, "node_modules_do_clone_principal");
    mkdirSync(alvo);
    execFileSync(process.platform === "win32" ? "cmd" : "ln", process.platform === "win32" ? ["/c", "mklink", "/J", join(copia, "node_modules"), alvo] : ["-s", alvo, join(copia, "node_modules")], { stdio: "ignore" });
    expect(conferirCopia(copia, mesclado, { antesDoNpm: true }).motivo).toContain("npm ci não roda aqui");
    expect(conferirCopia(copia, mesclado).ok).toBe(true); // depois do npm ci a pasta existe, e tudo bem
  });
});

describe("destinoCloudRunValido", () => {
  it("só a URL do serviço neo-admin no projeto fixado", () => {
    expect(destinoCloudRunValido(`https://neo-admin-${PROJETO_GCP}.southamerica-east1.run.app\n`)).toBe(true);
    expect(destinoCloudRunValido("https://neo-admin-111111111111.southamerica-east1.run.app")).toBe(false);
    expect(destinoCloudRunValido(`https://outro-${PROJETO_GCP}.southamerica-east1.run.app`)).toBe(false);
    expect(destinoCloudRunValido("")).toBe(false);
  });
});

describe("montarPassos", () => {
  const base = { sha: "a".repeat(40), curto: "a".repeat(12), copia: "C:/tmp/copia", agora: new Date("2026-10-28T15:04:00Z") };
  it("confere tudo antes de publicar e publica só da cópia limpa, no projeto fixo, com o commit na revisão", () => {
    const passos = montarPassos({ ...base, funcoes: ["x"] });
    const primeiraPublicacao = passos.findIndex((p) => p.tipo === "publicacao");
    const titulos = passos.map((p) => p.titulo);
    expect(titulos.slice(0, primeiraPublicacao)).toEqual([
      "Cópia limpa do commit", "Cópia no commit, sem alteração e sem node_modules", "Dependências do lock",
      "Typecheck, lint e testes", "Cópia continua no commit, sem arquivo rastreado alterado", "Destino do Cloud Run",
    ]);
    for (const p of passos.slice(1)) if (p.cmd) expect(p.cwd).toBe(base.copia);
    expect(passos[0].args).toContain(base.sha);
    const app = passos.at(-1)!;
    expect(app.titulo).toBe("App no Cloud Run");
    expect(app.args).toEqual(expect.arrayContaining([`--project=${PROJETO_GCP}`, `--update-labels=commit=${base.curto}`, `--revision-suffix=c${base.curto}-202610281504`]));
    expect(passos.find((p) => p.titulo.startsWith("Edge"))!.args).toEqual(expect.arrayContaining(["--project-ref", PROJETO_SUPABASE]));
  });
  it("--sem-app publica só as funções e não consulta o Cloud Run", () => {
    const passos = montarPassos({ ...base, funcoes: ["x"], semApp: true });
    expect(passos.some((p) => p.cmd === "gcloud")).toBe(false);
  });
});

describe("executarPassos", () => {
  const passos = montarPassos({ sha: "a".repeat(40), curto: "a".repeat(12), copia: "C:/tmp/copia", funcoes: ["x"] });
  it("falha antes de publicar: diz que nada foi publicado e não roda o resto", () => {
    const rodados: string[] = [];
    expect(() => executarPassos(passos, (p: { titulo: string }) => {
      rodados.push(p.titulo);
      if (p.titulo === "Typecheck, lint e testes") throw new Error("teste vermelho");
    })).toThrow(/Typecheck.*teste vermelho[\s\S]*Nada foi publicado/);
    expect(rodados.some((t) => t.startsWith("Edge"))).toBe(false);
  });
  it("falha depois das funções: lista o que já foi ao ar (estado parcial)", () => {
    expect(() => executarPassos(passos, (p: { titulo: string }) => {
      if (p.titulo === "App no Cloud Run") throw new Error("código 1");
    })).toThrow(/JÁ PUBLICADO antes da falha: Edge Functions: x/);
  });
  it("tudo certo: devolve o que foi publicado", () => {
    expect(executarPassos(passos, () => {})).toEqual(["Edge Functions: x", "App no Cloud Run"]);
  });
});
