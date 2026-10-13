import { describe, expect, it } from "vitest";
import { bloqueioDoFechamento, cicloDaCompetencia, competenciaDoVencimento, competenciasAte, rotuloCompetencia, somarMeses } from "./ciclos";

describe("calendário do ciclo (igual ao SQL crt_calendario)", () => {
  it("Sicredi PF fecha 26 do mês anterior e vence 10; Inter PJ fecha 3 e vence 10 no mesmo mês", () => {
    expect(cicloDaCompetencia({ diaFechamento: 26, diaVencimento: 10 }, "2026-10-01")).toEqual({ vencimento: "2026-10-10", fechamento: "2026-09-26" });
    expect(cicloDaCompetencia({ diaFechamento: 3, diaVencimento: 10 }, "2026-10-01")).toEqual({ vencimento: "2026-10-10", fechamento: "2026-10-03" });
  });
  it("vira o ano e respeita meses curtos", () => {
    expect(cicloDaCompetencia({ diaFechamento: 26, diaVencimento: 10 }, "2027-01-01").fechamento).toBe("2026-12-26");
    expect(cicloDaCompetencia({ diaFechamento: 31, diaVencimento: 28 }, "2027-03-01")).toEqual({ vencimento: "2027-03-28", fechamento: "2027-02-28" });
  });
});

describe("competência do vencimento efetivo", () => {
  it("vencimento deslocado para o dia útil volta à competência certa", () => {
    expect(competenciaDoVencimento(10, "2026-10-13")).toBe("2026-10-01");
    expect(competenciaDoVencimento(30, "2026-11-02")).toBe("2026-10-01");
    expect(competenciaDoVencimento(1, "2026-11-01")).toBe("2026-11-01");
  });
});

describe("apoio de tela", () => {
  it("competências recentes, rótulo e bloqueio do fechamento", () => {
    expect(competenciasAte("2026-10-12", 3)).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(competenciasAte("2026-01-05", 2)).toEqual(["2025-12-01", "2026-01-01"]);
    expect(rotuloCompetencia("2026-10-01")).toBe("10/2026");
    expect(somarMeses("2026-10-01", 6)).toBe("2027-04-01");
    expect(somarMeses("2026-02-01", -6)).toBe("2025-08-01");
    expect(bloqueioDoFechamento({ itensALancar: 3, residuoCentavos: 0 })).toMatch(/3 itens/);
    expect(bloqueioDoFechamento({ itensALancar: 0, residuoCentavos: 3 })).toMatch(/zero/);
    expect(bloqueioDoFechamento({ itensALancar: 0, residuoCentavos: 0 })).toBeNull();
  });
});

describe("cor do mês na grade", () => {
  it("paga verde, aguardando amarelo, atrasada vermelha (vencimento no fim de semana vale a segunda)", async () => {
    const { classeDoCiclo, estaAtrasado, vencimentoEmDiaUtil, CLASSE_ATRASADA } = await import("./ciclos");
    expect(vencimentoEmDiaUtil("2026-10-10")).toBe("2026-10-12");   // sábado → segunda
    expect(vencimentoEmDiaUtil("2026-10-11")).toBe("2026-10-12");   // domingo → segunda
    expect(vencimentoEmDiaUtil("2026-10-13")).toBe("2026-10-13");
    const aguardando = { situacao: "aguardando_fatura" as const, vencimento_nominal: "2026-10-10" };
    expect(estaAtrasado(aguardando, "2026-10-12")).toBe(false);
    expect(estaAtrasado(aguardando, "2026-10-13")).toBe(true);
    expect(classeDoCiclo(aguardando, "2026-10-01")).toMatch(/amber/);
    expect(classeDoCiclo(aguardando, "2026-10-13")).toBe(CLASSE_ATRASADA);
    expect(classeDoCiclo({ situacao: "paga", vencimento_nominal: "2026-10-10" }, "2026-12-01")).toMatch(/emerald/);
    expect(estaAtrasado({ situacao: "fechada", vencimento_nominal: "2026-10-28" }, "2026-10-29")).toBe(true);
  });
});
