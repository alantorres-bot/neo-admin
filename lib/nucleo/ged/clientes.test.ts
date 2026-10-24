import { describe, expect, it } from "vitest";
import { cnpjsNoTexto, normalizarNomeCliente, sugerirCliente } from "../../../supabase/functions/_shared/ged";

// Dados fictícios. 11.222.333/0001-81 é um CNPJ de exemplo com dígitos válidos.
const CNPJ = "11.222.333/0001-81";

describe("normalizarNomeCliente", () => {
  it("acentos, caixa, sufixo de ano e termos societários", () => {
    expect(normalizarNomeCliente("Construções Áurea S/A - 2026")).toBe("aurea");
    expect(normalizarNomeCliente("Exemplo Ltda.")).toBe("exemplo");
  });
  it("a pasta e a razão social chegam ao mesmo núcleo", () => {
    expect(normalizarNomeCliente("Construtora Exemplo Alfa - 2026")).toBe(
      normalizarNomeCliente("CONSTRUTORA EXEMPLO ALFA ENGENHARIA E CONSTRUCOES LTDA"),
    );
  });
});

describe("cnpjsNoTexto", () => {
  it("acha CNPJ válido com ou sem máscara e ignora inválido", () => {
    expect(cnpjsNoTexto(`Cartão de CNPJ ${CNPJ}.pdf`)).toEqual(["11222333000181"]);
    expect(cnpjsNoTexto("doc 11222333000181")).toEqual(["11222333000181"]);
    expect(cnpjsNoTexto("doc 11.222.333/0001-80")).toEqual([]);
  });
});

describe("sugerirCliente", () => {
  const clientes = [
    { id: "a", nome: "Exemplo Alfa Engenharia Ltda", documento: CNPJ },
    { id: "b", nome: "Exemplo Alfa Beta Construtora", documento: null },
    { id: "c", nome: "Outra Empresa Qualquer", documento: null },
  ];

  it("CNPJ válido no nome do arquivo dá nota máxima, com motivo", () => {
    const s = sugerirCliente("Pasta sem nome útil", [`Cartão de CNPJ ${CNPJ}.pdf`], clientes);
    expect(s.candidatos[0]).toEqual({ clienteId: "a", nota: 100, motivo: "mesmo CNPJ no nome do arquivo" });
  });
  it("CNPJ inválido é ignorado", () => {
    expect(sugerirCliente("Pasta sem nome útil", ["Cartão 11.222.333/0001-80.pdf"], clientes).situacao).toBe("sem_sugestao");
  });
  it("dois clientes parecidos aparecem nos candidatos, o igual primeiro", () => {
    const s = sugerirCliente("Exemplo Alfa - 2026", [], clientes);
    expect(s.situacao).toBe("sugerida");
    expect(s.candidatos.map((c) => c.clienteId)).toEqual(["a", "b"]);
    expect(s.candidatos[0]).toMatchObject({ nota: 90, motivo: "nome igual após normalização" });
  });
  it("sem candidatos: sem_sugestao", () => {
    expect(sugerirCliente("Fornecedor Zeta", [], clientes)).toEqual({ situacao: "sem_sugestao", candidatos: [] });
  });
});
