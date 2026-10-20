import { describe, expect, it } from "vitest";
import {
  calcularComissao, chaveCredito, chaveTitulo, cruzarZComCreditos, dataDaPlanilha, ehFilial, ehTituloZ, lerPlanilhaCreditos, montarProposta, proporLinhas,
  representanteDoCliente, tipoDoTitulo, totalizar, valorDaPlanilha, type Representante, type TituloPago,
} from "./regras";

const FERNANDO: Representante = { cod_representante: "3", nome: "Fernando", perc_venda: 1.5, perc_locacao: 3, recebe_de: ["3", "7"], ativo: true };
const HEITOR: Representante = { cod_representante: "7", nome: "Heitor", perc_venda: 1, perc_locacao: 1, recebe_de: ["7"], ativo: true };
const t = (cod: string, o: Partial<TituloPago> = {}): TituloPago => ({
  cod_titulo: cod, cod_cliente: "100", cod_representante: "3", nota_fiscal: null, valor_centavos: 15_400_000, valor_pago_centavos: null,
  data_pagamento: "2026-09-03", data_vencimento: null, tipo_baixa: "3", tipo_nota: null, comissao_consistem_centavos: null, ...o,
});

describe("classificação do título", () => {
  it("Z, Filial e venda/locação", () => {
    expect(ehTituloZ("Z00027A")).toBe(true);
    expect(ehTituloZ("AZ00019E")).toBe(true);
    expect(ehTituloZ("1001295C")).toBe(false);
    expect(ehFilial("4000040U")).toBe(true);
    expect(ehFilial("4102252U")).toBe(false);
    expect(tipoDoTitulo({ cod_titulo: "1001295C", tipo_nota: "12" })).toBe("locacao"); // o tipo da NF decide
    expect(tipoDoTitulo({ cod_titulo: "4102252U", tipo_nota: "4" })).toBe("venda");
    expect(tipoDoTitulo({ cod_titulo: "4102252U", tipo_nota: null })).toBe("locacao"); // sem NF: começa com 4, fora da Filial
    expect(tipoDoTitulo({ cod_titulo: "A1001291B", tipo_nota: null })).toBe("venda");
  });
  it("comissão: valor × %, ao centavo (exemplo da especificação)", () => {
    expect(calcularComissao(15_400_000, 1.5)).toBe(231_000); // R$ 154.000,00 → R$ 2.310,00
    expect(calcularComissao(15_400_000, 1)).toBe(154_000);
    expect(calcularComissao(3_323_000, 1.5)).toBe(49_845); // R$ 33.230,00 → R$ 498,45 (bate com o Consistem)
  });
});

describe("cruzamento Z × créditos da CCCCI010", () => {
  it("casa por cliente, data e valor; um crédito para um Z", () => {
    const titulos = [
      t("Z00027A", { cod_cliente: "200", data_pagamento: "2026-09-08", valor_centavos: 13_400_000 }),
      t("Z00028A", { cod_cliente: "200", data_pagamento: "2026-09-08", valor_centavos: 13_400_000 }), // igual ao de cima: só um crédito
      t("1001295C"),
    ];
    const creditos = [
      { id: "c1", data: "2026-09-08", cod_cliente: "200", nome_cliente: "J SETE", valor_centavos: 13_400_000 },
      { id: "c2", data: "2026-09-09", cod_cliente: "300", nome_cliente: "MIRANTE", valor_centavos: 183_000_000 },
    ];
    const r = cruzarZComCreditos(titulos, creditos);
    expect(r.zComCredito.map((x) => [x.titulo.cod_titulo, x.credito.id])).toEqual([["Z00027A", "c1"]]);
    expect(r.zSemCredito.map((x) => x.cod_titulo)).toEqual(["Z00028A"]);
    expect(r.creditosSemZ.map((c) => c.id)).toEqual(["c2"]);
  });
  it("data ou valor diferente não casa", () => {
    const r = cruzarZComCreditos([t("Z1", { cod_cliente: "1", data_pagamento: "2026-09-08", valor_centavos: 100 })],
      [{ id: "c", data: "2026-09-09", cod_cliente: "1", nome_cliente: null, valor_centavos: 100 }]);
    expect(r.zSemCredito).toHaveLength(1);
    expect(r.creditosSemZ).toHaveLength(1);
  });
});

describe("proposta do fechamento (setembro/2026, como nas planilhas)", () => {
  const titulos = [
    t("1001249E", { cod_representante: "3", valor_centavos: 48_000_000, comissao_consistem_centavos: 720_000 }),
    t("1001295C", { cod_representante: "7", valor_centavos: 15_400_000 }),
    t("1001350A", { cod_representante: "7", valor_centavos: 13_600_000, tipo_baixa: "1" }),
    t("1001366U", { cod_representante: "3", tipo_baixa: "7" }),     // compensado com crédito: não gera
    t("4000040U", { cod_representante: "3", tipo_baixa: "1" }),     // Filial: fora
    t("1001400U", { cod_representante: "5" }),                       // Lucas: ninguém recebe
    t("1001401U", { cod_representante: "3", tipo_baixa: "8" }),     // devolução: não gera
  ];
  const adiantamentos = [{ id: "c2", data: "2026-09-09", cod_cliente: "300", nome_cliente: "MIRANTE", valor_centavos: 183_000_000, cod_representante_sugerido: "3" }];

  it("Fernando recebe pelas vendas dele e do Heitor; Heitor só pelas dele", () => {
    const l = proporLinhas([FERNANDO, HEITOR], titulos, adiantamentos, new Set());
    const de = (r: string) => l.filter((x) => x.cod_representante === r).map((x) => [x.chave, x.valor_comissao_centavos]);
    expect(de("3")).toEqual([
      ["T:1001249E", 720_000], ["T:1001295C", 231_000], ["T:1001350A", 204_000], [chaveCredito(adiantamentos[0]), 2_745_000],
    ]);
    expect(de("7")).toEqual([["T:1001295C", 154_000], ["T:1001350A", 136_000]]);
    // Comissão do Consistem só aparece para o representante dono da venda.
    expect(l.find((x) => x.cod_representante === "3" && x.cod_titulo === "1001249E")?.comissao_consistem_centavos).toBe(720_000);
  });
  it("o que já foi pago em fechamento anterior não entra de novo", () => {
    const l = proporLinhas([FERNANDO, HEITOR], titulos, [], new Set([`3|${chaveTitulo("1001295C")}`]));
    expect(l.filter((x) => x.cod_titulo === "1001295C").map((x) => x.cod_representante)).toEqual(["7"]);
  });
  it("representante inativo não recebe", () => {
    expect(proporLinhas([{ ...HEITOR, ativo: false }], titulos, [], new Set())).toEqual([]);
  });
  it("locação usa o percentual de locação", () => {
    const l = proporLinhas([FERNANDO], [t("1001500U", { tipo_nota: "12", valor_centavos: 4_200_000 })], [], new Set());
    expect(l[0]).toMatchObject({ tipo: "locacao", percentual: 3, valor_comissao_centavos: 126_000 });
  });
});

describe("totais e representante do cliente", () => {
  it("total − antecipado = saldo", () => {
    expect(totalizar([{ incluida: true, valor_comissao_centavos: 1000 }, { incluida: false, valor_comissao_centavos: 500 }], [300])).toEqual({ total: 1000, antecipado: 300, saldo: 700 });
  });
  it("representante do cliente: o comissionado mais recente; senão o mais recente", () => {
    expect(representanteDoCliente([
      { cod_representante: "5", data_emissao: "2026-09-01" }, { cod_representante: "3", data_emissao: "2026-08-01" },
    ], ["3", "7"])).toBe("3");
    expect(representanteDoCliente([{ cod_representante: "5", data_emissao: "2026-09-01" }], ["3", "7"])).toBe("5");
    expect(representanteDoCliente([], ["3"])).toBeNull();
  });
});

describe("planilha da CCCCI010", () => {
  it("datas e valores", () => {
    expect(dataDaPlanilha("09/09/2026")).toBe("2026-09-09");
    expect(dataDaPlanilha(46274)).toBe("2026-09-09"); // série do Excel
    expect(dataDaPlanilha("31/02/2026")).toBeNull();
    expect(valorDaPlanilha("1.830.000,00")).toBe(183_000_000);
    expect(valorDaPlanilha(134000)).toBe(13_400_000);
    expect(valorDaPlanilha("R$ 98.000,50")).toBe(9_800_050);
    expect(valorDaPlanilha("abc")).toBeNull();
  });
  it("acha o cabeçalho, ignora vazias e total, aponta erros", () => {
    const r = lerPlanilhaCreditos([
      ["Relatório de créditos"],
      ["Data", "Cód. Cliente", "Nome do Cliente", "Valor"],
      ["09/09/2026", 300, "MIRANTE DO VALE", "1.830.000,00"],
      [],
      ["08/09/2026", "200", "J SETE", 134000],
      ["xx", "1", "X", "10"],
      ["Total", "", "", "1.964.000,00"],
    ]);
    expect(r.creditos).toEqual([
      { linha: 3, data: "2026-09-09", cod_cliente: "300", nome_cliente: "MIRANTE DO VALE", valor_centavos: 183_000_000 },
      { linha: 5, data: "2026-09-08", cod_cliente: "200", nome_cliente: "J SETE", valor_centavos: 13_400_000 },
    ]);
    expect(r.erros).toEqual(["Linha 6: data inválida."]);
  });
  it("formato da Consulta de Créditos Cadastrados (CCCCI010): valor do crédito, não o saldo; rodapé de totais ignorado", () => {
    const r = lerPlanilhaCreditos([
      ["Data", "Cliente", "Descrição", "Crédito", "Baixado", "Saldo", "Portador", "Descrição Portador", "Observação", "Pedido de Venda"],
      ["08/09/2026", "901", "CONSTRUTORA ALFA LTDA", "134000", "134000", "0", "237", "BRADESCO", "ANTECIPAÇÃO DE CLIENTE - ALFA"],
      ["28/09/2026", "902", "EMPREENDIMENTOS BETA LTDA", "54000", "0", "54000", "237", "BRADESCO", ""],
      ["", "", "", "188.000,00", "134.000,00", "54.000,00"],
    ]);
    expect(r.erros).toEqual([]);
    expect(r.creditos).toEqual([
      { linha: 2, data: "2026-09-08", cod_cliente: "901", nome_cliente: "CONSTRUTORA ALFA LTDA", valor_centavos: 13_400_000 },
      { linha: 3, data: "2026-09-28", cod_cliente: "902", nome_cliente: "EMPREENDIMENTOS BETA LTDA", valor_centavos: 5_400_000 },
    ]);
  });
  it("sem cabeçalho reconhecível", () => {
    expect(lerPlanilhaCreditos([["a", "b"]]).erros[0]).toMatch(/cabeçalho/);
  });
});

describe("montarProposta (caso Z00027A e Mirante, setembro/2026)", () => {
  it("Z com crédito comissiona pelo Z; crédito sem Z vira adiantamento do representante do cliente; Z sem crédito alerta", () => {
    const titulos = [
      t("Z00030A", { cod_cliente: "500", cod_representante: "7", data_pagamento: "2026-09-10", valor_centavos: 1_000_000, tipo_baixa: "3" }),
      t("Z00031A", { cod_cliente: "600", cod_representante: "3", data_pagamento: "2026-09-11", valor_centavos: 500_000, tipo_baixa: "1" }),
    ];
    const creditos = [
      { id: "c-z30", data: "2026-09-10", cod_cliente: "500", nome_cliente: "CLIENTE Z", valor_centavos: 1_000_000 },
      { id: "c-mirante", data: "2026-09-09", cod_cliente: "300", nome_cliente: "MIRANTE", valor_centavos: 183_000_000 },
    ];
    const r = montarProposta([FERNANDO, HEITOR], titulos, creditos, { "300": [{ cod_representante: "3", data_emissao: "2026-08-01" }] }, new Set());
    expect(r.linhas.map((l) => [l.cod_representante, l.chave, l.valor_comissao_centavos])).toEqual([
      ["3", "T:Z00030A", 15_000], ["3", "T:Z00031A", 7_500], ["3", "C:2026-09-09:300:183000000", 2_745_000],
      ["7", "T:Z00030A", 10_000],
    ]);
    expect(r.creditosMarcados).toEqual([
      { id: "c-z30", cod_titulo_z: "Z00030A", cod_representante_sugerido: "7" },
      { id: "c-mirante", cod_titulo_z: null, cod_representante_sugerido: "3" },
    ]);
    expect(r.zSemCredito.map((z) => z.cod_titulo)).toEqual(["Z00031A"]);
  });
});
