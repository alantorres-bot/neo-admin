import { describe, expect, it } from "vitest";
import { anoDoArquivo, ehDocumentoDeTitulo, lerPlanilhaHistorico } from "./historico";

// Aba no formato da planilha anual (valores como o leitor de XLSX entrega: texto; fórmulas pelo resultado).
const aba = (nome: string, mesDeDentro: string, linhas: string[][], rodape: string[][]) => ({
  nome,
  matriz: [
    [], [], [], [],
    ["Comissões - Fernando Grassmann", "", "", "", "Mês de Referência "],
    ["", "", "", "", mesDeDentro, "", "Venda", "0.015"],
    ["", "", "", "", "", "", "Locação", "0.03"],
    ["Nº docto", "REF", "Sacado", "Dt. emissão", "Dt. vencimento", "Vl. total", "Tipo ", "Comissão "],
    ...linhas,
    ["", "", "", "", "", "", "Venda", ""], // linha-modelo vazia
    ["", "", "", "", "", "999999"],        // soma da coluna
    ...rodape,
  ],
});

describe("planilha anual de comissões (histórico)", () => {
  it("ano pelo nome do arquivo e documento de título", () => {
    expect(anoDoArquivo("Comissões Fernando - 2026.xlsx")).toBe(2026);
    expect(anoDoArquivo("comissoes.xlsx")).toBeNull();
    expect(["1001323C", "A1001273D", "000928G", "Z00027A", "AZ00019E"].every(ehDocumentoDeTitulo)).toBe(true);
    expect(["112", "195/25-1-A", "1282026", ""].some(ehDocumentoDeTitulo)).toBe(false);
  });

  it("mês pelo nome da aba; títulos, lançamentos sem título e antecipações; confere o total", () => {
    const r = lerPlanilhaHistorico([
      aba("Setembro", "Agosto", [ // o "Mês de Referência" de dentro veio copiado do mês anterior
        ["1001323C", "156", "CLIENTE ALFA", "05/08/2026", "06/09/2026", "98000", "Venda", "1470"],
        ["1282026", "LOC", "CLIENTE BETA", "30/03/2026", "0/03/2026", "420000", "Locação", "12600"],
        ["", "", "CLIENTE GAMA", "09/09/2026", "09/09/2026", "1830000", "Venda", "27450"],
      ], [
        ["", "TOTAL DO MÊS", "", "", "", "", "", "41520"],
        ["", "ANTECIPAÇÃO COMISSÃO - 12/03/2026", "", "", "", "", "", "10000"],
        ["", "SALDO A PAGAR", "", "", "", "", "", "31520"],
      ]),
      { nome: "Resumo", matriz: [["x"]] }, // aba que não é mês: ignorada
    ], 2026, "Fernando Grassmann");
    expect(r.erros).toEqual([]);
    expect(r.meses).toHaveLength(1);
    const m = r.meses[0];
    expect(m.competencia).toBe("2026-09-01");
    expect(m.total_centavos).toBe(4_152_000);
    expect(m.linhas.map((l) => [l.origem, l.cod_titulo, l.data_pagamento, l.tipo, l.percentual, l.valor_comissao_centavos])).toEqual([
      ["titulo", "1001323C", "2026-09-06", "venda", 1.5, 147_000],
      ["manual", "1282026", "2026-03-30", "locacao", 3, 1_260_000], // vencimento inválido: vale a emissão
      ["manual", null, "2026-09-09", "venda", 1.5, 2_745_000],
      ["antecipacao", null, "2026-03-12", "venda", 0, 1_000_000],
    ]);
    expect(m.linhas[2].observacao).toBe("Sem documento (adiantamento)");
  });

  it("total que não bate e planilha de outro representante: erro, nada é importado", () => {
    const errada = lerPlanilhaHistorico([aba("Julho", "Julho", [["1001295A", "168", "X", "02/07/2026", "03/07/2026", "154000", "Venda", "2310"]],
      [["", "TOTAL DO MÊS", "", "", "", "", "", "9999"]])], 2026, "Fernando Grassmann");
    expect(errada.meses).toEqual([]);
    expect(errada.erros[0]).toMatch(/não bate com o TOTAL DO MÊS/);
    const outro = lerPlanilhaHistorico([aba("Julho", "Julho", [], [])], 2026, "Heitor Selerges");
    expect(outro.erros[0]).toMatch(/não é de Heitor Selerges/);
  });
});
