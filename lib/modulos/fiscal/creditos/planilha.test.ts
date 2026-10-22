import { describe, expect, it } from "vitest";
import { gerarPlanilha } from "./planilha";

describe("planilha dos relatórios", () => {
  it("traz emissão, critérios e valores em formato de moeda", async () => {
    const bytes = await gerarPlanilha([{
      titulo: "Créditos", emitidoPor: "Analista", emitidoEm: "22/10/2026 10:00", criterios: ["Período: 2025", "Tributo: ICMS"],
      colunas: [{ titulo: "Código" }, { titulo: "Data", tipo: "data" }, { titulo: "Saldo", tipo: "moeda" }], linhas: [["CR-1", "2025-01-31", 1234.56]], totais: ["Total", null, 1234.56],
    }]);
    const { Workbook } = await import("exceljs");
    const wb = new Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell("A2").value).toBe("Emitido em 22/10/2026 10:00 por Analista");
    expect(ws.getCell("A3").value).toBe("Período: 2025");
    expect(ws.getCell("C7").value).toBe(1234.56);
    expect(ws.getCell("C7").numFmt).toContain("R$");
    expect((ws.getCell("B7").value as Date).toISOString().slice(0, 10)).toBe("2025-01-31");
  });
});
