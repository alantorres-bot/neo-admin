import { describe, expect, it } from "vitest";
import {
  agruparPorCliente,
  criticidadeConfirmacao,
  descricaoPendenciaConfirmacao,
  elegiveis,
  mensagemWhatsAppConfirmacao,
  observacaoDemaisParcelas,
  planejarConfirmacoes,
  prazoConfirmacao,
  PREFIXO_CONFIRMACAO,
  tituloPendenciaConfirmacao,
  tituloPendenciaLigar,
  type TituloConfirmacao,
} from "../../../supabase/functions/_shared/confirmacao";

const HOJE = "2026-10-06";
const t = (id: string, extra: Partial<TituloConfirmacao> = {}): TituloConfirmacao => ({
  id, contraparteId: "c1", nomeCliente: "ACME LTDA", documento: `D${id}`, parcela: "1", vencimento: "2026-10-10", valorCentavos: 10_000_00, estagio: "boleto_enviado", ...extra,
});

describe("elegiveis", () => {
  it("vencimento de hoje até 7 dias, sem confirmação, sem pagamento", () => {
    const r = elegiveis([
      t("hoje", { vencimento: "2026-10-06" }),
      t("limite", { vencimento: "2026-10-13" }),
      t("longe", { vencimento: "2026-10-14" }),
      t("vencido", { vencimento: "2026-10-05" }),
      t("confirmado", { estagio: "confirmado_cliente" }),
      t("pago", { estagio: "pago" }),
      t("promessa", { estagio: "promessa" }),
      t("cedido", { cedido: true }),
      t("contestado", { contestado: true }),
      t("importado", { estagio: "importado" }),
      t("aguardando", { estagio: "aguardando_boleto" }),
    ], HOJE);
    expect(r.map((x) => x.id)).toEqual(["hoje", "limite", "importado", "aguardando"]);
  });
});

describe("planejarConfirmacoes", () => {
  it("soma por cliente e corta abaixo do mínimo (R$ 25.000)", () => {
    const g = planejarConfirmacoes([
      t("a1", { contraparteId: "grande", nomeCliente: "GRANDE", valorCentavos: 15_000_00 }),
      t("a2", { contraparteId: "grande", nomeCliente: "GRANDE", valorCentavos: 10_000_00, vencimento: "2026-10-12" }),
      t("b1", { contraparteId: "medio", nomeCliente: "MEDIO", valorCentavos: 24_999_99 }),
      t("c1", { contraparteId: "um", nomeCliente: "UM", valorCentavos: 90_000_00, vencimento: "2026-10-08" }),
    ], HOJE);
    expect(g.map((x) => x.nomeCliente)).toEqual(["UM", "GRANDE"]); // mais próximo primeiro; MEDIO ficou de fora
    expect(g[1].totalCentavos).toBe(25_000_00);
  });
  it("mínimo configurável e empate de vencimento por maior valor", () => {
    const g = planejarConfirmacoes([
      t("x", { contraparteId: "p", nomeCliente: "PEQUENO", valorCentavos: 6_000_00 }),
      t("y", { contraparteId: "g", nomeCliente: "GRANDE", valorCentavos: 8_000_00 }),
    ], HOJE, 5_000_00);
    expect(g.map((x) => x.nomeCliente)).toEqual(["GRANDE", "PEQUENO"]);
  });
  it("sem parcelas na janela não há grupo", () => {
    expect(planejarConfirmacoes([t("a", { vencimento: "2026-12-01", valorCentavos: 1_000_000_00 })], HOJE)).toEqual([]);
  });
});

describe("agruparPorCliente", () => {
  it("foca no vencimento mais próximo e separa as demais parcelas", () => {
    const [g] = agruparPorCliente([
      t("1", { vencimento: "2026-10-12", valorCentavos: 5_000_00 }),
      t("2", { vencimento: "2026-10-08", valorCentavos: 7_000_00 }),
      t("3", { vencimento: "2026-10-08", valorCentavos: 3_000_00 }),
    ], HOJE);
    expect(g.vencimentoMaisProximo).toBe("2026-10-08");
    expect(g.titulosDoFoco.map((x) => x.id)).toEqual(["2", "3"]);
    expect(g.demais.map((x) => x.id)).toEqual(["1"]);
    expect(g.totalCentavos).toBe(15_000_00);
  });
});

describe("prazo, criticidade e títulos da pendência", () => {
  it("prazo = vencimento menos 4 dias, ou hoje se já passou", () => {
    expect(prazoConfirmacao("2026-10-13", HOJE)).toBe("2026-10-09");
    expect(prazoConfirmacao("2026-10-08", HOJE)).toBe(HOJE);
    expect(prazoConfirmacao(HOJE, HOJE)).toBe(HOJE);
  });
  it("alta quando faltam até 2 dias", () => {
    expect(criticidadeConfirmacao("2026-10-08", HOJE)).toBe("alta");
    expect(criticidadeConfirmacao("2026-10-09", HOJE)).toBe("normal");
  });
  it("título único por cliente e vencimento", () => {
    expect(tituloPendenciaConfirmacao({ nomeCliente: " ACME ", vencimentoMaisProximo: "2026-10-08" })).toBe("Confirmar pagamento: ACME — vence 08/10");
    expect(tituloPendenciaConfirmacao({ nomeCliente: "", vencimentoMaisProximo: "2026-10-08" })).toBe("Confirmar pagamento: cliente — vence 08/10");
    expect(tituloPendenciaLigar({ nomeCliente: "ACME", vencimentoMaisProximo: "2026-10-08" })).toBe("Ligar para confirmar pagamento: ACME — vence 08/10");
    expect(tituloPendenciaConfirmacao({ nomeCliente: "A", vencimentoMaisProximo: "2026-10-08" }).startsWith(PREFIXO_CONFIRMACAO)).toBe(true);
  });
});

describe("mensagemWhatsAppConfirmacao (modelo da skill)", () => {
  it("uma parcela", () => {
    const [g] = agruparPorCliente([t("1", { documento: "1001395A", valorCentavos: 52_500_00, vencimento: "2026-10-15" })], "2026-10-12");
    const m = mensagemWhatsAppConfirmacao(g);
    expect(m).toBe([
      "Olá! Aqui é do Financeiro da Neo Formas.",
      "Estamos passando para confirmar a programação do pagamento da parcela no valor de *R$ 52.500,00*, com vencimento em *15/10/2026* (título 1001395A).",
      "Você pode nos confirmar que o pagamento está programado para a data? Se precisar do boleto ou dos dados para PIX/transferência, é só avisar que enviamos na hora.",
      "Ficamos à disposição. Obrigado!",
    ].join("\n\n"));
    expect(/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(m)).toBe(false); // sem emojis
  });
  it("várias parcelas do mesmo vencimento: lista e total; contato personaliza a saudação", () => {
    const [g] = agruparPorCliente([
      t("1", { documento: "A", valorCentavos: 1_000_00 }),
      t("2", { documento: "B", parcela: "2", valorCentavos: 2_500_50 }),
    ], HOJE);
    const m = mensagemWhatsAppConfirmacao(g, " Ana ");
    expect(m).toContain("Olá, Ana! Aqui é do Financeiro da Neo Formas.");
    expect(m).toContain("das parcelas abaixo, com vencimento em *10/10/2026*:");
    expect(m).toContain("• título A — R$ 1.000,00\n• título B/2 — R$ 2.500,50");
    expect(m).toContain("Total: *R$ 3.500,50*.");
  });
  it("parcelas de vencimentos seguintes não entram na mensagem (vão na observação)", () => {
    const [g] = agruparPorCliente([t("1", { documento: "A" }), t("2", { documento: "B", vencimento: "2026-10-12" })], HOJE);
    expect(mensagemWhatsAppConfirmacao(g)).not.toContain("B");
    expect(observacaoDemaisParcelas(g)).toContain("esta parcela nos próximos dias: B (12/10/2026, R$ 10.000,00)");
    expect(observacaoDemaisParcelas({ demais: [] })).toBe("");
  });
});

describe("descricaoPendenciaConfirmacao", () => {
  it("lista as parcelas, a observação e a mensagem pronta", () => {
    const [g] = agruparPorCliente([t("1", { documento: "A" }), t("2", { documento: "B", vencimento: "2026-10-12" })], HOJE);
    const d = descricaoPendenciaConfirmacao(g, "Ana");
    expect(d).toContain("total R$ 20.000,00");
    expect(d).toContain("• A — vence 10/10/2026 — R$ 10.000,00");
    expect(d).toContain("• B — vence 12/10/2026 — R$ 10.000,00");
    expect(d).toContain("Observação (não enviar ao cliente)");
    expect(d).toContain("Mensagem para o cliente (WhatsApp):\n\nOlá, Ana!");
  });
});

describe("unidades (Matriz e Filial Contagem)", () => {
  const tit = (extra: Record<string, unknown> = {}) => ({
    id: "a", contraparteId: "c1", nomeCliente: "Cliente", documento: "1001", parcela: "1", vencimento: "2026-10-12", valorCentavos: 3_000_000, estagio: "boleto_enviado", ...extra,
  });
  it("agrupa por cliente e unidade, e o corte de valor vale por grupo", () => {
    const grupos = planejarConfirmacoes([tit(), tit({ id: "b", documento: "4001", unidade: "contagem", valorCentavos: 1_000_000 })], "2026-10-08");
    expect(grupos).toHaveLength(1); // só a Matriz passa de R$ 25.000
    expect(grupos[0].unidade).toBe("matriz");
  });
  it("o título da pendência da Filial leva o sufixo", () => {
    const [g] = planejarConfirmacoes([tit({ unidade: "contagem" })], "2026-10-08");
    expect(tituloPendenciaConfirmacao(g)).toBe("Confirmar pagamento: Cliente (Filial Contagem) — vence 12/10");
    expect(tituloPendenciaLigar(g)).toBe("Ligar para confirmar pagamento: Cliente (Filial Contagem) — vence 12/10");
  });
});
