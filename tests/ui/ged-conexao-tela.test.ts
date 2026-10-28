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

const { iniciarConexaoGed, desconectarGed, definirContaGed, consultarMetadadosGed, verificarRaizGed, cadastrarRaizGed, definirAreasRaizGed, definirSituacaoRaizGed } =
  await import("@/app/(plataforma)/configuracoes/documentos/acoes");
const { PastasRaiz } = await import("@/app/(plataforma)/configuracoes/documentos/pastas-raiz");
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

describe("verificarRaizGed", () => {
  const RAIZ = "1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak";
  const resposta = { raiz: "Dossiê", itens: 3, truncada: false, candidatasDentro: [], porNivel: [{ profundidade: 1, pastas: 2, arquivos: 1 }],
    subpastasNivel1: ["Cliente ficticio"], subpastasNivel2: [], extensoes: [{ extensao: "pdf", quantidade: 1 }], temporarios: [],
    limites: { profundidadeMax: 4, maxItens: 10000, maxPastasAbertas: 1000, prazoMs: 90000 } };

  it("admin e raiz candidata: chama a função com a ação e a raiz; devolve o resumo validado", async () => {
    estado.invoke.mockResolvedValue({ data: resposta, error: null });
    expect(await verificarRaizGed(RAIZ)).toEqual({ ok: true, verificacao: resposta });
    expect(estado.invoke).toHaveBeenCalledWith("nucleo-ged-metadados", { method: "POST", body: { acao: "verificar_raiz", raiz: RAIZ } });
  });

  it("ID fora da lista ou não-admin: recusado sem chamar a função", async () => {
    expect(await verificarRaizGed("qualquer-pasta")).toEqual({ ok: false, erro: expect.stringContaining("raízes candidatas") });
    estado.adminGeral = false;
    expect((await verificarRaizGed(RAIZ)).ok).toBe(false);
    expect(estado.invoke).not.toHaveBeenCalled();
  });

  it("resposta fora do formato não chega à tela", async () => {
    estado.invoke.mockResolvedValue({ data: { ...resposta, subpastasNivel1: [{ x: 1 }] }, error: null });
    expect((await verificarRaizGed(RAIZ)).ok).toBe(false);
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
    expect(html).toContain("Verificação das raízes candidatas");
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

describe("pastas-raiz (A1a, 0804)", () => {
  const DOSSIE = "1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak";
  const ELABORACAO = "1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR";
  const erroFuncao = (erro: string) => ({ data: null, error: { context: new Response(JSON.stringify({ erro }), { status: 409 }) } });

  it("cadastrar: só admin e só as duas raízes confirmadas; chama a função com a ação e as áreas", async () => {
    estado.invoke.mockResolvedValue({ data: { id: "r1", nome: "x" }, error: null });
    expect(await cadastrarRaizGed(DOSSIE, "contratos", ["comercial"], "contratos")).toEqual({ ok: true });
    expect(estado.invoke).toHaveBeenCalledWith("nucleo-ged-metadados", {
      method: "POST", body: { acao: "cadastrar_raiz", raiz: DOSSIE, area: "contratos", areas_leitura: ["comercial"], area_operacao: "contratos" },
    });
    expect(estado.revalidar).toHaveBeenCalledWith("/configuracoes/documentos");
    estado.invoke.mockReset();
    expect(await cadastrarRaizGed("1JOh-QFYw9uwNkxSAdPa6cLzOzIuOiT56", "contratos", [], "contratos")).toEqual({ ok: false, erro: expect.stringContaining("duas raízes") });
    estado.adminGeral = false;
    expect((await cadastrarRaizGed(DOSSIE, "contratos", [], "contratos")).ok).toBe(false);
    expect(estado.invoke).not.toHaveBeenCalled();
  });

  it("cadastrar: código da função vira mensagem fixa; desconhecido vira genérica", async () => {
    estado.invoke.mockResolvedValue(erroFuncao("raiz_existente"));
    expect(await cadastrarRaizGed(DOSSIE, "contratos", [], "contratos")).toEqual({ ok: false, erro: "Esta raiz já está cadastrada." });
    estado.invoke.mockResolvedValue(erroFuncao("pasta_invalida"));
    expect(await cadastrarRaizGed(ELABORACAO, "contratos", [], "contratos")).toEqual({ ok: false, erro: expect.stringContaining("Drive compartilhado") });
    estado.invoke.mockResolvedValue(erroFuncao("detalhe interno qualquer"));
    expect(await cadastrarRaizGed(DOSSIE, "contratos", [], "contratos")).toEqual({ ok: false, erro: "Não foi possível concluir agora. Tente de novo." });
    expect(estado.revalidar).not.toHaveBeenCalled();
  });

  it("situação e áreas: RPC com o cliente do usuário; recusas do banco viram mensagens fixas", async () => {
    estado.rpc.mockResolvedValue({ data: null, error: null });
    expect(await definirSituacaoRaizGed("r1", "ativa")).toEqual({ ok: true });
    expect(estado.rpc).toHaveBeenCalledWith("ged_definir_situacao_raiz", { p_raiz: "r1", p_situacao: "ativa" });
    expect(await definirAreasRaizGed("r1", "contratos", ["financeiro"], "contratos")).toEqual({ ok: true });
    expect(estado.rpc).toHaveBeenCalledWith("ged_definir_areas_raiz", { p_raiz: "r1", p_area: "contratos", p_areas_leitura: ["financeiro"], p_area_operacao: "contratos" });
    estado.rpc.mockResolvedValue({ data: null, error: { message: "ged:sem_verificacao" } });
    expect(await definirSituacaoRaizGed("r1", "ativa")).toEqual({ ok: false, erro: expect.stringContaining("não foi completa") });
    estado.rpc.mockResolvedValue({ data: null, error: { message: "ged:raiz_travada" } });
    expect(await definirAreasRaizGed("r1", "comercial", [], "contratos")).toEqual({ ok: false, erro: expect.stringContaining("elaboração") });
    estado.rpc.mockReset();
    estado.adminGeral = false;
    expect((await definirSituacaoRaizGed("r1", "inativa")).ok).toBe(false);
    expect((await definirAreasRaizGed("r1", "contratos", [], "contratos")).ok).toBe(false);
    expect(estado.rpc).not.toHaveBeenCalled();
  });

  const AREAS = [{ codigo: "contratos", nome: "Contratos" }, { codigo: "comercial", nome: "Comercial" }];
  const render = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(PastasRaiz, { raizes: [], areas: AREAS, conectado: true, ...p }));

  it("sem cadastro: as duas raízes confirmadas com Cadastrar (desabilitado sem conexão); a subpasta Contratos não aparece", () => {
    const html = render({});
    expect(html).toContain("02 - CONTRATOS");
    expect(html).toContain("01 - CLIENTES");
    expect(html).not.toContain("(alternativa)");
    expect(html.match(/>Cadastrar</g)).toHaveLength(2);
    expect(html).not.toMatch(/disabled=""[^>]*>Cadastrar/);
    expect(render({ conectado: false })).toMatch(/disabled=""[^>]*>Cadastrar/);
  });

  it("cadastradas: nome do Drive, áreas e situação; Ativar/Inativar conforme a situação; Áreas só no dossiê", () => {
    const html = render({ raizes: [
      { id: "e", nome: "02 - CONTRATOS", finalidade: "elaboracao", area: "contratos", areas_leitura: [], area_operacao: "contratos", situacao: "em_verificacao" },
      { id: "d", nome: "01 - CLIENTES", finalidade: "dossie_cliente", area: "contratos", areas_leitura: ["comercial"], area_operacao: "contratos", situacao: "ativa" },
    ] });
    expect(html).toContain("Em verificação");
    expect(html).toContain("Leitura: Comercial");
    expect(html.match(/>Ativar</g)).toHaveLength(1);
    expect(html.match(/>Inativar</g)).toHaveLength(1);
    expect(html.match(/<button[^>]*>Áreas<\/button>/g)).toHaveLength(1); // o título da coluna também diz "Áreas"
    expect(html).not.toContain(">Cadastrar<");
  });
});
