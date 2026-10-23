import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buscarObjeto } from "../../../../supabase/functions/_shared/consistem-receber";
import { alterarTitulo, complementoCabeNaAlteracao, conferirAlteracao, jaAlterado, ROTA_INCLUSAO_LANCAMENTO, type Enviar } from "../../../../supabase/functions/_shared/consistem-inclusao";
import { normalizarLancamentoPagar } from "../../../../supabase/functions/_shared/consistem-pagar";
import {
  alterarVencimentoNoConsistem, casarTitulos, centavosDe, classificarEmail, CONSULTA_GMAIL, dataBrParaIso, documentoConfereMascara, intimacoesDoPortal,
  janelaVencimento, lerAvisoCenprot, lerEmail, lerIntimacaoCartorio, lerMensagemGmail, lerPortal4Oficio, listarMensagensGmail, numeroComparavel,
  type PortaConsistem, type TituloPagar,
} from "../../../../supabase/functions/_shared/intimacoes";

// Trechos reais (reduzidos) dos e-mails de 21 e 23/10/2026.
const HTML_4OFICIO = `<p>NEO FORMAS PARA CONCRETO LTDA</p><p>A INTIMAÇÃO DE PROTESTO é remetida conforme a Lei n° 9.492…</p>
<p><font size="1">Código localizador - de8ace29-1171-4f37-a37b-810984416e05</font></p>
<a href="https://app.protestocuiaba.com.br/#/directMail/items/de8ace29-1171-4f37-a37b-810984416e05/payments">Consultar no 4º Ofício de Cuiabá</a>`;
const linha = (oc: string, credor: string, num: string, valor: string, venc: string, prot: string) => `<tr>
    <td class="tg-0lax">${oc}</td><td class="tg-0lax">${credor}</td><td class="tg-0lax">17.209.767/0001-28</td><td class="tg-0lax">DV</td>
    <td class="tg-0lax">${num}</td><td class="tg-0lax">${valor}</td><td class="tg-0lax">${venc}</td><td class="tg-0lax">CUIABÁ<BR>04</td>
    <td class="tg-0lax">${prot}<BR>21/10/2026</td></tr>`;
const HTML_CENPROT = `<p> Data do aviso: 22/10/2026</p><table class="tg"><thead><tr><th>Ocorrência</th><th>Credor</th><th>Docto. <br>devedor</th>
<th>Espécie</th><th>Número título</th><th>Valor a protestar</th><th>Data de Vencimento</th><th>Comarca /<br>Cartório</th><th>Protocolo /<br>Data</th></tr></thead><tbody>
${linha("Apontamento", "13.235.780/0001-09<BR>FM DO BRASIL LTDA", "0921310", "14249.64", "13/10/2026", "3091854")}
${linha("Apontamento", "39.821.062/0001-08<BR>MT CORTE E DOBRA LTDA", "24827-2", "12367.00", "11/02/2026", "3090983")}
${linha("Protesto", "39.821.062/0001-08<BR>MT CORTE E DOBRA LTDA", "24800-1", "100.00", "11/01/2026", "3080000")}
<tr><td>Apontamento</td><td>linha cortada</td></tr>
</tbody></table>`;

describe("classificação dos e-mails", () => {
  it("intimação do 4º Ofício e aviso da CENPROT; o resto fica de fora", () => {
    expect(classificarEmail("4º Ofício <protesto.intimacao@4oficio.com>", "INTIMAÇÃO DE PROTESTO")).toBe("cartorio");
    expect(classificarEmail("PROTESTO.INTIMACAO@4OFICIO.COM", "Intimacao de protesto")).toBe("cartorio");
    expect(classificarEmail("aviso@pesquisaprotesto.com.br", "CENPROT: Avise-me")).toBe("cenprot");
    expect(classificarEmail("nomelimpo@4oficio.com", "LIMPE SEU NOME - 4º TABELIONATO DE PROTESTO CUIABÁ")).toBeNull();
    expect(classificarEmail("protesto.intimacao@4oficio.com", "LIMPE SEU NOME")).toBeNull();
    expect(classificarEmail("golpe@4oficio.com.br", "INTIMAÇÃO DE PROTESTO")).toBeNull();
    expect(CONSULTA_GMAIL).toContain("from:(protesto.intimacao@4oficio.com OR aviso@pesquisaprotesto.com.br)");
  });
});

describe("extração", () => {
  it("4º Ofício: só o localizador e o link (o e-mail não traz valor, custas nem prazo)", () => {
    expect(lerIntimacaoCartorio(HTML_4OFICIO)).toMatchObject({
      chave: "localizador:de8ace29-1171-4f37-a37b-810984416e05", origem: "cartorio", cartorio: "CUIABÁ 04",
      link: "https://app.protestocuiaba.com.br/#/directMail/items/de8ace29-1171-4f37-a37b-810984416e05/payments",
      valorTitulo: null, numeroTitulo: null,
    });
    expect(lerIntimacaoCartorio("sem código")).toBeNull();
    expect(lerEmail("cartorio", "", "Código localizador - BFDEC11A-5FF7-4716-807A-13A6FD3EA893")[0].chave).toBe("localizador:bfdec11a-5ff7-4716-807a-13a6fd3ea893");
  });

  it("CENPROT: um apontamento por linha; outras ocorrências contadas; linha cortada não entra", () => {
    const r = lerAvisoCenprot(HTML_CENPROT);
    expect(r.ignoradas).toBe(1);
    expect(r.linhasInvalidas).toBe(1);
    expect(r.apontamentos).toHaveLength(2);
    expect(r.apontamentos[1]).toEqual({
      chave: "protocolo:CUIABÁ 04:3090983", origem: "cenprot", cartorio: "CUIABÁ 04", localizador: null, link: null,
      protocolo: "3090983", dataProtocolo: "2026-10-21", credorDocumento: "39.821.062/0001-08", credorNome: "MT CORTE E DOBRA LTDA",
      devedorDocumento: "17.209.767/0001-28", especie: "DV", numeroTitulo: "24827-2", valorTitulo: 12367, vencimentoTitulo: "2026-02-11",
      dataLimite: null, valorTotalCartorio: null, valorCustas: null,
    });
    expect(r.apontamentos[0].valorTitulo).toBe(14249.64);
  });
});

// Resposta real do portal (23/10/2026, localizador de 21/10), só com os campos que o agente usa (sem boleto nem Pix).
const PEDIDOS_PORTAL = [
  { valorTotal: "14700.24", credor: { nome: "FM DO BRASIL LTDA", cpfCnpj: "13.***.***/****-09" },
    titulo: { protocolo: "3091854", numeroTitulo: "0921310", naturezaDocumento: "DMI", dataVencimento: "2026-10-13", dataProtocolo: "2026-10-21 10:48:36",
      dataLimitePagamento: "2026-10-23", valorTitulo: 14249.64, valorSaldo: 14249.64, status: "intimado", disponivelPagamento: true } },
  { valorTotal: "12855.94", credor: { nome: "MT CORTE E DOBRA LTDA", cpfCnpj: "39.***.***/****-08" },
    titulo: { protocolo: "3090983", numeroTitulo: "24827-2", naturezaDocumento: "DMI", dataVencimento: "2026-02-11", dataProtocolo: "2026-10-21 09:53:27",
      dataLimitePagamento: "2026-10-23", valorTitulo: 10520.33, valorSaldo: 12367, status: "intimado", disponivelPagamento: true } },
  { valorTotal: null, credor: { nome: "MT CORTE E DOBRA LTDA", cpfCnpj: "39.***.***/****-08" },
    titulo: { protocolo: "3090930", numeroTitulo: "24822-3", dataLimitePagamento: "2026-10-22", valorTitulo: 2297.44, valorSaldo: 2669, status: "pago" } },
  { valorTotal: "765.45", credor: { nome: "BARRAFORTE ALUMINIO LTDA", cpfCnpj: "**" },
    titulo: { protocolo: "3084955", numeroTitulo: "12766/0-02", dataLimitePagamento: "2026-10-15", valorTitulo: 39265.35, valorSaldo: 39265.35, status: "protestado" } },
];

describe("portal do 4º Ofício (entra no link)", () => {
  const LOC = "de8ace29-1171-4f37-a37b-810984416e05";

  it("máscara do CPF/CNPJ", () => {
    expect(documentoConfereMascara("17.209.767/0001-28", "17.***.***/****-28")).toBe(true);
    expect(documentoConfereMascara("17209767000128", "17.***.***/****-28")).toBe(true);
    expect(documentoConfereMascara("17.209.767/0001-29", "17.***.***/****-28")).toBe(false);
    expect(documentoConfereMascara("123.456.789-01", "17.***.***/****-28")).toBe(false);
  });

  it("um protocolo por título intimado, com prazo, total e custas (total − saldo); pago e protestado só contam", () => {
    const r = intimacoesDoPortal(LOC, "17.209.767/0001-28", PEDIDOS_PORTAL);
    expect(r.situacoes).toEqual({ intimado: 2, pago: 1, protestado: 1 });
    expect(r.intimacoes.map((i) => [i.chave, i.dataLimite, i.valorTotalCartorio, i.valorCustas, i.valorTitulo])).toEqual([
      ["protocolo:CUIABÁ 04:3091854", "2026-10-23", 14700.24, 450.6, 14249.64],
      ["protocolo:CUIABÁ 04:3090983", "2026-10-23", 12855.94, 488.94, 10520.33],
    ]);
    expect(r.intimacoes[1]).toMatchObject({ origem: "cartorio", localizador: LOC, link: `https://app.protestocuiaba.com.br/#/directMail/items/${LOC}/payments`,
      credorDocumento: "39.***.***/****-08", credorNome: "MT CORTE E DOBRA LTDA", vencimentoTitulo: "2026-02-11", dataProtocolo: "2026-10-21", especie: "DMI" });
    // Mesma chave do aviso da CENPROT para o mesmo protocolo: vira uma intimação só.
    expect(r.intimacoes[1].chave).toBe(lerAvisoCenprot(HTML_CENPROT).apontamentos[1].chave);
  });

  it("lê como a página: item, depois títulos com o CNPJ da empresa que confere; só GET, naoIntimar vazio", async () => {
    const chamadas: { url: string; method: string }[] = [];
    const buscar = async (url: string, init: { method: string }) => {
      chamadas.push({ url, method: init.method });
      const corpo = url.includes("/payments") ? PEDIDOS_PORTAL : { uuid: LOC, entityType: "J", cpfCnpj: "17.***.***/****-28", name: "NEO ****** *TDA" };
      return { ok: true, status: 200, text: async () => JSON.stringify(corpo) };
    };
    const r = await lerPortal4Oficio(buscar, LOC.toUpperCase(), ["03.070.443/0001-47", "17.209.767/0001-28"]);
    expect(r.documento).toBe("17.209.767/0001-28");
    expect(r.intimacoes).toHaveLength(2);
    expect(chamadas).toEqual([
      { url: `https://api.protestocuiaba.com.br/public/directMail/items/${LOC.toUpperCase()}`, method: "GET" },
      { url: `https://api.protestocuiaba.com.br/public/directMail/items/${LOC.toUpperCase()}/payments?naoIntimar=&cpfCnpj=17209767000128`, method: "GET" },
    ]);
    await expect(lerPortal4Oficio(buscar, LOC, ["03.070.443/0001-47"])).rejects.toThrow(/não confere com nenhuma empresa/);
    await expect(lerPortal4Oficio(buscar, "../../x", ["17.209.767/0001-28"])).rejects.toThrow(/Localizador inválido/);
  });

  it("datas e números", () => {
    expect(dataBrParaIso("31/02/2026")).toBeNull();
    expect(dataBrParaIso("13/10/2026")).toBe("2026-10-13");
    expect(numeroComparavel("0921310")).toBe("921310");
    expect(numeroComparavel("24827-2")).toBe(numeroComparavel("24827/2"));
    expect(janelaVencimento("2026-02-11", 10)).toEqual({ ini: "2026-02-01", fim: "2026-02-21" });
    expect([centavosDe("14249.64"), centavosDe("14.249,64"), centavosDe(1.005), centavosDe(""), centavosDe("abc")]).toEqual([1424964, 1424964, 101, null, null]);
  });
});

describe("Gmail (só leitura)", () => {
  const b64 = (t: string) => Buffer.from(t, "utf8").toString("base64url");

  it("lê cabeçalhos e o HTML de uma mensagem multipart", () => {
    const e = lerMensagemGmail({
      id: "1", internalDate: "1792607926000",
      payload: {
        headers: [{ name: "From", value: "protesto.intimacao@4oficio.com" }, { name: "Subject", value: "INTIMAÇÃO DE PROTESTO" }],
        mimeType: "multipart/alternative",
        parts: [{ mimeType: "text/plain", body: { data: b64("texto") } }, { mimeType: "text/html", body: { data: b64(HTML_4OFICIO) } }],
      },
    });
    expect(e).toMatchObject({ remetente: "protesto.intimacao@4oficio.com", assunto: "INTIMAÇÃO DE PROTESTO", texto: "texto", recebidoEm: "2026-10-21T18:38:46.000Z" });
    expect(e.html).toContain("Código localizador");
  });

  it("lista com paginação e só faz GET", async () => {
    const chamadas: { url: string; method: string }[] = [];
    const paginas = [{ messages: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" }, { messages: [{ id: "c" }] }];
    const buscar = async (url: string, init: { method: string }) => {
      chamadas.push({ url, method: init.method });
      return { ok: true, status: 200, text: async () => JSON.stringify(paginas[chamadas.length - 1]) };
    };
    expect(await listarMensagensGmail(buscar, "tok", CONSULTA_GMAIL)).toEqual(["a", "b", "c"]);
    expect(chamadas.every((c) => c.method === "GET")).toBe(true);
    expect(chamadas[1].url).toContain("pageToken=p2");
  });
});

describe("escolha do título", () => {
  // Como a Edge Function entrega: a linha da API já normalizada por normalizarLancamentoPagar.
  const t = (cod: string, num: string, valor: string, saldo = valor, tipo = "C"): TituloPagar => {
    const n = normalizarLancamentoPagar({ codLancamento: cod, tipoLancamento: tipo, numDocumento: num, valorDocumento: valor, valorAtualizado: saldo, codFornecedor: "1290", dataVencimento: "2026-02-11" });
    if (!n.ok) throw new Error(n.motivo);
    return n.lancamento;
  };

  it("sugere o único com número e valor; ignora antecipação e título pago", () => {
    const r = casarTitulos({ numeroTitulo: "24827-2", valorTitulo: 12367 }, [
      t("1", "24827/2", "12.367,00"), t("2", "24827/3", "12.220,00"), t("3", "24827/2", "12.367,00", "0,00"), t("4", "24827/2", "12.367,00", "12.367,00", "A"),
    ]);
    expect(r.sugerido).toBe("1");
    // A parcela 24827/3 (outro número, outro valor) não é candidata.
    expect(r.candidatos.map((c) => c.titulo.codLancamento)).toEqual(["1"]);
  });

  it("na dúvida não sugere", () => {
    const dois = casarTitulos({ numeroTitulo: "24827-2", valorTitulo: 12367 }, [t("1", "24827/2", "12.367,00"), t("9", "24827-2", "12.367,00")]);
    expect(dois.sugerido).toBeNull();
    expect(dois.candidatos).toHaveLength(2);
    const curto = casarTitulos({ numeroTitulo: "12", valorTitulo: null }, [t("1", "123456", "1,00")]);
    expect(curto.candidatos).toEqual([]);
    expect(casarTitulos({ numeroTitulo: "0921310", valorTitulo: 14249.64 }, [t("7", "921310/1", "14.249,64")]).sugerido).toBe("7");
  });
});

describe("vencimento no Consistem: só GET e PUT em lancamentoContasPagar/{id}", () => {
  const cfg = { baseUrl: "https://erp/api", token: "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.c2lnbmF0dXJhX2Zha2U", empresa: "1" };
  const titulo = { codLancamento: 5001, tipoLancamento: "C", codFornecedor: 1290, codDocumento: "24827/2", dataVencimento: "2026-02-11", dataVencimentoOriginal: "", diasPrazo: 30, valorDocumento: "12367", dataPagamento: "", complementoHistorico: "NF 24827" };

  function falso(opcoes: { depois?: Record<string, unknown>; put?: number; antes?: Record<string, unknown> } = {}) {
    const chamadas: { metodo: string; url: string; corpo?: string }[] = [];
    let estado: Record<string, unknown> = { ...(opcoes.antes ?? titulo) };
    const buscar = async (url: string) => {
      chamadas.push({ metodo: "GET", url });
      return { ok: true, status: 200, text: async () => JSON.stringify(estado) };
    };
    const enviar: Enviar = async (url, init) => {
      chamadas.push({ metodo: init.method, url, corpo: init.body });
      const status = opcoes.put ?? 200;
      if (status < 300) estado = opcoes.depois ?? { ...estado, ...JSON.parse(init.body), diasPrazo: 270, dataVencimentoOriginal: "2026-02-11" };
      return { status, text: async () => (status < 300 ? '"5001"' : JSON.stringify([{ mensagem: "Recusado" }])) };
    };
    // A mesma ligação de fin-intimacoes-consistem (portaConsistem), sobre o fetch falso.
    const porta: PortaConsistem = {
      lerDetalhe: (cod) => buscarObjeto(buscar, cfg, `${ROTA_INCLUSAO_LANCAMENTO}/${encodeURIComponent(cod)}`),
      alterar: (cod, corpo) => alterarTitulo(enviar, cfg, cod, corpo, "o vencimento é conferido pelo detalhe do título"),
      jaAlterado, complementoLongo: complementoCabeNaAlteracao, conferir: conferirAlteracao,
    };
    return { chamadas, porta };
  }

  const rotasPermitidas = (chamadas: { metodo: string; url: string }[]) =>
    chamadas.every((c) => /\/financeiro\/v10\/lancamentoContasPagar\/5001$/.test(c.url) && ["GET", "PUT"].includes(c.metodo));

  it("altera só a data e confere (o resto, valor inclusive, igual)", async () => {
    const f = falso();
    const r = await alterarVencimentoNoConsistem(f.porta, "5001", "2026-10-28");
    expect(r).toMatchObject({ ok: true, jaEstava: false });
    expect(f.chamadas.map((c) => c.metodo)).toEqual(["GET", "PUT", "GET"]);
    expect(JSON.parse(f.chamadas[1].corpo!)).toEqual({ dataVencimento: "2026-10-28" });
    expect(rotasPermitidas(f.chamadas)).toBe(true);
  });

  it("já estava com a data: não envia", async () => {
    const f = falso({ antes: { ...titulo, dataVencimento: "2026-10-28" } });
    expect(await alterarVencimentoNoConsistem(f.porta, "5001", "2026-10-28")).toMatchObject({ ok: true, jaEstava: true });
    expect(f.chamadas.map((c) => c.metodo)).toEqual(["GET"]);
  });

  it("recusa antecipação, título pago e complemento longo sem enviar", async () => {
    for (const antes of [{ ...titulo, tipoLancamento: "A" }, { ...titulo, dataPagamento: "2026-10-01" }, { ...titulo, complementoHistorico: "X".repeat(61) }]) {
      const f = falso({ antes });
      const r = await alterarVencimentoNoConsistem(f.porta, "5001", "2026-10-28");
      expect(r.ok).toBe(false);
      expect(f.chamadas.map((c) => c.metodo)).toEqual(["GET"]);
    }
  });

  it("recusa do Consistem e valor alterado viram erro com antes e depois", async () => {
    const recusa = falso({ put: 400 });
    const r1 = await alterarVencimentoNoConsistem(recusa.porta, "5001", "2026-10-28");
    expect(r1).toMatchObject({ ok: false, mensagem: expect.stringMatching(/recusou/) });
    const mexeu = falso({ depois: { ...titulo, dataVencimento: "2026-10-28", valorDocumento: "1" } });
    const r2 = await alterarVencimentoNoConsistem(mexeu.porta, "5001", "2026-10-28");
    expect(r2).toMatchObject({ ok: false, mensagem: expect.stringMatching(/valorDocumento/) });
    expect(r2.depois).not.toBeNull();
    expect(rotasPermitidas([...recusa.chamadas, ...mexeu.chamadas])).toBe(true);
  });
});

describe("nenhuma rota de criação de adiantamento no agente", () => {
  const raiz = join(__dirname, "../../../..");
  const arquivos = [
    "supabase/functions/_shared/intimacoes.ts",
    "supabase/functions/fin-intimacoes-ler-gmail/index.ts",
    "supabase/functions/fin-intimacoes-consistem/index.ts",
    "app/(plataforma)/financeiro/intimacoes/acoes.ts",
  ];

  it.each(arquivos)("%s não inclui lançamento nem fornecedor no Consistem", (arquivo) => {
    const fonte = readFileSync(join(raiz, arquivo), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(fonte).not.toMatch(/\bincluir(Lancamento|Fornecedor)?\s*\(/);
    expect(fonte).not.toMatch(/\bimport\b[^;]*\bincluir(Lancamento|Fornecedor)?\b/);
    expect(fonte).not.toMatch(/tipoLancamento\s*:\s*["']A["']/);
    expect(fonte).not.toMatch(/method:\s*["'](PUT|POST|DELETE|PATCH)["']/);
    expect(fonte).not.toMatch(/crt-lancar-no-consistem|rh-vt-lancar-no-consistem/);
  });
});
