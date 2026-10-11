import { describe, expect, it } from "vitest";
import { gerarPdfAutorizacao, nomeArquivoAutorizacao } from "./pdf-autorizacao";

describe("PDF da autorização", () => {
  it("gera um PDF válido com os itens, o caixa e o selo", async () => {
    const pdf = await gerarPdfAutorizacao({
      codigo: "101026", data: "2026-10-10", status: "autorizada", empresaRazaoSocial: "NEO FORMAS PARA CONCRETO LTDA", empresaCnpj: "17.209.767/0001-28",
      observacao: "Semana 41", motivoCancelamento: null, caixaCentavos: 100_000_00, criadoPor: "Alan", criadoEm: "10/10/2026, 10:00",
      autorizadaPor: "Diretor", autorizadaEm: "10/10/2026, 11:00", canceladaEm: null, emitidoEm: "10/10/2026, 12:00",
      itens: [
        { tipo: "titulo", fornecedorNome: "ACOFER", fornecedorDocumento: "03.989.217/0026-12", codFornecedor: "27", numDocumento: "170555/3", codLancamento: "14471", dataVencimento: "2026-03-19", dataPagamento: null, complemento: "CARTORIO", valorCentavos: 300_926 },
        { tipo: "antecipacao", fornecedorNome: "ACOFER EIRELI", fornecedorDocumento: null, codFornecedor: "3", numDocumento: "27783", codLancamento: "27783", dataVencimento: null, dataPagamento: "2026-07-06", complemento: "ANTECIPAÇÃO", valorCentavos: 11_968 },
      ],
    });
    expect(pdf.length).toBeGreaterThan(1500);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
  }, 30_000);
  it("nome do arquivo", () => {
    expect(nomeArquivoAutorizacao("101026-2")).toBe("autorizacao-pagamento-101026-2.pdf");
  });
});
