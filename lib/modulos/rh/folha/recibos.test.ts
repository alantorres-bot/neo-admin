import { describe, expect, it } from "vitest";
import { calcularRecibo, dividirPorMes, linhasDeDias, mensagemDoPeriodo, parametrosVigentes, type Rubrica, type Vigencia } from "./recibos";

const R = (codigo: string, forma: Rubrica["forma"], extra: Partial<Rubrica> = {}): Rubrica =>
  ({ codigo, descricao: codigo.toUpperCase(), natureza: "provento", forma, parametro: null, pct_campo: null, ...extra });
const CATALOGO = new Map<string, Rubrica>([
  R("dias_normais", "dias"), R("salario_ferias", "dias"), R("horas_normais", "horas"), R("salario_por_fora", "dias"),
  R("assiduidade", "mensal_proporcional", { parametro: "assiduidade_mensal" }),
  R("insalubridade", "pct_base_dias", { parametro: "salario_minimo", pct_campo: "insalubridade_pct", descricao: "INSALUBRIDADE" }),
  R("adicional_noturno", "pct_salario_dias", { pct_campo: "adicional_noturno_pct", descricao: "ADICIONAL NOTURNO" }),
  R("terco_ferias", "fracao_salario"), R("reembolso_irrf", "valor"), R("desconto_lote", "valor", { natureza: "desconto" }),
].map((r) => [r.codigo, r]));
const VIG: Vigencia[] = [
  { chave: "assiduidade_mensal", valor: 120, vigente_desde: "2026-01-01" }, { chave: "assiduidade_mensal", valor: 185, vigente_desde: "2026-06-01" },
  { chave: "salario_minimo", valor: 1621, vigente_desde: "2026-01-01" },
];
const set = parametrosVigentes(VIG, "2026-09-01");

describe("recibos avulsos: cálculo", () => {
  it("parâmetro vigente na competência (assiduidade 120 até maio, 185 desde junho)", () => {
    expect(parametrosVigentes(VIG, "2026-05-01")).toEqual({ assiduidade_mensal: 120, salario_minimo: 1621 });
    expect(set).toEqual({ assiduidade_mensal: 185, salario_minimo: 1621 });
  });

  it("compra de férias com insalubridade (Rubens, 20 dias): dias + assiduidade + insalubridade 20% do mínimo", () => {
    const p = { salario: 3141.78, insalubridade_pct: 20, adicional_noturno_pct: 0 };
    const r = calcularRecibo(linhasDeDias("compra_ferias", 20, p, CATALOGO), p, set);
    expect(r.linhas.map((l) => [l.rubrica, l.descricao, l.centavos])).toEqual([
      ["salario_ferias", "SALARIO_FERIAS", 209452], ["assiduidade", "ASSIDUIDADE", 12333], ["insalubridade", "INSALUBRIDADE (20%)", 21613],
    ]);
    expect(r.liquido).toBe(243398);
  });

  it("compra de férias com adicional noturno (Joanilson, 15 dias)", () => {
    const p = { salario: 2709.63, insalubridade_pct: 0, adicional_noturno_pct: 20 };
    const r = calcularRecibo(linhasDeDias("compra_ferias", 15, p, CATALOGO), p, set);
    expect(r.linhas.map((l) => l.centavos)).toEqual([135482, 9250, 27096]);
  });

  it("recorrentes: horas normais 220 = salário; salário por fora 30 dias; valor digitado; desconto; 1/3", () => {
    const bento = { salario: 3549.75, insalubridade_pct: 0, adicional_noturno_pct: 0 };
    expect(calcularRecibo([{ rubrica: CATALOGO.get("horas_normais")!, referencia: 220 }, { rubrica: CATALOGO.get("assiduidade")!, referencia: 30 }], bento, set).liquido).toBe(373475);
    const alan = { salario: 4749.27, insalubridade_pct: 0, adicional_noturno_pct: 0 };
    expect(calcularRecibo([{ rubrica: CATALOGO.get("salario_por_fora")!, referencia: 30 }], alan, set).liquido).toBe(474927);
    expect(calcularRecibo([{ rubrica: CATALOGO.get("terco_ferias")!, referencia: 1 / 3 }], { ...alan, salario: 4417.93 }, set).liquido).toBe(147264);
    const r = calcularRecibo([{ rubrica: CATALOGO.get("reembolso_irrf")!, referencia: 1, valor: 781.29 }, { rubrica: CATALOGO.get("desconto_lote")!, referencia: 1, valor: 675.43 }], bento, set);
    expect([r.proventos, r.descontos, r.liquido]).toEqual([78129, 67543, 10586]);
  });

  it("período dividido por mês (dias corridos)", () => {
    expect(dividirPorMes("2026-07-20", "2026-08-08")).toEqual([
      { competencia: "2026-07-01", inicio: "2026-07-20", fim: "2026-07-31", dias: 12 }, { competencia: "2026-08-01", inicio: "2026-08-01", fim: "2026-08-08", dias: 8 },
    ]);
    expect(dividirPorMes("2026-09-08", "2026-09-14")).toEqual([{ competencia: "2026-09-01", inicio: "2026-09-08", fim: "2026-09-14", dias: 7 }]);
    expect(dividirPorMes("2026-12-20", "2027-01-08").map((t) => [t.competencia, t.dias])).toEqual([["2026-12-01", 12], ["2027-01-01", 8]]);
    expect(dividirPorMes("2026-09-10", "2026-09-01")).toEqual([]);
  });

  it("mensagens", () => {
    expect(mensagemDoPeriodo("compra_ferias", "2026-07-20", "2026-07-31", { inicio: "2026-07-20", fim: "2026-08-08" })).toBe("Férias de 20/07/2026 a 08/08/2026 — neste recibo, 20/07/2026 a 31/07/2026");
    expect(mensagemDoPeriodo("inicio_antes_registro", "2026-09-08", "2026-09-14")).toBe("Trabalho de 08/09/2026 a 14/09/2026, antes do registro");
  });
});
