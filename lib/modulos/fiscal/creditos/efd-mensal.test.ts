import { describe, expect, it } from "vitest";
import { apurarContribuicoes, apurarIcmsIpi } from "./efd-mensal";

// Arquivos sintéticos com só os registros lidos (valores fictícios).
const efdIcms = (e110: string, e520 = "|E520|0|0|0|0|0|0|0|") =>
  ["|0000|017|0|01092026|30092026|EMPRESA FICTICIA|11111111000111||MT|", e110, e520].join("\r\n");
// E110: |E110|deb|aj deb|tot aj deb|estorno cred|cred|aj cred|tot aj cred|estorno deb|sld ant|sld apurado|deduções|recolher|transportar|deb esp|
const e110 = (deb: string, cred: string, ant: string, rec: string, transp: string) =>
  `|E110|${deb}|0|0|0|${cred}|0|0|0|${ant}|0|0|${rec}|${transp}|0|`;

describe("EFD ICMS/IPI", () => {
  it("saldo credor que cresce: crédito e dedução até o total dos débitos", () => {
    const a = apurarIcmsIpi(efdIcms(e110("1000,00", "1500,00", "200,00", "0", "700,00")), "ICMS", 20000);
    expect(a.competencia).toBe("2026-09");
    expect(a.movimentos.map((m) => [m.tipo, m.valor])).toEqual([["credito_apurado", 150000], ["utilizacao", 100000]]);
  });

  it("imposto a recolher: usa só o que havia de saldo e crédito", () => {
    const a = apurarIcmsIpi(efdIcms(e110("5000,00", "1000,00", "300,00", "3700,00", "0")), "ICMS", 30000);
    expect(a.movimentos.map((m) => [m.tipo, m.valor])).toEqual([["credito_apurado", 100000], ["utilizacao", 130000]]);
  });

  it("saldo anterior declarado diferente do sistema vira ajuste", () => {
    const a = apurarIcmsIpi(efdIcms(e110("0", "100,00", "250,00", "0", "350,00")), "ICMS", 26000);
    expect(a.movimentos[0]).toMatchObject({ tipo: "ajuste_negativo", valor: 1000 });
  });

  it("EFD incoerente (transportado não fecha) é recusada", () => {
    expect(() => apurarIcmsIpi(efdIcms(e110("0", "100,00", "0", "0", "99,00")), "ICMS", 0)).toThrow(/não|≠/);
  });

  it("IPI pelo E520", () => {
    const a = apurarIcmsIpi(efdIcms(e110("0", "0", "0", "0", "0"), "|E520|1000,00|10,00|200,00|0|0|1190,00|0|"), "IPI", 100000);
    expect(a.movimentos.map((m) => [m.tipo, m.valor])).toEqual([["credito_apurado", 20000], ["utilizacao", 1000]]);
  });
});

describe("EFD-Contribuições", () => {
  // 0000 da EFD-Contribuições: DT_INI no campo 6. 1100: |1100|origem|...|disponível (12)|...|saldo final (18)|
  const r1100 = (origem: string, disp: string, desc: string, fim: string) =>
    `|1100|${origem}|01||101|0|0|0|0|0|0|${disp}|${desc}|0|0|0|0|${fim}|`;
  const efd = (linhas: string[]) => ["|0000|006|0|||01082026|31082026|EMPRESA FICTICIA|11111111000111|MT|", ...linhas].join("\n");

  it("soma as origens: abertura = disponível das origens anteriores; fecha com o saldo final declarado", () => {
    const a = apurarContribuicoes(efd([
      "|M100|101|0|0|0|0|0|452,00|0|0|0|452,00|1|384,00|68,00|",
      "|M200|429,00|384,00|45,00|0|0|0|0|0|0|0|0|0|",
      r1100("072026", "45,00", "45,00", "0"), r1100("082026", "452,00", "384,00", "68,00"),
    ]), "PIS", 11200);
    expect(a.saldoAnteriorDeclarado).toBe(4500);
    expect(a.movimentos.map((m) => [m.tipo, m.valor])).toEqual([["ajuste_negativo", 6700], ["credito_apurado", 45200], ["utilizacao", 42900]]);
    expect(a.saldoFinalDeclarado).toBe(6800);
  });

  it("crédito todo usado no mês (sem linha no 1100)", () => {
    const a = apurarContribuicoes(efd(["|M100|101|0|0|0|0|0|300,00|0|0|0|300,00|1|300,00|0|", "|M200|500,00|300,00|0|0|0|0|0|0|0|0|0|200,00|"]), "PIS", 0);
    expect(a.movimentos.map((m) => [m.tipo, m.valor])).toEqual([["credito_apurado", 30000], ["utilizacao", 30000]]);
  });
});
