import { describe, expect, it } from "vitest";
import { avaliarNfPorHistorico, faturamentoLiberado, type ContratoLiberacao } from "./liberacao";

const vendaAssinada: ContratoLiberacao = { tipo: "venda", situacao: "assinado", documentoAssinadoConfirmado: true };

describe("faturamentoLiberado", () => {
  it("financiamento sem autorização validada nunca libera; recebida não libera", () => {
    expect(faturamentoLiberado("financiamento", [], [vendaAssinada], [])).toEqual({ resultado: "bloqueada", motivos: ["autorização bancária não validada"] });
    expect(faturamentoLiberado("financiamento", [], [vendaAssinada], ["recebida"]).resultado).toBe("bloqueada");
  });

  it("autorização validada sem contrato de venda assinado não libera, mesmo sem trava no modelo", () => {
    const r = faturamentoLiberado("financiamento", [], [], ["validada"]);
    expect(r).toEqual({ resultado: "bloqueada", motivos: ["contrato de compra e venda não assinado"] });
  });

  it("contrato de locação ou sem o documento assinado confirmado não satisfaz", () => {
    expect(faturamentoLiberado("financiamento", [], [{ ...vendaAssinada, tipo: "locacao" }], ["validada"]).resultado).toBe("bloqueada");
    expect(faturamentoLiberado("financiamento", [], [{ ...vendaAssinada, documentoAssinadoConfirmado: false }], ["validada"]).resultado).toBe("bloqueada");
  });

  it("contrato de venda assinado e autorização validada liberam; substituída volta a bloquear", () => {
    expect(faturamentoLiberado("financiamento", [], [vendaAssinada], ["substituida", "validada"]).resultado).toBe("liberada");
    expect(faturamentoLiberado("financiamento", [], [vendaAssinada], ["substituida"]).resultado).toBe("bloqueada");
  });

  it("travas do modelo: concluída ou dispensada liberam; modalidade sem trava não se aplica", () => {
    expect(faturamentoLiberado("entrega_futura", [{ descricao: "Assinaturas", situacao: "dispensada" }], [], []).resultado).toBe("liberada");
    expect(faturamentoLiberado("entrega_futura", [{ descricao: "Assinaturas", situacao: "aberta" }], [], [])).toEqual({
      resultado: "bloqueada",
      motivos: ["Assinaturas: não concluída"],
    });
    expect(faturamentoLiberado("avulsa", [], [], []).resultado).toBe("nao_se_aplica");
  });
});

describe("avaliarNfPorHistorico", () => {
  // 10/11/2026 12:00 em Cuiabá (UTC-4) = 16:00 UTC.
  const liberada = { em: "2026-11-10T16:00:00Z", para: "liberada" as const };
  const bloqueada = { em: "2026-11-20T16:00:00Z", para: "bloqueada" as const };

  it("NF emitida enquanto liberada não gera alerta depois de novo bloqueio", () => {
    expect(avaliarNfPorHistorico("2026-11-15", [liberada, bloqueada])).toBe("sem_alerta");
  });
  it("NF emitida sem liberação vigente gera alerta", () => {
    expect(avaliarNfPorHistorico("2026-11-05", [liberada])).toBe("alerta");
    expect(avaliarNfPorHistorico("2026-11-25", [liberada, bloqueada])).toBe("alerta");
  });
  it("NF do mesmo dia (data local de Cuiabá) de uma mudança fica para conferência", () => {
    expect(avaliarNfPorHistorico("2026-11-10", [liberada])).toBe("conferir");
    // 11/11 às 02:00 UTC ainda é 10/11 em Cuiabá.
    expect(avaliarNfPorHistorico("2026-11-10", [{ em: "2026-11-11T02:00:00Z", para: "liberada" }])).toBe("conferir");
    // Pela data UTC seria o mesmo dia; pela de Cuiabá, a liberação foi na véspera.
    expect(avaliarNfPorHistorico("2026-11-11", [{ em: "2026-11-11T02:00:00Z", para: "liberada" }])).toBe("sem_alerta");
  });
});
