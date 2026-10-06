import { describe, expect, it } from "vitest";
import {
  escolherContato, finalidadesDesconhecidas, normalizarFinalidade, temCanal, temContatoUtil, type ContatoEscolha,
} from "../../supabase/functions/_shared/contatos";

const c = (id: string, extra: Partial<ContatoEscolha> = {}): ContatoEscolha => ({ id, nome: `Contato ${id}`, finalidades: [], ...extra });

describe("normalizarFinalidade e finalidadesDesconhecidas", () => {
  it("tira acento, maiúsculas e espaços", () => {
    expect(normalizarFinalidade(" Cobrança ")).toBe("cobranca");
    expect(normalizarFinalidade("CONFIRMAÇÃO")).toBe("confirmacao");
  });
  it("aponta o que o sistema não reconhece", () => {
    expect(finalidadesDesconhecidas(["boleto", "cobranca", "cobrar", "Contrato"])).toEqual(["cobrar"]);
    expect(finalidadesDesconhecidas([])).toEqual([]);
  });
});

describe("temCanal", () => {
  it("e-mail, WhatsApp e telefone (ligar vale com telefone ou com o número do WhatsApp)", () => {
    expect(temCanal({ email: "a@b.com" }, "email")).toBe(true);
    expect(temCanal({ email: "  " }, "email")).toBe(false);
    expect(temCanal({ whatsapp: "+5565999990000" }, "whatsapp")).toBe(true);
    expect(temCanal({ telefone: "+556532220000" }, "telefone")).toBe(true);
    expect(temCanal({ whatsapp: "+5565999990000" }, "telefone")).toBe(true);
    expect(temCanal({ email: "a@b.com" }, "telefone")).toBe(false);
  });
});

describe("escolherContato", () => {
  it("prefere quem tem a finalidade e o canal", () => {
    const contatos = [c("a", { email: "a@x.com" }), c("b", { email: "b@x.com", finalidades: ["boleto"] })];
    expect(escolherContato(contatos, "boleto", "email")?.id).toBe("b");
  });

  it("NUNCA devolve contato sem o canal: o da finalidade sem e-mail perde para outro com e-mail", () => {
    const contatos = [c("so-whats", { whatsapp: "+5565999990000", finalidades: ["boleto"] }), c("com-email", { email: "x@x.com" })];
    expect(escolherContato(contatos, "boleto", "email")?.id).toBe("com-email");
    expect(escolherContato(contatos, "boleto", "whatsapp")?.id).toBe("so-whats");
  });

  it("sem ninguém com o canal, devolve nulo (a tela pede para cadastrar)", () => {
    expect(escolherContato([c("a", { whatsapp: "+5565999990000" })], "cobranca", "email")).toBeNull();
    expect(escolherContato([], "cobranca", "email")).toBeNull();
  });

  it("ignora contato inativo", () => {
    const contatos = [c("a", { email: "a@x.com", finalidades: ["cobranca"], ativo: false }), c("b", { email: "b@x.com" })];
    expect(escolherContato(contatos, "cobranca", "email")?.id).toBe("b");
  });

  it("a primeira finalidade da lista vale mais que a segunda (cobrança antes de boleto)", () => {
    const contatos = [c("boleto", { email: "b@x.com", finalidades: ["boleto"] }), c("cobranca", { email: "c@x.com", finalidades: ["cobranca"] })];
    expect(escolherContato(contatos, ["cobranca", "boleto"], "email")?.id).toBe("cobranca");
    expect(escolherContato([contatos[0]], ["cobranca", "boleto"], "email")?.id).toBe("boleto");
  });

  it("reconhece a finalidade mesmo gravada com acento ou maiúscula (dado antigo)", () => {
    const contatos = [c("a", { email: "a@x.com" }), c("b", { email: "b@x.com", finalidades: ["Cobrança"] })];
    expect(escolherContato(contatos, "cobranca", "email")?.id).toBe("b");
  });

  it("desempata pelo canal preferido e depois pelo nome", () => {
    const contatos = [
      c("z", { nome: "Zélia", email: "z@x.com", finalidades: ["boleto"], canal_preferido: "whatsapp" }),
      c("m", { nome: "Maria", email: "m@x.com", finalidades: ["boleto"], canal_preferido: "email" }),
      c("a", { nome: "Ana", email: "a@x.com", finalidades: ["boleto"], canal_preferido: "email" }),
    ];
    expect(escolherContato(contatos, "boleto", "email")?.id).toBe("a");
  });

  it("a escolha manual da pessoa vence, se o contato servir; se não servir, ignora", () => {
    const contatos = [c("a", { email: "a@x.com", finalidades: ["boleto"] }), c("b", { email: "b@x.com" }), c("sem", { whatsapp: "+5565999990000" })];
    expect(escolherContato(contatos, "boleto", "email", "b")?.id).toBe("b");
    expect(escolherContato(contatos, "boleto", "email", "sem")?.id).toBe("a"); // sem e-mail: não serve
    expect(escolherContato(contatos, "boleto", "email", "inexistente")?.id).toBe("a");
  });
});

describe("temContatoUtil", () => {
  it("precisa de um contato ativo com algum meio de falar", () => {
    expect(temContatoUtil([])).toBe(false);
    expect(temContatoUtil([c("a")])).toBe(false); // só nome
    expect(temContatoUtil([c("a", { email: "a@x.com", ativo: false })])).toBe(false);
    expect(temContatoUtil([c("a", { telefone: "+556532220000" })])).toBe(true);
    expect(temContatoUtil([c("a"), c("b", { whatsapp: "+5565999990000" })])).toBe(true);
  });
});
