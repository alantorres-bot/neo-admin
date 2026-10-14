import { describe, expect, it } from "vitest";
import { alterarPortador, alterarTitulo, conferirAlteracao, conferirTroca, incluirLancamento, jaAlterado, jaMarcado, lerRespostaInclusao, type Enviar } from "@/supabase/functions/_shared/consistem-inclusao";

const cfg = { baseUrl: "https://erp.exemplo/api/", token: "tok", empresa: "1" };

describe("resposta da inclusão de lançamento", () => {
  it("2xx com código = lançado (objeto ou lista); sem código = incerto", () => {
    expect(lerRespostaInclusao(200, JSON.stringify({ codLancamento: 40001, valorDocumento: 92.34 }))).toMatchObject({ tipo: "lancado", codLancamento: "40001" });
    expect(lerRespostaInclusao(201, JSON.stringify([{ codLancamento: "40002" }]))).toMatchObject({ tipo: "lancado", codLancamento: "40002" });
    expect(lerRespostaInclusao(200, "")).toMatchObject({ tipo: "incerto" });
    expect(lerRespostaInclusao(200, "{}").tipo).toBe("incerto");
  });
  it("4xx = erro com as mensagens do ERP (nada criado); 5xx = incerto", () => {
    expect(lerRespostaInclusao(400, JSON.stringify([{ mensagem: "Fornecedor inválido" }, { mensagem: "Conta contábil inexistente" }])))
      .toEqual({ tipo: "erro", mensagem: "O Consistem recusou (HTTP 400): Fornecedor inválido; Conta contábil inexistente", resposta: expect.anything() });
    expect(lerRespostaInclusao(403, "")).toMatchObject({ tipo: "erro", mensagem: expect.stringMatching(/permissão para esta inclusão/) });
    expect(lerRespostaInclusao(429, "").tipo).toBe("erro");
    expect(lerRespostaInclusao(500, JSON.stringify({ mensagem: "Erro interno" })).tipo).toBe("incerto");
    expect(lerRespostaInclusao(400, "texto solto")).toMatchObject({ mensagem: expect.stringMatching(/texto solto/) });
  });
});

describe("envio", () => {
  it("PUT uma vez, com token sem Bearer e o cabeçalho da empresa", async () => {
    const chamadas: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
    const enviar: Enviar = async (url, init) => { chamadas.push({ url, ...init }); return { status: 200, text: async () => '{"codLancamento":7}' }; };
    expect(await incluirLancamento(enviar, cfg, { valorDocumento: 1 })).toMatchObject({ tipo: "lancado", codLancamento: "7" });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ url: "https://erp.exemplo/api/financeiro/v10/lancamentoContasPagar", method: "PUT", body: '{"valorDocumento":1}' });
    expect(chamadas[0].headers).toMatchObject({ Authorization: "tok", empresa: "1", "Content-Type": "application/json" });
  });
  it("queda de rede ou demora = incerto, sem repetir", async () => {
    let n = 0;
    const falha: Enviar = async () => { n++; throw new Error("rede"); };
    expect(await incluirLancamento(falha, cfg, {})).toMatchObject({ tipo: "incerto", mensagem: /falha de rede/ });
    expect(n).toBe(1);
    const lento: Enviar = (_u, init) => new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))));
    expect(await incluirLancamento(lento, cfg, {}, { tempoMs: 10 })).toMatchObject({ tipo: "incerto", mensagem: /não respondeu a tempo/ });
  });
});

describe("cadastro de fornecedor", () => {
  it("usa a rota de fornecedor e lê o código em codFornecedor", async () => {
    const { incluirFornecedor } = await import("@/supabase/functions/_shared/consistem-inclusao");
    let urlUsada = "";
    const enviar: Enviar = async (url) => { urlUsada = url; return { status: 200, text: async () => '{"codFornecedor":1500,"nome":"NUVIAGENS"}' }; };
    expect(await incluirFornecedor(enviar, cfg, { nome: "NUVIAGENS" })).toMatchObject({ tipo: "lancado", codigo: "1500" });
    expect(urlUsada).toBe("https://erp.exemplo/api/cadastrosgerais/v10/fornecedor");
    expect(lerRespostaInclusao(200, '{"codLancamento":1}', "codFornecedor").tipo).toBe("incerto");
  });
});

describe("troca do portador e do histórico (0162/0164)", () => {
  const P = { codPortador: 501 };
  const responde = (status: number, corpo = ""): { enviar: Enviar; chamadas: { url: string; body: string }[] } => {
    const chamadas: { url: string; body: string }[] = [];
    return { chamadas, enviar: async (url, init) => { chamadas.push({ url, body: init.body }); return { status, text: async () => corpo }; } };
  };
  it("PUT no lançamento, só com o portador; 2xx com ou sem corpo = ok", async () => {
    const r = responde(200, "");
    expect(await alterarPortador(r.enviar, cfg, "33626", { codPortador: 501 })).toMatchObject({ tipo: "ok" });
    expect(r.chamadas).toEqual([{ url: "https://erp.exemplo/api/financeiro/v10/lancamentoContasPagar/33626", body: '{"codPortador":501}' }]);
    expect((await alterarPortador(responde(200, '{"codLancamento":33626}').enviar, cfg, "33626", P)).tipo).toBe("ok");
  });
  it("4xx = erro; 5xx = incerto; código inválido nem envia", async () => {
    expect(await alterarPortador(responde(400, '[{"mensagem":"Portador inexistente"}]').enviar, cfg, "1", P)).toMatchObject({ tipo: "erro", mensagem: /Portador inexistente/ });
    expect(await alterarPortador(responde(502).enviar, cfg, "1", P)).toMatchObject({ tipo: "incerto", mensagem: /conferida pelo detalhe/ });
    const r = responde(200);
    expect((await alterarPortador(r.enviar, cfg, "1;2", { codPortador: 501 })).tipo).toBe("erro");
    expect(r.chamadas).toHaveLength(0);
  });
  it("conferência: portador novo e o resto igual (campos de alteração não contam)", () => {
    const antes = { codLancamento: 1, codPortador: 91, valorDocumento: 10.5, dataVencimento: "2026-10-23", codBarras: "123", dataAlteracao: "2026-10-01" };
    expect(conferirTroca(antes, { ...antes, codPortador: 501, dataAlteracao: "2026-10-13" }, P)).toEqual({ ok: true });
    expect(conferirTroca(antes, { ...antes, codPortador: "501" }, P)).toEqual({ ok: true });
    expect(conferirTroca(antes, antes, P)).toMatchObject({ ok: false, mensagem: /continua 91 \(esperado 501\)/ });
    // Vencimento original vazio passa a ser o próprio vencimento (33456, 13/10/2026): aceito. Outro valor: diferença.
    const comOriginal = { ...antes, dataVencimentoOriginal: "" };
    expect(conferirTroca(comOriginal, { ...comOriginal, codPortador: 501, dataVencimentoOriginal: "2026-10-23" }, P)).toEqual({ ok: true });
    expect(conferirTroca(comOriginal, { ...comOriginal, codPortador: 501, dataVencimentoOriginal: "2026-10-30" }, P)).toMatchObject({ ok: false });
    const r = conferirTroca(antes, { ...antes, codPortador: 501, codBarras: "" }, P);
    expect(r).toMatchObject({ ok: false, mensagem: /outros campos também mudaram/, diferencas: ['codBarras: "123" → ""'] });
  });
  it("com histórico: PUT com os dois; conferência exige os dois e não acusa a troca do histórico", async () => {
    const r = responde(200, "");
    expect(await alterarPortador(r.enviar, cfg, "33626", { codPortador: 992, codHistorico: 80 })).toMatchObject({ tipo: "ok" });
    expect(r.chamadas[0].body).toBe('{"codPortador":992,"codHistorico":80}');
    const M = { codPortador: 992, codHistorico: 80 };
    const antes = { codPortador: 992, codHistorico: 2, valorDocumento: 10.5 };
    expect(jaMarcado(antes, M)).toBe(false);
    expect(jaMarcado({ ...antes, codHistorico: "80" }, M)).toBe(true);
    expect(jaMarcado(antes, { codPortador: 992 })).toBe(true);
    expect(conferirTroca(antes, { ...antes, codHistorico: 80 }, M)).toEqual({ ok: true });
    expect(conferirTroca(antes, antes, M)).toMatchObject({ ok: false, mensagem: /histórico continua 2 \(esperado 80\)/ });
    // Sem histórico no cartão, mudar o histórico é diferença.
    expect(conferirTroca(antes, { ...antes, codHistorico: 80 }, { codPortador: 992 })).toMatchObject({ ok: false, diferencas: ["codHistorico: 2 → 80"] });
  });
});

describe("alteração do título no desdobramento (0165)", () => {
  const antes = { codLancamento: 40000, codDocumento: "3615152/1", valorDocumento: 2994.78, valorOriginalDocumento: 2994.78, complementoHistorico: "CARTÃO UNICRED 1 X", codPortador: 91, dataVencimento: "2026-10-20", dataVencimentoOriginal: "" };
  const esperado = { valorDocumento: 499.13, codDocumento: "3615152/1", complementoHistorico: "CARTÃO UNICRED PF 6x — MP*TERABYTESHOP PARC 1/6" };

  it("PUT na rota do título com só os campos pedidos; 2xx sem código = aceito; 5xx = incerto", async () => {
    const chamadas: { url: string; body: string; method: string }[] = [];
    const ok: Enviar = async (url, init) => { chamadas.push({ url, body: init.body, method: init.method }); return { status: 200, text: async () => "" }; };
    expect(await alterarTitulo(ok, cfg, "40000", esperado)).toMatchObject({ tipo: "ok" });
    expect(chamadas).toEqual([{ url: "https://erp.exemplo/api/financeiro/v10/lancamentoContasPagar/40000", body: JSON.stringify(esperado), method: "PUT" }]);
    const falha: Enviar = async () => ({ status: 502, text: async () => "" });
    expect(await alterarTitulo(falha, cfg, "40000", esperado)).toMatchObject({ tipo: "incerto", mensagem: expect.stringContaining("conferida pelo detalhe") });
    expect(await alterarTitulo(ok, cfg, "40000;1", esperado)).toMatchObject({ tipo: "erro" });
  });

  it("confere: campos novos gravados, valor original acompanhando e o resto igual", () => {
    const depois = { ...antes, ...esperado, valorOriginalDocumento: 499.13, dataVencimentoOriginal: "2026-10-20" };
    expect(conferirAlteracao(antes, depois, esperado)).toEqual({ ok: true });
    expect(jaAlterado(depois, esperado)).toBe(true);
    expect(jaAlterado(antes, esperado)).toBe(false);
    expect(conferirAlteracao(antes, { ...depois, valorOriginalDocumento: 2994.78 }, esperado)).toEqual({ ok: true });
  });

  it("recusa: campo não gravado ou outro campo mudou", () => {
    const naoGravou = conferirAlteracao(antes, { ...antes, codDocumento: "3615152/1", complementoHistorico: esperado.complementoHistorico }, esperado);
    expect(naoGravou).toMatchObject({ ok: false, mensagem: expect.stringContaining("valorDocumento = 2994.78 (esperado 499.13)") });
    const mudouOutro = conferirAlteracao(antes, { ...antes, ...esperado, codPortador: 1 }, esperado);
    expect(mudouOutro).toMatchObject({ ok: false, diferencas: ["codPortador: 91 → 1"] });
  });
});
