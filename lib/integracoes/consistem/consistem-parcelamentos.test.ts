import { describe, expect, it } from "vitest";
import { juntarListasParcelamento, lancamentoNaoCadastrado, normalizarDetalheParcelamento } from "../../../supabase/functions/_shared/consistem-pagar";

describe("juntarListasParcelamento", () => {
  const item = (codLancamento: number, tipoLancamento: string, valorAtualizado = "10,00") => ({
    codLancamento, tipoLancamento, codFornecedor: 986, numDocumento: "8003-11/26", valorDocumento: "10,00", valorAtualizado, dataVencimento: "2026-11-27",
  });
  it("o mesmo lançamento nas duas listas fica um só (vale a última leitura); só P e C; recusados contados", () => {
    const r = juntarListasParcelamento([[item(1, "P"), item(2, "P")], [item(1, "P"), item(3, "C", "0,00"), item(4, "D"), item(5, "A"), { codLancamento: 6, tipoLancamento: "X" }]]);
    expect(r.lancamentos.map((l) => [l.codLancamento, l.tipo, l.saldoCentavos])).toEqual([["1", "P", 1000], ["2", "P", 1000], ["3", "C", 0]]);
    expect(r.recusados).toEqual(["6: tipo de lançamento desconhecido (X)"]);
  });
});

describe("lancamentoNaoCadastrado", () => {
  it("HTTP 400 com a mensagem real do ERP (ou 404) = excluído; outros erros = tentar de novo", () => {
    expect(lancamentoNaoCadastrado(400, 'Consistem HTTP 400: {"mensagem":"Lançamento não cadastrado!"}')).toBe(true);
    expect(lancamentoNaoCadastrado(404, "")).toBe(true);
    expect(lancamentoNaoCadastrado(400, "Consistem HTTP 400: parâmetro inválido")).toBe(false);
    expect(lancamentoNaoCadastrado(500, "Lançamento não cadastrado")).toBe(false);
    expect(lancamentoNaoCadastrado(undefined, "")).toBe(false);
  });
});

// Detalhes reais (GET lancamentoContasPagar/{id}, 11/11/2026): valores em formato en ("2061.18"), datas vazias como "".
const PGE_P = {
  categoriaDoc: "", codBarras: "", codDocumento: "8003-11/26", codFornecedor: 986, codHistorico: 3, codLancamento: 12482, codOrigem: "", codPortador: 91,
  complementoHistorico: "PARC. CDA ICMS - 2025658003", contaFluxoCaixa: 17, dataEmissao: "2025-11-26", dataEntrada: "", dataPagamento: "",
  dataVencimento: "2026-11-27", dataVencimentoOriginal: "", diasPrazo: "", grupoContaFluxoCaixa: 20, qrCodePix: "", tipoLancamento: "P", tipoMoeda: 0,
  valorDesconto: "0", valorDocumento: "2061.18", valorJuros: "0", valorMulta: "0", valorOriginalDocumento: "2061.18", valorPago: "0",
};

describe("normalizarDetalheParcelamento", () => {
  it("lê tipo, grupo/conta de fluxo e valores do detalhe real", () => {
    expect(normalizarDetalheParcelamento("12482", PGE_P)).toEqual({
      codLancamento: "12482", encontrado: true, tipo: "P", grupo: 20, conta: 17, codFornecedor: "986", numDocumento: "8003-11/26",
      complemento: "PARC. CDA ICMS - 2025658003", vencimento: "2026-11-27", valorDocumentoCentavos: 206_118, valorPagoCentavos: 0,
      valorJurosCentavos: 0, valorMultaCentavos: 0, dataPagamento: null, codBarras: "",
    });
  });

  it("C pago: data e valor pago; ponto e vírgula do histórico sai", () => {
    const r = normalizarDetalheParcelamento("12482", { ...PGE_P, tipoLancamento: "c", valorDocumento: "2295.73", valorPago: "2295.73", dataPagamento: "2026-10-30", complementoHistorico: "PARC;" });
    expect(r).toMatchObject({ encontrado: true, tipo: "C", valorDocumentoCentavos: 229_573, valorPagoCentavos: 229_573, dataPagamento: "2026-10-30", complemento: "PARC" });
  });

  it("sem conta de fluxo (0 ou vazio) vira nulo; resposta de outro código ou vazia = não encontrado", () => {
    expect(normalizarDetalheParcelamento("12482", { ...PGE_P, grupoContaFluxoCaixa: 0, contaFluxoCaixa: "" })).toMatchObject({ grupo: null, conta: null });
    expect(normalizarDetalheParcelamento("12482", {})).toEqual({ codLancamento: "12482", encontrado: false });
    expect(normalizarDetalheParcelamento("12482", { ...PGE_P, codLancamento: 1 })).toEqual({ codLancamento: "12482", encontrado: false });
  });
});
