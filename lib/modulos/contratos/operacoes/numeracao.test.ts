import { describe, expect, it } from "vitest";
import { conferirNumeroUnico, normalizarNumeroContrato } from "./numeracao";

describe("normalizarNumeroContrato", () => {
  it("número vazio é recusado", () => {
    expect(normalizarNumeroContrato("  ").ok).toBe(false);
    expect(normalizarNumeroContrato(null).ok).toBe(false);
  });
  it("tira os zeros à esquerda de número só com dígitos", () => {
    expect(normalizarNumeroContrato("0137")).toEqual({ ok: true, numero: "0137", normalizado: "137", composto: false });
    expect(normalizarNumeroContrato("000")).toMatchObject({ normalizado: "0" });
  });
  it("número composto fica como digitado e marcado (PENDENTE 8)", () => {
    expect(normalizarNumeroContrato(" 0137/2026 ")).toEqual({ ok: true, numero: "0137/2026", normalizado: "0137/2026", composto: true });
  });
});

describe("conferirNumeroUnico", () => {
  const existentes = [{ id: "c1", empresaId: "e1", numero: "137" }];
  it('"0137" e "137" na mesma empresa são o mesmo número, qualquer que seja o tipo', () => {
    expect(conferirNumeroUnico({ empresaId: "e1", numero: "0137" }, existentes)).toBe("Já existe o contrato 137 nesta empresa.");
  });
  it("o mesmo número em empresas diferentes é aceito", () => {
    expect(conferirNumeroUnico({ empresaId: "e2", numero: "137" }, existentes)).toBeNull();
  });
  it("o próprio contrato não conta como repetido", () => {
    expect(conferirNumeroUnico({ id: "c1", empresaId: "e1", numero: "0137" }, existentes)).toBeNull();
  });
});
