import { describe, expect, it } from "vitest";
import { LIMITE_DOCUMENTO, nomeSeguroArquivo, sha256, validarArquivo } from "./arquivos";

const bytes = (...b: number[]) => new Uint8Array(b);
const texto = (t: string) => new TextEncoder().encode(t);

describe("validação de arquivos no servidor", () => {
  it("aceita pelo conteúdo real", () => {
    expect(validarArquivo("recibo.pdf", texto("%PDF-1.7 ..."))).toMatchObject({ ok: true, mime: "application/pdf" });
    expect(validarArquivo("efd.txt", texto("|0000|017|0|01012025|"))).toMatchObject({ ok: true });
    expect(validarArquivo("nfe.xml", texto('<?xml version="1.0"?><nfe/>'))).toMatchObject({ ok: true });
    expect(validarArquivo("planilha.xlsx", bytes(0x50, 0x4b, 0x03, 0x04, 1))).toMatchObject({ ok: true });
  });
  it("recusa extensão proibida, arquivo renomeado, vazio e grande", () => {
    expect(validarArquivo("virus.exe", bytes(0x4d, 0x5a))).toMatchObject({ ok: false });
    expect(validarArquivo("falso.pdf", bytes(0x4d, 0x5a, 0x90))).toMatchObject({ ok: false, erro: expect.stringMatching(/não corresponde/) });
    expect(validarArquivo("bin.txt", bytes(65, 0, 66))).toMatchObject({ ok: false });
    expect(validarArquivo("vazio.pdf", bytes())).toMatchObject({ ok: false });
    expect(validarArquivo("grande.csv", new Uint8Array(LIMITE_DOCUMENTO + 1))).toMatchObject({ ok: false, erro: expect.stringMatching(/acima/) });
  });
  it("nome seguro e hash", async () => {
    expect(nomeSeguroArquivo("../Memória de cálculo 01/2025.pdf")).toBe("Memoria_de_calculo_01_2025.pdf");
    expect(await sha256(texto("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
