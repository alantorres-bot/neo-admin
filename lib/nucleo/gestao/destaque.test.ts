import { describe, expect, it } from "vitest";
import { acaoRecomendada, descreverMotivo, ordenarMotivos, type Motivo } from "./destaque";

describe("descreverMotivo", () => {
  it("explica cada regra com os dados usados", () => {
    expect(descreverMotivo({ codigo: "AGUARDA_GESTOR", nivel: "intervir", desde: "2026-10-20", motivo: "Aprovar desconto" }))
      .toBe("Aguarda decisão do gestor desde 20/10/2026: Aprovar desconto");
    expect(descreverMotivo({ codigo: "ATRASO_RELEVANTE", nivel: "intervir", dias: 8, limite: 5 })).toBe("Atrasada há 8 dias (limite de 5 dias)");
    expect(descreverMotivo({ codigo: "ATRASO_RELEVANTE", nivel: "intervir", dias: 1, limite: 5, prioridade_critica: true }))
      .toBe("Atrasada há 1 dia, com prioridade crítica");
    expect(descreverMotivo({ codigo: "ATRASO_SIMPLES", nivel: "acompanhar", dias: 2 })).toBe("Atrasada há 2 dias");
    expect(descreverMotivo({ codigo: "VENCE_HOJE", nivel: "acompanhar" })).toBe("Vence hoje");
    expect(descreverMotivo({ codigo: "PRAZO_PROXIMO", nivel: "acompanhar", dias: 1, prazo: "2026-10-23" })).toBe("Vence amanhã (23/10/2026)");
    expect(descreverMotivo({ codigo: "PRAZO_PROXIMO", nivel: "acompanhar", dias: 3, prazo: "2026-10-25" })).toBe("Vence em 3 dias (25/10/2026)");
    expect(descreverMotivo({ codigo: "IMPACTO_REGISTRADO", nivel: "intervir", impacto: "fiscal", fundamento: "Multa da obrigação X" }))
      .toBe("Impacto fiscal registrado: Multa da obrigação X");
    expect(descreverMotivo({ codigo: "BLOQUEIO_RELEVANTE", nivel: "intervir", dias: 3, limite: 2, motivo: "Sem extrato" }))
      .toBe("Bloqueada há 3 dias (limite de 2 dias): Sem extrato");
    expect(descreverMotivo({ codigo: "BLOQUEADA", nivel: "acompanhar", dias: 0, motivo: "Sem extrato" })).toBe("Bloqueada hoje: Sem extrato");
    expect(descreverMotivo({ codigo: "BLOQUEADA", nivel: "acompanhar", dias: 1 })).toBe("Bloqueada desde ontem");
    expect(descreverMotivo({ codigo: "IMPEDE_OUTRA", nivel: "intervir", quantidade: 1 })).toBe("Impede outra pendência de avançar");
    expect(descreverMotivo({ codigo: "IMPEDE_OUTRA", nivel: "intervir", quantidade: 3 })).toBe("Impede 3 pendências de avançar");
    expect(descreverMotivo({ codigo: "PRECISA_DISTRIBUIR", nivel: "intervir", prioridade: "alta", prazo: "2026-10-24" }))
      .toBe("Sem responsável, prioridade alta, prazo 24/10/2026");
    expect(descreverMotivo({ codigo: "PRECISA_DISTRIBUIR", nivel: "acompanhar", prioridade: "normal", prazo: null })).toBe("Sem responsável");
    expect(descreverMotivo({ codigo: "SEM_MOVIMENTACAO", nivel: "acompanhar", dias: 9, limite: 5 })).toBe("Sem movimentação há 9 dias (limite de 5 dias)");
    expect(descreverMotivo({ codigo: "SEM_PRAZO_IMPORTANTE", nivel: "avaliar", prioridade: "critica" })).toBe("Prioridade crítica sem prazo definido");
  });

  it("ajuste manual mostra quem, quando e por quê", () => {
    const nomes = new Map([["u1", "Alan Torres"]]);
    expect(descreverMotivo({ codigo: "AJUSTE_MANUAL", nivel: "acompanhar", por: "u1", em: "2026-10-21T15:00:00Z", motivo: "Cliente já pagou" }, nomes))
      .toBe('Ajuste manual de Alan Torres em 21/10/2026 para "Acompanhar": Cliente já pagou');
  });
});

describe("acaoRecomendada", () => {
  const m = (codigo: Motivo["codigo"], nivel: Motivo["nivel"] = "intervir"): Motivo => ({ codigo, nivel });
  it("só recomenda quando a regra tem ação certa, na ordem decisão > distribuição > bloqueio > atraso", () => {
    expect(acaoRecomendada([m("ATRASO_RELEVANTE"), m("AGUARDA_GESTOR")], true)).toBe("Decidir o pedido do responsável");
    expect(acaoRecomendada([m("PRECISA_DISTRIBUIR")], false)).toBe("Atribuir um responsável");
    expect(acaoRecomendada([m("IMPEDE_OUTRA")], true)).toBe("Resolver o bloqueio com o responsável");
    expect(acaoRecomendada([m("ATRASO_RELEVANTE")], true)).toBe("Cobrar o andamento do responsável");
    expect(acaoRecomendada([m("ATRASO_RELEVANTE")], false)).toBeNull();
    expect(acaoRecomendada([m("PRECISA_DISTRIBUIR", "acompanhar")], false)).toBeNull();
    expect(acaoRecomendada([m("IMPACTO_REGISTRADO")], true)).toBeNull();
  });
});

describe("ordenarMotivos", () => {
  it("intervenção primeiro e ajuste manual por último, sem alterar a lista original", () => {
    const lista: Motivo[] = [{ codigo: "AJUSTE_MANUAL", nivel: "intervir" }, { codigo: "VENCE_HOJE", nivel: "acompanhar" }, { codigo: "AGUARDA_GESTOR", nivel: "intervir" }];
    expect(ordenarMotivos(lista).map((x) => x.codigo)).toEqual(["AGUARDA_GESTOR", "VENCE_HOJE", "AJUSTE_MANUAL"]);
    expect(lista[0].codigo).toBe("AJUSTE_MANUAL");
  });
});
