import { describe, expect, it } from "vitest";
import { incluirLancamento, lerRespostaInclusao, type Enviar } from "@/supabase/functions/_shared/consistem-inclusao";

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
      .toEqual({ tipo: "erro", mensagem: "O Consistem recusou o título (HTTP 400): Fornecedor inválido; Conta contábil inexistente", resposta: expect.anything() });
    expect(lerRespostaInclusao(403, "")).toMatchObject({ tipo: "erro", mensagem: expect.stringMatching(/permissão para incluir/) });
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
