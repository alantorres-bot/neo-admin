import { describe, expect, it } from "vitest";
import { titulosALancar, titulosDoItem } from "./lancamento";

const item = { id: "a", liquido: 1954.26, ferias_acrescimos: 0, decimo_terceiro: 1672.76, avulso: 300 };

describe("títulos da folha no Consistem", () => {
  it("um título por tipo com valor; 13º é 1ª parcela, e 2ª na folha de dezembro", () => {
    expect(titulosDoItem(item, "2026-09-01")).toEqual([
      { item_id: "a", tipo: "salario", valor: 1954.26 }, { item_id: "a", tipo: "decimo_1", valor: 1672.76 }, { item_id: "a", tipo: "avulso", valor: 300 },
    ]);
    expect(titulosDoItem({ ...item, liquido: 0, avulso: 0, ferias_acrescimos: 10 }, "2026-12-01").map((t) => t.tipo)).toEqual(["ferias", "decimo_2"]);
    expect(titulosDoItem({ id: "z", liquido: 0, ferias_acrescimos: 0, decimo_terceiro: 0, avulso: 0 }, "2026-10-01")).toEqual([]);
  });

  it("deixa de fora os que já têm lançamento ativo (pessoa × tipo)", () => {
    const b = { ...item, id: "b", decimo_terceiro: 0, avulso: 0 };
    expect(titulosALancar([item, b], "2026-10-01", new Set(["a:salario", "b:decimo_1"])).map((t) => `${t.item_id}:${t.tipo}`))
      .toEqual(["a:decimo_1", "a:avulso", "b:salario"]);
  });
});
