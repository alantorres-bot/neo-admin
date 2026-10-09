import { describe, expect, it } from "vitest";
import { criticidadeExecucao, podeAutorizar, podeCancelar, podeRemoverItem, prazoExecucao, resumirItens, situacaoDoItem, tituloPendenciaExecucao } from "./autorizacao";

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
