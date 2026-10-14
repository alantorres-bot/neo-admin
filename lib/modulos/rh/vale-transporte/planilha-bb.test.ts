import { describe, expect, it } from "vitest";
import { cpfBB, gerarArquivoBB, linhasBB, nomeArquivoBB, type ItemBB } from "./planilha-bb";

const item = (m: Partial<ItemBB>): ItemBB => ({ cod_fornecedor: "1", nome: "B", cpf: "071.225.481-12", agencia: "2764-2", conta: "98657-7", forma_pagamento: "fopag", valor: 198, ...m });

describe("arquivo do BB", () => {
  it("CPF no formato da planilha (9 dígitos, hífen, 2)", () => {
    expect(cpfBB("071.225.481-12")).toBe("071225481-12");
    expect(cpfBB("8693621190")).toBe("086936211-90");
  });

  it("só FOPAG com valor; ordem por nome; total", () => {
    const r = linhasBB([item({ nome: "Zé" }), item({ nome: "Ana", valor: 207.9 }), item({ forma_pagamento: "pix_neo_formas", cpf: null }), item({ valor: 0, cpf: null })]);
    expect(r).toEqual({ ok: true, total: 405.9, linhas: [["071225481-12", "2764-2", "98657-7", 207.9], ["071225481-12", "2764-2", "98657-7", 198]] });
  });

  it("recusa FOPAG sem conta e mês sem FOPAG", () => {
    expect(linhasBB([item({ cod_fornecedor: "659", nome: "JOSE", conta: null })])).toEqual({ ok: false, erro: "FOPAG sem CPF, agência ou conta: 659 JOSE." });
    expect(linhasBB([item({ forma_pagamento: "pix_neo_servicos" })]).ok).toBe(false);
  });

  it("gera o XLSX com a aba EXPORTA BB", async () => {
    const r = linhasBB([item({})]);
    if (!r.ok) throw new Error(r.erro);
    const bytes = await gerarArquivoBB(r.linhas);
    const { Workbook } = await import("exceljs");
    const wb = new Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    const ws = wb.getWorksheet("EXPORTA BB")!;
    expect(ws.getRow(1).values).toEqual([undefined, "CPF", "AGENCIA", "CONTA", "VALOR"]);
    expect(ws.getRow(2).values).toEqual([undefined, "071225481-12", "2764-2", "98657-7", 198]);
    expect(nomeArquivoBB("2026-11-01")).toBe("VT 11-2026 - EXPORTA BB.xlsx");
  });
});
