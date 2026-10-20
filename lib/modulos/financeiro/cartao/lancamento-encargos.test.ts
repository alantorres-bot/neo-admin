import { describe, expect, it } from "vitest";
import { identificarCartaoDoTitulo } from "./cartoes";
import { CARTOES_TESTE } from "./cartoes.test";
import { conciliar, type DecisaoItem, type LinhaFatura, type TituloPagar } from "./conciliacao";
import { complementoEncargos, documentoDoFechamento, encargosALancar, lerConfigEncargos, montarTituloEncargos } from "./lancamento-encargos";

const SICREDI_PF = CARTOES_TESTE.find((c) => c.codigo === "SICREDI PF")!;
const CONFIG = {
  codFornecedor: 80, codHistorico: 2, codPortador: 91, categoriaDoc: 17, grupoContaFluxoCaixa: 22, contaFluxoCaixa: 28, contaContabilDebito: 3473, contaContabilCredito: 2004,
};
const linha = (id: string, descricao: string, reais: number): LinhaFatura => ({
  id, ordem: Number(id.replace(/\D/g, "")) || 1, dataCompra: "2026-09-20", descricao, valorCentavos: Math.round(reais * 100), parcelaNum: null, parcelaTotal: null,
});
const LINHAS = [
  linha("l1", "IOF COMPRA INTERNACIONAL", 12.34),
  linha("l2", "JUROS DE MORA", 50),
  linha("l3", "ESTORNO IOF", -2.34),                 // estorno: natureza "Estorno / crédito", fora da soma
  linha("l4", "SUPERMERCADO X", 100),                // não é encargo
  linha("l5", "ANUIDADE DIFERENCIADA", 30),
];
const base = (decisoes: DecisaoItem[] = [], titulos: TituloPagar[] = []) => conciliar({
  cartao: SICREDI_PF, cartoes: CARTOES_TESTE, vencimento: "2026-10-10", totalInformadoCentavos: 19_000, linhas: LINHAS, titulos, estabelecimentos: [], decisoes,
});
const justificar = (linhaId: string): DecisaoItem => ({ id: "d1", tipo: "justificar", linhas: [linhaId], titulos: [], categoria: null, contaFluxo: null, motivo: "x", autor: null, em: "2026-10-12" });

describe("encargos a lançar", () => {
  it("só 'Encargo financeiro' sem justificativa e fora de lançamento anterior", () => {
    expect(encargosALancar(base()).map((a) => a.linha.id)).toEqual(["l1", "l2", "l5"]);
    expect(encargosALancar(base([justificar("l5")])).map((a) => a.linha.id)).toEqual(["l1", "l2"]);
    expect(encargosALancar(base(), new Set(["l1"])).map((a) => a.linha.id)).toEqual(["l2", "l5"]);
  });
});

describe("título de encargos", () => {
  it("monta o corpo do Consistem com a soma, as datas do fechamento e os códigos do cartão", () => {
    const t = montarTituloEncargos({ nomeCartao: "SICREDI PF", config: CONFIG, linhas: encargosALancar(base()), fechamento: "2026-09-26", vencimento: "2026-10-13" });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.valorCentavos).toBe(9_234);
    expect(t.payload).toEqual({
      codFornecedor: 80, categoriaDoc: 17, codDocumento: "260926", codPortador: 91, dataEmissao: "2026-09-26", dataEntrada: "2026-09-26", dataVencimento: "2026-10-13",
      valorDocumento: 92.34, codHistorico: 2, complementoHistorico: "CARTÃO SICREDI PF — ENCARGOS: IOF, JUROS, ANUIDADE", grupoContaFluxoCaixa: 22, contaFluxoCaixa: 28,
      dadosContabilidade: { contaContabilDebito: 3473, contaContabilCredito: 2004, listaCentroCustoContab: [] },
    });
  });
  it("recusa sem configuração, sem fechamento, sem linhas ou com soma não positiva", () => {
    const linhas = encargosALancar(base());
    expect(montarTituloEncargos({ nomeCartao: "X", config: null, linhas, fechamento: "2026-09-26", vencimento: "2026-10-10" })).toMatchObject({ ok: false, erro: /códigos do Consistem/ });
    expect(montarTituloEncargos({ nomeCartao: "X", config: CONFIG, linhas, fechamento: null, vencimento: "2026-10-10" })).toMatchObject({ ok: false, erro: /fechamento/ });
    expect(montarTituloEncargos({ nomeCartao: "X", config: CONFIG, linhas: [], fechamento: "2026-09-26", vencimento: "2026-10-10" })).toMatchObject({ ok: false, erro: /Nenhum encargo/ });
    const negativa = [{ ...linhas[0], linha: { ...linhas[0].linha, valorCentavos: -100 } }];
    expect(montarTituloEncargos({ nomeCartao: "X", config: CONFIG, linhas: negativa, fechamento: "2026-09-26", vencimento: "2026-10-10" })).toMatchObject({ ok: false, erro: /não é positiva/ });
  });
  it("complemento até 70 caracteres e reconhecido como do cartão", () => {
    const c = complementoEncargos("SICREDI PF", ["IOF", "JUROS ROTATIVO", "MULTA", "ANUIDADE", "TARIFA AVULSA", "SEGURO PRESTAMISTA", "PARCELAMENTO DE FATURA"]);
    expect(c.length).toBeLessThanOrEqual(70);
    expect(c.startsWith("CARTÃO SICREDI PF — ENCARGOS: IOF, JUROS, MULTA")).toBe(true);
    expect(complementoEncargos("ITAÚ PJ", ["ENCARGOS DIVERSOS"])).toBe("CARTÃO ITAÚ PJ — ENCARGOS");
    const id = identificarCartaoDoTitulo({ complemento: complementoEncargos("SICREDI PF", ["IOF"]), vencimento: "2026-10-10" }, CARTOES_TESTE);
    expect(id.situacao === "cartao" && id.cartao?.codigo).toBe("SICREDI PF");
  });
  it("documento = DDMM do fechamento; configuração exige todos os códigos inteiros positivos", () => {
    expect(documentoDoFechamento("2026-09-26")).toBe("260926");
    expect(documentoDoFechamento("2026-10-19")).toBe("191026");   // com o ano: DDMM repete todo ano no mesmo fornecedor
    expect(lerConfigEncargos(CONFIG)).toEqual(CONFIG);
    expect(lerConfigEncargos({ ...CONFIG, codHistorico: "2" })).toEqual(CONFIG);
    expect(lerConfigEncargos({ ...CONFIG, contaFluxoCaixa: 0 })).toBeNull();
    expect(lerConfigEncargos({ ...CONFIG, codPortador: 1.5 })).toBeNull();
    expect(lerConfigEncargos(null)).toBeNull();
  });
});

describe("depois de lançado", () => {
  it("a decisão 'casar' com o título criado tira os encargos de 'A lançar'", () => {
    const titulo: TituloPagar = {
      id: "api:40001", codLancamento: "40001", numeroTitulo: "2609", fornecedor: "BANCO SICREDI", vencimento: "2026-10-13",
      complemento: "CARTÃO SICREDI PF — ENCARGOS: IOF, JUROS, ANUIDADE", tipoTitulo: "", valorCentavos: 9_234,
    };
    const casar: DecisaoItem = { id: "d2", tipo: "casar", linhas: ["l1", "l2", "l5"], titulos: ["40001"], categoria: null, contaFluxo: null, motivo: "lançado", autor: null, em: "2026-10-12" };
    const r = base([casar], [titulo]);
    expect(encargosALancar(r)).toEqual([]);
    expect(r.conciliados.find((c) => c.modo === "Manual")?.diferencaCentavos).toBe(0);
    expect(r.aLancar.map((a) => a.linha.id)).toEqual(["l3", "l4"]);
  });
});
