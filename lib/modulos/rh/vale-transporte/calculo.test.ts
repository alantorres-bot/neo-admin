import { describe, expect, it } from "vitest";
import { calcularItem, type EntradaCalculo } from "./calculo";
import { diasUteisDoMes, diasUteisDoPeriodoNoMes, enesimoDiaUtil, pagamentoDaFolha, prazosDaCompetencia, rotuloMes, somarMeses, ultimoDiaUtil } from "@/lib/modulos/rh/calendario";

const base: EntradaCalculo = {
  competencia: "2026-11-01", dias_uteis: 21, faltas: 0, atestados: 0, extras: 0, ferias_inicio: null, ferias_fim: null,
  afastamento_inicio: null, afastamento_fim: null, abat_dias: 0, abat_valor: 0, sem_vt: false, tarifa: 4.95, valor_fixo: null, passagens_dia: 2,
};
const calc = (m: Partial<EntradaCalculo>) => calcularItem({ ...base, ...m });

describe("calendário do VT", () => {
  it("novembro/2026: 21 dias úteis; pago em 30/10 (último dia útil de outubro); fechamento em 28/10", () => {
    expect(diasUteisDoMes("2026-11-01")).toBe(21);
    expect(ultimoDiaUtil("2026-10-01")).toBe("2026-10-30");
    expect(prazosDaCompetencia("2026-11-01")).toEqual({ pagamento: "2026-10-30", fechamento: "2026-10-28" });
  });
  it("último dia útil numa segunda: fechamento na quinta anterior", () => {
    // agosto/2026 termina na segunda 31/08 → VT de setembro
    expect(prazosDaCompetencia("2026-09-01")).toEqual({ pagamento: "2026-08-31", fechamento: "2026-08-27" });
  });
  it("período dentro do mês conta só seg–sex do mês", () => {
    expect(diasUteisDoPeriodoNoMes("2026-11-10", "2026-11-20", "2026-11-01")).toBe(9);
    expect(diasUteisDoPeriodoNoMes("2026-10-20", "2026-11-04", "2026-11-01")).toBe(3);
    expect(diasUteisDoPeriodoNoMes("2026-12-01", "2026-12-20", "2026-11-01")).toBe(0);
    expect(diasUteisDoPeriodoNoMes("2026-11-10", null, "2026-11-01")).toBe(0);
  });
  it("folha: 5º dia útil do mês seguinte", () => {
    expect(enesimoDiaUtil("2026-10-01", 5)).toBe("2026-10-07");
    expect(pagamentoDaFolha("2026-09-01")).toBe("2026-10-07");
    expect(pagamentoDaFolha("2026-12-01")).toBe("2027-01-07");
  });
  it("rótulos e virada de ano", () => {
    expect(rotuloMes("2026-11-01")).toBe("novembro/2026");
    expect(somarMeses("2026-01-01", -1)).toBe("2025-12-01");
  });
});

describe("cálculo do VT", () => {
  it("exemplos da planilha", () => {
    expect(calc({}).valor).toBe(207.9);
    expect(calc({ dias_uteis: 19, extras: 1 }).valor).toBe(198);
    expect(calc({ tarifa: 8 }).valor).toBe(336);
    expect(calc({ tarifa: 5.95 }).valor).toBe(249.9);
  });
  it("falta e atestado descontam igual", () => {
    expect(calc({ faltas: 1, atestados: 1 })).toMatchObject({ dias_pagos: 19, valor: 188.1 });
  });
  it("férias por período descontam os dias úteis do mês do VT", () => {
    expect(calc({ ferias_inicio: "2026-11-10", ferias_fim: "2026-11-20" })).toEqual({ dias_ferias: 9, dias_afastamento: 0, dias_pagos: 12, valor: 118.8 });
  });
  it("afastamento e abatimento em dias também descontam; nunca negativo", () => {
    expect(calc({ afastamento_inicio: "2026-11-23", afastamento_fim: "2026-11-30", abat_dias: 1 })).toMatchObject({ dias_afastamento: 6, dias_pagos: 14 });
    expect(calc({ faltas: 30 })).toMatchObject({ dias_pagos: 0, valor: 0 });
  });
  it("abatimento em R$ sai do valor; nunca negativo", () => {
    expect(calc({ abat_valor: 50 }).valor).toBe(157.9);
    expect(calc({ abat_valor: 500 }).valor).toBe(0);
  });
  it("valor fixo é proporcional aos dias pagos", () => {
    expect(calc({ tarifa: null, valor_fixo: 800 }).valor).toBe(800);
    expect(calc({ tarifa: null, valor_fixo: 800, faltas: 2 }).valor).toBe(723.81);
    expect(calc({ tarifa: null, valor_fixo: 800, faltas: 2, abat_valor: 23.81 }).valor).toBe(700);
  });
  it("sem VT no mês zera", () => {
    expect(calc({ sem_vt: true })).toMatchObject({ dias_pagos: 0, valor: 0 });
  });
});
