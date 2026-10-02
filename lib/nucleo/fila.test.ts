import { describe, expect, it } from "vitest";
import { descreverPrazo, diferencaDias, estaAtrasada, formatarData, hojeEmCuiaba, ordenarFila } from "./fila";
import type { Criticidade } from "./tipos";

describe("hojeEmCuiaba", () => {
  it("usa o fuso de Cuiabá (UTC-4): 01h UTC ainda é o dia anterior", () => {
    expect(hojeEmCuiaba(new Date("2026-10-02T01:00:00Z"))).toBe("2026-10-01");
    expect(hojeEmCuiaba(new Date("2026-10-02T04:00:00Z"))).toBe("2026-10-02");
    expect(hojeEmCuiaba(new Date("2026-10-02T15:30:00Z"))).toBe("2026-10-02");
  });
});

describe("datas e prazos", () => {
  it("diferença em dias, inclusive na virada de mês e ano", () => {
    expect(diferencaDias("2026-10-05", "2026-10-02")).toBe(3);
    expect(diferencaDias("2026-10-01", "2026-10-02")).toBe(-1);
    expect(diferencaDias("2027-01-01", "2026-12-31")).toBe(1);
    expect(diferencaDias("2026-03-01", "2026-02-28")).toBe(1);
  });

  it("formata dd/mm/aaaa", () => {
    expect(formatarData("2026-10-02")).toBe("02/10/2026");
    expect(formatarData("2026-10-02T10:00:00Z")).toBe("02/10/2026");
    expect(formatarData(null)).toBe("");
  });

  it("descreve o prazo em português", () => {
    const hoje = "2026-10-02";
    expect(descreverPrazo(null, hoje)).toBe("Sem prazo");
    expect(descreverPrazo("2026-10-01", hoje)).toBe("Atrasada há 1 dia");
    expect(descreverPrazo("2026-09-27", hoje)).toBe("Atrasada há 5 dias");
    expect(descreverPrazo("2026-10-02", hoje)).toBe("Vence hoje");
    expect(descreverPrazo("2026-10-03", hoje)).toBe("Vence amanhã");
    expect(descreverPrazo("2026-10-10", hoje)).toBe("Vence em 8 dias (10/10/2026)");
  });

  it("atrasada é só o que venceu antes de hoje", () => {
    expect(estaAtrasada("2026-10-01", "2026-10-02")).toBe(true);
    expect(estaAtrasada("2026-10-02", "2026-10-02")).toBe(false);
    expect(estaAtrasada(null, "2026-10-02")).toBe(false);
  });
});

describe("ordenarFila", () => {
  const hoje = "2026-10-02";
  const item = (id: string, prazo: string | null, criticidade: Criticidade = "normal", criado_em = "2026-09-01T00:00:00Z") => ({
    id, prazo, criticidade, criado_em,
  });

  it("atrasadas primeiro, depois por prazo; sem prazo por último", () => {
    const ordem = ordenarFila(
      [item("sem-prazo", null), item("amanha", "2026-10-03"), item("hoje", "2026-10-02"), item("atrasada-2d", "2026-09-30"), item("atrasada-1d", "2026-10-01")],
      hoje,
    ).map((i) => i.id);
    expect(ordem).toEqual(["atrasada-2d", "atrasada-1d", "hoje", "amanha", "sem-prazo"]);
  });

  it("no mesmo prazo, a criticidade desempata (crítica, alta, normal)", () => {
    const ordem = ordenarFila(
      [item("normal", "2026-10-05", "normal"), item("critica", "2026-10-05", "critica"), item("alta", "2026-10-05", "alta")],
      hoje,
    ).map((i) => i.id);
    expect(ordem).toEqual(["critica", "alta", "normal"]);
  });

  it("sem prazo, ordena por criticidade e depois pela criação mais antiga", () => {
    const ordem = ordenarFila(
      [item("b", null, "alta", "2026-09-10T00:00:00Z"), item("a", null, "alta", "2026-09-01T00:00:00Z"), item("c", null, "critica", "2026-09-20T00:00:00Z")],
      hoje,
    ).map((i) => i.id);
    expect(ordem).toEqual(["c", "a", "b"]);
  });

  it("não altera a lista original", () => {
    const original = [item("2", "2026-10-05"), item("1", "2026-10-01")];
    ordenarFila(original, hoje);
    expect(original.map((i) => i.id)).toEqual(["2", "1"]);
  });
});
