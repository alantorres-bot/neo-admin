import { describe, expect, it } from "vitest";
import { CARTOES_TESTE } from "./cartoes.test";
import { conciliar, type DecisaoItem, type LinhaFatura, type TituloPagar } from "./conciliacao";
import { camposDaSelecao, gruposSugeridos, sugestaoDoGrupo, type ItemGrupo } from "./lancamento-agrupado";
import { sugestaoDaLinha } from "./lancamento-compras";

const UBER = { codFornecedor: 1376, grupoContaFluxoCaixa: 13, contaFluxoCaixa: 5, contaContabilDebito: 3435 };
const ESTAB = [{ padrao: "UBER", lancamentoErp: UBER }, { padrao: "99", lancamentoErp: UBER }, { padrao: "POSTO", lancamentoErp: { codFornecedor: 1377, grupoContaFluxoCaixa: 18, contaFluxoCaixa: 4 } }];
const CARTAO = { codPortador: 91, categoriaDoc: 17, codHistorico: 2, contaContabilCredito: 2004 };
let n = 0;
const linha = (descricao: string, reais: number, parcelaTotal: number | null = null): LinhaFatura => ({
  id: `l${++n}`, ordem: n, dataCompra: "2026-09-16", descricao, valorCentavos: Math.round(reais * 100), parcelaNum: parcelaTotal ? 1 : null, parcelaTotal,
});
const item = (l: LinhaFatura): ItemGrupo => ({ linha: l, sugestao: sugestaoDaLinha(l.descricao, ESTAB, CARTAO), fornecedorNome: "TRANSPORTE POR APLICATIVO" });

describe("grupos sugeridos", () => {
  it("Uber e 99 juntos pelo fornecedor; posto sozinho e parcela ficam de fora", () => {
    const itens = [linha("Dl Uberrides", 29.67), linha("Uber Pending", 26), linha("99", 160.2), linha("Postoipe", 219.49), linha("Dl Uberrides", 10, 3)].map(item);
    const g = gruposSugeridos(itens);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ chave: "f:1376", rotulo: "TRANSPORTE POR APLICATIVO", totalCentavos: 21_587 });
    expect(g[0].linhaIds).toHaveLength(3);
  });
});

describe("seleção de várias linhas", () => {
  it("campos comuns preenchidos; divergência avisada", () => {
    const iguais = sugestaoDoGrupo([linha("Dl Uberrides", 1), linha("99", 2)].map(item));
    expect(iguais).toEqual({ campos: { ...UBER, ...CARTAO }, divergentes: [] });
    const misto = sugestaoDoGrupo([linha("Dl Uberrides", 1), linha("Postoipe", 2)].map(item));
    expect(misto.divergentes).toEqual(["codFornecedor", "grupoContaFluxoCaixa", "contaFluxoCaixa"]);   // o posto do teste não tem débito: o da Uber vale
    expect(misto.campos.codFornecedor).toBeUndefined();   // fornecedores diferentes: o operador escolhe
  });
  it("lançar selecionadas: cada linha com os seus códigos; os do diálogo só completam o que falta", () => {
    const comuns = { codFornecedor: 1378, codPortador: 991, contaContabilDebito: 1 };
    expect(camposDaSelecao({ ...UBER, ...CARTAO }, comuns)).toEqual({ ...UBER, ...CARTAO });
    expect(camposDaSelecao({ ...CARTAO }, comuns)).toEqual({ ...CARTAO, codFornecedor: 1378, contaContabilDebito: 1 });
  });
  it("título agrupado antigo: depois da decisão 'casar', as linhas saem de 'A lançar'", () => {
    const ls = [linha("Dl Uberrides", 29.67), linha("99", 160.2)];
    const titulo: TituloPagar = { id: "api:60001", codLancamento: "60001", numeroTitulo: "1010", fornecedor: "TRANSPORTE", vencimento: "2026-10-23",
      complemento: "CARTÃO SICREDI PJ 1x — TRANSPORTE POR APLICATIVO (2 LANÇ.)", tipoTitulo: "", valorCentavos: 18_987 };
    const casar: DecisaoItem = { id: "d", tipo: "casar", linhas: ls.map((l) => l.id), titulos: ["60001"], categoria: null, contaFluxo: null, motivo: "x", autor: null, em: "2026-10-13" };
    const sicrediPJ = CARTOES_TESTE.find((c) => c.codigo === "SICREDI PJ")!;
    const r = conciliar({ cartao: sicrediPJ, cartoes: CARTOES_TESTE, vencimento: "2026-10-23", totalInformadoCentavos: 18_987, linhas: ls, titulos: [titulo], estabelecimentos: [], decisoes: [casar] });
    expect(r.aLancar).toEqual([]);
    expect(r.residuoCentavos).toBe(0);
  });
});

describe("atalhos por categoria", () => {
  it("o que não forma grupo por fornecedor junta pela categoria do dicionário", () => {
    const semFornecedor = (d: string, v: number, categoria: string): ItemGrupo => ({ ...item(linha(d, v)), sugestao: { padrao: null, campos: {}, origem: {} as never }, categoria });
    const g = gruposSugeridos([
      item(linha("Dl Uberrides", 10)), item(linha("99", 20)),
      semFornecedor("Restaurante A", 30, "Alimentação"), semFornecedor("Lanchonete B", 40, "Alimentação"), semFornecedor("Loja C", 50, "[CONFERIR]"),
    ]);
    expect(g.map((x) => [x.chave, x.linhaIds.length, x.totalCentavos])).toEqual([["c:Alimentação", 2, 7_000], ["f:1376", 2, 3_000]]);
  });
});
