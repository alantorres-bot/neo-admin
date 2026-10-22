import { describe, expect, it } from "vitest";
import { mapearAutomatico, modelo, prepararLinhas } from "./importacao";

describe("importação: mapeamento e normalização", () => {
  it("mapeia pelos títulos do modelo e por sinônimos", () => {
    const m = mapearAutomatico("movimentos", ["Código do crédito", "TIPO", "Competência", "Data", "Valor", "Histórico", "PER/DCOMP"]);
    expect(m).toMatchObject({ codigo_credito: 0, tipo: 1, competencia: 2, data: 3, valor: 4, descricao: 5, protocolo: 6, processo: null });
    const cab = modelo("creditos").cabecalho;
    expect(Object.values(mapearAutomatico("creditos", cab)).every((v) => v !== null)).toBe(true);
  });
  it("normaliza formatos brasileiros e acusa erros por linha", () => {
    const mapa = mapearAutomatico("movimentos", ["Código do crédito", "Tipo", "Competência", "Data", "Valor", "Descrição"]);
    const r = prepararLinhas("movimentos", [
      ["CR-2025-00001", "utilizacao", "02/2025", "20/02/2025", "1.000,50", "Dedução"],
      ["", "", "", "", "", ""],
      ["CR-2025-00001", "utilizacao", "13/2025", "31/02/2025", "10,001", "x"],
      ["CR-2025-00001", "compensacao", new Date("2025-03-01T00:00:00Z"), new Date("2025-03-10T00:00:00Z"), 99.9, "Compensação"],
    ], mapa);
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ linha: 2, erros: [], dados: expect.objectContaining({ competencia: "2025-02-01", data: "2025-02-20", valor: "1000.50" }) });
    expect(r[1].linha).toBe(4);
    expect(r[1].erros).toHaveLength(4);
    expect(r[2].dados).toMatchObject({ competencia: "2025-03-01", data: "2025-03-10", valor: "99.90" });
  });
});
