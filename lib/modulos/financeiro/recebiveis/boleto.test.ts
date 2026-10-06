import { describe, expect, it } from "vitest";
import {
  avaliarEnvio,
  listarLinhasDigitaveis,
  listarParcelas,
  montarMensagem,
  normalizarLinhaDigitavel,
  pendenciaConcluida,
  preencherModelo,
  variaveisDaMensagem,
  type DadosMensagem,
  type ParcelaMensagem,
} from "./boleto";
import { formatarData, formatarMoeda } from "./formatos";

const parcela = (documento: string, vencimento: string, valorCentavos: number, extra: Partial<ParcelaMensagem> = {}): ParcelaMensagem => ({
  documento, parcela: "1", vencimento, valorCentavos, ...extra,
});

describe("formatos", () => {
  it("moeda e data no padrão brasileiro", () => {
    expect(formatarMoeda(123_456)).toBe("R$ 1.234,56");
    expect(formatarMoeda(0)).toBe("R$ 0,00");
    expect(formatarMoeda(2_599_057_023)).toBe("R$ 25.990.570,23");
    expect(formatarMoeda(-5_000)).toBe("-R$ 50,00");
    expect(formatarData("2026-10-05")).toBe("05/10/2026");
    expect(formatarData(null)).toBe("");
  });
});

describe("normalizarLinhaDigitavel", () => {
  const L47 = "34191790010104351004791020150008291070026000";
  it("vazia é permitida", () => {
    expect(normalizarLinhaDigitavel("")).toEqual({ ok: true, valor: null });
    expect(normalizarLinhaDigitavel(null)).toEqual({ ok: true, valor: null });
    expect(normalizarLinhaDigitavel("  ")).toEqual({ ok: true, valor: null });
  });
  it("aceita 47 e 48 dígitos, com pontos e espaços", () => {
    const d47 = "1".repeat(47);
    const d48 = "2".repeat(48);
    expect(normalizarLinhaDigitavel(d47)).toEqual({ ok: true, valor: d47 });
    expect(normalizarLinhaDigitavel(`${d47.slice(0, 5)}.${d47.slice(5, 10)} ${d47.slice(10)}`)).toEqual({ ok: true, valor: d47 });
    expect(normalizarLinhaDigitavel(d48)).toEqual({ ok: true, valor: d48 });
  });
  it("recusa tamanho errado", () => {
    expect(normalizarLinhaDigitavel(L47).ok).toBe(false); // 44 dígitos: é código de barras, não linha digitável
    expect(normalizarLinhaDigitavel("123")).toMatchObject({ ok: false });
    expect(normalizarLinhaDigitavel("1".repeat(49))).toMatchObject({ ok: false });
  });
});

describe("listarParcelas e variáveis", () => {
  const parcelas = [
    parcela("1001395B", "2026-11-15", 1_750_000),
    parcela("1001395A", "2026-10-15", 5_250_000, { linhaDigitavel: "1".repeat(47) }),
    parcela("X", "2026-12-01", 100_00, { parcela: "2" }),
  ];
  it("ordena por vencimento e mostra o número da parcela quando não é a 1", () => {
    expect(listarParcelas(parcelas).split("\n")).toEqual([
      "• 1001395A — vencimento 15/10/2026 — R$ 52.500,00",
      "• 1001395B — vencimento 15/11/2026 — R$ 17.500,00",
      "• X/2 — vencimento 01/12/2026 — R$ 100,00",
    ]);
  });
  it("lista só as linhas digitáveis que existem", () => {
    expect(listarLinhasDigitaveis(parcelas)).toBe(`1001395A: ${"1".repeat(47)}`);
    expect(listarLinhasDigitaveis([parcela("A", "2026-10-01", 1)])).toBe("");
  });
  it("variáveis: total, quantidade e fallback de nome", () => {
    const d: DadosMensagem = { contato: "  ", cliente: " ACME ", referencia: "NF 1395", parcelas };
    const v = variaveisDaMensagem(d);
    expect(v).toMatchObject({ contato: "Prezados", cliente: "ACME", referencia: "NF 1395", total: "R$ 70.100,00", qtd_parcelas: "3" });
  });
});

describe("preencherModelo e montarMensagem", () => {
  it("troca variáveis conhecidas e preserva as desconhecidas", () => {
    expect(preencherModelo("Olá, {contato}! {desconhecida} {contato}", { contato: "Ana" })).toBe("Olá, Ana! {desconhecida} Ana");
  });

  const modelo = {
    assunto: "Boleto — {referencia} — Neo Formas",
    corpo: "Olá, {contato}!\n\nSegue o boleto da {referencia}:\n\n{parcelas}\n\nAtenciosamente,",
  };
  const dados: DadosMensagem = { contato: "Ana", cliente: "ACME", referencia: "NF 1395", parcelas: [parcela("1001395A", "2026-10-15", 5_250_000)] };

  it("monta assunto e corpo", () => {
    const m = montarMensagem(modelo, dados);
    expect(m.assunto).toBe("Boleto — NF 1395 — Neo Formas");
    expect(m.corpo).toBe("Olá, Ana!\n\nSegue o boleto da NF 1395:\n\n• 1001395A — vencimento 15/10/2026 — R$ 52.500,00\n\nAtenciosamente,");
  });
  it("modelo sem assunto devolve assunto nulo", () => {
    expect(montarMensagem({ assunto: null, corpo: "{contato}" }, dados)).toEqual({ assunto: null, corpo: "Ana" });
  });
  it("sem linha digitável não sobram linhas em branco de sobra", () => {
    const m = montarMensagem({ assunto: null, corpo: "A\n\n{linhas_digitaveis}\n\nB" }, dados);
    expect(m.corpo).toBe("A\n\nB");
  });
  it("e-mail termina em Atenciosamente, sem assinatura (regra do projeto)", () => {
    expect(montarMensagem(modelo, dados).corpo.trimEnd().endsWith("Atenciosamente,")).toBe(true);
  });
});

describe("avaliarEnvio", () => {
  const parcelas = [
    { id: "a", estagio: "aguardando_boleto", temBoleto: true },
    { id: "b", estagio: "aguardando_boleto", temBoleto: false },
    { id: "c", estagio: "boleto_enviado", temBoleto: true },
  ];
  it("aceita parcelas aguardando e com boleto, sem repetir", () => {
    expect(avaliarEnvio(["a", "a"], parcelas)).toEqual({ ok: true, ids: ["a"] });
  });
  it("recusa vazio, parcela sem boleto, já enviada e desconhecida", () => {
    expect(avaliarEnvio([], parcelas)).toMatchObject({ ok: false });
    expect(avaliarEnvio(["a", "b"], parcelas)).toMatchObject({ ok: false, erro: expect.stringContaining("Anexe o boleto") });
    expect(avaliarEnvio(["c"], parcelas)).toMatchObject({ ok: false, erro: expect.stringContaining("já não está") });
    expect(avaliarEnvio(["zzz"], parcelas)).toMatchObject({ ok: false, erro: expect.stringContaining("inválida") });
  });
});

describe("pendenciaConcluida", () => {
  it("só quando nenhuma parcela continua aguardando boleto", () => {
    expect(pendenciaConcluida(["boleto_enviado", "boleto_enviado"])).toBe(true);
    expect(pendenciaConcluida(["boleto_enviado", "aguardando_boleto"])).toBe(false);
    expect(pendenciaConcluida(["pago", "cancelado"])).toBe(true);
  });
});
