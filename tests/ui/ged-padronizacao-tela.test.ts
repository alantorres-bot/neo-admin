// Tela "Documentos > Padronização de nomes": ações de servidor (sessão e Supabase simulados) e a grade renderizada no servidor.
// Cliques reais ficam para o Playwright com banco real (depois da 0811 aplicada).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ adminGeral: true, rpc: vi.fn(), invoke: vi.fn(), revalidar: vi.fn(), lista: vi.fn() }));

vi.mock("@/lib/nucleo/sessao", () => ({ exigirSessao: async () => ({ acesso: { adminGeral: estado.adminGeral } }) }));
vi.mock("@/lib/supabase/servidor", () => ({
  criarClienteServidor: async () => ({
    rpc: estado.rpc, functions: { invoke: estado.invoke },
    from: () => ({ select: () => ({ in: (_c: string, situacoes: string[]) => ({ order: () => ({ limit: () => estado.lista(situacoes) }) }) }) }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: estado.revalidar }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { analisarProximos, decidirAnalise, reanalisarSemDecisao } = await import("@/app/(plataforma)/documentos/padronizacao/acoes");
const { GradeAnalises, BotaoAnalisar } = await import("@/app/(plataforma)/documentos/padronizacao/grade");
const { lerFiltros, padraoCliente, resumoAnalise, mensagemPadronizacao } = await import("@/lib/nucleo/ged/padronizacao");

const DOC = "11111111-1111-4111-8111-111111111111";
const CONTAGENS = { analisados: 3, sugerida: 1, sem_texto: 1, nao_suportado: 1, erro: 0, pendentes: 5 };

beforeEach(() => {
  estado.adminGeral = true;
  estado.rpc.mockReset().mockResolvedValue({ error: null });
  estado.invoke.mockReset().mockResolvedValue({ data: CONTAGENS, error: null });
  estado.revalidar.mockReset();
});

describe("ações da padronização", () => {
  it("analisar: só admin geral; pede no máximo 20 e devolve só contagens", async () => {
    estado.adminGeral = false;
    expect(await analisarProximos()).toEqual({ ok: false, erro: mensagemPadronizacao("sem_permissao") });
    expect(estado.invoke).not.toHaveBeenCalled();
    estado.adminGeral = true;
    const r = await analisarProximos();
    expect(estado.invoke).toHaveBeenCalledWith("nucleo-ged-analisar", { method: "POST", body: { limite: 20 } });
    expect(r).toEqual({ ok: true, mensagem: "3 analisado(s): 1 com sugestão pelo conteúdo, 1 sem texto, 1 em formato não lido, 5 ficaram para a próxima." });
    expect(estado.revalidar).toHaveBeenCalledWith("/documentos/padronizacao");
  });

  it("analisar: resposta fora do formato ou erro da função vira mensagem fixa", async () => {
    estado.invoke.mockResolvedValueOnce({ data: { analisados: 1, texto: "x" }, error: null });
    expect((await analisarProximos()).ok).toBe(false);
    const contexto = new Response(JSON.stringify({ erro: "desconectado" }), { status: 409 });
    estado.invoke.mockResolvedValueOnce({ data: null, error: { context: contexto } });
    expect(await analisarProximos()).toEqual({ ok: false, erro: mensagemPadronizacao("desconectado") });
  });

  it("reanalisar: só as sem decisão, em ids, para a mesma função", async () => {
    estado.lista.mockResolvedValueOnce({ data: [{ documento_id: DOC }], error: null });
    expect((await reanalisarSemDecisao()).ok).toBe(true);
    expect(estado.lista).toHaveBeenCalledWith(["sugerida", "sem_texto", "nao_suportado", "erro"]);
    expect(estado.invoke).toHaveBeenCalledWith("nucleo-ged-analisar", { method: "POST", body: { documentos: [DOC] } });
    estado.lista.mockResolvedValueOnce({ data: [], error: null });
    estado.invoke.mockClear();
    expect(await reanalisarSemDecisao()).toEqual({ ok: true, mensagem: "Nenhuma análise sem decisão para refazer." });
    expect(estado.invoke).not.toHaveBeenCalled();
    estado.adminGeral = false;
    expect((await reanalisarSemDecisao()).ok).toBe(false);
  });

  it("decidir: editar valida o nome antes do banco; aprovar e rejeitar repassam", async () => {
    expect(await decidirAnalise(DOC, "editar", " :/* ", "pdf", "")).toEqual({ ok: false, erro: mensagemPadronizacao("nome_invalido") });
    expect(estado.rpc).not.toHaveBeenCalled();
    expect(await decidirAnalise(DOC, "editar", "NF REMESSA - 794 - Construteto", "pdf", "")).toEqual({ ok: true });
    expect(estado.rpc).toHaveBeenLastCalledWith("ged_decidir_analise", expect.objectContaining({ p_decisao: "editar", p_nome: expect.stringMatching(/^NF REMESSA - 794 - Construteto\.pdf$/) }));
    await decidirAnalise(DOC, "rejeitar", "", "pdf", "  tipo errado ");
    expect(estado.rpc).toHaveBeenLastCalledWith("ged_decidir_analise", { p_documento: DOC, p_decisao: "rejeitar", p_nome: null, p_motivo: "tipo errado" });
    estado.rpc.mockResolvedValueOnce({ error: { message: "ged:motivo_obrigatorio" } });
    expect(await decidirAnalise(DOC, "rejeitar", "", "pdf", "")).toEqual({ ok: false, erro: mensagemPadronizacao("motivo_obrigatorio") });
    expect(await decidirAnalise(DOC, "apagar" as "aprovar", "", "pdf", "")).toEqual({ ok: false, erro: mensagemPadronizacao("decisao_invalida") });
    estado.adminGeral = false;
    expect((await decidirAnalise(DOC, "aprovar", "", "pdf", "")).ok).toBe(false);
  });
});

describe("filtros e textos", () => {
  it("só aceita valores conhecidos e escapa o curinga do cliente", () => {
    expect(lerFiltros({ raiz: "outra", tipo: "x", situacao: "apagada", confianca: "total", cliente: ["  Neo "] }, ["nf_venda"]))
      .toEqual({ finalidade: null, tipo: null, situacao: null, confianca: null, cliente: "Neo" });
    expect(lerFiltros({ raiz: "elaboracao", tipo: "nf_venda", situacao: "sugerida", confianca: "alta" }, ["nf_venda"]))
      .toMatchObject({ finalidade: "elaboracao", tipo: "nf_venda", situacao: "sugerida", confianca: "alta" });
    expect(padraoCliente("a")).toBeNull();
    expect(padraoCliente("50%_x")).toBe("%50\\%\\_x%");
    expect(resumoAnalise({ ...CONTAGENS, analisados: 0 })).toBe("Nenhum documento novo para analisar.");
  });
});

describe("grade", () => {
  it("mostra nome atual e sugerido, confiança e situação; sem decisão aberta por padrão", () => {
    const html = renderToStaticMarkup(createElement(GradeAnalises, { linhas: [{
      documento_id: DOC, situacao: "sugerida", tipo: "nf_remessa", tipo_nome: "NF de remessa", nome_atual: "NF 794 - REM 02.pdf",
      nome_sugerido: "NF REMESSA - 794 - Remessa 02.pdf", nome_final: null, confianca: "alta", justificativa: "nome e conteúdo", erro: null,
      extensao: "pdf", raiz: "Dossiê de clientes", link: "https://drive.google.com/file/d/x/view", campos: {}, historico: [],
    }] }));
    expect(html).toContain("NF 794 - REM 02.pdf");
    expect(html).toContain("NF REMESSA - 794 - Remessa 02.pdf");
    expect(html).toContain("Alta");
    expect(html).toContain("Sugerida");
    expect(html).not.toContain("Rejeitar");
    expect(renderToStaticMarkup(createElement(BotaoAnalisar))).toContain("Analisar próximos 20");
  });
});
