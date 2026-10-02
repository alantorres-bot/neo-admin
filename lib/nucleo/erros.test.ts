import { describe, expect, it } from "vitest";
import { mensagemDeErroBanco, sanitizarBusca } from "./erros";

describe("mensagemDeErroBanco", () => {
  it("traduz duplicidade, permissão e gatilhos nossos", () => {
    expect(mensagemDeErroBanco({ code: "23505", message: "duplicate key" }, "Já existe empresa com este CNPJ.")).toBe("Já existe empresa com este CNPJ.");
    expect(mensagemDeErroBanco({ code: "42501", message: "new row violates row-level security policy" })).toBe("Você não tem permissão para esta operação.");
    expect(mensagemDeErroBanco({ code: "P0001", message: "Somente o gestor da área aprova mensagens." })).toBe("Somente o gestor da área aprova mensagens.");
  });

  it("não vaza mensagem técnica desconhecida", () => {
    expect(mensagemDeErroBanco({ code: "XX000", message: 'relation "x" does not exist' })).toBe("Não foi possível salvar. Tente novamente.");
    expect(mensagemDeErroBanco({ message: "boom" })).toBe("Não foi possível salvar. Tente novamente.");
  });
});

describe("sanitizarBusca", () => {
  it("remove caracteres que quebrariam o filtro .or() do PostgREST", () => {
    expect(sanitizarBusca("alfa,nome.eq.x)")).toBe("alfa nome.eq.x");
    expect(sanitizarBusca('  "Silva"  (Cia) %  ')).toBe("Silva Cia");
    expect(sanitizarBusca("a".repeat(200)).length).toBe(80);
  });
});
