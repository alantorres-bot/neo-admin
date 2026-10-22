import { describe, expect, it } from "vitest";
import { agregarPorChave, apurarCredito, consolidadoFechaConta, consolidarExercicio, fechaConta, type MovimentoApuracao } from "./apuracao";

const m = (competencia: string, classe: MovimentoApuracao["classe"], valorAssinado: number, status: MovimentoApuracao["status"] = "efetivo"): MovimentoApuracao =>
  ({ competencia, classe, natureza: valorAssinado >= 0 ? "entrada" : "saida", valorAssinado, status });

describe("apuração de um crédito", () => {
  const movs = [
    m("2025-11-01", "saldo_inicial", 100000),
    m("2025-11-01", "utilizacao", -30000),
    m("2025-12-01", "gerado", 5000),
    m("2025-12-01", "compensacao", -2000),
    { ...m("2025-12-01", "compensacao", 2000), natureza: "saida" as const }, // estorno da compensação: entra na mesma coluna
    m("2026-01-01", "baixa", -1000),
    m("2026-01-01", "utilizacao", -999999, "pendente"),
  ];
  const ap = apurarCredito(movs, "2025-11-01", "2026-02-01");

  it("saldo inicial = saldo final do mês anterior (inclusive na virada do ano)", () => {
    expect(ap.map((l) => [l.competencia, l.saldoInicial, l.saldoFinal])).toEqual([
      ["2025-11-01", 100000, 70000], ["2025-12-01", 70000, 75000], ["2026-01-01", 75000, 74000], ["2026-02-01", 74000, 74000],
    ]);
  });
  it("estorno líquido na coluna do original e pendente fora do saldo", () => {
    expect(ap[1].compensado).toBe(0);
    expect(ap[2].pendentes).toBe(1);
    expect(ap.every(fechaConta)).toBe(true);
  });
  it("implantação aparece no saldo inicial e na coluna própria", () => {
    expect(ap[0].implantado).toBe(100000);
  });
  it("começa só na primeira competência do crédito; anteriores ao início entram no saldo transportado", () => {
    expect(apurarCredito(movs, "2025-01-01", "2025-11-01")).toHaveLength(1);
    expect(apurarCredito(movs, "2026-01-01", "2026-01-01")[0].saldoInicial).toBe(75000);
  });
});

describe("agregação e consolidado", () => {
  it("soma créditos da mesma chave e consolida o exercício fechando a conta", () => {
    const linha = (credito: string, competencia: string, si: number, im: number, g: number, u: number, sf: number) => ({
      credito_id: credito, empresa_id: "e", estabelecimento_id: "est", tributo_id: "t", competencia,
      saldo_inicial: (si / 100).toFixed(2), implantado: (im / 100).toFixed(2), gerado: (g / 100).toFixed(2), reconhecido: "0", ajustes_positivos: "0",
      ajustes_negativos: "0", utilizado: (u / 100).toFixed(2), compensado: "0", baixado: "0", transferido_entrada: "0", transferido_saida: "0",
      saldo_final: (sf / 100).toFixed(2), pendentes: 0,
    });
    const ag = agregarPorChave([
      linha("a", "2025-01-01", 1000, 1000, 500, 200, 1300), linha("a", "2025-02-01", 1300, 0, 0, 300, 1000),
      linha("b", "2025-02-01", 700, 700, 0, 0, 700),
    ]);
    expect(ag).toHaveLength(2);
    expect(ag[1]).toMatchObject({ saldoInicial: 2000, implantado: 700, saldoFinal: 1700, utilizado: 300 });
    const c = consolidarExercicio(ag);
    expect(c).toMatchObject({ saldoInicial: 1000, implantadoNoAno: 700, gerado: 500, utilizado: 500, saldoFinal: 1700 });
    expect(consolidadoFechaConta(c)).toBe(true);
  });
});

import { consolidarPor, totalGeral } from "./consolidado";

describe("consolidado anual", () => {
  const b = (credito: string, tributo: string, competencia: string, si: number, sf: number, g = 0, u = 0, im = 0) => ({
    credito_id: credito, empresa_id: "e", estabelecimento_id: "s", tributo_id: tributo, competencia,
    saldo_inicial: si.toFixed(2), implantado: im.toFixed(2), gerado: g.toFixed(2), reconhecido: "0", ajustes_positivos: "0", ajustes_negativos: "0",
    utilizado: u.toFixed(2), compensado: "0", baixado: "0", transferido_entrada: "0", transferido_saida: "0", saldo_final: sf.toFixed(2), pendentes: 0,
  });
  it("janeiro começa no saldo de dezembro anterior; crédito que nasce no meio do ano não distorce o inicial", () => {
    const g = consolidarPor([
      b("a", "ICMS", "2025-12-01", 100, 120, 20), b("a", "ICMS", "2026-01-01", 120, 110, 0, 10), b("a", "ICMS", "2026-02-01", 110, 110),
      b("b", "ICMS", "2026-02-01", 50, 50, 0, 0, 50),
    ], 2026, (l) => l.tributo_id);
    expect(g).toHaveLength(1);
    expect(g[0].transportadoDoAnterior).toBe(12000);
    expect(g[0].atual).toMatchObject({ saldoInicial: 12000, implantadoNoAno: 5000, utilizado: 1000, saldoFinal: 16000 });
    expect(g[0].anterior).toMatchObject({ saldoFinal: 12000 });
    expect(totalGeral(g, "atual")?.saldoFinal).toBe(16000);
  });
});
