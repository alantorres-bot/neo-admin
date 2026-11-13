import { describe, expect, it } from "vitest";
import { definirAcabamento } from "./geometria";
import { BASE_ATUAL, criarProjetoBase } from "./projetoBase";
import { criarVersao, duplicarVersao, juntarVersoes, mesmaDecoracao, nomeLimpo, nomePadrao, ordenarVersoes, projetoDaVersao, renomearVersao, versaoValida } from "./versoes";

const dia = (h: number, min = 0) => new Date(2026, 10, 13, h, min);

describe("versões da decoração", () => {
  const projeto = criarProjetoBase();

  it("nome padrão numera a partir do maior número já usado e traz dia e hora", () => {
    expect(nomePadrao([], dia(14, 5))).toBe("Versão 1 — 13/11 14h05");
    expect(nomePadrao([{ nome: "Versão 1 — 13/11 14h05" }, { nome: "Sala azul" }, { nome: "Versão 7" }], dia(9))).toBe("Versão 8 — 13/11 09h00");
  });

  it("nome informado é limpo; vazio vira o padrão", () => {
    expect(nomeLimpo("  Parede   azul  ", [], dia(10))).toBe("Parede azul");
    expect(nomeLimpo("   ", [], dia(10))).toBe("Versão 1 — 13/11 10h00");
    expect(nomeLimpo("x".repeat(200), [], dia(10))).toHaveLength(60);
  });

  it("a versão é uma cópia: continuar editando o projeto não a altera", () => {
    const v = criarVersao(projeto, "Antes", [], dia(10), undefined, "a");
    expect(v.id).toMatch(/^v-[a-z0-9]+-a$/);
    expect(v.projeto).toEqual(projeto);
    expect(v.projeto).not.toBe(projeto);
    const editado = { ...projeto, moveis: projeto.moveis.map((m) => (m.id === "sala-sofa" ? { ...m, x: m.x + 50 } : m)) };
    expect(v.projeto.moveis.find((m) => m.id === "sala-sofa")!.x).toBe(projeto.moveis.find((m) => m.id === "sala-sofa")!.x);
    expect(mesmaDecoracao(v, projeto)).toBe(true);
    expect(mesmaDecoracao(v, editado)).toBe(false);
  });

  it("a imagem de planta importada (grande) não entra na versão; o marcador da planta original, sim", () => {
    const comImagem = { ...projeto, planta: { ...projeto.planta, referencia: { ...projeto.planta.referencia!, imagem: "data:image/png;base64,AAAA" } } };
    expect(criarVersao(comImagem, "x", [], dia(10)).projeto.planta.referencia).toBeUndefined();
    expect(criarVersao(projeto, "x", [], dia(10)).projeto.planta.referencia?.imagem).toBe("@planta-original");
  });

  it("abrir uma versão devolve a decoração dela, na base atual, sem prender o projeto à versão", () => {
    const pintado = { ...projeto, planta: { ...projeto.planta, paredes: projeto.planta.paredes.map((p) => (p.id === "p-fundo-jantar" ? definirAcabamento(p, "esquerda", "amb-jantar", { cor: "#1c2444" }) : p)) } };
    const v = criarVersao(pintado, "Remos em azul", [], dia(10));
    const aberto = projetoDaVersao(v, { ...projeto, base: "antiga" }, BASE_ATUAL, dia(11));
    expect(aberto.base).toBe(BASE_ATUAL);
    expect(aberto.alteradoPeloUsuario).toBe(true);
    expect(aberto.atualizadoEm).toBe(dia(11).toISOString());
    expect(mesmaDecoracao(v, aberto)).toBe(true);
    // editar o projeto aberto não mexe na versão guardada
    aberto.moveis[0].x += 10;
    expect(v.projeto.moveis[0].x).toBe(pintado.moveis[0].x);
  });

  it("ao abrir, a imagem de planta importada no projeto atual é mantida", () => {
    const v = criarVersao({ ...projeto, planta: { ...projeto.planta, referencia: { ...projeto.planta.referencia!, imagem: "data:image/png;base64,AAAA" } } }, "x", [], dia(10));
    const atual = { ...projeto, planta: { ...projeto.planta, referencia: { ...projeto.planta.referencia!, imagem: "data:image/png;base64,BBBB" } } };
    expect(projetoDaVersao(v, atual, BASE_ATUAL, dia(11)).planta.referencia?.imagem).toBe("data:image/png;base64,BBBB");
  });

  it("duplicar cria outra versão, com '(cópia)' no nome e sem repetir nomes", () => {
    const v = criarVersao(projeto, "Sala azul", [], dia(10), "data:image/jpeg;base64,xx", "a");
    const c1 = duplicarVersao(v, [v], dia(11), "b");
    expect(c1.nome).toBe("Sala azul (cópia)");
    expect(c1.id).not.toBe(v.id);
    expect(c1.miniatura).toBe(v.miniatura);
    expect(duplicarVersao(v, [v, c1], dia(12), "c").nome).toBe("Sala azul (cópia 2)");
  });

  it("renomear troca o nome e a data de alteração; nome vazio ou igual não muda nada", () => {
    const v = criarVersao(projeto, "A", [], dia(10));
    const r = renomearVersao(v, "  B  ", dia(12));
    expect(r.nome).toBe("B");
    expect(r.atualizadaEm > v.atualizadaEm).toBe(true);
    expect(r.criadaEm).toBe(v.criadaEm);
    expect(renomearVersao(v, "   ", dia(12))).toBe(v);
    expect(renomearVersao(v, "A", dia(12))).toBe(v);
  });

  it("ordena das mais recentes para as mais antigas e junta aparelho + conta sem duplicar", () => {
    const a = criarVersao(projeto, "A", [], dia(9), undefined, "a");
    const b = criarVersao(projeto, "B", [], dia(10), undefined, "b");
    const c = criarVersao(projeto, "C", [], dia(11), undefined, "c");
    expect(ordenarVersoes([a, c, b]).map((v) => v.nome)).toEqual(["C", "B", "A"]);
    // B foi renomeada na conta depois: vale a da conta; C só existe no aparelho; A só na conta
    const bConta = renomearVersao(b, "B (conta)", dia(15));
    expect(juntarVersoes([b, c], [a, bConta]).map((v) => v.nome)).toEqual(["C", "B (conta)", "A"]);
  });

  it("dados estranhos lidos do armazenamento não passam por versão", () => {
    expect(versaoValida(criarVersao(projeto, "ok", [], dia(10)))).toBe(true);
    expect(versaoValida(undefined)).toBe(false);
    expect(versaoValida({ id: "v-1", nome: "x", criadaEm: "2026", projeto: { versaoModelo: 1 } })).toBe(false);
    expect(versaoValida({ id: "v-1", nome: "x" })).toBe(false);
  });

  it("uma versão cabe com folga no limite de 256 KiB do banco da página", () => {
    const bytes = JSON.stringify(criarVersao(projeto, "Tamanho", [], dia(10))).length;
    expect(bytes).toBeLessThan(120_000);
  });
});
