import { describe, expect, it } from "vitest";
import { complementoProvisorio, documentoProvisorio, montarProvisorio } from "./provisorio";

const CONFIG = { codHistorico: 1, categoriaDoc: 17, codPortador: 91, grupoContaFluxoCaixa: 22, contaFluxoCaixa: 24, contaContabilDebito: 9001, contaContabilCredito: 2004 };
const base = { nomeCartao: "SICREDI PJ", codigosCartao: { codFornecedor: 80 }, config: CONFIG, totalCentavos: 3_576_92, vencimento: "2026-10-23", competencia: "2026-10-01", hoje: "2026-10-14" };

describe("provisório da fatura", () => {
  it("fornecedor do banco, total, documento DDMMAA do vencimento, complemento com a competência, emissão no dia", () => {
    const r = montarProvisorio(base);
    if (!r.ok) throw new Error(r.erro);
    expect(r.payload).toEqual({
      codFornecedor: 80, categoriaDoc: 17, codDocumento: "231026", codPortador: 91, dataEmissao: "2026-10-14", dataEntrada: "2026-10-14",
      dataVencimento: "2026-10-23", valorDocumento: 3576.92, codHistorico: 1, complementoHistorico: "FATURA CARTÃO SICREDI PJ 10/2026",
      grupoContaFluxoCaixa: 22, contaFluxoCaixa: 24, dadosContabilidade: { contaContabilDebito: 9001, contaContabilCredito: 2004, listaCentroCustoContab: [] },
    });
    expect(documentoProvisorio("2026-10-13")).toBe("131026");
    expect(complementoProvisorio("Itaú PJ", "2026-11-01")).toBe("FATURA CARTÃO ITAU PJ 11/2026");
  });
  it("recusa sem o banco do cartão, com a configuração incompleta e sem valor", () => {
    expect(montarProvisorio({ ...base, codigosCartao: null })).toMatchObject({ ok: false, erro: /banco emissor/ });
    expect(montarProvisorio({ ...base, config: { codHistorico: 1, categoriaDoc: 17, codPortador: 91 } })).toMatchObject({ ok: false, erro: /conta de fluxo/ });
    expect(montarProvisorio({ ...base, totalCentavos: 0 })).toMatchObject({ ok: false, erro: /sem valor/ });
  });
});
