import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { criarClienteDrive, ErroDrive } from "../../../supabase/functions/_shared/ged";

const TOKEN = "token-ficticio-123";
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status });
const semEspera = async () => {};

describe("criarClienteDrive", () => {
  it("só GET: POST, PATCH, PUT e DELETE falham antes do fetch", async () => {
    const f = vi.fn();
    const drive = criarClienteDrive(async () => TOKEN, { fazerFetch: f });
    for (const m of ["POST", "PATCH", "DELETE", "PUT"]) await expect(drive.requisitar(m, "files")).rejects.toThrow(ErroDrive);
    expect(f).not.toHaveBeenCalled();
  });

  it("recusa endereço fora da Drive API v3 antes do fetch", async () => {
    const f = vi.fn();
    const drive = criarClienteDrive(async () => TOKEN, { fazerFetch: f });
    await expect(drive.get("https://exemplo.invalid/drive/v3/files")).rejects.toThrow(ErroDrive);
    await expect(drive.get("../../upload/drive/v3/files")).rejects.toThrow(ErroDrive);
    expect(f).not.toHaveBeenCalled();
  });

  it("monta o GET com os parâmetros e o token só no cabeçalho", async () => {
    const f = vi.fn(async () => resposta(200, { files: [] }));
    const drive = criarClienteDrive(async () => TOKEN, { fazerFetch: f });
    expect(await drive.get("files", { q: "'x' in parents" })).toEqual({ files: [] });
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe("https://www.googleapis.com/drive/v3/files?q=%27x%27+in+parents");
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("o token nunca aparece na mensagem de erro", async () => {
    const f = vi.fn(async () => resposta(401, { error: { message: `token ${TOKEN} inválido` } }));
    const drive = criarClienteDrive(async () => TOKEN, { fazerFetch: f });
    const erro = await drive.get("files").catch((e: ErroDrive) => e);
    expect(erro).toBeInstanceOf(ErroDrive);
    expect((erro as ErroDrive).status).toBe(401);
    expect((erro as ErroDrive).message).not.toContain(TOKEN);
  });

  it("429 e 5xx: tenta de novo com espera exponencial", async () => {
    const respostas = [resposta(429, {}), resposta(503, {}), resposta(200, { ok: true })];
    const f = vi.fn(async () => respostas.shift() as Response);
    const esperas: number[] = [];
    const drive = criarClienteDrive(async () => TOKEN, { fazerFetch: f, esperar: async (ms) => void esperas.push(ms) });
    expect(await drive.get("files")).toEqual({ ok: true });
    expect(esperas).toEqual([1000, 2000]);
  });

  it("persistindo o erro transitório, desiste depois de 4 tentativas", async () => {
    const f = vi.fn(async () => resposta(500, {}));
    const drive = criarClienteDrive(async () => TOKEN, { fazerFetch: f, esperar: semEspera });
    await expect(drive.get("files")).rejects.toMatchObject({ status: 500 });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("erro definitivo (403) não é repetido", async () => {
    const f = vi.fn(async () => resposta(403, {}));
    const drive = criarClienteDrive(async () => TOKEN, { fazerFetch: f, esperar: semEspera });
    await expect(drive.get("files")).rejects.toMatchObject({ status: 403 });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("varredura do código do GED", () => {
  it("nenhum arquivo do GED chama a Drive API com método de escrita", () => {
    const shared = join(__dirname, "../../../supabase/functions/_shared");
    const funcoes = join(__dirname, "../../../supabase/functions");
    const fontes = [
      join(shared, "ged.ts"),
      ...readdirSync(funcoes).filter((n) => n.startsWith("administrativo-ged")).map((n) => join(funcoes, n, "index.ts")),
    ];
    for (const caminho of fontes) {
      const codigo = readFileSync(caminho, "utf8");
      expect(codigo, caminho).not.toMatch(/method:\s*["'](POST|PATCH|PUT|DELETE)["']/i);
      expect(codigo, caminho).not.toMatch(/upload\/drive|\.(create|update|delete|emptyTrash)\(/);
    }
  });
});
