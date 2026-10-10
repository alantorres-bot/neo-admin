import { describe, expect, it } from "vitest";
import { compararComCaixa, criticidadeExecucao, mensagemSlack, parseReais, podeAutorizar, podeCancelar, podeRemoverItem, prazoExecucao, resumirItens, situacaoDoItem, tituloPendenciaExecucao } from "./autorizacao";

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
    expect(r).toEqual({ titulos: { quantidade: 1, centavos: 1_000 }, antecipacoes: { quantidade: 1, centavos: 2_000 }, geral: { quantidade: 2, centavos: 3_000 }, baixados: 1, removidos: 1 });
  });
  it("título da pendência igual ao do banco", () => {
    expect(tituloPendenciaExecucao(12, 48_391_044)).toBe("Executar autorização de pagamento nº 12 — R$ 483.910,44");
    expect(tituloPendenciaExecucao(1, 50)).toBe("Executar autorização de pagamento nº 1 — R$ 0,50");
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
      numero: 4, data: "10/10/2026", empresa: "NEO FORMAS", status: "autorizada", titulos: { quantidade: 2, centavos: 300_000 }, antecipacoes: { quantidade: 1, centavos: 50_000 },
      totalCentavos: 350_000, caixa: compararComCaixa(350_000, 300_000), autorizadaPor: "Diretor", observacao: "Semana 41", link: "https://neo.exemplo/financeiro/contas-pagar/autorizacoes/x",
    });
    expect(texto.split("\n")).toEqual([
      "*Autorização de pagamento nº 4* · NEO FORMAS · 10/10/2026",
      "Títulos: 2 (R$ 3.000,00) · Antecipações: 1 (R$ 500,00)",
      "*Total autorizado: R$ 3.500,00*",
      "Caixa disponível: R$ 3.000,00 · *Ultrapassa em R$ 500,00*",
      "Obs.: Semana 41",
      "Autorizada por Diretor.",
      "Relatório e itens: https://neo.exemplo/financeiro/contas-pagar/autorizacoes/x",
    ]);
  });
  it("rascunho vai marcado e sem caixa não há linha de caixa", () => {
    const texto = mensagemSlack({ numero: 5, data: "10/10/2026", empresa: "NEO", status: "rascunho", titulos: { quantidade: 1, centavos: 100 }, antecipacoes: { quantidade: 0, centavos: 0 }, totalCentavos: 100, caixa: null, autorizadaPor: null, observacao: null, link: "l" });
    expect(texto).toContain("· RASCUNHO");
    expect(texto).not.toContain("Caixa");
  });
});
