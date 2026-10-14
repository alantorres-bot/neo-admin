import { describe, expect, it } from "vitest";
import { codigosDoModelo, complementoVt, documentoVt, itensALancar, lerCodigosLancamento, montarTituloVt } from "./lancamento";

const codigos = { codHistorico: 3, codPortador: 91, categoriaDoc: 17, grupoContaFluxoCaixa: 2, contaFluxoCaixa: 45, contaContabilDebito: 3101, contaContabilCredito: 2101 };

describe("título do VT no Consistem", () => {
  it("lê os códigos dos Parâmetros; recusa faltando, não inteiro ou débito = crédito", () => {
    expect(lerCodigosLancamento({ ...codigos, codPortador: "91" })).toEqual(codigos);
    expect(lerCodigosLancamento({ ...codigos, codPortador: undefined })).toBeNull();
    expect(lerCodigosLancamento({ ...codigos, codPortador: 1.5 })).toBeNull();
    expect(lerCodigosLancamento({ ...codigos, contaContabilCredito: 3101 })).toBeNull();
    expect(lerCodigosLancamento(null)).toBeNull();
  });

  it("monta o título: fornecedor = Nº, valor do mês, vencimento = pagamento, documento VTMMAA", () => {
    const t = montarTituloVt({
      item: { id: "x", cod_fornecedor: "660", nome: "AILTON", valor: 207.9, forma_pagamento: "pix_neo_formas" },
      competencia: "2026-11-01", dataPagamento: "2026-10-30", hoje: "2026-10-29", codigos,
    });
    expect(t).toEqual({
      codFornecedor: 660, categoriaDoc: 17, codDocumento: "VT1126", codPortador: 91, dataEmissao: "2026-10-29", dataEntrada: "2026-10-29",
      dataVencimento: "2026-10-30", valorDocumento: 207.9, codHistorico: 3, complementoHistorico: "VALE TRANSPORTE NOVEMBRO/2026 - PIX NEO FORMAS",
      grupoContaFluxoCaixa: 2, contaFluxoCaixa: 45, dadosContabilidade: { contaContabilDebito: 3101, contaContabilCredito: 2101, listaCentroCustoContab: [] },
    });
    expect(documentoVt("2027-01-01")).toBe("VT0127");
    expect(complementoVt("2026-03-01", "fopag").length).toBeLessThanOrEqual(70);
  });

  it("só valor > 0 e sem lançamento ativo", () => {
    const itens = [
      { id: "a", cod_fornecedor: "1", nome: "A", valor: 10, forma_pagamento: "fopag" as const },
      { id: "b", cod_fornecedor: "2", nome: "B", valor: 0, forma_pagamento: "fopag" as const },
      { id: "c", cod_fornecedor: "3", nome: "C", valor: 5, forma_pagamento: "fopag" as const },
    ];
    expect(itensALancar(itens, new Set(["c"])).map((i) => i.id)).toEqual(["a"]);
  });

  it("lê os códigos do título modelo (detalhe da API); ausentes ficam de fora", () => {
    expect(codigosDoModelo({ codHistorico: "3", codBanco: 91, categoriaDoc: 17, contaFluxoCaixa: "45", dadosContabilidade: { contaContabilDebito: 3101, contaContabilCredito: "0" } }))
      .toEqual({ codHistorico: 3, codPortador: 91, categoriaDoc: 17, contaFluxoCaixa: 45, contaContabilDebito: 3101 });
  });
});
