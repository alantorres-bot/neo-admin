import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { criarClienteDrive, ErroDrive } from "./drive-http";

const TOKEN = "token-ficticio-123";
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status });

describe("criarClienteDrive", () => {
  it("só GET: POST, PATCH e DELETE falham antes do fetch", async () => {
    const f = vi.fn();
    const drive = criarClienteDrive(async () => TOKEN, f);
    for (const m of ["POST", "PATCH", "DELETE", "PUT"]) await expect(drive.requisitar(m, "files")).rejects.toThrow(ErroDrive);
    expect(f).not.toHaveBeenCalled();
  });

  it("recusa endereço fora da Drive API v3 antes do fetch", async () => {
    const f = vi.fn();
    const drive = criarClienteDrive(async () => TOKEN, f);
    await expect(drive.get("https://exemplo.invalid/drive/v3/files")).rejects.toThrow(ErroDrive);
    await expect(drive.get("../../upload/drive/v3/files")).rejects.toThrow(ErroDrive);
    expect(f).not.toHaveBeenCalled();
  });

  it("monta o GET com os parâmetros e o token só no cabeçalho", async () => {
    const f = vi.fn(async () => resposta(200, { files: [] }));
    const drive = criarClienteDrive(async () => TOKEN, f);
    expect(await drive.get("files", { q: "'x' in parents" })).toEqual({ files: [] });
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe("https://www.googleapis.com/drive/v3/files?q=%27x%27+in+parents");
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("o token nunca aparece na mensagem de erro", async () => {
    const f = vi.fn(async () => resposta(401, { error: { message: `token ${TOKEN} inválido` } }));
    const drive = criarClienteDrive(async () => TOKEN, f);
    const erro = await drive.get("files").catch((e: ErroDrive) => e);
    expect(erro).toBeInstanceOf(ErroDrive);
    expect((erro as ErroDrive).status).toBe(401);
    expect((erro as ErroDrive).message).not.toContain(TOKEN);
  });
});

describe("varredura do código do GED", () => {
  it("nenhum arquivo do GED chama a Drive API com método de escrita", () => {
    const pasta = __dirname;
    const fontes = readdirSync(pasta).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && statSync(join(pasta, n)).isFile());
    for (const n of fontes) {
      expect(readFileSync(join(pasta, n), "utf8"), n).not.toMatch(/method:\s*["'](POST|PATCH|PUT|DELETE)["']/i);
    }
  });
});
