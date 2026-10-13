import { describe, expect, it } from "vitest";
import { paraCentavos as paraCentavosReceber, paraDataIso as paraDataIsoReceber } from "../../../supabase/functions/_shared/consistem-receber";
import {
  classificarLancamento,
  diaSeguinte,
  estaEmAberto,
  FILTRO_BORDERO,
  FILTRO_CONFIRMADO,
  janelasDeDatas,
  planejarConfirmacoes,
  normalizarDetalheLancamento,
  normalizarFornecedorApi,
  normalizarLancamentoPagar,
  paraCentavos,
  paraDataIso,
  planejarSincronizacaoPagar,
  type LancamentoBanco,
  type LancamentoPagarApi,
} from "../../../supabase/functions/_shared/consistem-pagar";

// Registro real da API (09/10/2026), com os valores em texto pt-BR e o vencimento "0" das antecipações.
const ANTECIPACAO = {
  categoriaDoc: "25", codBanco: 91, codFornecedor: 382, codHistorico: 4, codLancamento: 33428, codOrigem: "",
  complementoHistorico: "ANTECIPAÇÃO DE COMPRA - PEDIDO 948;", dadosCustomizados: [], dataEmissao: "2026-10-09", dataEntrada: "2026-10-09",
  dataVencimento: "0", numDocumento: "33428", tipoLancamento: "A", tipoMoeda: 0, valorAtualizado: "46.728,90", valorDocumento: "46.728,90", valorOriginal: "0,00",
};
const TITULO = {
  categoriaDoc: "16", codBanco: 91, codFornecedor: 205, codHistorico: 1, codLancamento: 2, codOrigem: 0, complementoHistorico: "92966;",
  dadosCustomizados: [], dataEmissao: "2026-07-01", dataEntrada: "2026-07-01", dataVencimento: "2026-07-01", numDocumento: "92966",
  tipoLancamento: "C", tipoMoeda: 0, valorAtualizado: "2.525,44", valorDocumento: "2.525,44", valorOriginal: "2.525,44",
};

function lanc(parcial: Partial<LancamentoPagarApi> & { codLancamento: string }): LancamentoPagarApi {
  return {
    tipo: "C", codFornecedor: "1", numDocumento: "D1", categoriaDoc: "", codBanco: "91", codHistorico: "1", complemento: "", emissao: "2026-10-01",
    entrada: "2026-10-01", vencimento: "2026-10-20", valorDocumentoCentavos: 10_000, valorOriginalCentavos: 10_000, saldoCentavos: 10_000, codOrigem: "0",
    ...parcial,
  };
}
function banco(parcial: Partial<LancamentoBanco> & { codLancamento: string }): LancamentoBanco {
  return {
    id: `id-${parcial.codLancamento}`, tipo: "C", codFornecedor: "1", numDocumento: "D1", complemento: "", vencimento: "2026-10-20",
    valorDocumentoCentavos: 10_000, saldoCentavos: 10_000, baixadoEm: null, ...parcial,
  };
}

describe("paridade com consistem-receber (cópias enxutas)", () => {
  it("paraCentavos e paraDataIso dão o mesmo resultado nos dois arquivos", () => {
    for (const v of ["2.525,44", "46.728,90", "0,00", 100.5, "1234.56", "", "abc", null, 1.005]) expect(paraCentavos(v)).toBe(paraCentavosReceber(v));
    for (const v of ["2026-10-09", "0", "", "2026-02-31", "2026-10-09T10:00:00", null]) expect(paraDataIso(v)).toBe(paraDataIsoReceber(v));
  });
});

describe("normalizarLancamentoPagar", () => {
  it("lê uma antecipação real: valor pt-BR vira centavos, vencimento '0' vira nulo, ponto e vírgula do histórico sai", () => {
    const r = normalizarLancamentoPagar(ANTECIPACAO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lancamento).toMatchObject({
      codLancamento: "33428", tipo: "A", codFornecedor: "382", numDocumento: "33428", codBanco: "91", complemento: "ANTECIPAÇÃO DE COMPRA - PEDIDO 948",
      emissao: "2026-10-09", vencimento: null, valorDocumentoCentavos: 4_672_890, saldoCentavos: 4_672_890, valorOriginalCentavos: 0,
    });
  });
  it("lê um título real", () => {
    const r = normalizarLancamentoPagar(TITULO);
    expect(r.ok && r.lancamento).toMatchObject({ codLancamento: "2", tipo: "C", vencimento: "2026-07-01", saldoCentavos: 252_544, complemento: "92966", codOrigem: "0" });
  });
  it("aceita valor numérico do JSON e valorAtualizado zerado (encerrado)", () => {
    const r = normalizarLancamentoPagar({ codLancamento: 10, tipoLancamento: "C", valorDocumento: 100.5, valorAtualizado: 0 });
    expect(r.ok && r.lancamento.saldoCentavos).toBe(0);
    expect(r.ok && r.lancamento.valorDocumentoCentavos).toBe(10_050);
  });
  it("recusa sem código, tipo desconhecido e valor inválido", () => {
    expect(normalizarLancamentoPagar({ tipoLancamento: "C", valorDocumento: "1", valorAtualizado: "1" })).toMatchObject({ ok: false, motivo: "lançamento sem código" });
    expect(normalizarLancamentoPagar({ codLancamento: 1, tipoLancamento: "X", valorDocumento: "1", valorAtualizado: "1" })).toMatchObject({ ok: false });
    expect(normalizarLancamentoPagar({ codLancamento: 1, tipoLancamento: "C", valorDocumento: "abc", valorAtualizado: "1" })).toMatchObject({ ok: false, motivo: "valor do documento inválido" });
    expect(normalizarLancamentoPagar({ codLancamento: 1, tipoLancamento: "C", valorDocumento: "1", valorAtualizado: "" })).toMatchObject({ ok: false, motivo: "valor atualizado inválido" });
  });
});

describe("classificação", () => {
  it("C título, A antecipação, D crédito, B e P ignorados", () => {
    expect(classificarLancamento({ tipo: "C" })).toBe("titulo");
    expect(classificarLancamento({ tipo: "A" })).toBe("antecipacao");
    expect(classificarLancamento({ tipo: "D" })).toBe("credito");
    expect(classificarLancamento({ tipo: "B" })).toBe("ignorar");
    expect(classificarLancamento({ tipo: "P" })).toBe("ignorar");
  });
  it("em aberto é saldo maior que zero", () => {
    expect(estaEmAberto({ saldoCentavos: 1 })).toBe(true);
    expect(estaEmAberto({ saldoCentavos: 0 })).toBe(false);
  });
});

describe("detalhe e fornecedor", () => {
  it("normaliza o detalhe do lançamento (campos que a lista não traz)", () => {
    expect(normalizarDetalheLancamento({ codPortador: 91, codBarras: "", qrCodePix: "", dataPagamento: "2026-10-09", valorPago: "0" }))
      .toEqual({ codPortador: "91", codBarras: "", qrCodePix: "", dataPagamento: "2026-10-09", valorPagoCentavos: 0 });
    expect(normalizarDetalheLancamento({ dataPagamento: "" }).dataPagamento).toBeNull();
  });
  it("normaliza o fornecedor (ativo/inativo pela situação)", () => {
    expect(normalizarFornecedorApi({ codFornecedor: 382, nome: "PERFILADOS MULTIACO", nomeFantasia: "MULTIAÇO", cpfCnpj: "12345678000195", situacao: 1, codCategoria: 14 }))
      .toEqual({ codFornecedor: "382", nome: "PERFILADOS MULTIACO", nomeFantasia: "MULTIAÇO", documentoBruto: "12345678000195", ativo: true, codCategoria: 14 });
    expect(normalizarFornecedorApi({ codFornecedor: 1, nome: "X" })?.codCategoria).toBeNull();
    expect(normalizarFornecedorApi({ codFornecedor: 9, situacao: 0 })).toMatchObject({ nome: "Fornecedor 9 (Consistem)", ativo: false });
    expect(normalizarFornecedorApi({ nome: "sem código" })).toBeNull();
  });
});

describe("janelas de datas para a consulta de borderô", () => {
  it("intervalo curto vira uma janela só", () => {
    expect(janelasDeDatas(["2026-10-09", "2026-09-14", "2026-10-09", "2026-09-24"])).toEqual([{ ini: "2026-09-14", fim: "2026-10-09" }]);
  });
  it("intervalo longo é partido onde há lacuna maior que o limite", () => {
    expect(janelasDeDatas(["2026-01-06", "2026-03-10", "2026-04-14", "2026-05-28", "2026-07-02", "2026-07-06", "2026-07-17", "2026-10-09"], 3)).toEqual([
      { ini: "2026-01-06", fim: "2026-01-06" }, { ini: "2026-03-10", fim: "2026-03-10" }, { ini: "2026-04-14", fim: "2026-04-14" },
      { ini: "2026-05-28", fim: "2026-05-28" }, { ini: "2026-07-02", fim: "2026-07-02" }, { ini: "2026-07-06", fim: "2026-07-06" }, { ini: "2026-07-17", fim: "2026-07-17" }, { ini: "2026-10-09", fim: "2026-10-09" },
    ]);
  });
  it("lacuna maior agrupa dias próximos", () => {
    expect(janelasDeDatas(["2026-07-02", "2026-07-06", "2026-10-09"], 4)).toEqual([{ ini: "2026-07-02", fim: "2026-07-06" }, { ini: "2026-10-09", fim: "2026-10-09" }]);
  });
  it("ignora lixo e lista vazia", () => {
    expect(janelasDeDatas([])).toEqual([]);
    expect(janelasDeDatas(["0", "", "2026-10-09"])).toEqual([{ ini: "2026-10-09", fim: "2026-10-09" }]);
    expect(diaSeguinte("2026-12-31")).toBe("2027-01-01");
    expect(FILTRO_BORDERO).toEqual({ campoFiltroDinamico: "codBordero", valorFiltroDinamico: "%" });
    expect(FILTRO_CONFIRMADO).toEqual({ campoFiltroDinamico: "docConfirmado", valorFiltroDinamico: "1" });
  });
});

describe("confirmação no Consistem (docConfirmado)", () => {
  it("quem veio na resposta vira confirmado; quem foi coberto e não veio vira não confirmado; só grava o que muda", () => {
    const cobertos = [
      { id: "a", codLancamento: "1479", confirmadoAtual: null },   // confirmado agora: grava true
      { id: "b", codLancamento: "1480", confirmadoAtual: true },   // continua confirmado: nada
      { id: "c", codLancamento: "1481", confirmadoAtual: true },   // deixou de constar: grava false
      { id: "d", codLancamento: "1482", confirmadoAtual: null },   // verificado e não confirmado: grava false
      { id: "e", codLancamento: "1483", confirmadoAtual: false },  // continua não confirmado: nada
      { id: "f", codLancamento: "1484", confirmadoAtual: false },  // passou a confirmado: grava true
    ];
    expect(planejarConfirmacoes(cobertos, new Set(["1479", "1480", "1484", "9999"]))).toEqual({ confirmar: ["a", "f"], desconfirmar: ["c", "d"] });
    expect(planejarConfirmacoes([], new Set(["1"]))).toEqual({ confirmar: [], desconfirmar: [] });
  });
});

describe("planejarSincronizacaoPagar", () => {
  it("novos: só C, A e D em aberto; B e P em aberto contam como ignorados; sem saldo e sem registro = encerrados", () => {
    const api = [
      lanc({ codLancamento: "1" }),
      lanc({ codLancamento: "2", tipo: "A", vencimento: null }),
      lanc({ codLancamento: "3", tipo: "D" }),
      lanc({ codLancamento: "4", tipo: "P" }),
      lanc({ codLancamento: "5", tipo: "B" }),
      lanc({ codLancamento: "6", saldoCentavos: 0 }),
    ];
    const plano = planejarSincronizacaoPagar(api, []);
    expect(plano.novos.map((n) => n.codLancamento)).toEqual(["1", "2", "3"]);
    expect(plano.ignorados).toBe(2);
    expect(plano.encerradosNaApi).toBe(1);
    expect(plano.abertosPorTipo.C).toEqual({ quantidade: 1, centavos: 10_000 });
    expect(plano.abertosPorTipo.P.quantidade).toBe(1);
  });
  it("alterados: saldo, vencimento, documento, fornecedor ou histórico mudaram; iguais contam como inalterados", () => {
    const api = [
      lanc({ codLancamento: "1", saldoCentavos: 5_000 }),
      lanc({ codLancamento: "2", vencimento: "2026-11-01" }),
      lanc({ codLancamento: "3" }),
      lanc({ codLancamento: "4", complemento: "PEDIDO 948", codFornecedor: "7" }),
    ];
    const no = [banco({ codLancamento: "1" }), banco({ codLancamento: "2" }), banco({ codLancamento: "3" }), banco({ codLancamento: "4" })];
    const plano = planejarSincronizacaoPagar(api, no);
    expect(plano.alterados).toEqual([
      { id: "id-1", campos: { valor_atualizado: 50 } },
      { id: "id-2", campos: { data_vencimento: "2026-11-01" } },
      { id: "id-4", campos: { cod_fornecedor: "7", complemento_historico: "PEDIDO 948" } },
    ]);
    expect(plano.inalterados).toBe(1);
    expect(plano.baixados).toEqual([]);
  });
  it("baixados: aberto no banco que sumiu da API ou voltou com saldo zero; já baixado não repete", () => {
    const api = [lanc({ codLancamento: "2", saldoCentavos: 0 })];
    const no = [banco({ codLancamento: "1" }), banco({ codLancamento: "2" }), banco({ codLancamento: "3", baixadoEm: "2026-10-01" })];
    const plano = planejarSincronizacaoPagar(api, no);
    expect(plano.baixados.sort()).toEqual(["id-1", "id-2"]);
    expect(plano.novos).toEqual([]);
  });
  it("reaberto: baixado no banco que voltou com saldo na API perde o baixado_em", () => {
    const plano = planejarSincronizacaoPagar([lanc({ codLancamento: "1" })], [banco({ codLancamento: "1", baixadoEm: "2026-10-01" })]);
    expect(plano.alterados).toEqual([{ id: "id-1", campos: { baixado_em: null } }]);
  });
  it("código repetido na API: vale o primeiro e o resto vai para duplicadosApi", () => {
    const plano = planejarSincronizacaoPagar([lanc({ codLancamento: "1" }), lanc({ codLancamento: "1", saldoCentavos: 1 })], []);
    expect(plano.novos).toHaveLength(1);
    expect(plano.duplicadosApi).toEqual(["1"]);
  });
});
