import { describe, expect, it } from "vitest";
import { podeIndexar, raizSobreposta } from "./raizes";

describe("raizSobreposta", () => {
  const cadastrada = { driveId: "A", ancestrais: ["RAIZ"] };
  it("recusa a mesma pasta, uma pasta dentro ou acima de outra raiz", () => {
    expect(raizSobreposta({ driveId: "A", ancestrais: ["RAIZ"] }, [cadastrada])).toBe("A");
    expect(raizSobreposta({ driveId: "B", ancestrais: ["RAIZ", "A"] }, [cadastrada])).toBe("A");
    expect(raizSobreposta({ driveId: "RAIZ", ancestrais: [] }, [cadastrada])).toBe("A");
  });
  it("aceita pastas irmãs", () => {
    expect(raizSobreposta({ driveId: "C", ancestrais: ["RAIZ"] }, [cadastrada])).toBeNull();
  });
});

describe("podeIndexar", () => {
  it("raiz em verificação ou inativa não é indexada", () => {
    expect(podeIndexar("em_verificacao")).toBe(false);
    expect(podeIndexar("inativa")).toBe(false);
    expect(podeIndexar("ativa")).toBe(true);
  });
});
