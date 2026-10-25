// Tela "Configurações > Google Drive (GED)": ações de servidor (com sessão e Supabase simulados) e o componente renderizado no
// servidor (react-dom/server). Sem DOM no projeto: cliques reais ficam para o Playwright, com banco real (fase de ativação).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  adminGeral: true,
  rpc: vi.fn(),
  invoke: vi.fn(),
  update: vi.fn(),
  revalidar: vi.fn(),
}));

vi.mock("@/lib/nucleo/sessao", () => ({ exigirSessao: async () => ({ acesso: { adminGeral: estado.adminGeral } }) }));
vi.mock("@/lib/supabase/servidor", () => ({
  criarClienteServidor: async () => ({
    rpc: estado.rpc,
    functions: { invoke: estado.invoke },
    from: (tabela: string) => ({
      update: (valores: unknown) => ({ eq: (coluna: string, chave: string) => ({ select: () => estado.update(tabela, valores, coluna, chave) }) }),
    }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: estado.revalidar }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const { iniciarConexaoGed, desconectarGed, definirContaGed, consultarMetadadosGed } = await import("@/app/(plataforma)/configuracoes/documentos/acoes");
const { ConexaoDrive } = await import("@/app/(plataforma)/configuracoes/documentos/conexao-drive");

const STATE = "c".repeat(64);
const SENSIVEIS = ["segredo_id", "google_sub", "refresh", "rt-", "code_verifier", "token", STATE];

beforeEach(() => {
  estado.adminGeral = true;
  estado.rpc.mockReset();
  estado.invoke.mockReset();
  estado.update.mockReset();
  estado.revalidar.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-ficticio.supabase.co";
});

describe("iniciarConexaoGed", () => {
  it("admin: gera o state com o destino FIXO e devolve a URL da Edge Function", async () => {
    estado.rpc.mockResolvedValue({ data: STATE, error: null });
    const r = await iniciarConexaoGed();
    expect(estado.rpc).toHaveBeenCalledWith("ged_iniciar_conexao", { p_destino: "/configuracoes/documentos" });
    expect(r).toEqual({ ok: true, url: `https://projeto-ficticio.supabase.co/functions/v1/nucleo-ged-conectar?state=${STATE}` });
  });

  it("não-admin: recusado sem tocar no banco", async () => {
    estado.adminGeral = false;
    expect(await iniciarConexaoGed()).toEqual({ ok: false, erro: expect.stringContaining("administrador geral") });
    expect(estado.rpc).not.toHaveBeenCalled();
  });

  it("falha da RPC: mensagem segura; erro técnico não vaza", async () => {
    estado.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.ged_iniciar_conexao" } });
    expect(await iniciarConexaoGed()).toEqual({ ok: false, erro: "Não foi possível iniciar a conexão. Tente de novo." });
    estado.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Configure a conta do GED (administrativo.ged.conta) antes de conectar." } });
    expect(await iniciarConexaoGed()).toEqual({ ok: false, erro: expect.stringContaining("Configure a conta") });
  });

  it("state fora do formato (resposta inesperada) não vira URL", async () => {
    estado.rpc.mockResolvedValue({ data: "https://evil.invalid", error: null });
    expect(await iniciarConexaoGed()).toEqual({ ok: false, erro: "Não foi possível iniciar a conexão. Tente de novo." });
  });
});

describe("desconectarGed", () => {
  it("admin: chama a Edge Function por POST e mostra o resultado da revogação", async () => {
    estado.invoke.mockResolvedValue({ data: { desconectado: true, revogacao: "falhou" }, error: null });
    const r = await desconectarGed();
    expect(estado.invoke).toHaveBeenCalledWith("nucleo-ged-conectar", { method: "POST" });
    expect(r).toMatchObject({ ok: true, tipo: "aviso", mensagem: expect.stringContaining("manualmente") });
    expect(estado.revalidar).toHaveBeenCalledWith("/configuracoes/documentos");
  });

  it("não-admin: recusado sem chamar a Edge Function", async () => {
    estado.adminGeral = false;
    expect((await desconectarGed()).ok).toBe(false);
    expect(estado.invoke).not.toHaveBeenCalled();
  });

  it("falha da Edge Function: erro recuperável, sem detalhe técnico, sem revalidar como sucesso", async () => {
    estado.invoke.mockResolvedValue({ data: null, error: { message: "FunctionsHttpError: 500 Internal" } });
    expect(await desconectarGed()).toEqual({ ok: false, erro: "Não foi possível desconectar agora. Tente de novo." });
    expect(estado.revalidar).not.toHaveBeenCalled();
  });
});

describe("definirContaGed", () => {
  const semConexao = { data: [], error: null };

  it("admin, sem conexão: grava a conta normalizada no parâmetro do núcleo e revalida a tela", async () => {
    estado.rpc.mockResolvedValue(semConexao);
    estado.update.mockResolvedValue({ data: [{ chave: "administrativo.ged.conta" }], error: null });
    expect(await definirContaGed(" Teste.Ficticio.GED@NeoFormas.com.br ")).toEqual({ ok: true });
    expect(estado.rpc).toHaveBeenCalledWith("ged_situacao_conexao");
    expect(estado.update).toHaveBeenCalledWith("configuracoes", { valor: "teste.ficticio.ged@neoformas.com.br" }, "chave", "administrativo.ged.conta");
    expect(estado.revalidar).toHaveBeenCalledWith("/configuracoes/documentos");
  });

  it("não-admin: recusado sem tocar no banco", async () => {
    estado.adminGeral = false;
    expect(await definirContaGed("teste.ficticio.ged@neoformas.com.br")).toEqual({ ok: false, erro: expect.stringContaining("administrador geral") });
    expect(estado.rpc).not.toHaveBeenCalled();
    expect(estado.update).not.toHaveBeenCalled();
  });

  it("e-mail inválido ou de outro domínio: recusado sem tocar no banco", async () => {
    expect((await definirContaGed("ged@gmail.com")).ok).toBe(false);
    expect(estado.rpc).not.toHaveBeenCalled();
  });

  it("D-TROCA: com conexão ativa (ou com erro) não troca; situação ilegível também recusa", async () => {
    for (const situacao of ["conectada", "com_erro"]) {
      estado.rpc.mockResolvedValue({ data: [{ situacao }], error: null });
      expect(await definirContaGed("teste.ficticio.ged@neoformas.com.br")).toEqual({ ok: false, erro: expect.stringContaining("Desconecte") });
    }
    estado.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    expect(await definirContaGed("teste.ficticio.ged@neoformas.com.br")).toEqual({ ok: false, erro: expect.stringContaining("conferir a conexão") });
    expect(estado.update).not.toHaveBeenCalled();
  });

  it("parâmetro ausente (sem migration) ou recusa da RLS: erro claro, sem revalidar", async () => {
    estado.rpc.mockResolvedValue(semConexao);
    estado.update.mockResolvedValue({ data: [], error: null });
    expect(await definirContaGed("teste.ficticio.ged@neoformas.com.br")).toEqual({ ok: false, erro: expect.stringContaining("0801") });
    estado.update.mockResolvedValue({ data: null, error: { code: "42501", message: "new row violates row-level security policy" } });
    expect(await definirContaGed("teste.ficticio.ged@neoformas.com.br")).toEqual({ ok: false, erro: "Você não tem permissão para esta operação." });
    expect(estado.revalidar).not.toHaveBeenCalled();
  });
});

describe("consultarMetadadosGed", () => {
  it("admin: chama a função de metadados por POST e devolve só o formato esperado", async () => {
    estado.invoke.mockResolvedValue({ data: { itens: 1, limite_atingido: false, por_tipo: { "application/pdf": 1 },
      amostra: [{ nome: "Ficticio.pdf", tipo: "application/pdf", modificado_em: null, tamanho: null }, { nome: 1 }] }, error: null });
    const r = await consultarMetadadosGed();
    expect(estado.invoke).toHaveBeenCalledWith("nucleo-ged-metadados", { method: "POST" });
    expect(r).toEqual({ ok: true, consulta: { itens: 1, limite_atingido: false, por_tipo: { "application/pdf": 1 },
      amostra: [{ nome: "Ficticio.pdf", tipo: "application/pdf", modificado_em: null, tamanho: null }] } });
  });

  it("não-admin: recusado sem chamar a função", async () => {
    estado.adminGeral = false;
    expect((await consultarMetadadosGed()).ok).toBe(false);
    expect(estado.invoke).not.toHaveBeenCalled();
  });

  it("erro da função: mensagem pelo código conhecido; código desconhecido ou corpo ilegível vira genérica", async () => {
    const erro = (corpo: unknown) => ({ data: null, error: { message: "FunctionsHttpError", context: new Response(JSON.stringify(corpo), { status: 502 }) } });
    estado.invoke.mockResolvedValue(erro({ erro: "sem_permissao_drive" }));
    expect(await consultarMetadadosGed()).toEqual({ ok: false, erro: expect.stringContaining("Drive API") });
    estado.invoke.mockResolvedValue(erro({ erro: "<script>" }));
    expect(await consultarMetadadosGed()).toEqual({ ok: false, erro: expect.stringContaining("Não foi possível consultar") });
    estado.invoke.mockResolvedValue({ data: null, error: { message: "rede" } });
    expect((await consultarMetadadosGed()).ok).toBe(false);
    estado.invoke.mockResolvedValue({ data: { inesperado: true }, error: null });
    expect((await consultarMetadadosGed()).ok).toBe(false);
  });
});

describe("componente ConexaoDrive (render no servidor)", () => {
  const conectada = {
    email: "ged.drive@exemplo.invalid", escopos: ["openid", "https://www.googleapis.com/auth/drive.readonly"],
    conectado_em: "2026-10-24T12:00:00Z", desconectado_em: null, revogacao_remota: null, ultimo_erro: null, ultimo_erro_em: null,
    situacao: "conectada" as const,
  };
  const render = (p: Partial<Parameters<typeof ConexaoDrive>[0]>) =>
    renderToStaticMarkup(createElement(ConexaoDrive, { disponivel: true, situacao: null, conta: "ged.drive@exemplo.invalid", revogarNoGoogle: true, ...p }));

  it("desconectada: botão Conectar; sem conta configurada, botão desabilitado e aviso", () => {
    const html = render({});
    expect(html).toContain("Desconectado");
    expect(html).not.toContain("Consultar arquivos");
    expect(html).toContain("Conectar Google Drive");
    expect(html).not.toContain(">Desconectar<");
    expect(html).toContain('value="ged.drive@exemplo.invalid"'); // campo da conta, só sem conexão ativa
    expect(html).toContain("Salvar conta");
    const semConta = render({ conta: null });
    expect(semConta).toMatch(/<button[^>]*disabled[^>]*>Conectar Google Drive/);
    expect(semConta).toContain("configure a conta dedicada");
  });

  it("conectada: e-mail, somente leitura e Desconectar; sem botão Conectar; nada sensível", () => {
    const html = render({ situacao: conectada });
    expect(html).toContain("Conectado");
    expect(html).toContain("ged.drive@exemplo.invalid");
    expect(html).toContain("Somente leitura do Drive");
    expect(html).toContain("Desconectar");
    expect(html).toContain("Consultar arquivos (amostra)"); // primeira leitura só com conexão ativa
    expect(html).not.toContain("Conectar Google Drive");
    expect(html).not.toContain("Salvar conta"); // D-TROCA: sem troca de conta com conexão ativa
    for (const s of SENSIVEIS) expect(html).not.toContain(s);
  });

  it("com erro: mensagem amigável por código e Reconectar + Desconectar", () => {
    const html = render({ situacao: { ...conectada, situacao: "com_erro", ultimo_erro: "invalid_grant", ultimo_erro_em: "2026-10-24T13:00:00Z" } });
    expect(html).toContain("Com erro");
    expect(html).toContain("deixou de valer");
    expect(html).toContain("Reconectar Google Drive");
    expect(html).toContain("Desconectar");
  });

  it("texto da revogação acompanha a configuração efetiva (D-REV), sem opção contraditória", () => {
    expect(render({ situacao: conectada, revogarNoGoogle: true })).toContain("também é revogado no Google");
    const sem = render({ situacao: conectada, revogarNoGoogle: false });
    expect(sem).toContain("revogação no Google fica manual");
    expect(sem).not.toMatch(/type="checkbox"|role="switch"/);
    expect(render({})).not.toContain("Ao desconectar"); // sem conexão ativa, o texto não aparece
  });

  it("migration ausente no ambiente: aviso neutro, sem botões e sem erro técnico", () => {
    const html = render({ disponivel: false });
    expect(html).toContain("ainda não está disponível neste ambiente");
    expect(html).not.toContain("<button");
  });
});
