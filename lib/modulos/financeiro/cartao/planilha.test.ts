import { describe, expect, it } from "vitest";
import { CARTOES_TESTE } from "./cartoes.test";
import { conciliar, type LinhaFatura, type TituloPagar } from "./conciliacao";
import { gerarPlanilha, nomeDaPlanilha } from "./planilha";

const NUBANK = CARTOES_TESTE.find((c) => c.codigo === "NUBANK PF")!;
const linha = (id: string, descricao: string, valor: number): LinhaFatura => ({ id, ordem: 1, dataCompra: "2026-06-05", descricao, valorCentavos: Math.round(valor * 100), parcelaNum: null, parcelaTotal: null });
const titulo = (id: string, complemento: string, valor: number): TituloPagar => ({ id, numeroTitulo: `${id}/1`, fornecedor: "NU PAGAMENTOS", vencimento: "2026-06-27", complemento, tipoTitulo: "", valorCentavos: Math.round(valor * 100) });

describe("planilha de conciliação", () => {
  it("gera o XLSX com as sete abas e o nome no padrão da skill", async () => {
    const r = conciliar({
      cartao: NUBANK, cartoes: CARTOES_TESTE, vencimento: "2026-06-27", totalInformadoCentavos: 47_212,
      linhas: [linha("a", "ClickUp", 120), linha("b", "Hoteis.com", 352.12), linha("c", "IOF de X", 2), linha("d", "IOF de volta de X", -2)],
      titulos: [titulo("t1", "CARTAO NUBANK - CLICKUP", 120), titulo("t2", "CARTAO NUBANK - ANTIGO", 10)],
      estabelecimentos: [{ padrao: "HOTEIS.COM", categoria: "Hospedagem", contaFluxo: "Hospedagens" }],
    });
    expect(nomeDaPlanilha(r)).toBe("Conciliacao Cartao NUBANK PF - 27-06-2026.xlsx");
    const bytes = await gerarPlanilha(r);
    expect(bytes.length).toBeGreaterThan(2000);
    const { Workbook } = await import("exceljs");
    const wb = new Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof wb.xlsx.load>[0]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Resumo", "A Lançar", "Divergências", "Conciliados", "Compensados", "Conciliação", "Decisões"]);
    expect(wb.getWorksheet("A Lançar")!.rowCount).toBe(2);
    expect(wb.getWorksheet("A Lançar")!.getRow(2).getCell(2).value).toBe("Hoteis.com");
    expect(wb.getWorksheet("Compensados")!.rowCount).toBe(2);
    const quadro = wb.getWorksheet("Conciliação")!;
    expect(String(quadro.getRow(quadro.rowCount).getCell(1).value)).toMatch(/NÃO JUSTIFICADA/);
    expect(wb.getWorksheet("Resumo")!.getRow(8).getCell(2).value).toBe("OK");
  });
});
