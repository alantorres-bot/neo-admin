import { describe, expect, it } from "vitest";
import { lerXls } from "@/lib/integracoes/importador/xls";
import { xlsSintetico, type CelulaTeste } from "@/lib/integracoes/importador/xls.fixture";
import { casarRelacao, interpretarRelacao, naturezaDoCalculo, type ItemCasavel } from "./relacao-liquidos";

/** Mesmo layout do relatório do escritório (colunas 0, 3, 11, 18/21, 24/25), com dados fictícios. */
function relatorio(o: { cnpj?: string; calculo?: string; total?: number; pessoas?: [number, string, number][]; competencia?: number | string } = {}) {
  const pessoas = o.pessoas ?? [[133, "FULANO DE TAL", 2398.59], [18, "BELTRANO SILVA", 5112.46], [207, "CICLANO SOUZA", 1722.42]];
  const cel: CelulaTeste[] = [
    [0, 0, "Empresa:"], [0, 5, "NEO FORMAS SERVICOS DE MANUTEN"], [0, 20, "Página:  "], [0, 23, "1 / 1"],
    [1, 0, "CNPJ:"], [1, 5, o.cnpj ?? "45513941000167"],
    [2, 0, "Cálculo:"], [2, 5, o.calculo ?? "Folha Mensal"],
    [3, 0, "Competência:"], [3, 5, o.competencia ?? 46266],
    [6, 0, "RELAÇÃO GERAL DOS LÍQUIDOS"],
    [8, 0, "Código "], [8, 3, "Nome do empregado  "], [8, 11, "Identidade"], [8, 25, "Valor"],
    [9, 1, "Empregados"],
  ];
  pessoas.forEach(([cod, nome, valor], k) => cel.push([10 + k, 0, cod], [10 + k, 3, nome], [10 + k, 11, "29592550"], [10 + k, 24, valor]));
  const fim = 10 + pessoas.length;
  cel.push([fim, 3, `Empregados: ${pessoas.length}`], [fim, 18, "Total da Empresa:"], [fim, 21, o.total ?? pessoas.reduce((s, p) => s + p[2], 0)]);
  const r = lerXls(xlsSintetico(cel));
  if (!r.ok) throw new Error(r.erro);
  return r.planilhas[0];
}

describe("Relação Geral dos Líquidos", () => {
  it("lê empresa, cálculo, competência, pessoas e total; a soma bate", () => {
    const r = interpretarRelacao(relatorio());
    if (!r.ok) throw new Error(r.erro);
    expect(r.relacao).toMatchObject({ cnpj: "45513941000167", empregador: "NEO SERVIÇOS", calculo: "Folha Mensal", natureza: "liquido", competencia: "2026-09-01", totalCentavos: 923347 });
    expect(r.relacao.pessoas).toEqual([
      { codigo: "133", nome: "FULANO DE TAL", centavos: 239859 }, { codigo: "18", nome: "BELTRANO SILVA", centavos: 511246 }, { codigo: "207", nome: "CICLANO SOUZA", centavos: 172242 },
    ]);
  });

  it("recusa soma diferente do total, empresa fora da folha, cálculo desconhecido e código repetido", () => {
    expect(interpretarRelacao(relatorio({ total: 9000 }))).toMatchObject({ ok: false, erro: expect.stringMatching(/não bate com o Total da Empresa/) });
    expect(interpretarRelacao(relatorio({ cnpj: "11222333000181" }))).toMatchObject({ ok: false, erro: expect.stringMatching(/não é de uma empresa da folha/) });
    expect(interpretarRelacao(relatorio({ calculo: "Rescisão" }))).toMatchObject({ ok: false, erro: expect.stringMatching(/desconhecido/) });
    expect(interpretarRelacao(relatorio({ pessoas: [[1, "A", 1], [1, "B", 2]] }))).toMatchObject({ ok: false, erro: expect.stringMatching(/repetido/) });
  });

  it("cálculo → natureza; competência também como texto mm/aaaa", () => {
    expect(naturezaDoCalculo("Folha Mensal")).toBe("liquido");
    expect(naturezaDoCalculo("13o. Adiantamento")).toBe("decimo_terceiro");
    expect(naturezaDoCalculo("Férias")).toBe("ferias_acrescimos");
    const r = interpretarRelacao(relatorio({ competencia: "10/2026" }));
    expect(r.ok && r.relacao.competencia).toBe("2026-10-01");
  });

  it("casa pelo código do escritório dentro da empresa; ligação manual; quem ficou de fora", () => {
    const r = interpretarRelacao(relatorio());
    if (!r.ok) throw new Error(r.erro);
    const item = (id: string, empregador: string, mat: string | null, liquido = 0): ItemCasavel => ({ id, nome: id.toUpperCase(), empregador, matricula_escritorio: mat, liquido, ferias_acrescimos: 0, decimo_terceiro: 0 });
    const itens = [item("a", "NEO SERVIÇOS", "133", 100), item("b", "OESTE", "18"), item("c", "NEO SERVIÇOS", null), item("d", "NEO SERVIÇOS", "999", 50)];
    const c = casarRelacao(r.relacao, itens);
    expect(c.casados).toEqual([{ item_id: "a", nome: "A", codigo: "133", atualCentavos: 10000, novoCentavos: 239859 }]);
    expect(c.semCadastro.map((p) => p.codigo)).toEqual(["18", "207"]);   // o 18 da OESTE não serve para a NEO SERVIÇOS
    expect(c.foraDoRelatorio).toEqual([{ item_id: "d", nome: "D", atualCentavos: 5000 }]);
    expect(c.ambiguos).toEqual([]);
    const ligado = casarRelacao(r.relacao, itens, { "207": "c" });
    expect(ligado.casados.map((x) => [x.item_id, x.codigo])).toEqual([["a", "133"], ["c", "207"]]);
  });

  it("código repetido na mesma empresa não grava em ninguém (aponta); ligação à mão resolve", () => {
    const r = interpretarRelacao(relatorio());
    if (!r.ok) throw new Error(r.erro);
    const item = (id: string, mat: string): ItemCasavel => ({ id, nome: id.toUpperCase(), empregador: "NEO SERVIÇOS", matricula_escritorio: mat, liquido: 0, ferias_acrescimos: 0, decimo_terceiro: 0 });
    const itens = [item("x", "207"), item("y", "207"), item("a", "133")];
    const c = casarRelacao(r.relacao, itens);
    expect(c.ambiguos).toEqual([{ codigo: "207", nomes: ["X", "Y"] }]);
    expect(c.casados.map((k) => k.item_id)).toEqual(["a"]);
    expect(c.semCadastro.map((p) => p.codigo)).toEqual(["18", "207"]);
    expect(casarRelacao(r.relacao, itens, { "207": "y" }).casados.map((k) => [k.item_id, k.codigo])).toEqual([["a", "133"], ["y", "207"]]);
  });
});
