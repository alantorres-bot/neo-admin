import { describe, expect, it } from "vitest";
import { papelEfetivo, pode, proximasSituacoes } from "./modulo";

describe("papéis (espelho de fis_pode)", () => {
  it("matriz", () => {
    expect(pode("leitor", "lancar")).toBe(false);
    expect(pode("analista", "lancar")).toBe(true);
    expect(pode("analista", "validar")).toBe(false);
    expect(pode("contador", "fechar")).toBe(true);
    expect(pode("contador", "reabrir")).toBe(false);
    expect(pode("revisor", "reabrir")).toBe(true);
    expect(pode("revisor", "parametrizar")).toBe(false);
    expect(pode("administrador", "parametrizar")).toBe(true);
    expect(pode(null, "ler")).toBe(false);
  });
  it("papel efetivo respeita o nível da área", () => {
    expect(papelEfetivo("gestor")).toBe("revisor");
    expect(papelEfetivo("gestor", "contador")).toBe("contador");
    expect(papelEfetivo("operador", "revisor")).toBe("analista");
    expect(papelEfetivo("gestor", "leitor")).toBe("leitor");
    expect(papelEfetivo("sem_acesso", "leitor")).toBeNull();
  });
  it("transmitida só a partir de pronta; transmitida só vai para conferida", () => {
    expect(proximasSituacoes("em_revisao")).not.toContain("transmitida");
    expect(proximasSituacoes("pronta_transmissao")).toContain("transmitida");
    expect(proximasSituacoes("transmitida")).toEqual(["entregue_conferida"]);
    expect(proximasSituacoes("dispensada")).toEqual([]);
  });
});
