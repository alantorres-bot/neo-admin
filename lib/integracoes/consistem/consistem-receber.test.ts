import { describe, expect, it } from "vitest";
import { normalizarDocumento } from "@/lib/nucleo/documentos";
import {
  buscarTodasPaginas,
  ConsistemErro,
  documentoFormatado,
  limparToken,
  normalizarClienteApi,
  normalizarTituloApi,
  paraCentavos,
  paraDataIso,
  planejarSincronizacao,
  type Buscar,
  type ConfigConsistem,
  type TituloApi,
  type TituloBanco,
} from "../../../supabase/functions/_shared/consistem-receber";

const TOKEN = "eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJhcGkiLCJhdWQiOiJhcGkifQ.c2lnbmF0dXJlLWRlLXRlc3RlLTEyMzQ1";
const cfg: ConfigConsistem = { baseUrl: "https://erp.exemplo.com/api/", token: TOKEN, empresa: "1" };
const semEspera = { esperar: async () => {} };

function resposta(status: number, corpo: unknown) {
  const txt = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  return { ok: status >= 200 && status < 300, status, text: async () => txt };
}

describe("paraCentavos", () => {
  it("aceita número, string pt-BR e string en", () => {
    expect(paraCentavos(54000)).toBe(5_400_000);
    expect(paraCentavos(18396.63)).toBe(1_839_663);
    expect(paraCentavos("1.234,56")).toBe(123_456);
    expect(paraCentavos("1234.56")).toBe(123_456);
    expect(paraCentavos("R$ 10,10")).toBe(1010);
  });
  it("evita erro de ponto flutuante", () => {
    expect(paraCentavos(0.1 + 0.2)).toBe(30);
    expect(paraCentavos(1.005)).toBe(101); // arredonda ao centavo
  });
  it("rejeita vazio e lixo", () => {
    expect(paraCentavos("")).toBeNull();
    expect(paraCentavos(null)).toBeNull();
    expect(paraCentavos("abc")).toBeNull();
    expect(paraCentavos(Number.NaN)).toBeNull();
  });
});

describe("limparToken", () => {
  it("aceita JWT e remove espaços e quebras de linha", () => {
    expect(limparToken(` ${TOKEN}\n`)).toBe(TOKEN);
    expect(limparToken(TOKEN.replace(".", ".\n  "))).toBe(TOKEN);
  });
  it("recusa lixo, prefixo '>' e vazio", () => {
    expect(limparToken("> " + TOKEN)).toBeNull();
    expect(limparToken("abc")).toBeNull();
    expect(limparToken("")).toBeNull();
  });
  it("tira o prefixo Bearer, que a API do Consistem não usa", () => {
    expect(limparToken("Bearer " + TOKEN)).toBe(TOKEN);
    expect(limparToken("bearer\n" + TOKEN)).toBe(TOKEN);
  });
});

describe("paraDataIso", () => {
  it("aceita ISO e timestamp, recusa dd/mm/aaaa e datas impossíveis", () => {
    expect(paraDataIso("2026-10-28")).toBe("2026-10-28");
    expect(paraDataIso("2026-10-28T00:00:00")).toBe("2026-10-28");
    expect(paraDataIso("28/10/2026")).toBeNull();
    expect(paraDataIso("2026-02-30")).toBeNull();
    expect(paraDataIso(null)).toBeNull();
  });
});

describe("normalizarTituloApi", () => {
  const base = { codTitulo: " Z00028B ", codCliente: 191, codPortador: 91, dataEmissao: "2026-09-28", dataVenc: "2026-10-28", valorTitulo: 54000 };
  it("normaliza um registro válido", () => {
    const r = normalizarTituloApi(base);
    expect(r).toEqual({
      ok: true,
      titulo: { documento: "Z00028B", parcela: "1", codCliente: "191", emissao: "2026-09-28", vencimento: "2026-10-28", valorCentavos: 5_400_000, codPortador: "91" },
    });
  });
  it("usa o campo de parcela quando a API trouxer", () => {
    const r = normalizarTituloApi({ ...base, parcela: 3 });
    expect(r.ok && r.titulo.parcela).toBe("3");
  });
  it.each([
    [{ ...base, codTitulo: "" }, "título sem código"],
    [{ ...base, codCliente: null }, "título sem cliente"],
    [{ ...base, dataVenc: "x" }, "vencimento inválido"],
    [{ ...base, valorTitulo: 0 }, "valor inválido ou zerado"],
    [{ ...base, valorTitulo: -5 }, "valor inválido ou zerado"],
  ])("recusa registro inválido", (reg, motivo) => {
    const r = normalizarTituloApi(reg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe(motivo);
  });
  it("emissão ausente não impede o título", () => {
    const r = normalizarTituloApi({ ...base, dataEmissao: null });
    expect(r.ok && r.titulo.emissao).toBeNull();
  });
});

describe("normalizarClienteApi", () => {
  it("usa nome, cai no fantasia e ignora sem código", () => {
    expect(normalizarClienteApi({ codCliente: 11, nome: " AMORIM ", cpfCnpj: "03.214.866/0001-00" })).toEqual({ codCliente: "11", nome: "AMORIM", documentoBruto: "03.214.866/0001-00" });
    expect(normalizarClienteApi({ codCliente: 12, nomeFantasia: "FANTASIA" })?.nome).toBe("FANTASIA");
    expect(normalizarClienteApi({ nome: "sem código" })).toBeNull();
  });
});

describe("documentoFormatado (paridade com o núcleo)", () => {
  const amostras = ["17.209.767/0001-28", "17209767000128", "11.111.111/1111-11", "529.982.247-25", "52998224725", "111.111.111-11", "123", "", "12.345.678/0001-95"];
  it.each(amostras)("igual ao normalizarDocumento para %j", (entrada) => {
    const nucleo = normalizarDocumento(entrada);
    expect(documentoFormatado(entrada)).toBe(nucleo.ok ? nucleo.valor : null);
  });
});

describe("buscarTodasPaginas", () => {
  it("segue o continuationToken e manda os headers certos (sem Bearer)", async () => {
    const chamadas: { url: string; headers: Record<string, string> }[] = [];
    const buscar: Buscar = async (url, init) => {
      chamadas.push({ url, headers: init.headers });
      return url.includes("continuationToken=abc") ? resposta(200, { data: [{ id: 3 }] }) : resposta(200, { data: [{ id: 1 }, { id: 2 }], continuationToken: "abc" });
    };
    const regs = await buscarTodasPaginas(buscar, cfg, "/financeiro/v10/contasReceber", { tipoTitulo: 0, paginacao: 200 }, semEspera);
    expect(regs).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0].url).toBe("https://erp.exemplo.com/api/financeiro/v10/contasReceber?tipoTitulo=0&paginacao=200");
    expect(chamadas[1].url).toContain("continuationToken=abc");
    expect(chamadas[0].headers.Authorization).toBe(TOKEN);
    expect(chamadas[0].headers.empresa).toBe("1");
  });
  it("aceita resposta que é um array puro", async () => {
    const regs = await buscarTodasPaginas(async () => resposta(200, [{ a: 1 }]), cfg, "x", {}, semEspera);
    expect(regs).toEqual([{ a: 1 }]);
  });
  it("tenta de novo em 429 e depois consegue", async () => {
    let n = 0;
    const esperas: number[] = [];
    const buscar: Buscar = async () => (++n < 3 ? resposta(429, "") : resposta(200, { data: [{ ok: true }] }));
    const regs = await buscarTodasPaginas(buscar, cfg, "x", {}, { esperar: async (ms) => void esperas.push(ms) });
    expect(regs).toEqual([{ ok: true }]);
    expect(esperas).toEqual([1000, 2000]);
  });
  it("desiste depois de várias 429 seguidas", async () => {
    await expect(buscarTodasPaginas(async () => resposta(429, "lento"), cfg, "x", {}, semEspera)).rejects.toThrow(/HTTP 429/);
  });
  it("401/403 explica que o serviço pode não estar liberado", async () => {
    const e = await buscarTodasPaginas(async () => resposta(403, "no"), cfg, "x", {}, semEspera).catch((x) => x);
    expect(e).toBeInstanceOf(ConsistemErro);
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/CSMEN050/);
  });
  it("recusa token ausente ou curto sem chamar a API", async () => {
    let chamou = false;
    const buscar: Buscar = async () => ((chamou = true), resposta(200, {}));
    await expect(buscarTodasPaginas(buscar, { ...cfg, token: "curto" }, "x", {}, semEspera)).rejects.toThrow(/CONSISTEM_API_KEY/);
    expect(chamou).toBe(false);
  });
  it("token copiado do terminal (com '> ' e quebra de linha) é recusado sem repetir o valor", async () => {
    const sujo = "> " + TOKEN.slice(0, 40) + "\n  " + TOKEN.slice(40);
    const e = await buscarTodasPaginas(async () => resposta(200, {}), { ...cfg, token: sujo }, "x", {}, semEspera).catch((x) => x);
    expect(e).toBeInstanceOf(ConsistemErro);
    expect(String(e.message)).not.toContain(TOKEN.slice(0, 20));
  });
  it("token com quebra de linha no meio (sem '>') é limpo e funciona", async () => {
    let enviado = "";
    const buscar: Buscar = async (_u, init) => ((enviado = init.headers.Authorization), resposta(200, { data: [] }));
    await buscarTodasPaginas(buscar, { ...cfg, token: TOKEN.slice(0, 40) + "\n  " + TOKEN.slice(40) + "\n" }, "x", {}, semEspera);
    expect(enviado).toBe(TOKEN);
  });
  it("falha de rede devolve mensagem genérica, sem o texto do erro original (que pode conter o token)", async () => {
    const buscar: Buscar = async () => {
      throw new TypeError(`Invalid header value: "${TOKEN}"`);
    };
    const e = await buscarTodasPaginas(buscar, cfg, "x", {}, semEspera).catch((x) => x);
    expect(e).toBeInstanceOf(ConsistemErro);
    expect(String(e.message)).not.toContain(TOKEN.slice(0, 20));
  });
});

describe("planejarSincronizacao", () => {
  const api = (documento: string, extra: Partial<TituloApi> = {}): TituloApi => ({
    documento, parcela: "1", codCliente: "1", emissao: "2026-09-01", vencimento: "2026-10-10", valorCentavos: 100_00, codPortador: "91", ...extra,
  });
  const banco = (id: string, documento: string, extra: Partial<TituloBanco> = {}): TituloBanco => ({
    id, documento, parcela: "1", emissao: "2026-09-01", vencimento: "2026-10-10", valorCentavos: 100_00, estagio: "importado", origem: "importacao", ...extra,
  });

  it("separa novos, inalterados e alterados", () => {
    const p = planejarSincronizacao(
      [api("A"), api("B"), api("C", { vencimento: "2026-11-10", valorCentavos: 250_50 })],
      [banco("1", "B"), banco("2", "C")],
    );
    expect(p.novos.map((t) => t.documento)).toEqual(["A"]);
    expect(p.inalterados).toBe(1);
    expect(p.alterados).toEqual([{ id: "2", campos: { vencimento: "2026-11-10", valor: 250.5 } }]);
    expect(p.presentes).toEqual(["1", "2"]);
  });

  it("título aberto no banco que sumiu da API é possível baixa, nunca baixa automática", () => {
    const p = planejarSincronizacao([api("A")], [banco("1", "A"), banco("2", "SUMIU")]);
    expect(p.possiveisBaixas.map((t) => t.documento)).toEqual(["SUMIU"]);
    expect(p.alterados).toEqual([]);
  });

  it("não sinaliza baixa de título já encerrado nem de origem manual/acordo", () => {
    const p = planejarSincronizacao([], [
      banco("1", "PAGO", { estagio: "pago" }),
      banco("2", "CANC", { estagio: "cancelado" }),
      banco("3", "MAN", { origem: "manual" }),
      banco("4", "ACO", { origem: "acordo" }),
      banco("5", "ABERTO", { estagio: "vencido" }),
    ]);
    expect(p.possiveisBaixas.map((t) => t.documento)).toEqual(["ABERTO"]);
  });

  it("API diz em aberto mas o banco já encerrou: divergência, sem alterar", () => {
    const p = planejarSincronizacao([api("P")], [banco("1", "P", { estagio: "pago" })]);
    expect(p.divergentes.map((t) => t.documento)).toEqual(["P"]);
    expect(p.novos).toEqual([]);
    expect(p.alterados).toEqual([]);
    expect(p.presentes).toEqual([]);
  });

  it("repetido na API conta uma vez só e avisa", () => {
    const p = planejarSincronizacao([api("A"), api("A", { valorCentavos: 999_00 })], []);
    expect(p.novos).toHaveLength(1);
    expect(p.novos[0].valorCentavos).toBe(100_00);
    expect(p.duplicadosApi).toEqual(["A/1"]);
  });

  it("parcelas diferentes do mesmo documento são títulos diferentes", () => {
    const p = planejarSincronizacao([api("A", { parcela: "1" }), api("A", { parcela: "2" })], [banco("1", "A", { parcela: "1" })]);
    expect(p.novos.map((t) => t.parcela)).toEqual(["2"]);
    expect(p.inalterados).toBe(1);
  });

  it("emissão nova da API só preenche quando vem valor", () => {
    const p = planejarSincronizacao([api("A", { emissao: null })], [banco("1", "A", { emissao: "2026-09-01" })]);
    expect(p.alterados).toEqual([]);
    expect(p.inalterados).toBe(1);
  });
});
