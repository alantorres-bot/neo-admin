import { describe, expect, it } from "vitest";
import { CARTOES_TESTE } from "./cartoes.test";
import type { ADesdobrar } from "./conciliacao";
import { baseDocumento, montarDesdobramento, previaDesdobramento, valoresDasParcelas } from "./desdobramento";

const UNICRED = CARTOES_TESTE.find((c) => c.codigo === "UNICRED PF")!;
const par = (tituloCentavos = 299_478, extra: Partial<ADesdobrar["titulo"]> = {}): ADesdobrar => ({
  linha: { id: "l1", ordem: 14, dataCompra: "2026-09-23", descricao: "MP*TERABYTESHOP", valorCentavos: 49_913, parcelaNum: 1, parcelaTotal: 6 },
  titulo: { id: "api:40000", codLancamento: "40000", numeroTitulo: "3615152/1", fornecedor: "TERABYTE", vencimento: "2026-10-20", complemento: "CARTÃO UNICRED 1 X", tipoTitulo: "9", valorCentavos: tituloCentavos, ...extra },
  parcelas: 6, parcelaCentavos: 49_913, diferencaCentavos: tituloCentavos - 6 * 49_913,
});
// Detalhe como o GET lancamentoContasPagar/{id} devolve (formato do lançamento 33650).
const detalhe = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  categoriaDoc: 9, codBarras: "", codDocumento: "3615152/1", codFornecedor: 1345, codHistorico: 2, codLancamento: 40000, codOrigem: 3, codPortador: 91,
  complementoHistorico: "CARTÃO UNICRED 1 X", contaFluxoCaixa: 5, dadosContabilidade: { contaContabilCredito: 2004, contaContabilDebito: 3240, listaCentroCustoContab: [] },
  dadosCustomizados: [], dataEmissao: "2026-09-23", dataEntrada: "2026-09-25", dataPagamento: "", dataVencimento: "2026-10-20", dataVencimentoOriginal: "",
  grupoContaFluxoCaixa: 16, tipoLancamento: "C", valorDocumento: 2994.78, valorOriginalDocumento: 2994.78, valorPago: 0, ...extra,
});
const base = { cartao: UNICRED, competencia: "2026-10-01", marcas: { portador: 994, historico: null } };

describe("desdobramento da compra lançada pelo total", () => {
  it("valores: todas as parcelas com o valor da linha; a última fecha o total do título", () => {
    expect(valoresDasParcelas(par())).toEqual([49_913, 49_913, 49_913, 49_913, 49_913, 49_913]);
    expect(valoresDasParcelas(par(299_480))).toEqual([49_913, 49_913, 49_913, 49_913, 49_913, 49_915]);
    expect(valoresDasParcelas(par(299_476)).reduce((s, v) => s + v, 0)).toBe(299_476);
  });

  it("documento sem a parcela", () => {
    expect(baseDocumento("3615152/1")).toBe("3615152");
    expect(baseDocumento(" 3615152 ")).toBe("3615152");
    expect(baseDocumento("2309-14/12")).toBe("2309-14");
  });

  it("prévia: parcela 1 no vencimento do título, as demais nos vencimentos das faturas seguintes", () => {
    const p = previaDesdobramento({ par: par(), cartao: UNICRED, competencia: "2026-10-01" });
    expect(p.map((x) => [x.parcela, x.vencimento, x.valorCentavos, x.documento])).toEqual([
      [1, "2026-10-20", 49_913, "3615152/1"], [2, "2026-11-20", 49_913, "3615152/2"], [3, "2026-12-20", 49_913, "3615152/3"],
      [4, "2027-01-20", 49_913, "3615152/4"], [5, "2027-02-20", 49_913, "3615152/5"], [6, "2027-03-20", 49_913, "3615152/6"],
    ]);
    expect(p[5].complemento).toMatch(/PARC 6\/6$/);
    expect(previaDesdobramento({ par: par(), cartao: UNICRED, competencia: null })[1].vencimento).toBeNull();
  });

  it("monta a alteração do original e as parcelas 2 a 6 copiando o título, com as marcas da fatura por cima", () => {
    const r = montarDesdobramento({ par: par(299_480), detalhe: detalhe({ valorDocumento: 2994.8 }), ...base });
    if (!r.ok) throw new Error(r.erro);
    expect(r.alteracao).toEqual({ valorDocumento: 499.13, codDocumento: "3615152/1", complementoHistorico: expect.stringMatching(/^CARTÃO .* 6x — MP\*TERABYTESHOP PARC 1\/6$/) });
    expect(r.parcelas.map((p) => [p.parcela, p.vencimento, p.payload.valorDocumento, p.payload.codDocumento])).toEqual([
      [2, "2026-11-20", 499.13, "3615152/2"], [3, "2026-12-20", 499.13, "3615152/3"], [4, "2027-01-20", 499.13, "3615152/4"],
      [5, "2027-02-20", 499.13, "3615152/5"], [6, "2027-03-20", 499.15, "3615152/6"],
    ]);
    expect(r.parcelas[0].payload).toMatchObject({
      codFornecedor: 1345, categoriaDoc: 9, codPortador: 994, codHistorico: 2, dataEmissao: "2026-09-23", dataEntrada: "2026-09-25", dataVencimento: "2026-11-20",
      grupoContaFluxoCaixa: 16, contaFluxoCaixa: 5, dadosContabilidade: { contaContabilDebito: 3240, contaContabilCredito: 2004, listaCentroCustoContab: [] },
    });
    expect(r.parcelas.every((p) => p.payload.complementoHistorico.length <= 70)).toBe(true);
    const total = Math.round(r.alteracao.valorDocumento * 100) + r.parcelas.reduce((s, p) => s + Math.round(p.payload.valorDocumento * 100), 0);
    expect(total).toBe(299_480);
  });

  it("sem marcas no cartão: portador e histórico do título original", () => {
    const r = montarDesdobramento({ par: par(), detalhe: detalhe(), ...base, marcas: { portador: null } });
    expect(r.ok && r.parcelas[0].payload).toMatchObject({ codPortador: 91, codHistorico: 2 });
  });

  it("recusa: valor mudou, pagamento, borderô, rateio, campo faltando, não é título", () => {
    const erro = (r: ReturnType<typeof montarDesdobramento>) => (r.ok ? "" : r.erro);
    expect(erro(montarDesdobramento({ par: par(), detalhe: detalhe({ valorDocumento: 499.13 }), ...base }))).toMatch(/Recarregue/);
    expect(erro(montarDesdobramento({ par: par(), detalhe: detalhe({ valorPago: 10 }), ...base }))).toMatch(/pagamento/);
    expect(erro(montarDesdobramento({ par: par(), detalhe: detalhe({ dataPagamento: "2026-10-20" }), ...base }))).toMatch(/pagamento/);
    expect(erro(montarDesdobramento({ par: par(299_478, { emBordero: true }), detalhe: detalhe(), ...base }))).toMatch(/borderô/);
    expect(erro(montarDesdobramento({ par: par(), detalhe: detalhe({ dadosContabilidade: { contaContabilCredito: 2004, contaContabilDebito: 3240, listaCentroCustoContab: [{ cc: 1 }] } }), ...base }))).toMatch(/centro de custo/);
    expect(erro(montarDesdobramento({ par: par(), detalhe: detalhe({ contaFluxoCaixa: null, codDocumento: "" }), ...base }))).toMatch(/sem contaFluxoCaixa, codDocumento/);
    expect(erro(montarDesdobramento({ par: par(), detalhe: detalhe({ tipoLancamento: "A" }), ...base }))).toMatch(/não é um título/);
  });
});
