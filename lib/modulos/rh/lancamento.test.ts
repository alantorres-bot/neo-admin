import { describe, expect, it } from "vitest";
import { codigosDoModelo, codigosDoTitulo, complemento, contaPagadora, documento, lerCodigosTipo, lerParametrosLancamento, montarTitulo } from "./lancamento";

const salario = { codHistorico: 5, grupoContaFluxoCaixa: 12, contaFluxoCaixa: 3, contaContabilDebito: 3101, contaContabilCredito: 2101 };
const parametros = lerParametrosLancamento({
  categoriaDoc: 6,
  tipos: { salario, vt: { ...salario, codHistorico: 27 }, ferias: { ...salario, contaFluxoCaixa: undefined }, outro: salario },
  portadores: [
    { empregador: "oeste ", forma: "pix", codPortador: 40, conta: " Conta Oeste " },
    { empregador: "NEO SERVIÇOS", forma: "pix", codPortador: 41, conta: "" },
    { empregador: "OESTE", forma: "fopag", codPortador: "91" },
    { empregador: "", forma: "pix", codPortador: 1 },
  ],
});

describe("parâmetros dos títulos do RH no Consistem", () => {
  it("lê: tipos completos, portadores válidos (empregador em maiúsculas), ignora o resto", () => {
    expect(Object.keys(parametros.tipos)).toEqual(["vt", "salario"]);
    expect(parametros.categoriaDoc).toBe(6);
    expect(parametros.portadores).toEqual([
      { empregador: "OESTE", forma: "pix", codPortador: 40, conta: "Conta Oeste" },
      { empregador: "NEO SERVIÇOS", forma: "pix", codPortador: 41, conta: null },
      { empregador: "OESTE", forma: "fopag", codPortador: 91, conta: null },
    ]);
    expect(lerParametrosLancamento(null)).toEqual({ categoriaDoc: null, tipos: {}, portadores: [] });
    expect(lerCodigosTipo({ ...salario, contaContabilCredito: 3101 })).toBeNull();
  });

  it("códigos do título = tipo + categoria + portador da empregadora/forma; forma antiga conta como PIX", () => {
    expect(codigosDoTitulo(parametros, "salario", "Oeste", "pix_neo_formas")).toEqual({ ...salario, categoriaDoc: 6, codPortador: 40 });
    expect(codigosDoTitulo(parametros, "vt", "OESTE", "fopag")?.codPortador).toBe(91);
    expect(codigosDoTitulo(parametros, "salario", "NEO SERVIÇOS", "fopag")).toBeNull();   // sem portador
    expect(codigosDoTitulo(parametros, "decimo_1", "OESTE", "pix")).toBeNull();          // tipo sem códigos
    expect(codigosDoTitulo({ ...parametros, categoriaDoc: null }, "salario", "OESTE", "pix")).toBeNull();
    expect(contaPagadora(parametros, "OESTE", "pix")).toBe("Conta Oeste");
    expect(contaPagadora(parametros, "NEO FORMAS", "pix")).toBeNull();
  });

  it("monta o título: fornecedor = Nº, vencimento = pagamento, documento sigla+MMAA, complemento TIPO - MM/AAAA", () => {
    const codigos = codigosDoTitulo(parametros, "salario", "OESTE", "pix")!;
    expect(montarTitulo({ tipo: "salario", codFornecedor: "696", valor: 1300.004, competencia: "2026-10-01", dataPagamento: "2026-11-09", hoje: "2026-11-05", codigos })).toEqual({
      codFornecedor: 696, categoriaDoc: 6, codDocumento: "SA1026", codPortador: 40, dataEmissao: "2026-11-05", dataEntrada: "2026-11-05",
      dataVencimento: "2026-11-09", valorDocumento: 1300, codHistorico: 5, complementoHistorico: "SALÁRIO - 10/2026",
      grupoContaFluxoCaixa: 12, contaFluxoCaixa: 3, dadosContabilidade: { contaContabilDebito: 3101, contaContabilCredito: 2101, listaCentroCustoContab: [] },
    });
    expect(complemento("vt", "2026-11-01")).toBe("VALE TRANSPORTE - 11/2026");
    expect(complemento("decimo_2", "2026-12-01")).toBe("13º SALÁRIO 2ª PARCELA - 12/2026");
    expect(documento("vt", "2027-01-01")).toBe("VT0127");
  });

  it("lê os códigos do título modelo (detalhe da API); ausentes ficam de fora", () => {
    expect(codigosDoModelo({ codHistorico: "3", codBanco: 91, categoriaDoc: 17, contaFluxoCaixa: "45", dadosContabilidade: { contaContabilDebito: 3101, contaContabilCredito: "0" } }))
      .toEqual({ codHistorico: 3, codPortador: 91, categoriaDoc: 17, contaFluxoCaixa: 45, contaContabilDebito: 3101 });
  });
});
