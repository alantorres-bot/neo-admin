import { describe, expect, it } from "vitest";
import { agruparLote, lerNomeArquivo, normalizarNota, notaDoDocumento, pendenciasDoKit, tipoPeloNome } from "./arquivos";

describe("lerNomeArquivo (nomes reais dos e-mails da filial e de Cuiabá)", () => {
  it("nota fatura da filial: NF + cliente", () => {
    expect(lerNomeArquivo("NF 02351 - QRTZ 39.pdf")).toEqual({ nota: "002351", cliente: "QRTZ 39", tipo: "nota_fatura" });
    expect(lerNomeArquivo("NF 02352 - HERMES RESIDENCE.pdf")).toEqual({ nota: "002352", cliente: "HERMES RESIDENCE", tipo: "nota_fatura" });
    expect(lerNomeArquivo("NF 02350 - MB - JARDINS 156.pdf")).toEqual({ nota: "002350", cliente: "MB - JARDINS 156", tipo: "nota_fatura" });
    expect(lerNomeArquivo("NF 02354 - JANEIRO - CARBON (GUARDA-CORPO PARA PILARES).pdf"))
      .toEqual({ nota: "002354", cliente: "JANEIRO - CARBON (GUARDA-CORPO PARA PILARES)", tipo: "nota_fatura" });
  });
  it("cliente com acento é preservado", () => {
    expect(lerNomeArquivo("NF 2340 - CAPARAÓ RESERVA GREEN.pdf").cliente).toBe("CAPARAÓ RESERVA GREEN");
  });
  it("boleto devolvido por Cuiabá: só o número", () => {
    expect(lerNomeArquivo("2353.PDF")).toEqual({ nota: "002353", cliente: null, tipo: null });
    expect(lerNomeArquivo("002331.pdf")).toEqual({ nota: "002331", cliente: null, tipo: null });
  });
  it("demonstrativo e comodato pelo nome", () => {
    expect(lerNomeArquivo("DEMONSTRATIVO NF 2351 - QRTZ 39.pdf")).toEqual({ nota: "002351", cliente: "QRTZ 39", tipo: "demonstrativo" });
    expect(lerNomeArquivo("Comodato NF 02351 - QRTZ 39.pdf")).toEqual({ nota: "002351", cliente: "QRTZ 39", tipo: "comodato" });
  });
  it("carta de cessão sem NF no nome fica para a pessoa informar", () => {
    expect(lerNomeArquivo("CESSÃO NEO FORMAS - CAPANEMA (1).pdf")).toEqual({ nota: null, cliente: null, tipo: "carta_cessao" });
  });
  it("nome sem pista nenhuma", () => {
    expect(lerNomeArquivo("image001.jpg")).toEqual({ nota: null, cliente: null, tipo: null });
    expect(lerNomeArquivo("1234567.pdf").nota).toBeNull(); // 7 dígitos não é NF
  });
});

describe("normalizarNota e notaDoDocumento", () => {
  it("NF com 6 dígitos", () => {
    expect(normalizarNota("2351")).toBe("002351");
    expect(normalizarNota("02351")).toBe("002351");
    expect(normalizarNota("NF 002351")).toBe("002351");
    expect(normalizarNota("0")).toBeNull();
    expect(normalizarNota("")).toBeNull();
    expect(normalizarNota("1234567")).toBeNull();
  });
  it("documento da filial → NF (igual à rec_nota_filial)", () => {
    expect(notaDoDocumento("4002323U")).toBe("002323");
    expect(notaDoDocumento("4002351A")).toBe("002351");
    expect(notaDoDocumento("1001266E")).toBeNull(); // Matriz
    expect(notaDoDocumento("453")).toBeNull();
    expect(notaDoDocumento("40023")).toBeNull();
  });
});

describe("tipoPeloNome", () => {
  it("palavras-chave sem acento e sem caixa", () => {
    expect(tipoPeloNome("demonstrativo de faturamento")).toBe("demonstrativo");
    expect(tipoPeloNome("Cessão de crédito")).toBe("carta_cessao");
    expect(tipoPeloNome("Nota 2351")).toBe("nota_fatura");
    expect(tipoPeloNome("2351")).toBeNull();
  });
});

describe("agruparLote", () => {
  it("agrupa por NF, ordena e separa os sem NF", () => {
    const itens = ["NF 02352 - HERMES RESIDENCE.pdf", "DEMONSTRATIVO 2352.pdf", "NF 02351 - QRTZ 39.pdf", "carta.pdf"]
      .map((nome, indice) => ({ indice, nome, ...lerNomeArquivo(nome) }));
    const r = agruparLote(itens);
    expect(r.grupos.map((g) => [g.nota, g.cliente, g.itens.length])).toEqual([["002351", "QRTZ 39", 1], ["002352", "HERMES RESIDENCE", 2]]);
    expect(r.semNota.map((i) => i.nome)).toEqual(["carta.pdf"]);
  });
});

describe("pendenciasDoKit", () => {
  const base = { estagio: "implantada" as const, notas: 1, demonstrativos: 1, comodatos: 1, cartas: 0, parcelas: 1, boletos: 0, exigeCarta: false };
  it("lista o que falta", () => {
    expect(pendenciasDoKit({ ...base, estagio: "recebida", parcelas: 0, comodatos: 0 })).toEqual(["comodato", "implantação no Consistem"]);
    expect(pendenciasDoKit(base)).toEqual(["boleto"]);
    expect(pendenciasDoKit({ ...base, parcelas: 3, boletos: 1, exigeCarta: true })).toEqual(["boleto (1/3)", "carta de cessão"]);
    expect(pendenciasDoKit({ ...base, boletos: 1 })).toEqual([]);
    expect(pendenciasDoKit({ ...base, parcelasTransferencia: 1 })).toEqual([]);
  });
  it("kit encerrado não tem pendência", () => {
    expect(pendenciasDoKit({ ...base, estagio: "enviada" })).toEqual([]);
  });
});
