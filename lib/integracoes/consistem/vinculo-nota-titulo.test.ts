import { describe, expect, it } from "vitest";
import {
  analisarVinculo,
  buscarObjeto,
  ConsistemErro,
  chaveNfe,
  numeroNota,
  padraoDe,
  type Buscar,
  type ConfigConsistem,
} from "../../../supabase/functions/_shared/consistem-receber";

const TOKEN = "eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJhcGkiLCJhdWQiOiJhcGkifQ.c2lnbmF0dXJlLWRlLXRlc3RlLTEyMzQ1";
const cfg: ConfigConsistem = { baseUrl: "https://erp.exemplo.com/api", token: TOKEN, empresa: "1" };
const semEspera = { esperar: async () => {} };
const resposta = (status: number, corpo: unknown) => ({ ok: status < 300, status, text: async () => (typeof corpo === "string" ? corpo : JSON.stringify(corpo)) });

const CHAVE_A = "5".repeat(44);
const CHAVE_B = "6".repeat(44);

describe("normalizadores", () => {
  it("numeroNota tira zeros e pontuação", () => {
    expect(numeroNota("000123")).toBe("123");
    expect(numeroNota("1.371")).toBe("1371");
    expect(numeroNota(null)).toBe("");
  });
  it("chaveNfe exige 44 dígitos", () => {
    expect(chaveNfe(CHAVE_A)).toBe(CHAVE_A);
    expect(chaveNfe("1234")).toBe("");
    expect(chaveNfe(`${CHAVE_A.slice(0, 20)} ${CHAVE_A.slice(20)}`)).toBe(CHAVE_A);
  });
  it("padraoDe esconde o conteúdo", () => {
    expect(padraoDe("1182025-4")).toBe("9999999-9");
    expect(padraoDe("Z00028B")).toBe("A99999A");
    expect(padraoDe("")).toBe("(vazio)");
    expect(padraoDe(null)).toBe("(vazio)");
  });
});

describe("analisarVinculo", () => {
  const hoje = "2026-10-06";
  const notas = [
    { codNumNota: "000100", chaveAcesso: CHAVE_A, codPedido: 11, codCliente: 1, valorTotal: "3.000,00" },
    { codNumNota: "000200", chaveAcesso: CHAVE_B, codPedido: 22, codCliente: 2, valorTotal: "1.000,00" },
    { codNumNota: "000300", chaveAcesso: "", codPedido: 33, codCliente: 3, valorTotal: "500,00" },
    // duas NFs com o mesmo número e cliente: ambíguo
    { codNumNota: "000400", chaveAcesso: "", codPedido: 44, codCliente: 4, valorTotal: "100,00" },
    { codNumNota: "400", chaveAcesso: "", codPedido: 45, codCliente: 4, valorTotal: "100,00" },
  ];
  const titulos = [
    // casa pela chave (2 parcelas da mesma NF)
    { codTitulo: "100A", notaFiscal: "100", chaveNfeNotaFiscal: CHAVE_A, numeroDuplicatas: "100-1", codCliente: 1, dataEmissao: "2026-10-01", valorTitulo: "1500.00" },
    { codTitulo: "100B", notaFiscal: "100", chaveNfeNotaFiscal: CHAVE_A, numeroDuplicatas: "100-2", codCliente: 1, dataEmissao: "2026-10-01", valorTitulo: "1500.00" },
    // casa por nota + cliente (sem chave)
    { codTitulo: "300", notaFiscal: "000300", chaveNfeNotaFiscal: "", numeroDuplicatas: "300", codCliente: 3, dataEmissao: "2026-09-20", valorTitulo: "500.00" },
    // ambíguo
    { codTitulo: "400", notaFiscal: "400", chaveNfeNotaFiscal: "", numeroDuplicatas: "400", codCliente: 4, dataEmissao: "2026-09-25", valorTitulo: "100.00" },
    // sem nota, na janela
    { codTitulo: "X9", notaFiscal: "", chaveNfeNotaFiscal: "", numeroDuplicatas: "", codCliente: 9, dataEmissao: "2026-10-02", valorTitulo: "10.00" },
    // antigo, fora da janela de 30 dias
    { codTitulo: "OLD", notaFiscal: "1", chaveNfeNotaFiscal: "", numeroDuplicatas: "", codCliente: 7, dataEmissao: "2024-01-10", valorTitulo: "10.00" },
  ];

  const r = analisarVinculo(notas, titulos, hoje, 30);

  it("conta notas e títulos", () => {
    expect(r.janela).toEqual({ desde: "2026-09-06", ate: hoje });
    expect(r.notas).toMatchObject({ total: 5, comPedido: 5, comChave: 2, pedidosDistintos: 5 });
    expect(r.notas.camposDisponiveis).toContain("codPedido");
    expect(r.titulos).toEqual({ total: 6, comNotaFiscal: 5, comChave: 2, naJanela: 5 });
  });

  it("mede o casamento só dentro da janela", () => {
    expect(r.casamento.porChave).toBe(2);
    expect(r.casamento.porNotaECliente).toBe(2); // 300 e 400
    expect(r.casamento.ambiguos).toBe(1);
    expect(r.casamento.semCasamento).toBe(1);
    expect(r.casamento.taxaNaJanela).toBe(80);
    expect(r.casamento.notasComTitulo).toBe(3);
  });

  it("descobre como título e nota se relacionam", () => {
    expect(r.relacoes.codTituloContemNota).toBe(4);
    expect(r.relacoes.duplicatasContemNota).toBe(4);
    expect(r.relacoes.valorMenorOuIgualNota).toBe(4);
  });

  it("devolve padrões de formato, nunca os valores reais", () => {
    const texto = JSON.stringify(r);
    expect(r.padroes.codTitulo.length).toBeGreaterThan(0);
    for (const proibido of ["100A", "100B", "OLD", CHAVE_A, CHAVE_B, "100-1"]) expect(texto).not.toContain(proibido);
  });

  it("janela vazia não divide por zero", () => {
    const vazio = analisarVinculo([], [], hoje, 30);
    expect(vazio.casamento.taxaNaJanela).toBe(0);
    expect(vazio.notas.total).toBe(0);
  });
});

describe("buscarObjeto", () => {
  it("devolve o objeto e manda os headers certos", async () => {
    let enviado: Record<string, string> = {};
    const buscar: Buscar = async (_u, init) => ((enviado = init.headers), resposta(200, { codPedido: 187, codCliente: 156 }));
    const o = await buscarObjeto(buscar, cfg, "/comercial/v10/pedidoVenda/187", semEspera);
    expect(o.codPedido).toBe(187);
    expect(enviado.Authorization).toBe(TOKEN);
    expect(enviado.empresa).toBe("1");
  });
  it("repete em 429 e falha clara em 403", async () => {
    let n = 0;
    const o = await buscarObjeto(async () => (++n < 2 ? resposta(429, "") : resposta(200, { ok: 1 })), cfg, "x", semEspera);
    expect(o).toEqual({ ok: 1 });
    const e = await buscarObjeto(async () => resposta(403, "no"), cfg, "x", semEspera).catch((x) => x);
    expect(e).toBeInstanceOf(ConsistemErro);
    expect(e.status).toBe(403);
  });
  it("erro de rede não repete o texto original (pode ter o token)", async () => {
    const e = await buscarObjeto(async () => { throw new TypeError(`Invalid header value: "${TOKEN}"`); }, cfg, "x", semEspera).catch((x) => x);
    expect(String(e.message)).not.toContain(TOKEN.slice(0, 20));
  });
  it("aceita array com um item", async () => {
    expect(await buscarObjeto(async () => resposta(200, [{ a: 1 }]), cfg, "x", semEspera)).toEqual({ a: 1 });
  });
});
