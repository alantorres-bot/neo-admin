import { describe, expect, it } from "vitest";
import { itensALancar, montarTituloVt } from "./lancamento";

const codigos = { codHistorico: 3, codPortador: 91, categoriaDoc: 17, grupoContaFluxoCaixa: 2, contaFluxoCaixa: 45, contaContabilDebito: 3101, contaContabilCredito: 2101 };

describe("título do VT no Consistem", () => {
  it("monta o título: fornecedor = Nº, valor do mês, vencimento = pagamento, documento VTMMAA, complemento VALE TRANSPORTE - MM/AAAA", () => {
    const t = montarTituloVt({
      item: { id: "x", cod_fornecedor: "660", nome: "AILTON", valor: 207.9, empregador: "OESTE", forma_pagamento: "pix" },
      competencia: "2026-11-01", dataPagamento: "2026-10-30", hoje: "2026-10-29", codigos,
    });
    expect(t).toEqual({
      codFornecedor: 660, categoriaDoc: 17, codDocumento: "VT1126", codPortador: 91, dataEmissao: "2026-10-29", dataEntrada: "2026-10-29",
      dataVencimento: "2026-10-30", valorDocumento: 207.9, codHistorico: 3, complementoHistorico: "VALE TRANSPORTE - 11/2026",
      grupoContaFluxoCaixa: 2, contaFluxoCaixa: 45, dadosContabilidade: { contaContabilDebito: 3101, contaContabilCredito: 2101, listaCentroCustoContab: [] },
    });
  });

  it("só valor > 0 e sem lançamento ativo", () => {
    const itens = [{ id: "a", valor: 10 }, { id: "b", valor: 0 }, { id: "c", valor: 5 }];
    expect(itensALancar(itens, new Set(["c"])).map((i) => i.id)).toEqual(["a"]);
  });
});
