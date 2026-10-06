import { describe, expect, it } from "vitest";
import {
  calcularEncargos, canaisDoMarco, cobravel, criticidadeCobranca, descricaoPendenciaCobranca, emailCobranca, linhaDemonstrativo,
  marcoDoAtraso, mensagemWhatsAppCobranca, planejarCobrancas, tituloPendenciaCobranca, totalAtualizadoCentavos, type TituloCobranca,
} from "../../../supabase/functions/_shared/cobranca";

const HOJE = "2026-10-20";
const CORTE = "2026-10-06";

const t = (extra: Partial<TituloCobranca> = {}): TituloCobranca => ({
  id: "t1", contraparteId: "c1", nomeCliente: "Cliente Alfa", documento: "1001", parcela: "1", vencimento: "2026-10-19", valorCentavos: 1_000_000, estagio: "importado", ...extra,
});

describe("marcoDoAtraso", () => {
  it.each([[0, null], [-3, null], [1, 1], [4, 1], [5, 5], [9, 5], [10, 10], [40, 10]])("%i dias de atraso → marco %j", (dias, marco) => {
    expect(marcoDoAtraso(dias)).toBe(marco);
  });
  it("canais por marco: D+1 e-mail e WhatsApp, D+5 WhatsApp, D+10 e-mail", () => {
    expect(canaisDoMarco(1)).toEqual(["email", "whatsapp"]);
    expect(canaisDoMarco(5)).toEqual(["whatsapp"]);
    expect(canaisDoMarco(10)).toEqual(["email"]);
  });
});

describe("calcularEncargos", () => {
  it("sem atraso não há encargos", () => {
    expect(calcularEncargos(1_000_000, 0)).toEqual({ multaCentavos: 0, jurosCentavos: 0, totalCentavos: 1_000_000 });
  });
  it("multa de 2% + juros de 2% ao mês pro rata dia sobre o valor original", () => {
    // 10.000,00: multa 200,00; juros 2%/30 por dia = 6,67/dia × 15 = 100,00
    expect(calcularEncargos(1_000_000, 15)).toEqual({ multaCentavos: 20_000, jurosCentavos: 10_000, totalCentavos: 1_030_000 });
  });
  it("valor + multa + juros sempre fecha o total, sem centavo de diferença", () => {
    for (const valor of [12_345, 99_999, 1_234_567, 3_333_333]) {
      for (const dias of [1, 3, 7, 11, 29, 47]) {
        const e = calcularEncargos(valor, dias);
        expect(valor + e.multaCentavos + e.jurosCentavos).toBe(e.totalCentavos);
      }
    }
  });
  it("respeita percentuais do contrato", () => {
    expect(calcularEncargos(1_000_000, 30, 1, 1).totalCentavos).toBe(1_000_000 + 10_000 + 10_000);
  });
});

describe("cobravel", () => {
  it("vencido, dentro do corte e sem pausa é cobrável", () => {
    expect(cobravel(t(), HOJE, CORTE)).toBe(true);
    expect(cobravel(t({ estagio: "vencido" }), HOJE, CORTE)).toBe(true);
    expect(cobravel(t({ estagio: "confirmado_cliente" }), HOJE, CORTE)).toBe(true);
  });
  it("não cobra: a vencer, vencendo hoje, antes do corte", () => {
    expect(cobravel(t({ vencimento: "2026-10-21" }), HOJE, CORTE)).toBe(false);
    expect(cobravel(t({ vencimento: HOJE }), HOJE, CORTE)).toBe(false);
    expect(cobravel(t({ vencimento: "2026-10-05" }), HOJE, CORTE)).toBe(false);
    expect(cobravel(t({ vencimento: "2026-10-06" }), HOJE, CORTE)).toBe(true); // o corte vale
  });
  it("não cobra: pago, renegociado, jurídico, cancelado, em renegociação, cedido, contestado", () => {
    for (const estagio of ["pago", "renegociado", "juridico", "cancelado", "em_renegociacao"]) expect(cobravel(t({ estagio }), HOJE, CORTE)).toBe(false);
    expect(cobravel(t({ cedido: true }), HOJE, CORTE)).toBe(false);
    expect(cobravel(t({ contestado: true }), HOJE, CORTE)).toBe(false);
  });
  it("não cobra título com possível baixa (excluído)", () => {
    expect(cobravel(t(), HOJE, CORTE, new Set(["t1"]))).toBe(false);
  });
  it("promessa pausa a régua até a data; depois dela, retoma", () => {
    expect(cobravel(t({ estagio: "promessa", reguaPausadaAte: "2026-10-25" }), HOJE, CORTE)).toBe(false);
    expect(cobravel(t({ estagio: "promessa", reguaPausadaAte: HOJE }), HOJE, CORTE)).toBe(false); // vale até o fim do dia
    expect(cobravel(t({ estagio: "promessa", reguaPausadaAte: "2026-10-19" }), HOJE, CORTE)).toBe(true);
    expect(cobravel(t({ estagio: "promessa", reguaPausadaAte: null }), HOJE, CORTE)).toBe(false); // promessa sem data: não cobra às cegas
  });
});

describe("planejarCobrancas", () => {
  it("agrupa por cliente e marco: vários títulos do mesmo cliente no mesmo marco viram um grupo", () => {
    const g = planejarCobrancas([
      t({ id: "a", documento: "1002", vencimento: "2026-10-18" }),
      t({ id: "b", documento: "1001", vencimento: "2026-10-19", valorCentavos: 500_000 }),
    ], HOJE, CORTE);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ marco: 1, totalCentavos: 1_500_000, vencimentoMaisAntigo: "2026-10-18" });
    expect(g[0].titulos.map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("o mesmo cliente com títulos em marcos diferentes gera um grupo por marco, cada título no seu", () => {
    const g = planejarCobrancas([
      t({ id: "a", vencimento: "2026-10-19" }), // D+1
      t({ id: "b", vencimento: "2026-10-14" }), // D+6 → D+5
      t({ id: "c", vencimento: "2026-10-08" }), // D+12 → D+10
    ], HOJE, CORTE);
    expect(g.map((x) => [x.marco, x.titulos.map((y) => y.id)])).toEqual([[10, ["c"]], [5, ["b"]], [1, ["a"]]]);
  });
  it("clientes diferentes não se misturam", () => {
    const g = planejarCobrancas([t({ id: "a" }), t({ id: "b", contraparteId: "c2", nomeCliente: "Cliente Beta" })], HOJE, CORTE);
    expect(g).toHaveLength(2);
  });
  it("sem título cobrável, nada", () => {
    expect(planejarCobrancas([t({ vencimento: "2026-09-01" }), t({ id: "x", estagio: "pago" })], HOJE, CORTE)).toEqual([]);
  });
  it("o título da pendência é único por cliente, marco e vencimento mais antigo", () => {
    const [g] = planejarCobrancas([t()], HOJE, CORTE);
    expect(tituloPendenciaCobranca(g)).toBe("Cobrar D+1: Cliente Alfa — venc. 19/10");
  });
  it("D+10 é criticidade alta; D+1 e D+5, normal", () => {
    expect([1, 5, 10].map((m) => criticidadeCobranca(m as 1 | 5 | 10))).toEqual(["normal", "normal", "alta"]);
  });
});

describe("mensagens", () => {
  const grupo = (extra: Partial<TituloCobranca>[] = [{}], marco: 1 | 5 | 10 = 1) => ({ marco, nomeCliente: "Cliente Alfa", titulos: extra.map((e, i) => t({ id: `t${i}`, documento: `100${i + 1}`, ...e })) });

  it("WhatsApp D+1: cordial, com a parcela e o pedido de comprovante", () => {
    const m = mensagemWhatsAppCobranca(grupo(), "Ana")!;
    expect(m).toContain("Olá, Ana! Aqui é do Financeiro da Neo Formas.");
    expect(m).toContain("• título 1001 — vencimento 19/10/2026 — R$ 10.000,00");
    expect(m).toContain("comprovante");
    expect(m).not.toMatch(/multa|juros/i);
  });
  it("WhatsApp D+5 pede a previsão; várias parcelas viram lista no plural", () => {
    const m = mensagemWhatsAppCobranca(grupo([{}, { parcela: "2", vencimento: "2026-10-14" }], 5), "")!;
    expect(m.startsWith("Olá! Aqui é do Financeiro")).toBe(true);
    expect(m).toContain("as parcelas abaixo, ainda em aberto");
    expect(m).toContain("• título 1002/2");
    expect(m).toContain("previsão de pagamento");
  });
  it("D+10 não tem WhatsApp, e D+5 não tem e-mail", () => {
    expect(mensagemWhatsAppCobranca(grupo([{}], 10))).toBeNull();
    expect(emailCobranca(grupo([{}], 5), HOJE)).toBeNull();
  });
  it("e-mail D+1 termina em 'Atenciosamente,' sem assinatura", () => {
    const e = emailCobranca(grupo(), HOJE, "Ana")!;
    expect(e.assunto).toBe("Lembrete de vencimento — Cliente Alfa");
    expect(e.corpo.startsWith("Olá, Ana!")).toBe(true);
    expect(e.corpo.endsWith("Atenciosamente,")).toBe(true);
  });
  it("e-mail D+10 traz o demonstrativo de multa e juros e o total atualizado", () => {
    const g = grupo([{ vencimento: "2026-10-05" }], 10); // 15 dias
    const e = emailCobranca(g, HOJE)!;
    expect(e.assunto).toBe("Cobrança de títulos vencidos — Cliente Alfa");
    expect(e.corpo).toContain("(15 dias de atraso): valor R$ 10.000,00 + multa R$ 200,00 + juros R$ 100,00 = R$ 10.300,00");
    expect(e.corpo).toContain("Total atualizado: R$ 10.300,00.");
    expect(e.corpo).toContain("multa de 2% e os juros de 2% ao mês");
    expect(e.corpo.endsWith("Atenciosamente,")).toBe(true);
  });
  it("demonstrativo usa a data de hoje e o total soma os títulos", () => {
    expect(linhaDemonstrativo(t({ vencimento: "2026-10-19" }), HOJE)).toContain("(1 dia de atraso)");
    const g = { titulos: [t({ vencimento: "2026-10-05" }), t({ id: "b", vencimento: "2026-10-05", valorCentavos: 500_000 })] };
    expect(totalAtualizadoCentavos(g, HOJE)).toBe(1_030_000 + 515_000);
  });
  it("a descrição da pendência traz as parcelas e as mensagens; no D+10 avisa sobre os encargos padrão", () => {
    const [g1] = planejarCobrancas([t()], HOJE, CORTE);
    const d1 = descricaoPendenciaCobranca(g1, HOJE, "Ana");
    expect(d1).toContain("D+1: Lembrete cordial de vencimento");
    expect(d1).toContain("Mensagem para o cliente (WhatsApp)");
    expect(d1).toContain("Lembrete de vencimento — Cliente Alfa");
    expect(d1).not.toContain("padrão do módulo");

    const [g10] = planejarCobrancas([t({ vencimento: "2026-10-08" })], HOJE, CORTE);
    const d10 = descricaoPendenciaCobranca(g10, HOJE);
    expect(d10).toContain("padrão do módulo (multa 2% e juros 2% ao mês)");
    expect(d10).not.toContain("Mensagem para o cliente (WhatsApp)");
  });
});

describe("unidades (Matriz e Filial Contagem)", () => {
  it("o mesmo cliente com títulos nas duas unidades gera um grupo por unidade", () => {
    const g = planejarCobrancas([
      t({ id: "m", documento: "1001" }),
      t({ id: "f", documento: "4001", unidade: "contagem" }),
    ], HOJE, CORTE);
    expect(g).toHaveLength(2);
    expect(g.map((x) => [x.unidade, x.titulos.map((y) => y.id)]).sort()).toEqual([["contagem", ["f"]], ["matriz", ["m"]]]);
  });
  it("o título da pendência da Filial Contagem leva o sufixo; o da Matriz não muda", () => {
    const [m, f] = [t(), t({ unidade: "contagem" })].map((x) => planejarCobrancas([x], HOJE, CORTE)[0]);
    expect(tituloPendenciaCobranca(m)).toBe("Cobrar D+1: Cliente Alfa — venc. 19/10");
    expect(tituloPendenciaCobranca(f)).toBe("Cobrar D+1: Cliente Alfa (Filial Contagem) — venc. 19/10");
  });
  it("a descrição da pendência da Filial avisa a unidade", () => {
    const [f] = planejarCobrancas([t({ unidade: "contagem" })], HOJE, CORTE);
    expect(descricaoPendenciaCobranca(f, HOJE)).toContain("Unidade: Filial Contagem");
  });
});
