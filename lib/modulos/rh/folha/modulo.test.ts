import { describe, expect, it } from "vitest";
import { competenciaDoDecimo, lerReais, pagamentoDe, rotuloFolha, valorAPagar } from "./modulo";

describe("folha: valores", () => {
  it("lê reais digitados", () => {
    expect(lerReais("1.234,56")).toBe(1234.56);
    expect(lerReais("1234,5")).toBe(1234.5);
    expect(lerReais("1234.56")).toBe(1234.56);
    expect(lerReais("R$ 5.112,46")).toBe(5112.46);
    expect(lerReais("1.234")).toBe(1234);
    expect(lerReais("")).toBe(0);
    expect(lerReais("-10")).toBeNaN();
    expect(lerReais("12a")).toBeNaN();
  });
  it("valor a pagar = soma das naturezas, em centavos", () => {
    expect(valorAPagar({ liquido: 5112.46, ferias_acrescimos: 4749.27, decimo_terceiro: 0, avulso: 0.1 })).toBe(986183);
  });
  it("folhas do 13º: competência, rótulo e pagamento (último dia útil até 30/11 e 20/12)", () => {
    expect(competenciaDoDecimo(2026, "decimo_1")).toBe("2026-11-01");
    expect(competenciaDoDecimo(2026, "decimo_2")).toBe("2026-12-01");
    expect(rotuloFolha("2026-11-01", "decimo_1")).toBe("13º 1ª parcela/2026");
    expect(rotuloFolha("2026-11-01", "mensal")).toBe("novembro/2026");
    expect(pagamentoDe("2026-11-01", "decimo_1")).toBe("2026-11-30");   // segunda-feira
    expect(pagamentoDe("2026-12-01", "decimo_2")).toBe("2026-12-18");   // 20/12/2026 é domingo
    expect(pagamentoDe("2027-11-01", "decimo_1")).toBe("2027-11-30");
    expect(pagamentoDe("2025-11-01", "decimo_1")).toBe("2025-11-28");   // 30/11/2025 é domingo
    expect(pagamentoDe("2026-09-01", "mensal")).toBe("2026-10-07");
  });
});
