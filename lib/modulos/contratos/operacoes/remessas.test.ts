import { describe, expect, it } from "vitest";
import { resumoRemessas } from "./remessas";

describe("resumoRemessas", () => {
  it("conta só remetida/entregue com NF de remessa; canceladas não contam", () => {
    const r = resumoRemessas(
      [
        { situacao: "remetida", notaId: "n1" },
        { situacao: "entregue", notaId: "n2" },
        { situacao: "remetida", notaId: null },
        { situacao: "cancelada", notaId: "n3" },
        { situacao: "prevista", notaId: null },
      ],
      3,
    );
    expect(r).toEqual({ realizadas: 2, texto: "2 realizada(s) de 3", completas: false });
  });
  it("previstas nulo aparece como não informado", () => {
    expect(resumoRemessas([], null).texto).toBe("0 realizada(s) de não informado");
  });
});
