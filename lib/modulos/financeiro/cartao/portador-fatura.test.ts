import { describe, expect, it } from "vitest";
import type { Conciliado, TituloPagar } from "./conciliacao";
import { comMarcasDaFatura, titulosParaTrocar } from "./portador-fatura";

const titulo = (cod: string, extra: Partial<TituloPagar> = {}): TituloPagar => ({
  id: `api:${cod}`, codLancamento: cod, numeroTitulo: `D${cod}`, fornecedor: "LOJA", vencimento: "2026-10-23", complemento: "CARTAO SICREDI PJ",
  tipoTitulo: "", valorCentavos: 10_50, codBanco: "91", codHistorico: "2", ...extra,
});
const casado = (t: TituloPagar, extras?: TituloPagar[]): Conciliado =>
  ({ linhas: [], titulo: t, modo: "Exato", diferencaCentavos: 0, semelhanca: 1, aderencia: "OK", ...(extras ? { titulosExtras: extras } : {}) });

describe("marcas da fatura do cartão", () => {
  it("conciliados e os demais títulos dos casamentos à mão, sem repetir", () => {
    const r = titulosParaTrocar({ conciliados: [casado(titulo("1")), casado(titulo("2"), [titulo("3"), titulo("1")])] }, { portador: 992, historico: 80 });
    expect(r).toEqual([
      { cod_lancamento: "1", num_documento: "D1", fornecedor: "LOJA", valor: 10.5, portador_atual: 91, historico_atual: 2 },
      { cod_lancamento: "2", num_documento: "D2", fornecedor: "LOJA", valor: 10.5, portador_atual: 91, historico_atual: 2 },
      { cod_lancamento: "3", num_documento: "D3", fornecedor: "LOJA", valor: 10.5, portador_atual: 91, historico_atual: 2 },
    ]);
  });
  it("fora: provisório, antecipação, em borderô, já marcado, sem código", () => {
    const r = titulosParaTrocar({
      conciliados: [
        casado(titulo("10")), casado(titulo("11", { antecipacao: true })), casado(titulo("12", { emBordero: true })),
        casado(titulo("13", { codBanco: "992", codHistorico: "80" })), casado(titulo("14", { codLancamento: undefined })),
        casado(titulo("15", { codBanco: "992" })), casado(titulo("16", { codBanco: null, codHistorico: null })),
      ],
    }, { portador: 992, historico: 80, provisorio: "10" });
    // 15: já no portador, mas sem o histórico → entra.
    expect(r.map((t) => [t.cod_lancamento, t.portador_atual, t.historico_atual])).toEqual([["15", 992, 2], ["16", null, null]]);
    // Sem histórico no cartão: só o portador decide.
    expect(titulosParaTrocar({ conciliados: [casado(titulo("15", { codBanco: "992" }))] }, { portador: 992 })).toEqual([]);
  });
  it("códigos de compra com o portador e o histórico da fatura por cima", () => {
    expect(comMarcasDaFatura({ codPortador: 91, codHistorico: 2, categoriaDoc: 17 }, { portador: 992, historico: 80 })).toEqual({ codPortador: 992, codHistorico: 80, categoriaDoc: 17 });
    expect(comMarcasDaFatura({ codPortador: 91, codHistorico: 2 }, { portador: 992 })).toEqual({ codPortador: 992, codHistorico: 2 });
    const semNada: { codPortador?: number; codHistorico?: number; categoriaDoc: number } = { categoriaDoc: 17 };
    expect(comMarcasDaFatura(semNada, { portador: 992, historico: 80 })).toEqual({ codPortador: 992, codHistorico: 80, categoriaDoc: 17 });
    expect(comMarcasDaFatura({ codPortador: 91 }, { portador: null })).toEqual({ codPortador: 91 });
  });
});
