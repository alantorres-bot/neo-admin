import { describe, expect, it } from "vitest";
import { diasAtraso, emCentavos, pedidoAberto, previsaoFaturamento, rotuloSituacao, situacaoParcela } from "./carteira";

const hoje = "2026-10-21"; // quarta-feira
const p = (data_prev_fat: string | null, valor_saldo = 100, situacao = "2") => ({ situacao, valor_saldo, data_prev_fat });

describe("carteira", () => {
  it("rótulo da situação", () => {
    expect(rotuloSituacao("5")).toBe("Faturado parcial");
    expect(rotuloSituacao("X")).toBe("Situação X");
  });
  it("pedido aberto: saldo e não cancelado nem faturado total", () => {
    expect(pedidoAberto(p("2026-10-01"))).toBe(true);
    expect(pedidoAberto(p("2026-10-01", 0))).toBe(false);
    expect(pedidoAberto(p("2026-10-01", 100, "9"))).toBe(false);
    expect(pedidoAberto(p("2026-10-01", 100, "6"))).toBe(false);
  });
  it("dias de atraso", () => {
    expect(diasAtraso(p("2026-10-11"), hoje)).toBe(10);
    expect(diasAtraso(p(hoje), hoje)).toBe(0);
    expect(diasAtraso(p("2026-10-11", 0), hoje)).toBe(0);
  });
  it("emCentavos", () => {
    expect(emCentavos(1234.565)).toBe(123457);
    expect(emCentavos("10.1")).toBe(1010);
    expect(emCentavos(null)).toBe(0);
  });
});

describe("previsão de faturamento", () => {
  it("separa atrasados, semanas (segunda a domingo), meses e sem previsão", () => {
    const r = previsaoFaturamento([
      p("2026-10-20", 50),            // ontem: atrasado
      p("2026-10-21", 100),           // hoje: esta semana
      p("2026-10-25", 10),            // domingo: esta semana
      p("2026-10-26", 20),            // segunda: 2ª faixa
      p("2026-12-15", 30),            // depois das semanas: dez/2026
      p("2027-01-02", 40),            // jan/2027
      p(null, 5),                     // sem previsão
      p("2026-10-22", 999, "9"),      // cancelado: fora
      p("2026-10-22", 0, "5"),        // sem saldo: fora
    ], hoje, 2);
    expect(r.atrasados).toMatchObject({ pedidos: 1, saldoCentavos: 5000 });
    expect(r.semanas.map((s) => [s.rotulo, s.inicio, s.fim, s.pedidos, s.saldoCentavos])).toEqual([
      ["Esta semana", "2026-10-21", "2026-10-25", 2, 11000],
      ["26/10 a 01/11", "2026-10-26", "2026-11-01", 1, 2000],
    ]);
    expect(r.meses.map((m) => [m.rotulo, m.pedidos, m.saldoCentavos])).toEqual([["dez/2026", 1, 3000], ["jan/2027", 1, 4000]]);
    expect(r.semPrevisao).toMatchObject({ pedidos: 1, saldoCentavos: 500 });
    expect(r.total).toEqual({ pedidos: 7, saldoCentavos: 25500 });
  });
  it("domingo: a semana corrente é só o próprio dia", () => {
    const r = previsaoFaturamento([p("2026-10-25"), p("2026-10-26")], "2026-10-25", 2);
    expect(r.semanas[0]).toMatchObject({ inicio: "2026-10-25", fim: "2026-10-25", pedidos: 1 });
    expect(r.semanas[1]).toMatchObject({ inicio: "2026-10-26", fim: "2026-11-01", pedidos: 1 });
  });
});

describe("parcela da NF", () => {
  it("paga, vencida ou a vencer", () => {
    expect(situacaoParcela({ data_vencimento: "2026-10-01", data_pagamento: "2026-10-02" }, hoje)).toBe("paga");
    expect(situacaoParcela({ data_vencimento: "2026-10-01", data_pagamento: null }, hoje)).toBe("vencida");
    expect(situacaoParcela({ data_vencimento: hoje, data_pagamento: null }, hoje)).toBe("a_vencer");
  });
});
