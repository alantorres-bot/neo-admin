import { describe, expect, it } from "vitest";
import { avisoDaBaixa } from "./baixa";

const HOJE = "2026-10-06";

describe("avisoDaBaixa", () => {
  it("pagamento recente e de valor igual ao do título vem sem aviso (marcado)", () => {
    expect(avisoDaBaixa({ valorCentavos: 600_00, valorPagoCentavos: 600_00, pagoEm: "2026-10-05" }, HOJE)).toBeNull();
    expect(avisoDaBaixa({ valorCentavos: 600_00, valorPagoCentavos: 600_00, pagoEm: "2026-09-29" }, HOJE)).toBeNull(); // 7 dias ainda é recente
  });

  it("valor diferente (juros ou desconto) pede conferência", () => {
    expect(avisoDaBaixa({ valorCentavos: 600_00, valorPagoCentavos: 614_80, pagoEm: "2026-10-06" }, HOJE)).toBe("valor difere do título (juros ou desconto): confira antes de marcar");
  });

  it("pagamento com mais de 7 dias pede conferência e os dois avisos se juntam", () => {
    expect(avisoDaBaixa({ valorCentavos: 600_00, valorPagoCentavos: 600_00, pagoEm: "2026-09-28" }, HOJE)).toContain("pagamento de há 8 dias");
    const dois = avisoDaBaixa({ valorCentavos: 600_00, valorPagoCentavos: 500_00, pagoEm: "2026-09-01" }, HOJE)!;
    expect(dois).toContain("valor difere do título");
    expect(dois).toContain("pagamento de há 35 dias");
  });
});
