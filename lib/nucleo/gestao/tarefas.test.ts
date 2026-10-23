import { describe, expect, it } from "vitest";
import { executarEmLote, resumirLote } from "./tarefas";

describe("executarEmLote", () => {
  it("segue depois de uma recusa e separa feitas de recusadas", async () => {
    const chamadas: string[] = [];
    const r = await executarEmLote(["a", "b", "c"], async (id) => {
      chamadas.push(id);
      return id === "b" ? "O responsável precisa ter acesso à área." : null;
    });
    expect(chamadas).toEqual(["a", "b", "c"]);
    expect(r).toEqual({ feitas: ["a", "c"], recusadas: [{ id: "b", erro: "O responsável precisa ter acesso à área." }] });
  });

  it("não repete a mesma pendência marcada duas vezes", async () => {
    const chamadas: string[] = [];
    await executarEmLote(["a", "a", "b"], async (id) => { chamadas.push(id); return null; });
    expect(chamadas).toEqual(["a", "b"]);
  });
});

describe("resumirLote", () => {
  it("singular, plural e recusadas só quando houver", () => {
    expect(resumirLote({ feitas: ["a"], recusadas: [] })).toBe("1 atribuída");
    expect(resumirLote({ feitas: ["a", "b"], recusadas: [{ id: "c", erro: "x" }] })).toBe("2 atribuídas; 1 recusada");
  });
});
