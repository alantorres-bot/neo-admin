// Conferência do segredo do agendamento do GED (scripts/ged-conferir-segredo.mjs): só resumos SHA-256, saída só com o veredito.
import { describe, expect, it } from "vitest";
import { compararResumos, conferir } from "../../scripts/ged-conferir-segredo.mjs";

const A = "a".repeat(64);
const B = "b".repeat(64);
const lista = (valor: unknown, nome = "SINCRONIZACAO_SEGREDO") => JSON.stringify({ secrets: [{ name: "OUTRO", value: B }, { name: nome, value: valor }] });
const vault = (resumo: unknown) => JSON.stringify([{ resumo }]);

describe("compararResumos", () => {
  it("IGUAL só com os dois resumos SHA-256 idênticos", () => {
    expect(compararResumos(lista(A), vault(A))).toBe("IGUAL");
    expect(compararResumos(JSON.stringify([{ name: "SINCRONIZACAO_SEGREDO", value: A }]), vault(A))).toBe("IGUAL"); // lista sem envelope
  });

  it("DIFERENTE quando os resumos não batem", () => {
    expect(compararResumos(lista(A), vault(B))).toBe("DIFERENTE");
  });

  it("NAO_COMPROVADO em qualquer dúvida: sem o segredo, sem a linha do Vault, formato que não é SHA-256 ou JSON quebrado", () => {
    for (const [s, v] of [
      [lista(A, "OUTRO_NOME"), vault(A)],
      [lista(A), "[]"],
      [lista(A), JSON.stringify([{ resumo: A }, { resumo: A }])],
      [lista("segredo-em-texto-puro"), vault("segredo-em-texto-puro")],    // a CLI nunca devolve o valor; se devolvesse, não serve
      [lista(A.toUpperCase()), vault(A.toUpperCase())],
      [lista(null), vault(null)],
      ["não é json", vault(A)],
      [lista(A), "{"],
    ]) {
      expect(compararResumos(s, v)).toBe("NAO_COMPROVADO");
    }
  });
});

describe("conferir (com a CLI simulada)", () => {
  const cli = (segredos: string | Error, vaultSaida: string | Error) => (args: string[]) => {
    const r = args[0] === "secrets" ? segredos : vaultSaida;
    if (r instanceof Error) throw r;
    return r;
  };
  const REF = "abcdefghijabcdefghij";

  it("IGUAL e DIFERENTE pelos resumos; a resposta é só o veredito (nenhum resumo volta)", () => {
    const r = conferir(cli(lista(A), vault(A)), REF);
    expect(r).toBe("IGUAL");
    expect(conferir(cli(lista(A), vault(B)), REF)).toBe("DIFERENTE");
    expect(r).not.toContain(A);
  });

  it("segredo ausente na lista ou no Vault: NAO_COMPROVADO", () => {
    expect(conferir(cli(JSON.stringify({ secrets: [{ name: "OUTRO", value: A }] }), vault(A)), REF)).toBe("NAO_COMPROVADO");
    expect(conferir(cli(lista(A), "[]"), REF)).toBe("NAO_COMPROVADO");
  });

  it("falha da CLI, falha da consulta e tempo esgotado: NAO_COMPROVADO", () => {
    const tempo = Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" });
    expect(conferir(cli(new Error("supabase: não autenticado"), vault(A)), REF)).toBe("NAO_COMPROVADO");
    expect(conferir(cli(lista(A), new Error("ERROR: relation vault.decrypted_secrets")), REF)).toBe("NAO_COMPROVADO");
    expect(conferir(cli(tempo, vault(A)), REF)).toBe("NAO_COMPROVADO");
  });

  it("saída inesperada (texto, tabela, aviso antes do JSON): NAO_COMPROVADO", () => {
    expect(conferir(cli("│ name │ value │", vault(A)), REF)).toBe("NAO_COMPROVADO");
    expect(conferir(cli(`Aviso: nova versão${"\n"}${lista(A)}`, vault(A)), REF)).toBe("NAO_COMPROVADO");
    expect(conferir(cli(lista(A), `resumo${"\n"}${A}`), REF)).toBe("NAO_COMPROVADO");
  });

  it("chama só a lista de segredos e a consulta do resumo (nada que execute a indexação)", () => {
    const chamadas: string[][] = [];
    conferir((args: string[]) => { chamadas.push(args); return args[0] === "secrets" ? lista(A) : vault(A); }, REF);
    expect(chamadas.map((c) => c.slice(0, 2))).toEqual([["secrets", "list"], ["db", "query"]]);
    expect(JSON.stringify(chamadas)).not.toMatch(/functions|ged_chamar_indexacao|nucleo-ged-indexar|update |insert |delete /i);
  });
});
