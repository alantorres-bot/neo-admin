import { describe, expect, it } from "vitest";
import { identificarCartaoDoTitulo } from "./cartoes";
import { CARTOES_TESTE } from "./cartoes.test";
import { conciliar, type DecisaoItem, type LinhaFatura, type TituloPagar } from "./conciliacao";
import { complementoAgrupado, gruposSugeridos, montarTituloAgrupado, sugestaoDoGrupo, type ItemGrupo } from "./lancamento-agrupado";
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

describe("título agrupado", () => {
  it("campos comuns preenchidos; divergência avisada", () => {
    const iguais = sugestaoDoGrupo([linha("Dl Uberrides", 1), linha("99", 2)].map(item));
    expect(iguais).toEqual({ campos: { ...UBER, ...CARTAO }, divergentes: [] });
    const misto = sugestaoDoGrupo([linha("Dl Uberrides", 1), linha("Postoipe", 2)].map(item));
    expect(misto.divergentes).toEqual(["codFornecedor", "grupoContaFluxoCaixa", "contaFluxoCaixa"]);   // o posto do teste não tem débito: o da Uber vale
    expect(misto.campos.codFornecedor).toBeUndefined();   // fornecedores diferentes: o operador escolhe
  });
  it("soma, fechamento e complemento; recusa uma linha só, parcela e campo vazio", () => {
    const ls = [linha("Dl Uberrides", 29.67), linha("99", 160.2), linha("Uber Pending", 26)];
    const t = montarTituloAgrupado({ linhas: ls, nomeCartao: "SICREDI PJ", campos: { ...UBER, ...CARTAO }, fechamento: "2026-10-10", vencimento: "2026-10-23", rotulo: "Transporte por aplicativo" });
    if (!t.ok) throw new Error(t.erro);
    expect(t.payload.codDocumento).toBe(`101026-${Math.min(...ls.map((l) => l.ordem))}`);   // número da linha: o mesmo fornecedor pode ter vários títulos no dia
    expect(t.payload).toMatchObject({ codFornecedor: 1376, dataEmissao: "2026-10-10", dataVencimento: "2026-10-23", valorDocumento: 215.87,
      complementoHistorico: "CARTÃO SICREDI PJ 1x — TRANSPORTE POR APLICATIVO (3 LANÇ.)" });
    const base = { nomeCartao: "X", campos: { ...UBER, ...CARTAO }, fechamento: "2026-10-10", vencimento: "2026-10-23", rotulo: "X" };
    expect(montarTituloAgrupado({ ...base, linhas: [ls[0]] })).toMatchObject({ ok: false, erro: /duas linhas/ });
    expect(montarTituloAgrupado({ ...base, linhas: [ls[0], linha("X", 10, 2)] })).toMatchObject({ ok: false, erro: /à vista/ });
    expect(montarTituloAgrupado({ ...base, linhas: ls, campos: { ...UBER } })).toMatchObject({ ok: false, erro: /portador/ });
  });
  it("complemento até 70, com a contagem, reconhecido como do cartão", () => {
    const c = complementoAgrupado("SICREDI PJ", "UM NOME DE GRUPO MUITO GRANDE QUE NAO CABE NO COMPLEMENTO DO CONSISTEM", 14);
    expect(c.length).toBeLessThanOrEqual(70);
    expect(c.endsWith(" (14 LANÇ.)")).toBe(true);
    const id = identificarCartaoDoTitulo({ complemento: c, vencimento: "2026-10-23" }, CARTOES_TESTE);
    expect(id.situacao === "cartao" && id.cartao?.codigo).toBe("SICREDI PJ");
  });
  it("depois da decisão 'casar', as linhas agrupadas saem de 'A lançar'", () => {
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
