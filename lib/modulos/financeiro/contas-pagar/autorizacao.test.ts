import { describe, expect, it } from "vitest";
import { compararComCaixa, criticidadeExecucao, mensagemSlack, parseReais, podeAutorizar, podeCancelar, podeEditarExtras, podeRemoverItem, prazoExecucao, resumirItens, situacaoDoItem, tituloPendenciaExecucao, totalParaCaixa, validarExtra, descreverRascunho } from "./autorizacao";

const gestor = { podeOperar: true, ehGestor: true, userId: "g" };
const operador = { podeOperar: true, ehGestor: false, userId: "o" };
const consulta = { podeOperar: false, ehGestor: false, userId: "c" };

describe("quem pode o quê", () => {
  it("autorizar: só gestor, só rascunho (quem montou pode autorizar a própria)", () => {
    expect(podeAutorizar("rascunho", gestor)).toBe(true);
    expect(podeAutorizar("rascunho", operador)).toBe(false);
    expect(podeAutorizar("autorizada", gestor)).toBe(false);
  });
  it("cancelar: gestor cancela rascunho ou autorizada; operador só o próprio rascunho", () => {
    expect(podeCancelar("autorizada", "x", gestor)).toBe(true);
    expect(podeCancelar("rascunho", "o", operador)).toBe(true);
    expect(podeCancelar("rascunho", "outro", operador)).toBe(false);
    expect(podeCancelar("autorizada", "o", operador)).toBe(false);
    expect(podeCancelar("cancelada", "x", gestor)).toBe(false);
    expect(podeCancelar("rascunho", "c", consulta)).toBe(false);
  });
  it("remover item: só rascunho, operador ou acima", () => {
    expect(podeRemoverItem("rascunho", operador)).toBe(true);
    expect(podeRemoverItem("rascunho", consulta)).toBe(false);
    expect(podeRemoverItem("autorizada", gestor)).toBe(false);
  });
});

describe("totais e textos", () => {
  it("resume por tipo, ignora removidos e conta baixados", () => {
    const r = resumirItens([
      { tipo: "titulo", valorCentavos: 1_000, removido: false, baixadoConsistemEm: "2026-10-10" },
      { tipo: "titulo", valorCentavos: 500, removido: true, baixadoConsistemEm: null },
      { tipo: "antecipacao", valorCentavos: 2_000, removido: false, baixadoConsistemEm: null },
    ]);
    expect(r).toEqual({ titulos: { quantidade: 1, centavos: 1_000 }, antecipacoes: { quantidade: 1, centavos: 2_000 }, extras: { quantidade: 0, centavos: 0 }, lancamentos: { quantidade: 2, centavos: 3_000 }, geral: { quantidade: 2, centavos: 3_000 }, baixados: 1, removidos: 1 });
  });
  it("título da pendência igual ao do banco", () => {
    expect(tituloPendenciaExecucao("101026", 48_391_044)).toBe("Executar autorização de pagamento 101026 — R$ 483.910,44");
    expect(tituloPendenciaExecucao("101026-2", 50)).toBe("Executar autorização de pagamento 101026-2 — R$ 0,50");
  });
  it("prazo = menor data, nunca no passado; criticidade alta até 3 dias", () => {
    expect(prazoExecucao(["2026-10-20", null, "2026-10-12"], "2026-10-09")).toBe("2026-10-12");
    expect(prazoExecucao(["2026-10-01"], "2026-10-09")).toBe("2026-10-09");
    expect(prazoExecucao([null], "2026-10-09")).toBe("2026-10-09");
    expect(criticidadeExecucao("2026-10-12", "2026-10-09")).toBe("alta");
    expect(criticidadeExecucao("2026-10-13", "2026-10-09")).toBe("normal");
  });
  it("situação do item", () => {
    expect(situacaoDoItem({ removido: true, baixadoConsistemEm: null, tipo: "titulo" })).toBe("removido");
    expect(situacaoDoItem({ removido: false, baixadoConsistemEm: "2026-10-10", tipo: "titulo" })).toBe("baixado no Consistem");
    expect(situacaoDoItem({ removido: false, baixadoConsistemEm: "2026-10-10", tipo: "antecipacao" })).toBe("abatida por NF no Consistem");
    expect(situacaoDoItem({ removido: false, baixadoConsistemEm: null, tipo: "titulo" })).toBe("em aberto no Consistem");
  });
});

describe("caixa disponível", () => {
  it("parseReais aceita formato brasileiro e americano; rejeita vazio, negativo e lixo", () => {
    expect(parseReais("1.234,56")).toBe(123_456);
    expect(parseReais("R$ 50.000")).toBe(5_000_000);
    expect(parseReais("1234.56")).toBe(123_456);
    expect(parseReais("")).toBeNull();
    expect(parseReais("-10")).toBeNull();
    expect(parseReais("abc")).toBeNull();
  });
  it("compara total com caixa: sobra, excedente e aviso", () => {
    expect(compararComCaixa(100, null)).toBeNull();
    expect(compararComCaixa(80_00, 100_00)).toEqual({ caixaCentavos: 100_00, sobraCentavos: 20_00, excedenteCentavos: 0, ultrapassa: false });
    expect(compararComCaixa(130_00, 100_00)).toEqual({ caixaCentavos: 100_00, sobraCentavos: 0, excedenteCentavos: 30_00, ultrapassa: true });
  });
});

describe("mensagem para o Slack", () => {
  it("monta o texto com totais, caixa e link", () => {
    const texto = mensagemSlack({
      codigo: "101026", data: "10/10/2026", empresa: "NEO FORMAS", status: "autorizada", titulos: { quantidade: 2, centavos: 300_000 }, antecipacoes: { quantidade: 1, centavos: 50_000 },
      totalCentavos: 350_000, caixa: compararComCaixa(350_000, 300_000), autorizadaPor: "Diretor", observacao: "Semana 41", link: "https://neo.exemplo/financeiro/contas-pagar/autorizacoes/x",
    });
    expect(texto.split("\n")).toEqual([
      "*Autorização de pagamento 101026* · NEO FORMAS · 10/10/2026",
      "Títulos: 2 (R$ 3.000,00) · Antecipações: 1 (R$ 500,00)",
      "*Total autorizado: R$ 3.500,00*",
      "Caixa disponível: R$ 3.000,00 · *Ultrapassa em R$ 500,00*",
      "Obs.: Semana 41",
      "Autorizada por Diretor.",
      "Relatório e itens: https://neo.exemplo/financeiro/contas-pagar/autorizacoes/x",
    ]);
  });
  it("rascunho vai marcado e sem caixa não há linha de caixa", () => {
    const texto = mensagemSlack({ codigo: "101026-2", data: "10/10/2026", empresa: "NEO", status: "rascunho", titulos: { quantidade: 1, centavos: 100 }, antecipacoes: { quantidade: 0, centavos: 0 }, totalCentavos: 100, caixa: null, autorizadaPor: null, observacao: null, link: "l" });
    expect(texto).toContain("· RASCUNHO");
    expect(texto).not.toContain("Caixa");
  });
});

describe("pagamentos extras (fora do Consistem)", () => {
  it("resumirItens soma os extras no total geral, separados dos lançamentos; removidos não contam", () => {
    const r = resumirItens(
      [{ tipo: "titulo", valorCentavos: 10_000, removido: false, baixadoConsistemEm: null }, { tipo: "antecipacao", valorCentavos: 5_000, removido: false, baixadoConsistemEm: null }],
      [{ valorCentavos: 8_050, removido: false }, { valorCentavos: 999, removido: true }],
    );
    expect(r.extras).toEqual({ quantidade: 1, centavos: 8_050 });
    expect(r.lancamentos).toEqual({ quantidade: 2, centavos: 15_000 });
    expect(r.geral).toEqual({ quantidade: 3, centavos: 23_050 });
    // sem extras, geral = lançamentos (compatível com o que já existia)
    const s = resumirItens([{ tipo: "titulo", valorCentavos: 100, removido: false, baixadoConsistemEm: null }]);
    expect(s.extras).toEqual({ quantidade: 0, centavos: 0 });
    expect(s.geral).toEqual(s.lancamentos);
  });
  it("validarExtra aplica as mesmas regras do banco", () => {
    expect(validarExtra({ descricao: "Frete avulso — NF 123", favorecido: "Transportadora XPTO", valorCentavos: 8_050 })).toBeNull();
    expect(validarExtra({ descricao: "ab", favorecido: "Alguém", valorCentavos: 100 })).toMatch(/descrição/);
    expect(validarExtra({ descricao: "Frete avulso", favorecido: " ", valorCentavos: 100 })).toMatch(/favorecido/);
    expect(validarExtra({ descricao: "Frete avulso", favorecido: "Alguém", valorCentavos: 0 })).toMatch(/Valor inválido/);
    expect(validarExtra({ descricao: "Frete avulso", favorecido: "Alguém", valorCentavos: null })).toMatch(/Valor inválido/);
    expect(validarExtra({ descricao: "x".repeat(201), favorecido: "Alguém", valorCentavos: 100 })).toMatch(/descrição/);
  });
  it("extras só em rascunho, por operador ou acima", () => {
    const operador = { podeOperar: true, ehGestor: false, userId: "u" };
    const consulta = { podeOperar: false, ehGestor: false, userId: "u" };
    expect(podeEditarExtras("rascunho", operador)).toBe(true);
    expect(podeEditarExtras("autorizada", operador)).toBe(false);
    expect(podeEditarExtras("rascunho", consulta)).toBe(false);
  });
  it("mensagemSlack cita os extras quando há", () => {
    const base = { codigo: "101026", data: "10/10/2026", empresa: "NEO FORMAS", status: "autorizada" as const, titulos: { quantidade: 1, centavos: 100 }, antecipacoes: { quantidade: 0, centavos: 0 }, totalCentavos: 8_150, caixa: null, autorizadaPor: null, observacao: null, link: "http://x" };
    expect(mensagemSlack({ ...base, extras: { quantidade: 1, centavos: 8_050 } })).toContain("Extras (fora do Consistem): 1 (R$ 80,50)");
    expect(mensagemSlack(base)).not.toContain("Extras");
  });
});

describe("rascunho em montagem (tela de seleção)", () => {
  it("descreverRascunho mostra itens e, quando há, os extras", () => {
    expect(descreverRascunho({ codigo: "111026", itens: 3, extras: 0, totalCentavos: 150_000, totalExtrasCentavos: 0 })).toBe("Rascunho 111026 em montagem: 3 itens · R$ 1.500,00");
    expect(descreverRascunho({ codigo: "111026", itens: 1, extras: 2, totalCentavos: 110_050, totalExtrasCentavos: 10_050 })).toBe("Rascunho 111026 em montagem: 1 item · R$ 1.000,00 + 2 extras · R$ 100,50");
  });
  it("totalParaCaixa soma o rascunho com o que está marcado", () => {
    expect(totalParaCaixa(null, 500)).toBe(500);
    expect(totalParaCaixa({ totalCentavos: 1_000 }, 500)).toBe(1_500);
  });
});
