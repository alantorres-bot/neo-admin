import { describe, expect, it } from "vitest";
import { divergencias, lerTarifa, normalizarAgencia, normalizarCodFornecedor, normalizarConta, normalizarCpf } from "./cadastro";

describe("cadastro do vale-transporte", () => {
  it("agência e conta no formato da planilha (X maiúsculo, sem espaços); vazio vira nulo", () => {
    expect(normalizarAgencia(" 2764-2 ")).toEqual({ ok: true, valor: "2764-2" });
    expect(normalizarConta("99149-x")).toEqual({ ok: true, valor: "99149-X" });
    expect(normalizarConta("1648187")).toEqual({ ok: true, valor: "1648187" });
    expect(normalizarConta("")).toEqual({ ok: true, valor: null });
    expect(normalizarAgencia("27A4-2").ok).toBe(false);
    expect(normalizarConta("99149-77").ok).toBe(false);
  });

  it("CPF: confere dígitos e grava com máscara", () => {
    expect(normalizarCpf("11144477735")).toEqual({ ok: true, valor: "111.444.777-35" });
    expect(normalizarCpf("111444777-35")).toEqual({ ok: true, valor: "111.444.777-35" });
    expect(normalizarCpf("111.444.777-36")).toEqual({ ok: false, erro: "CPF inválido." });
    expect(normalizarCpf(null)).toEqual({ ok: true, valor: null });
  });

  it("código de fornecedor sem zeros à esquerda", () => {
    expect(normalizarCodFornecedor("0660")).toEqual({ ok: true, valor: "660" });
    expect(normalizarCodFornecedor("0").ok).toBe(false);
    expect(normalizarCodFornecedor("66a").ok).toBe(false);
  });

  it("tarifa em reais com vírgula", () => {
    expect(lerTarifa("4,95")).toBe(4.95);
    expect(lerTarifa("R$ 5,95")).toBe(5.95);
    expect(lerTarifa("8")).toBe(8);
    expect(lerTarifa("0")).toBeNull();
    expect(lerTarifa("4,955")).toBeNull();
  });

  it("divergências com o Consistem: nome sem acento/caixa, CPF por dígitos, fornecedor inativo", () => {
    const aqui = { cod_fornecedor: "695", nome: "JEAN VAUDREIL PIERRI", cpf: "111.444.777-35" };
    expect(divergencias(aqui, { codFornecedor: "695", nome: "Jean  Vaudreil Pierri", cpf: "11144477735", ativo: true })).toEqual([]);
    expect(divergencias({ ...aqui, nome: "JOÃO" }, { codFornecedor: "695", nome: "JOAO", cpf: "111.444.777-35", ativo: true })).toEqual([]);
    expect(divergencias(aqui, { codFornecedor: "695", nome: "JEAN VAUDREUIL PIERRE", cpf: null, ativo: false })).toEqual([
      { campo: "nome", aqui: "JEAN VAUDREIL PIERRI", consistem: "JEAN VAUDREUIL PIERRE" },
      { campo: "cpf", aqui: "111.444.777-35", consistem: "—" },
      { campo: "situacao", aqui: "ativo", consistem: "inativo" },
    ]);
  });
});
