import { describe, expect, it } from "vitest";
import {
  canaisDoMarco, criticidadeCobranca, descricaoPendenciaCobranca, emailCobranca, marcoDoAtraso, marcoInformaEncargos, MARCOS_PADRAO, marcosDeLinhas,
  mensagemWhatsAppCobranca, nomeDoMarco, planejarCobrancas, renderizarTexto, tituloPendenciaCobranca, validarMarcos, variaveisDesconhecidas, VARIAVEIS_TEXTO_COBRANCA,
  type GrupoCobranca, type MarcoRegua, type TituloCobranca,
} from "../../../supabase/functions/_shared/cobranca";

const HOJE = "2026-10-20";
const titulo = (id: string, vencimento: string, valorCentavos = 10_000_00, extra: Partial<TituloCobranca> = {}): TituloCobranca => ({
  id, contraparteId: "c1", nomeCliente: "Cliente Alfa", documento: id, parcela: "1", vencimento, valorCentavos, estagio: "vencido", ...extra,
});
const marco = (dias: number, extra: Partial<MarcoRegua> = {}): MarcoRegua => ({
  dias, nome: `D+${dias}`, canais: ["whatsapp"], descricao: `Marco ${dias}`, textoWhatsapp: "{saudacao} Faltam {total}.\n\n{parcelas}", assuntoEmail: null, corpoEmail: null, ...extra,
});
const grupo = (marcoDias: number, titulos: TituloCobranca[]): GrupoCobranca => ({
  contraparteId: "c1", nomeCliente: "Cliente Alfa", unidade: "matriz", marco: marcoDias, titulos,
  totalCentavos: titulos.reduce((s, t) => s + t.valorCentavos, 0), vencimentoMaisAntigo: titulos[0].vencimento,
});

describe("marcos editáveis: escolha do marco", () => {
  const custom = [marco(3), marco(15), marco(40)];

  it("usa o maior marco já atingido, em qualquer ordem da lista", () => {
    expect(marcoDoAtraso(2, custom)).toBeNull();
    expect(marcoDoAtraso(3, custom)).toBe(3);
    expect(marcoDoAtraso(14, custom)).toBe(3);
    expect(marcoDoAtraso(15, custom)).toBe(15);
    expect(marcoDoAtraso(200, custom)).toBe(40);
    expect(marcoDoAtraso(20, [marco(15), marco(3)])).toBe(15); // lista fora de ordem
    expect(marcoDoAtraso(20, [])).toBeNull(); // régua sem marcos não cobra
  });

  it("o nome é sempre D+<dias>", () => {
    expect(nomeDoMarco(3)).toBe("D+3");
    expect(nomeDoMarco(40)).toBe("D+40");
  });

  it("canais e criticidade vêm da lista (o último marco é alta)", () => {
    const lista = [marco(3, { canais: ["email"] }), marco(15)];
    expect(canaisDoMarco(3, lista)).toEqual(["email"]);
    expect(canaisDoMarco(99, lista)).toEqual([]);
    expect(criticidadeCobranca(3, lista)).toBe("normal");
    expect(criticidadeCobranca(15, lista)).toBe("alta");
    expect(criticidadeCobranca(15, [])).toBe("normal");
    expect(criticidadeCobranca(1)).toBe("normal"); // padrão
    expect(criticidadeCobranca(10)).toBe("alta");
  });
});

describe("marcos editáveis: planejarCobrancas", () => {
  it("agrupa por cliente e marco da lista recebida", () => {
    // vencidos há 4 e 16 dias: com D+3 e D+15 são dois marcos; com o padrão (1, 5, 10) seriam D+1 e D+10
    const titulos = [titulo("a", "2026-10-16"), titulo("b", "2026-10-04")];
    const custom = planejarCobrancas(titulos, HOJE, "2026-01-01", new Set(), [marco(3), marco(15)]);
    expect(custom.map((g) => g.marco)).toEqual([15, 3]);
    const padrao = planejarCobrancas(titulos, HOJE, "2026-01-01");
    expect(padrao.map((g) => g.marco)).toEqual([10, 1]);
  });

  it("sem marcos, não cobra nada", () => {
    expect(planejarCobrancas([titulo("a", "2026-10-01")], HOJE, "2026-01-01", new Set(), [])).toEqual([]);
  });

  it("o título da pendência usa o nome do marco novo", () => {
    const [g] = planejarCobrancas([titulo("a", "2026-10-14")], HOJE, "2026-01-01", new Set(), [marco(6)]);
    expect(tituloPendenciaCobranca(g)).toBe("Cobrar D+6: Cliente Alfa — venc. 14/10");
  });
});

describe("textos com variáveis", () => {
  const g = grupo(5, [titulo("1001", "2026-10-10", 12_500_00), titulo("1002", "2026-10-12", 8_300_00)]);

  it("troca as variáveis e escolhe singular/plural", () => {
    const um = grupo(5, [titulo("1001", "2026-10-10", 12_500_00)]);
    const modelo = "Oi {saudacao} {cliente} — {pl:uma parcela|várias parcelas} — {marco} ({marco_dias}) — {total} — {data} — {multa_pct}% {juros_pct}%";
    expect(renderizarTexto(modelo, um, 5, HOJE, "Ana")).toBe("Oi Olá, Ana! Cliente Alfa — uma parcela — D+5 (5) — R$ 12.500,00 — 20/10/2026 — 2% 2%");
    expect(renderizarTexto(modelo, g, 5, HOJE)).toContain("— várias parcelas —");
    expect(renderizarTexto(modelo, g, 5, HOJE)).toContain("R$ 20.800,00");
  });

  it("{parcelas} e {demonstrativo} listam as parcelas; total atualizado inclui multa e juros", () => {
    const t = renderizarTexto("{parcelas}\n{demonstrativo}\n{total_atualizado}", g, 5, HOJE);
    expect(t).toContain("• título 1001 — vencimento 10/10/2026 — R$ 12.500,00");
    expect(t).toContain("(10 dias de atraso): valor R$ 12.500,00 + multa R$ 250,00 + juros");
    expect(t).toMatch(/R\$ 2\d\.\d{3},\d{2}$/);
  });

  it("variável desconhecida fica como está e é apontada na validação", () => {
    expect(renderizarTexto("Oi {nome}", g, 5, HOJE)).toBe("Oi {nome}");
    expect(variaveisDesconhecidas("{saudacao} {nome} {pl:a|b} {x} {nome}")).toEqual(["{nome}", "{x}"]);
    expect(variaveisDesconhecidas(Object.keys(VARIAVEIS_TEXTO_COBRANCA).map((v) => `{${v}}`).join(" "))).toEqual([]);
  });

  it("mensagem e e-mail só existem nos canais escolhidos", () => {
    const m = marco(5, { canais: ["email"], textoWhatsapp: "texto que sobrou", assuntoEmail: "Assunto {cliente}", corpoEmail: "{saudacao}\n\n{parcelas}\n\nAtenciosamente," });
    expect(mensagemWhatsAppCobranca(g, "", [m], HOJE)).toBeNull();
    expect(emailCobranca(g, HOJE, "", [m])?.assunto).toBe("Assunto Cliente Alfa");
    const w = marco(5);
    expect(emailCobranca(g, HOJE, "", [w])).toBeNull();
    expect(mensagemWhatsAppCobranca(g, "", [w], HOJE)).toContain("Faltam R$ 20.800,00.");
    expect(mensagemWhatsAppCobranca(g, "", [], HOJE)).toBeNull(); // marco que não existe
  });

  it("encargos: a pendência avisa para conferir o contrato só quando o marco os informa", () => {
    const comEncargos = marco(10, { canais: ["email"], assuntoEmail: "x", corpoEmail: "Total atualizado: {total_atualizado}" });
    const semEncargos = marco(10, { canais: ["email"], assuntoEmail: "x", corpoEmail: "{saudacao}" });
    expect(marcoInformaEncargos(comEncargos)).toBe(true);
    expect(marcoInformaEncargos(semEncargos)).toBe(false);
    expect(descricaoPendenciaCobranca(grupo(10, g.titulos), HOJE, "", [comEncargos])).toContain("Confirme no contrato do cliente");
    expect(descricaoPendenciaCobranca(grupo(10, g.titulos), HOJE, "", [semEncargos])).not.toContain("Confirme no contrato");
  });

  it("a descrição da pendência usa o texto do marco", () => {
    const d = descricaoPendenciaCobranca(grupo(5, g.titulos), HOJE, "Ana", [marco(5, { descricao: "Aviso especial" })]);
    expect(d).toContain("D+5: Aviso especial. Total em aberto R$ 20.800,00.");
    expect(d).toContain("Mensagem para o cliente (WhatsApp):");
  });
});

describe("validarMarcos", () => {
  const ok = { dias: 3, canais: ["whatsapp"] as const, descricao: "Aviso", textoWhatsapp: "Oi {saudacao}", assuntoEmail: null, corpoEmail: null };

  it("o padrão e um marco simples passam", () => {
    expect(validarMarcos(MARCOS_PADRAO)).toBeNull();
    expect(validarMarcos([ok])).toBeNull();
    expect(validarMarcos([])).toBeNull(); // régua sem marcos é uma escolha
  });

  it("recusa com mensagem em português", () => {
    expect(validarMarcos(Array.from({ length: 7 }, (_, i) => ({ ...ok, dias: i + 1 })))).toMatch(/No máximo 6/);
    expect(validarMarcos([{ ...ok, dias: 0 }])).toMatch(/entre 1 e 365/);
    expect(validarMarcos([{ ...ok, dias: 366 }])).toMatch(/entre 1 e 365/);
    expect(validarMarcos([{ ...ok, dias: NaN }])).toMatch(/entre 1 e 365/);
    expect(validarMarcos([ok, ok])).toMatch(/Dois marcos com 3 dias/);
    expect(validarMarcos([{ ...ok, dias: 1 }, { ...ok, dias: 1 }])).toMatch(/Dois marcos com 1 dia de atraso/);
    expect(validarMarcos([{ ...ok, canais: [] }])).toMatch(/escolha pelo menos um canal/);
    expect(validarMarcos([{ ...ok, descricao: "ab" }])).toMatch(/descreva o marco/);
    expect(validarMarcos([{ ...ok, textoWhatsapp: " " }])).toMatch(/texto do WhatsApp/);
    expect(validarMarcos([{ ...ok, canais: ["email"], assuntoEmail: "A", corpoEmail: "" }])).toMatch(/assunto e o texto do e-mail/);
    expect(validarMarcos([{ ...ok, textoWhatsapp: "x".repeat(4001) }])).toMatch(/texto longo demais/);
    expect(validarMarcos([{ ...ok, textoWhatsapp: "Oi {nome}" }])).toMatch(/variável desconhecida \{nome\}/);
  });
});

describe("marcosDeLinhas", () => {
  it("ordena por dias, deriva o nome e ignora canal desconhecido e dias inválidos", () => {
    const m = marcosDeLinhas([
      { dia_relativo: 10, canais: ["email", "sms"], descricao: " Formal ", texto_whatsapp: null, assunto_email: "A", corpo_email: "B" },
      { dia_relativo: 1, canais: ["whatsapp"], descricao: null, texto_whatsapp: "T", assunto_email: null, corpo_email: null },
      { dia_relativo: 0, canais: ["whatsapp"], descricao: "x", texto_whatsapp: "T", assunto_email: null, corpo_email: null },
      { dia_relativo: -5, canais: null, descricao: "x", texto_whatsapp: null, assunto_email: null, corpo_email: null },
    ]);
    expect(m.map((x) => [x.dias, x.nome, x.canais, x.descricao])).toEqual([[1, "D+1", ["whatsapp"], "Cobrança"], [10, "D+10", ["email"], "Formal"]]);
  });
});
