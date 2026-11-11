import { describe, expect, it } from "vitest";
import { contaFluxo, emCentavos, formatarCompetencia } from "./parcelamentos";

describe("formatos das telas de parcelamentos", () => {
  it("competência, centavos e conta de fluxo", () => {
    expect(formatarCompetencia("2026-11")).toBe("11/2026");
    expect(formatarCompetencia(null)).toBe("—");
    expect(emCentavos("2061.18")).toBe(206_118);
    expect(emCentavos(1.005)).toBe(101);
    expect(emCentavos(null)).toBeNull();
    expect(contaFluxo(20, 17)).toBe("20/17");
    expect(contaFluxo(null, null)).toBe("—");
  });
});
