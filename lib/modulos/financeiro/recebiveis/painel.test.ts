import { describe, expect, it } from "vitest";
import { formatarCurto, formatarPercentual, montarPainel, segundaDaSemana, somarRecebido, type LinhaPainel } from "./painel";

const t = (contraparte: string, faixa: string, vencimento: string, valor: number, extra: Partial<LinhaPainel> = {}): LinhaPainel =>
  ({ contraparte_id: contraparte, faixa, vencimento, valor, valor_atualizado: valor, cedido: false, dias_atraso: 0, unidade: "matriz", ...extra });

describe("segundaDaSemana", () => {
  it("semana de segunda a domingo", () => {
    expect(segundaDaSemana("2026-10-15")).toBe("2026-10-12"); // quinta
    expect(segundaDaSemana("2026-10-12")).toBe("2026-10-12"); // segunda
    expect(segundaDaSemana("2026-10-18")).toBe("2026-10-12"); // domingo
  });
});

describe("montarPainel", () => {
  const linhas = [
    t("a", "a_vencer", "2026-10-16", 100, { cedido: true }),
    t("b", "a_vencer", "2026-10-20", 200),
    t("b", "a_vencer", "2026-10-25", 50, { cedido: true }),
    t("c", "a_vencer", "2026-12-30", 999), // fora das 8 semanas
    t("a", "01_15", "2026-10-10", 300, { cedido: true, dias_atraso: 5 }),
    t("d", "60_mais", "2026-01-10", 1000, { dias_atraso: 278 }),
    t("d", "16_30", "2026-09-20", 400, { dias_atraso: 25 }),
    t("x", "encerrado", "2026-09-01", 5000),
  ];
  const p = montarPainel(linhas, "2026-10-15");

  it("totais e aging como a Carteira, com o cedido por faixa", () => {
    expect(p.resumo.totalCentavos).toBe(304_900);
    expect(p.resumo.vencido.centavos).toBe(170_000);
    expect(p.cedidoPorFaixa).toEqual({ a_vencer: 15_000, "01_15": 30_000, "16_30": 0, "31_60": 0, "60_mais": 0 });
    expect(p.mais60Centavos).toBe(100_000);
    expect(p.inadimplencia).toBeCloseTo(170_000 / 304_900);
  });

  it("previsão semanal separa caixa da Neo e AKF; fora da janela não entra", () => {
    expect(p.previsao).toHaveLength(8);
    expect(p.previsao[0]).toEqual({ inicio: "2026-10-12", fim: "2026-10-18", quantidade: 1, neoCentavos: 0, akfCentavos: 10_000 });
    expect(p.previsao[1]).toEqual({ inicio: "2026-10-19", fim: "2026-10-25", quantidade: 2, neoCentavos: 20_000, akfCentavos: 5_000 });
    expect(p.previsao.reduce((s, x) => s + x.quantidade, 0)).toBe(3);
    expect(p.previsao[7].fim).toBe("2026-12-06");
  });

  it("maiores devedores pelo vencido, com maior atraso e selo AKF", () => {
    expect(p.devedores).toEqual([
      { contraparteId: "d", quantidade: 2, maiorAtraso: 278, centavos: 140_000, cedido: false },
      { contraparteId: "a", quantidade: 1, maiorAtraso: 5, centavos: 30_000, cedido: true },
    ]);
    expect(montarPainel(linhas, "2026-10-15", { devedores: 1 }).devedores).toHaveLength(1);
  });

  it("carteira vazia", () => {
    const vazio = montarPainel([], "2026-10-15");
    expect(vazio.inadimplencia).toBeNull();
    expect(vazio.devedores).toEqual([]);
  });
});

describe("somarRecebido e formatos", () => {
  it("conta o pago desde a data, pelo valor pago (ou o do título)", () => {
    expect(somarRecebido([
      { consistem_pago_em: "2026-10-01", consistem_valor_pago: "150.50", valor: 100 },
      { consistem_pago_em: "2026-09-15T10:00:00Z", consistem_valor_pago: null, valor: 80 },
      { consistem_pago_em: "2026-09-10", consistem_valor_pago: 999, valor: 999 },
      { consistem_pago_em: null, consistem_valor_pago: null, valor: 1 },
    ], "2026-09-15")).toEqual({ quantidade: 2, centavos: 23_050 });
  });
  it("percentual e rótulo curto", () => {
    expect(formatarPercentual(0.53357)).toBe("53,4%");
    expect(formatarPercentual(null)).toBe("—");
    expect(formatarCurto(156_740_833)).toBe("1,57 mi");
    expect(formatarCurto(45_975_582)).toBe("460 mil");
    expect(formatarCurto(0)).toBe("0");
  });
});
