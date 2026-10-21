import { describe, expect, it } from "vitest";
import { identificarCartaoDoTitulo } from "./cartoes";
import { CARTOES_TESTE } from "./cartoes.test";
import { conciliar, type DecisaoItem, type LinhaFatura, type TituloPagar } from "./conciliacao";
import { complementoCompra, lerCampos, montarTitulosCompra, padraoSugerido, somarMeses, sugestaoDaLinha } from "./lancamento-compras";

const SICREDI_PF = CARTOES_TESTE.find((c) => c.codigo === "SICREDI PF")!;   // fecha 26, vence 10
const CARTAO = { codPortador: 91, categoriaDoc: 17, codHistorico: 2, contaContabilCredito: 2004 };
const ESTAB = [
  { padrao: "NUVIAGENS", lancamentoErp: { codFornecedor: 1500, grupoContaFluxoCaixa: 13, contaFluxoCaixa: 6, contaContabilDebito: 3338 } },
  { padrao: "POSTO", lancamentoErp: { grupoContaFluxoCaixa: 18, contaFluxoCaixa: 4, contaContabilDebito: 3344, codHistorico: 54 } },
];
const CAMPOS = { ...CARTAO, codFornecedor: 1500, grupoContaFluxoCaixa: 13, contaFluxoCaixa: 6, contaContabilDebito: 3338 };
const linha = (descricao: string, reais: number, parcelaNum: number | null = null, parcelaTotal: number | null = null): LinhaFatura => ({
  id: "l1", ordem: 1, dataCompra: "2026-08-15", descricao, valorCentavos: Math.round(reais * 100), parcelaNum, parcelaTotal,
});

describe("sugestão pelo estabelecimento", () => {
  it("estabelecimento por cima do cartão; o que faltar fica para escolher", () => {
    const s = sugestaoDaLinha("NUVIAGENS*AEREO 123", ESTAB, CARTAO);
    expect(s.padrao).toBe("NUVIAGENS");
    expect(s.campos).toEqual(CAMPOS);
    expect(s.origem).toMatchObject({ codFornecedor: "estabelecimento", codPortador: "cartao", contaContabilDebito: "estabelecimento" });
    const posto = sugestaoDaLinha("POSTO SAO JOSE", ESTAB, CARTAO);
    expect(posto.campos.codHistorico).toBe(54);
    expect(posto.origem.codFornecedor).toBe("escolher");
    const nada = sugestaoDaLinha("LOJA X", ESTAB, {});
    expect(nada.padrao).toBeNull();
    expect(Object.values(nada.origem).every((o) => o === "escolher")).toBe(true);
  });
  it("lê códigos do banco e sugere a chave para lembrar", () => {
    expect(lerCampos({ codFornecedor: "12", contaFluxoCaixa: 0, outro: 5, codHistorico: 2.5 })).toEqual({ codFornecedor: 12 });
    expect(padraoSugerido("NUVIAGENS*123 SAO PAULO")).toBe("NUVIAGENS");
    expect(padraoSugerido("99APP *99APP")).toBe("99APP");
  });
});

describe("títulos da compra", () => {
  it("à vista: um título no vencimento da fatura, emissão na compra e entrada no fechamento, documento DDMMAA, códigos escolhidos", () => {
    const r = montarTitulosCompra({ linha: linha("NUVIAGENS*AEREO", 461.92), cartao: SICREDI_PF, campos: CAMPOS, vencimentoFatura: "2026-10-13", competencia: "2026-10-01", fechamento: "2026-09-26" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.titulos).toHaveLength(1);
    expect(r.titulos[0]).toEqual({
      parcela: 1, parcelas: 1, vencimento: "2026-10-13",
      payload: {
        codFornecedor: 1500, categoriaDoc: 17, codDocumento: "150826-1", codPortador: 91, dataEmissao: "2026-08-15", dataEntrada: "2026-09-26",
        dataVencimento: "2026-10-13", valorDocumento: 461.92, codHistorico: 2, complementoHistorico: "CARTÃO SICREDI PF 1x — NUVIAGENS*AEREO",
        grupoContaFluxoCaixa: 13, contaFluxoCaixa: 6, dadosContabilidade: { contaContabilDebito: 3338, contaContabilCredito: 2004, listaCentroCustoContab: [] },
      },
    });
  });
  it("parcela 2/5 sem título: quatro títulos, nos vencimentos das competências seguintes", () => {
    const r = montarTitulosCompra({ linha: linha("LATAM AIR", 300, 2, 5), cartao: SICREDI_PF, campos: CAMPOS, vencimentoFatura: "2026-10-13", competencia: "2026-10-01", fechamento: "2026-09-26" });
    if (!r.ok) throw new Error(r.erro);
    expect(r.titulos.map((t) => [t.parcela, t.vencimento, t.payload.codDocumento, t.payload.valorDocumento])).toEqual([
      [2, "2026-10-13", "150826-1/2", 300], [3, "2026-11-10", "150826-1/3", 300], [4, "2026-12-10", "150826-1/4", 300], [5, "2027-01-10", "150826-1/5", 300],
    ]);
    expect(r.titulos[3].payload.complementoHistorico).toBe("CARTÃO SICREDI PF 5x — LATAM AIR PARC 5/5");
  });
  it("recusa estorno, campo vazio e linha sem data", () => {
    const base = { cartao: SICREDI_PF, vencimentoFatura: "2026-10-13", competencia: "2026-10-01", fechamento: "2026-09-26" };
    expect(montarTitulosCompra({ ...base, linha: linha("X", -10), campos: CAMPOS })).toMatchObject({ ok: false, erro: /Estorno/ });
    expect(montarTitulosCompra({ ...base, linha: linha("X", 10), campos: { ...CAMPOS, contaFluxoCaixa: undefined } })).toMatchObject({ ok: false, erro: /conta de fluxo/ });
    expect(montarTitulosCompra({ ...base, linha: { ...linha("X", 10), dataCompra: null }, campos: CAMPOS })).toMatchObject({ ok: false, erro: /data da compra/ });
    expect(montarTitulosCompra({ ...base, fechamento: null, linha: linha("X", 10), campos: CAMPOS })).toMatchObject({ ok: false, erro: /fechamento/ });
  });
  it("complemento até 60 caracteres, mantendo a parcela, e reconhecido como do cartão", () => {
    const c = complementoCompra("SICREDI PF", 10, 12, "LOJA COM UM NOME MUITO GRANDE QUE NAO CABE NO CAMPO DO CONSISTEM");
    expect(c.length).toBeLessThanOrEqual(60);
    expect(c.endsWith(" PARC 10/12")).toBe(true);
    const id = identificarCartaoDoTitulo({ complemento: c, vencimento: "2026-10-10" }, CARTOES_TESTE);
    expect(id.situacao === "cartao" && id.cartao?.codigo).toBe("SICREDI PF");
    expect(somarMeses("2026-11-01", 3)).toBe("2027-02-01");
  });
});

describe("depois de lançada", () => {
  it("a decisão 'casar' com o título da parcela desta fatura tira a linha de 'A lançar'", () => {
    const l = linha("NUVIAGENS*AEREO", 461.92);
    const titulo: TituloPagar = { id: "api:50001", codLancamento: "50001", numeroTitulo: "1508", fornecedor: "NUVIAGENS", vencimento: "2026-10-13",
      complemento: "CARTÃO SICREDI PF 1x — NUVIAGENS*AEREO", tipoTitulo: "", valorCentavos: 46_192 };
    const casar: DecisaoItem = { id: "d", tipo: "casar", linhas: ["l1"], titulos: ["50001"], categoria: null, contaFluxo: null, motivo: "lançada", autor: null, em: "2026-10-13" };
    const r = conciliar({ cartao: SICREDI_PF, cartoes: CARTOES_TESTE, vencimento: "2026-10-10", totalInformadoCentavos: 46_192, linhas: [l], titulos: [titulo], estabelecimentos: [], decisoes: [casar] });
    expect(r.aLancar).toEqual([]);
    expect(r.residuoCentavos).toBe(0);
  });
});

describe("conferência das contas contábeis", () => {
  it("recusa débito igual ao crédito e débito na conta de fornecedores (crédito padrão)", async () => {
    const { conferirContas } = await import("./lancamento-compras");
    expect(conferirContas({ contaContabilDebito: 3435, contaContabilCredito: 2004 }, 2004)).toBeNull();
    expect(conferirContas({ contaContabilDebito: 2004, contaContabilCredito: 2004 }, 2004)).toMatch(/igual/);
    expect(conferirContas({ contaContabilDebito: 2004, contaContabilCredito: 3241 }, 2004)).toMatch(/conta de fornecedores/);
    expect(conferirContas({}, 2004)).toBeNull();
  });
});
