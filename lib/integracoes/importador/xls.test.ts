import { describe, expect, it } from "vitest";
import { lerXls } from "./xls";
import { xlsSintetico, type CelulaTeste } from "./xls.fixture";

// ---------------------------------------------------------------- testes

const CELULAS: CelulaTeste[] = [
  [0, 0, "Empresa:"], [0, 5, "EMPRESA TESTE LTDA"], [3, 5, 46266], [10, 0, 133], [10, 3, "FULANO DE TAL"], [10, 24, 2398.59], [11, 24, -12.5], [12, 24, 100000],
];

describe("leitura de .xls (BIFF8) tolerante", () => {
  it("lê textos, inteiros (RK) e decimais (NUMBER) ignorando o deslocamento errado da planilha e o fim cortado", () => {
    const r = lerXls(xlsSintetico(CELULAS, { preencher: 400, cortar: 300 }));
    if (!r.ok) throw new Error(r.erro);
    const l = r.planilhas[0].linhas;
    expect(r.planilhas[0].nome).toBe("Folha");
    expect([l[0][0], l[0][5], l[3][5], l[10][0], l[10][3], l[10][24], l[11][24], l[12][24]])
      .toEqual(["Empresa:", "EMPRESA TESTE LTDA", 46266, 133, "FULANO DE TAL", 2398.59, -12.5, 100000]);
    expect(l[10][1]).toBeNull();
  });

  it("stream pequeno (mini stream) e texto cortado entre SST e CONTINUE", () => {
    const r = lerXls(xlsSintetico(CELULAS, { sstPartido: true }));
    if (!r.ok) throw new Error(r.erro);
    expect(r.planilhas[0].linhas[0][0]).toBe("Empresa:");   // o texto cortado entre SST e CONTINUE
    expect(r.planilhas[0].linhas[0][5]).toBe("EMPRESA TESTE LTDA");
    expect(r.planilhas[0].linhas[10][3]).toBe("FULANO DE TAL");
  });

  it("recusa o que não é .xls", () => {
    expect(lerXls(new TextEncoder().encode("CPF;AG;CONTA\n".repeat(60)))).toEqual({ ok: false, erro: "O arquivo não é um .xls (Excel 97-2003)." });
  });
});
