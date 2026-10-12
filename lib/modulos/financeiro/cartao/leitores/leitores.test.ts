import { describe, expect, it } from "vitest";
import { paginaPicpay, paginaResumoPicpay, paginaResumoSicredi, paginaSicredi } from "../fixtures/sinteticas";
import { dataComAno, dataDeTexto, motivoDescarte, parcelaDe } from "./comum";
import { lerFatura, paginaDeMatriz } from "./index";
import { somaLinhas } from "./comum";

describe("peças comuns", () => {
  it("infere o ano pela data do vencimento (compra depois do vencimento é do ano anterior)", () => {
    expect(dataComAno(27, 9, "2026-10-10")).toBe("2026-09-27");
    expect(dataComAno(30, 10, "2026-08-10")).toBe("2025-10-30");
    expect(dataComAno(11, 2, "2026-10-10")).toBe("2026-02-11");
    expect(dataDeTexto("27/set 21:02", "2026-10-10")).toBe("2026-09-27");
    expect(dataDeTexto("20/10", "2026-08-25")).toBe("2025-10-20");
    expect(dataDeTexto("20/10/2026", "2026-11-10")).toBe("2026-10-20");
    expect(dataDeTexto("2026-06-05", "2026-06-27")).toBe("2026-06-05");
  });
  it("parcela e descarte", () => {
    expect(parcelaDe("01/03")).toEqual({ num: 1, total: 3 });
    expect(parcelaDe("PARC07/08")).toEqual({ num: 7, total: 8 });
    expect(parcelaDe("10/10/2026")).toBeNull(); // é data, não parcela (10/10 seguido de /2026)
    expect(parcelaDe("5/3")).toBeNull();
    expect(motivoDescarte("Pagamento 029571246")).toMatch(/Pagamento/);
    expect(motivoDescarte("PAGAMENTO DE FATURA")).toMatch(/não é despesa/);
    expect(motivoDescarte("Shock Metais")).toBeNull();
  });
});

describe("leitor Sicredi", () => {
  const paginas = [
    paginaResumoSicredi("R$ 78.528,72"),
    paginaSicredi(2, [
      { dataHora: "27/set 21:02", descricao: ["Anuidade Diferenc 07/12", "0000"], valor: "R$ 50,00" },
      { dataHora: "18/set 10:11", cidade: "Curitiba", compra: "Online", descricao: ["Loja Azul"], parcela: "01/03", valor: "R$ 5.919,84" },
      { dataHora: "15/set 16:17", cidade: "Vinhedo", compra: "Online", descricao: ["Fornecedor", "Exemplo"], parcela: "01/10", valor: "R$ 1.073,98" },
      { dataHora: "10/set 21:38", descricao: ["Pagamento 029571246"], valor: "-R$ 91.374,55" },
      { dataHora: "03/set 21:32", descricao: ["Credito Anuidade Cartao"], valor: "-R$ 50,00" },
      { dataHora: "12/ago 23:34", compra: "Online", descricao: ["Metais Ltda"], parcela: "02/03", valor: "R$ 26.666,66" },
      { dataHora: "11/fev 23:34", compra: "Presencial", descricao: ["Concreto Sa"], parcela: "08/12", valor: "R$ 2.166,66" },
      { dataHora: "10/jul 05:22", descricao: ["Slack Dublin 1", "Ie"], dolar: "US$ 103,95", cotacao: "R$ 5,18", valor: "R$ 538,90" },
    ], { totalCartao: "R$ 36.365,04", totalFatura: "R$ 78.528,72" }),
    paginaSicredi(3, [{ dataHora: "14/set 00:35", cidade: "Sao Paulo", compra: "Online", descricao: ["Livros Digitais"], valor: "R$ 24,90" }], { totalCartao: "R$ 24,90", totalFatura: "R$ 78.528,72" }),
  ];
  const r = lerFatura("sicredi", paginas, { vencimento: "2026-10-10" });

  it("lê todas as transações, junta a descrição quebrada e ignora totais", () => {
    expect(r.avisos).toEqual([]);
    expect(r.linhas).toHaveLength(9);
    expect(r.linhas.map((l) => l.descricao)).toEqual([
      "Anuidade Diferenc 07/12 0000", "Loja Azul", "Fornecedor Exemplo", "Pagamento 029571246", "Credito Anuidade Cartao", "Metais Ltda", "Concreto Sa", "Slack Dublin 1 Ie", "Livros Digitais",
    ]);
  });
  it("data com ano inferido, parcela da coluna própria, valor em reais (não o dólar nem a cotação), pagamento descartado", () => {
    const loja = r.linhas[1];
    expect(loja).toMatchObject({ dataCompra: "2026-09-18", valorCentavos: 591_984, parcelaNum: 1, parcelaTotal: 3, descartada: false });
    expect(r.linhas[6]).toMatchObject({ dataCompra: "2026-02-11", parcelaNum: 8, parcelaTotal: 12 });
    expect(r.linhas[7]).toMatchObject({ valorCentavos: 53_890, parcelaNum: null });
    expect(r.linhas[3]).toMatchObject({ valorCentavos: -9_137_455, descartada: true });
    expect(r.linhas[4]).toMatchObject({ valorCentavos: -5_000, descartada: false });
  });
  it("total e vencimento impressos; a soma das linhas não descartadas bate com o total", () => {
    expect(r.totalImpressoCentavos).toBe(7_852_872);
    expect(r.vencimentoImpresso).toBe("2026-10-10");
    expect(somaLinhas(r.linhas)).toBe(5_000 + 591_984 + 107_398 - 5_000 + 2_666_666 + 216_666 + 53_890 + 2_490);
  });
  it("arquivo sem o cabeçalho do Sicredi avisa", () => {
    const x = lerFatura("sicredi", [paginaResumoSicredi("R$ 1,00")], { vencimento: "2026-10-10" });
    expect(x.linhas).toEqual([]);
    expect(x.avisos[0]).toMatch(/não parece uma fatura Sicredi/);
  });
});

describe("leitor PicPay", () => {
  const paginas = [
    paginaResumoPicpay("R$ 12.005,32"),
    paginaPicpay(3, [
      { titulo: "Tarifas", transacoes: [
        { data: "09/08", descricao: ["IOF DIARIO ROTATIVO"], valor: "3,64" },
        { data: "19/08", descricao: ["JUROS CREDITO ROTATIVO"], valor: "220,77" },
        { data: "19/08", descricao: ["MULTA POR ATRASO"], valor: "173,50" },
      ], subtotal: "397,91" },
      { transacoes: [{ data: "30/07", descricao: ["PAGAMENTO DE FATURA"], valor: "-8.890,72" }], subtotal: "412,72" },
      { transacoes: [{ data: "20/10", descricao: ["LOJA MOVEIS*LOJAPARC10/10"], valor: "115,80" }], subtotal: "115,80" },
    ], [
      { transacoes: [
        { data: "03/02", descricao: ["TINTAS LTDA PARC07/08"], valor: "635,00" },
        { data: "28/07", descricao: ["CIA AEREA A*WCWUWA0-", "TXEM"], valor: "84,50" },
        { data: "28/07", descricao: ["HOTEIS.COM PARC01/04"], valor: "100,59" },
        { data: "03/08", descricao: ["LOJA ONLINE*LOJAONL"], valor: "1.247,23" },
      ] },
    ]),
    paginaPicpay(4, [{ transacoes: [{ data: "13/08", descricao: ["POSTO COMBUSTIVEL"], valor: "300,00" }], subtotal: "300,00" }], [], { totalGeral: "12.005,32" }),
  ];
  const r = lerFatura("picpay", paginas, { vencimento: "2026-08-25" });

  it("lê as duas colunas, tira a parcela colada ao nome e junta a descrição quebrada", () => {
    expect(r.avisos).toEqual([]);
    expect(r.linhas.map((l) => l.descricao)).toEqual([
      "IOF DIARIO ROTATIVO", "JUROS CREDITO ROTATIVO", "MULTA POR ATRASO", "PAGAMENTO DE FATURA", "LOJA MOVEIS*LOJA",
      "TINTAS LTDA", "CIA AEREA A*WCWUWA0- TXEM", "HOTEIS.COM", "LOJA ONLINE*LOJAONL", "POSTO COMBUSTIVEL",
    ]);
    expect(r.linhas[4]).toMatchObject({ dataCompra: "2025-10-20", parcelaNum: 10, parcelaTotal: 10, valorCentavos: 11_580 });
    expect(r.linhas[5]).toMatchObject({ dataCompra: "2026-02-03", parcelaNum: 7, parcelaTotal: 8, valorCentavos: 63_500 });
    expect(r.linhas[3]).toMatchObject({ descartada: true, valorCentavos: -889_072 });
    expect(r.linhas[8].valorCentavos).toBe(124_723);
  });
  it("total geral e vencimento impressos", () => {
    expect(r.totalImpressoCentavos).toBe(1_200_532);
    expect(r.vencimentoImpresso).toBe("2026-08-25");
  });
});

describe("leitor genérico (CSV e plano B)", () => {
  it("lê o CSV do Nubank (date,title,amount com ponto decimal) e linhas 'dd/mm descrição valor'", () => {
    const pagina = paginaDeMatriz([
      ["date", "title", "amount"],
      ["2026-06-05", "EBW*NuViagens - NuPay - Parcela 3/8", "352.12"],
      ["2026-06-07", "IOF de Compra Internacional", "4.07"],
      ["2026-06-10", "Pagamento recebido", "-9883.45"],
      ["2026-06-12", "Estorno de \"Uber\"", "-25.90"],
    ]);
    const r = lerFatura("generico", [pagina], { vencimento: "2026-06-27" });
    expect(r.linhas).toHaveLength(4);
    expect(r.linhas[0]).toMatchObject({ dataCompra: "2026-06-05", descricao: "EBW*NuViagens - NuPay - Parcela 3/8", valorCentavos: 35_212, parcelaNum: 3, parcelaTotal: 8 });
    expect(r.linhas[2]).toMatchObject({ descartada: true, valorCentavos: -988_345 });
    expect(r.linhas[3].valorCentavos).toBe(-2_590);
    const texto = paginaDeMatriz([["20/10 FLEXFORM PARC 02/06 R$ 115,80"], ["Total da fatura", "R$ 115,80"]]);
    const g = lerFatura("generico", [texto], { vencimento: "2026-11-10" });
    expect(g.linhas).toHaveLength(1);
    expect(g.linhas[0]).toMatchObject({ dataCompra: "2026-10-20", descricao: "FLEXFORM PARC", valorCentavos: 11_580, parcelaNum: 2, parcelaTotal: 6 });
    expect(g.totalImpressoCentavos).toBe(11_580);
  });
});
