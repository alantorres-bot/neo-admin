import { describe, expect, it } from "vitest";
import type { Conciliado, TituloPagar } from "./conciliacao";
import { comPortadorDaFatura, titulosParaTrocar } from "./portador-fatura";

const titulo = (cod: string, extra: Partial<TituloPagar> = {}): TituloPagar => ({
  id: `api:${cod}`, codLancamento: cod, numeroTitulo: `D${cod}`, fornecedor: "LOJA", vencimento: "2026-10-23", complemento: "CARTAO SICREDI PJ",
  tipoTitulo: "", valorCentavos: 10_50, codBanco: "91", ...extra,
});
const casado = (t: TituloPagar, extras?: TituloPagar[]): Conciliado =>
  ({ linhas: [], titulo: t, modo: "Exato", diferencaCentavos: 0, semelhanca: 1, aderencia: "OK", ...(extras ? { titulosExtras: extras } : {}) });

describe("portador da fatura do cartão", () => {
  it("conciliados e os demais títulos dos casamentos à mão, sem repetir", () => {
    const r = titulosParaTrocar({ conciliados: [casado(titulo("1")), casado(titulo("2"), [titulo("3"), titulo("1")])] }, { portador: 501 });
    expect(r).toEqual([
      { cod_lancamento: "1", num_documento: "D1", fornecedor: "LOJA", valor: 10.5, portador_atual: 91 },
      { cod_lancamento: "2", num_documento: "D2", fornecedor: "LOJA", valor: 10.5, portador_atual: 91 },
      { cod_lancamento: "3", num_documento: "D3", fornecedor: "LOJA", valor: 10.5, portador_atual: 91 },
    ]);
  });
  it("fora: provisório, antecipação, em borderô, já no portador, sem código", () => {
    const r = titulosParaTrocar({
      conciliados: [
        casado(titulo("10")), casado(titulo("11", { antecipacao: true })), casado(titulo("12", { emBordero: true })),
        casado(titulo("13", { codBanco: "501" })), casado(titulo("14", { codLancamento: undefined })), casado(titulo("15", { codBanco: null })),
      ],
    }, { portador: 501, provisorio: "10" });
    expect(r.map((t) => [t.cod_lancamento, t.portador_atual])).toEqual([["15", null]]);
  });
  it("códigos de compra com o portador da fatura por cima", () => {
    expect(comPortadorDaFatura({ codPortador: 91, codHistorico: 2 }, 501)).toEqual({ codPortador: 501, codHistorico: 2 });
    const semPortador: { codHistorico: number; codPortador?: number } = { codHistorico: 2 };
    expect(comPortadorDaFatura(semPortador, 501)).toEqual({ codPortador: 501, codHistorico: 2 });
    expect(comPortadorDaFatura({ codPortador: 91 }, null)).toEqual({ codPortador: 91 });
  });
});
