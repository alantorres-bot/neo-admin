import { describe, expect, it } from "vitest";
import { avisosDoPedido, ESQUEMAS, linhasDoPedido } from "./modulo";

describe("Portal do Líder: formulário", () => {
  it("valida cada tipo", () => {
    expect(ESQUEMAS.ferias.safeParse({ inicio: "2026-12-01", dias: "30", abono: false }).success).toBe(true);
    expect(ESQUEMAS.ferias.safeParse({ inicio: "2026-12-01", dias: 31, abono: false }).success).toBe(false);
    expect(ESQUEMAS.atestado.safeParse({ inicio: "2026-11-05", fim: "2026-11-04" }).success).toBe(false);
    expect(ESQUEMAS.desligamento.safeParse({ iniciativa: "empresa", aviso: "outro", data: "2026-11-10", motivo: "Baixo desempenho" }).success).toBe(false);
    const c = ESQUEMAS.contratacao.parse({ nome: " Willyam ", cargo: "Projetista Júnior", salario: "5000", beneficios: "", data_prevista: "2026-12-01" });
    expect(c).toMatchObject({ nome: "Willyam", salario: 5000, beneficios: undefined });
  });

  it("avisa antecedência de férias e vigência fora do dia 1º", () => {
    expect(avisosDoPedido("ferias", { inicio: "2026-12-03" }, "2026-11-04")).toHaveLength(1);
    expect(avisosDoPedido("ferias", { inicio: "2026-12-04" }, "2026-11-04")).toEqual([]);
    expect(avisosDoPedido("funcao", { vigencia: "2026-11-15" }, "2026-11-04")[0]).toMatch(/meio do mês/);
    expect(avisosDoPedido("funcao", { vigencia: "2026-12-01" }, "2026-11-04")).toEqual([]);
    expect(avisosDoPedido("atestado", { inicio: "2026-11-03" }, "2026-11-04")[0]).toMatch(/passado/);
  });

  it("mostra o pedido em linhas", () => {
    expect(linhasDoPedido("ferias", { inicio: "2026-12-01", dias: 20, abono: true })).toContainEqual(["Vende 10 dias", "Sim"]);
    expect(linhasDoPedido("desligamento", { iniciativa: "empresa", aviso: "dispensado", data: "2026-11-10", motivo: "x" })[1])
      .toEqual(["Aviso prévio", "dispensado do cumprimento"]);
  });
});
