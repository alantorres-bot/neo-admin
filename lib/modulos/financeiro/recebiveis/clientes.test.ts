import { describe, expect, it } from "vitest";
import { clienteNoEscopoDeCadastro, titulaNoEscopoDeCadastro } from "./clientes";

const t = (extra: Partial<{ unidade: string; faixa: string; dias_atraso: number }> = {}) => ({ unidade: "matriz", faixa: "a_vencer", dias_atraso: 0, ...extra });

describe("escopo do cadastro de contatos", () => {
  it("título da Matriz a vencer ou vencido há menos de 60 dias entra", () => {
    expect(titulaNoEscopoDeCadastro(t())).toBe(true);
    expect(titulaNoEscopoDeCadastro(t({ faixa: "01_15", dias_atraso: 3 }))).toBe(true);
    expect(titulaNoEscopoDeCadastro(t({ faixa: "31_60", dias_atraso: 59 }))).toBe(true);
  });
  it("60 dias ou mais, encerrado e Filial Contagem ficam de fora", () => {
    expect(titulaNoEscopoDeCadastro(t({ faixa: "31_60", dias_atraso: 60 }))).toBe(false);
    expect(titulaNoEscopoDeCadastro(t({ faixa: "60_mais", dias_atraso: 400 }))).toBe(false);
    expect(titulaNoEscopoDeCadastro(t({ faixa: "encerrado" }))).toBe(false);
    expect(titulaNoEscopoDeCadastro(t({ unidade: "contagem" }))).toBe(false);
  });
  it("o cliente entra se tiver ao menos um título no escopo", () => {
    expect(clienteNoEscopoDeCadastro([t({ faixa: "60_mais", dias_atraso: 300 }), t({ dias_atraso: 10, faixa: "01_15" })])).toBe(true);
    expect(clienteNoEscopoDeCadastro([t({ faixa: "60_mais", dias_atraso: 300 })])).toBe(false);
    expect(clienteNoEscopoDeCadastro([])).toBe(false);
  });
});
