import { describe, expect, it } from "vitest";
import { enderecoDaTela, rotaDoAplicativo, validarAplicativo, type EntradaAplicativo } from "./aplicativos";

const areas = ["financeiro", "fiscal", "rh", "producao"];
const base: EntradaAplicativo = {
  codigo: "vigilancia_fiscal", nome: "Vigilância Fiscal", descricao: " Conferência diária ", area: "fiscal",
  url: "https://neo-fiscal-spark.lovable.app", abrir: "embutido", icone: "file-text", ordem: "10", ativo: true,
};

describe("validarAplicativo", () => {
  it("aceita um cadastro completo e normaliza os campos", () => {
    const r = validarAplicativo(base, areas);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor).toEqual({
        codigo: "vigilancia_fiscal", nome: "Vigilância Fiscal", descricao: "Conferência diária", area: "fiscal",
        url: "https://neo-fiscal-spark.lovable.app", abrir: "embutido", icone: "file-text", ordem: 10, ativo: true,
      });
    }
  });

  it("código em minúsculas, descrição vazia vira null, ícone vazio vira null, ordem vazia vira 0", () => {
    const r = validarAplicativo({ ...base, codigo: "NeoControl", descricao: "", icone: "", ordem: "" }, areas);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toMatchObject({ codigo: "neocontrol", descricao: null, icone: null, ordem: 0 });
  });

  it("recusa código, nome, área, endereço, modo, ícone e ordem inválidos", () => {
    const erro = (e: Partial<EntradaAplicativo>) => {
      const r = validarAplicativo({ ...base, ...e }, areas);
      return r.ok ? "" : r.erro;
    };
    expect(erro({ codigo: "a" })).toMatch(/código/);
    expect(erro({ codigo: "com espaço" })).toMatch(/código/);
    expect(erro({ nome: "X" })).toMatch(/nome/);
    expect(erro({ area: "juridico" })).toMatch(/área/);
    expect(erro({ url: "http://inseguro" })).toMatch(/https/);
    expect(erro({ url: "https://com espaço" })).toMatch(/https/);
    expect(erro({ abrir: "popup" })).toMatch(/abre/);
    expect(erro({ icone: "foguete" })).toMatch(/Ícone/);
    expect(erro({ ordem: "-1" })).toMatch(/ordem/);
    expect(erro({ ordem: "2.5" })).toMatch(/ordem/);
  });

  it("monta a rota do aplicativo", () => {
    expect(rotaDoAplicativo("neocontrol")).toBe("/apps/neocontrol");
  });
});

describe("enderecoDaTela", () => {
  it("abre a tela interna pedida e ignora o que poderia levar a outro site", () => {
    expect(enderecoDaTela("https://app.exemplo/", "/pendencias")).toBe("https://app.exemplo/pendencias");
    expect(enderecoDaTela("https://app.exemplo", "/conferencia/transferencia-aco")).toBe("https://app.exemplo/conferencia/transferencia-aco");
    for (const ruim of [undefined, "", "pendencias", "//mal.com", "/../x", "/a?b=1", "/@mal.com", ["/x"]])
      expect(enderecoDaTela("https://app.exemplo", ruim as string | undefined)).toBe("https://app.exemplo");
  });
});
