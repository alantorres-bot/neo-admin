// GED: primeira leitura controlada do Drive (só metadados) — tratarConsultaMetadados e consultarMetadados (Edge Function
// nucleo-ged-metadados). Tudo fictício: nenhuma credencial, conta, arquivo ou URL real.
import { describe, expect, it, vi } from "vitest";
import {
  DRIVE_COMPARTILHADO_GED,
  ESCOPO_DRIVE_LEITURA,
  LIMITE_METADADOS,
  LIMITE_VERIFICACAO,
  tratarConsultaMetadados,
  tratarCadastroRaiz,
  tratarVerificacaoRaiz,
  type DepsMetadados,
} from "../../../supabase/functions/_shared/ged";

const ENV: Record<string, string> = {
  GED_DRIVE_CLIENT_ID: "cliente-ficticio.apps.googleusercontent.com",
  GED_DRIVE_CLIENT_SECRET: "segredo-cliente-ficticio",
  GED_DRIVE_REDIRECT_URI: "https://projeto-ficticio.supabase.co/functions/v1/nucleo-ged-conectar",
  NEO_ADMIN_URL: "https://neoadmin.exemplo.invalid",
};
const PERFIL = "00000000-0000-4000-8000-0000000000a1";
const SENSIVEIS = ["rt-ficticio", "at-ficticio", "segredo-cliente-ficticio"];
const ESCOPOS = `openid https://www.googleapis.com/auth/userinfo.email ${ESCOPO_DRIVE_LEITURA}`;

const arquivo = (n: number) => ({ name: `Contrato ficticio ${n}.pdf`, mimeType: "application/pdf", modifiedTime: "2026-10-20T12:00:00Z", size: "2048" });
const pagina = (qtd: number, proxima?: string) =>
  new Response(JSON.stringify({ files: Array.from({ length: qtd }, (_, i) => arquivo(i)), ...(proxima ? { nextPageToken: proxima } : {}) }), { status: 200 });

function deps(o: {
  admin?: boolean; conectado?: boolean; env?: Record<string, string>;
  token?: () => Response; drive?: (url: string) => Response; cadastro?: { data?: unknown; error?: { message: string } | null };
} = {}) {
  const rpcs: { nome: string; args: Record<string, unknown> }[] = [];
  const logs: string[] = [];
  const posts: { url: string; corpo: string }[] = [];
  const gets: { url: string; auth: string }[] = [];
  const d: DepsMetadados = {
    env: (k) => (o.env ?? ENV)[k],
    agoraSeg: () => 1_800_000_000,
    perfilAdmin: async () => (o.admin === false ? null : PERFIL),
    rpc: async (nome, args) => {
      rpcs.push({ nome, args });
      if (nome === "ged_refresh_token") return { data: o.conectado === false ? null : { refresh_token: "rt-ficticio" }, error: null };
      if (nome === "ged_cadastrar_raiz") return { data: o.cadastro?.data ?? "raiz-uuid", error: o.cadastro?.error ?? null };
      return { data: null, error: null };
    },
    fetch: vi.fn(async (url: string, init: { body: string }) => {
      posts.push({ url, corpo: init.body });
      return o.token ? o.token() : new Response(JSON.stringify({ access_token: "at-ficticio", scope: ESCOPOS }), { status: 200 });
    }),
    fetchDrive: async (url, init) => {
      gets.push({ url, auth: init.headers.Authorization });
      return o.drive ? o.drive(url) : pagina(2);
    },
    esperar: async () => {},
    log: (m) => logs.push(m),
  };
  return { d, rpcs, logs, posts, gets };
}
const corpo = (r: { corpo?: string }) => JSON.parse(r.corpo ?? "null");
const auditoria = (rpcs: { nome: string; args: Record<string, unknown> }[]) =>
  rpcs.filter((r) => r.nome === "ged_registrar_consulta_metadados").map((r) => r.args);

describe("acesso", () => {
  it("só POST, com JWT de admin geral; sem isso nada é lido nem renovado", async () => {
    for (const [req, o, status] of [
      [{ method: "GET", jwt: "jwt" }, {}, 405],
      [{ method: "POST", jwt: null }, {}, 401],
      [{ method: "POST", jwt: "jwt" }, { admin: false }, 403],
      [{ method: "POST", jwt: "jwt" }, { env: { ...ENV, GED_DRIVE_CLIENT_SECRET: "" } }, 500],
      [{ method: "POST", jwt: "jwt" }, { conectado: false }, 409],
    ] as const) {
      const t = deps(o);
      expect((await tratarConsultaMetadados(req, t.d)).status).toBe(status);
      expect(t.posts).toEqual([]);
      expect(t.gets).toEqual([]);
    }
  });
});

describe("consulta", () => {
  it("renova o acesso com o refresh token do Vault, lê só metadados por GET e audita a contagem", async () => {
    const t = deps();
    const r = await tratarConsultaMetadados({ method: "POST", jwt: "jwt" }, t.d);
    expect(r.status).toBe(200);
    expect(corpo(r)).toEqual({
      itens: 2, limite_atingido: false, por_tipo: { "application/pdf": 2 },
      amostra: [0, 1].map((n) => ({ nome: `Contrato ficticio ${n}.pdf`, tipo: "application/pdf", modificado_em: "2026-10-20T12:00:00Z", tamanho: 2048 })),
    });
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(new URLSearchParams(t.posts[0].corpo))).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt-ficticio" });
    const u = new URL(t.gets[0].url);
    expect(u.origin + u.pathname).toBe("https://www.googleapis.com/drive/v3/files");
    expect(u.searchParams.get("fields")).toBe("nextPageToken,files(name,mimeType,modifiedTime,size)"); // sem link, id ou conteúdo
    expect(u.searchParams.get("q")).toBe("trashed=false");
    expect(t.gets[0].auth).toBe("Bearer at-ficticio");
    expect(auditoria(t.rpcs)).toEqual([{ p_perfil: PERFIL, p_itens: 2, p_resultado: "ok" }]);
    expect(t.logs).toEqual(["ged-metadados: resultado=ok itens=2"]);
    for (const s of [...SENSIVEIS, "Contrato"]) expect(t.logs.join(" ")).not.toContain(s);
    for (const s of SENSIVEIS) expect(r.corpo).not.toContain(s);
  });

  it("limite fixo: para em 3 páginas mesmo com mais no Drive; amostra de no máximo 20", async () => {
    const t = deps({ drive: () => pagina(LIMITE_METADADOS.porPagina, "mais") });
    const r = corpo(await tratarConsultaMetadados({ method: "POST", jwt: "jwt" }, t.d));
    expect(t.gets).toHaveLength(LIMITE_METADADOS.paginas);
    expect(r.itens).toBe(300);
    expect(r.limite_atingido).toBe(true);
    expect(r.amostra).toHaveLength(LIMITE_METADADOS.amostra);
    expect(new URL(t.gets[1].url).searchParams.get("pageToken")).toBe("mais");
  });

  it("invalid_grant: marca a conexão com erro (sem state), audita e não chama o Drive", async () => {
    const t = deps({ token: () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }) });
    const r = await tratarConsultaMetadados({ method: "POST", jwt: "jwt" }, t.d);
    expect([r.status, corpo(r)]).toEqual([409, { erro: "invalid_grant" }]);
    expect(t.rpcs).toContainEqual({ nome: "ged_registrar_erro_conexao", args: { p_codigo: "invalid_grant" } });
    expect(auditoria(t.rpcs)).toEqual([{ p_perfil: PERFIL, p_itens: 0, p_resultado: "invalid_grant" }]);
    expect(t.gets).toEqual([]);
  });

  it("renovação devolvendo escopo maior que o aceito: recusa sem ler o Drive", async () => {
    const t = deps({ token: () => new Response(JSON.stringify({ access_token: "at-ficticio", scope: "https://www.googleapis.com/auth/drive" }), { status: 200 }) });
    const r = await tratarConsultaMetadados({ method: "POST", jwt: "jwt" }, t.d);
    expect([r.status, corpo(r)]).toEqual([502, { erro: "http" }]);
    expect(t.gets).toEqual([]);
  });

  it("Drive 403 (API desativada ou sem acesso): código próprio, sem token na resposta; falha de rede vira 'http'", async () => {
    const t = deps({ drive: () => new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "Drive API disabled at-ficticio" } }), { status: 403 }) });
    const r = await tratarConsultaMetadados({ method: "POST", jwt: "jwt" }, t.d);
    expect([r.status, corpo(r)]).toEqual([502, { erro: "sem_permissao_drive" }]);
    expect(auditoria(t.rpcs)).toEqual([{ p_perfil: PERFIL, p_itens: 0, p_resultado: "sem_permissao_drive" }]);
    for (const s of SENSIVEIS) expect(r.corpo).not.toContain(s);

    const rede = deps({ token: () => { throw new Error("rede rt-ficticio"); } });
    expect(corpo(await tratarConsultaMetadados({ method: "POST", jwt: "jwt" }, rede.d))).toEqual({ erro: "http" });
  });

  it("resposta 200 sem a lista de arquivos não vira 'zero itens'", async () => {
    const t = deps({ drive: () => new Response("{}", { status: 200 }) });
    const r = await tratarConsultaMetadados({ method: "POST", jwt: "jwt" }, t.d);
    expect(corpo(r)).toEqual({ erro: "http" });
    expect(auditoria(t.rpcs)).toEqual([{ p_perfil: PERFIL, p_itens: 0, p_resultado: "http" }]);
  });
});

describe("verificação das raízes candidatas (A0, 5.2.4)", () => {
  const ELABORACAO = "1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR";
  const SUBPASTA = "1JOh-QFYw9uwNkxSAdPa6cLzOzIuOiT56";
  const pasta = (id: string, nome: string) => ({ id, name: nome, mimeType: "application/vnd.google-apps.folder" });
  const doc = (nome: string) => ({ id: `f-${nome}`, name: nome, mimeType: "application/pdf" });
  // Árvore fictícia: raiz -> Contratos (a outra candidata) -> Venda -> 2026 -> arquivos; temporário na raiz.
  const filhos: Record<string, object[]> = {
    [ELABORACAO]: [pasta(SUBPASTA, "Contratos"), doc("~WRL0001.tmp")],
    [SUBPASTA]: [pasta("V", "Venda"), doc("modelo ficticio.docx")],
    V: [pasta("A", "2026")],
    A: [doc("229 - contrato ficticio.pdf")],
  };
  const maeDe = (url: string) => /'([^']+)' in parents/.exec(new URL(url).searchParams.get("q") ?? "")?.[1] ?? "";
  const drive = (url: string) => new Response(JSON.stringify({ files: filhos[maeDe(url)] ?? [] }), { status: 200 });
  const verificar = (raiz: unknown, o: Parameters<typeof deps>[0] = {}) => {
    const t = deps({ drive, ...o });
    return tratarVerificacaoRaiz({ method: "POST", jwt: "jwt", raiz }, t.d).then((r) => ({ r, ...t }));
  };

  it("só IDs da lista da especificação: ID livre é recusado antes de qualquer chamada", async () => {
    for (const raiz of ["1abcDEF", "../x", null, 42, "toString", DRIVE_COMPARTILHADO_GED]) {
      const { r, posts, gets, rpcs } = await verificar(raiz);
      expect([r.status, corpo(r)]).toEqual([400, { erro: "raiz_invalida" }]);
      expect([posts, gets, rpcs]).toEqual([[], [], []]);
    }
  });

  it("não-admin: 403 sem ler o Drive", async () => {
    const { r, gets, posts } = await verificar(ELABORACAO, { admin: false });
    expect(r.status).toBe(403);
    expect([gets, posts]).toEqual([[], []]);
  });

  it("resumo da 5.2.4.1 só na resposta; Drive compartilhado; auditoria e log sem nomes", async () => {
    const { r, gets, rpcs, logs } = await verificar(ELABORACAO);
    const v = corpo(r);
    expect(r.status).toBe(200);
    expect(v).toMatchObject({
      raiz: "Elaboração: 02 - COMERCIAL / 02 - CONTRATOS", itens: 6, truncada: false,
      candidatasDentro: ["Elaboração (alternativa): 02 - CONTRATOS / Contratos"],
      subpastasNivel1: ["Contratos"], subpastasNivel2: ["Venda"], temporarios: ["~WRL0001.tmp"],
      porNivel: [{ profundidade: 0, pastas: 0, arquivos: 1 }, { profundidade: 1, pastas: 1, arquivos: 1 }, { profundidade: 2, pastas: 1, arquivos: 0 },
        { profundidade: 3, pastas: 1, arquivos: 1 }],
    });
    for (const g of gets) {
      const u = new URL(g.url);
      expect([u.searchParams.get("corpora"), u.searchParams.get("driveId")]).toEqual(["drive", DRIVE_COMPARTILHADO_GED]);
    }
    const aud = rpcs.filter((x) => x.nome === "ged_registrar_verificacao_raiz").map((x) => x.args);
    expect(aud).toEqual([{ p_perfil: PERFIL, p_raiz: ELABORACAO, p_itens: 6, p_resultado: "ok" }]);
    expect(logs).toEqual(["ged-verificacao: resultado=ok itens=6"]);
    expect(JSON.stringify(aud) + logs.join()).not.toMatch(/Contratos|Venda|ficticio|WRL/);
  });

  it("teto de pastas abertas: leitura marcada como incompleta", async () => {
    const muitas = (url: string) =>
      new Response(JSON.stringify({ files: Array.from({ length: 6 }, (_, i) => pasta(`${maeDe(url)}_${i}`, `p${i}`)) }), { status: 200 });
    const { r, gets } = await verificar(ELABORACAO, { drive: muitas });
    expect(corpo(r).truncada).toBe(true);
    expect(gets.length).toBeLessThanOrEqual(LIMITE_VERIFICACAO.maxPastasAbertas);
  });

  it("prazo de 90 s: ao vencer, para e marca a leitura como incompleta (sem estourar o tempo da função)", async () => {
    let agora = 0;
    const t = deps({ drive });
    t.d.agoraMs = () => (agora += 50_000); // cada consulta ao relógio avança 50 s
    const r = corpo(await tratarVerificacaoRaiz({ method: "POST", jwt: "jwt", raiz: ELABORACAO }, t.d));
    expect(r.truncada).toBe(true);
    expect(t.gets.length).toBeLessThan(4);
    expect(r.limites.prazoMs).toBe(LIMITE_VERIFICACAO.prazoMs);
  });

  it("lê até 5 pastas ao mesmo tempo, sem passar disso", async () => {
    let emVoo = 0;
    let pico = 0;
    const largas = async (url: string) => {
      emVoo++;
      pico = Math.max(pico, emVoo);
      await new Promise((ok) => setTimeout(ok, 1));
      emVoo--;
      const mae = maeDe(url);
      const filhos = mae.split("_").length < 3 ? Array.from({ length: 8 }, (_, i) => pasta(`${mae}_${i}`, `p${i}`)) : [];
      return new Response(JSON.stringify({ files: filhos }), { status: 200 });
    };
    const t = deps();
    t.d.fetchDrive = (url) => largas(url);
    const r = corpo(await tratarVerificacaoRaiz({ method: "POST", jwt: "jwt", raiz: ELABORACAO }, t.d));
    expect(r.truncada).toBe(false);
    expect(pico).toBe(LIMITE_VERIFICACAO.paralelas);
    expect(r.subpastasNivel1).toEqual(Array.from({ length: 8 }, (_, i) => `p${i}`)); // ordem preservada
  });

  it("sem acesso à pasta (403): código próprio, auditado sem nomes", async () => {
    const { r, rpcs } = await verificar(ELABORACAO, { drive: () => new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 }) });
    expect([r.status, corpo(r)]).toEqual([502, { erro: "sem_permissao_drive" }]);
    expect(rpcs.filter((x) => x.nome === "ged_registrar_verificacao_raiz").map((x) => x.args.p_resultado)).toEqual(["sem_permissao_drive"]);
  });
});

describe("cadastro das pastas-raiz (A1a, 5.2; 0804)", () => {
  const ELABORACAO = "1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR";
  const DOSSIE = "1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak";
  const pastaDrive = (o: Record<string, unknown> = {}) => () =>
    new Response(JSON.stringify({ id: DOSSIE, name: "01 - PASTA FICTICIA", mimeType: "application/vnd.google-apps.folder",
      driveId: DRIVE_COMPARTILHADO_GED, trashed: false, ...o }), { status: 200 });
  const pedido = (raiz: unknown, extra: Record<string, unknown> = {}) =>
    ({ method: "POST", jwt: "jwt", raiz, area: "contratos", areas_leitura: ["comercial"], area_operacao: "contratos", ...extra });
  const cadastrar = (req: ReturnType<typeof pedido>, o: Parameters<typeof deps>[0] = {}) => {
    const t = deps({ drive: pastaDrive(), ...o });
    return tratarCadastroRaiz(req, t.d).then((r) => ({ r, ...t }));
  };

  it("só as duas raízes confirmadas: subpasta Contratos, ALUTEC e ID livre recusados antes de qualquer chamada", async () => {
    for (const raiz of ["1JOh-QFYw9uwNkxSAdPa6cLzOzIuOiT56", "pasta-alutec-ficticia", DRIVE_COMPARTILHADO_GED, null]) {
      const { r, posts, gets, rpcs } = await cadastrar(pedido(raiz));
      expect([r.status, corpo(r)]).toEqual([400, { erro: "raiz_invalida" }]);
      expect([posts, gets, rpcs]).toEqual([[], [], []]);
    }
  });

  it("áreas fora do formato: recusadas antes do Drive; não-admin: 403 sem ler o Drive", async () => {
    for (const extra of [{ area: 1 }, { areas_leitura: "comercial" }, { areas_leitura: [1] }, { area_operacao: null }]) {
      const { r, gets } = await cadastrar(pedido(DOSSIE, extra));
      expect([r.status, corpo(r), gets]).toEqual([400, { erro: "area_invalida" }, []]);
    }
    const { r, gets } = await cadastrar(pedido(DOSSIE), { admin: false });
    expect([r.status, gets]).toEqual([403, []]);
  });

  it("lê o nome no Drive (files.get, só GET, Drive compartilhado) e grava pela ged_cadastrar_raiz; log sem nome", async () => {
    const { r, gets, rpcs, logs } = await cadastrar(pedido(DOSSIE));
    expect([r.status, corpo(r)]).toEqual([201, { id: "raiz-uuid", nome: "01 - PASTA FICTICIA" }]);
    expect(gets).toHaveLength(1);
    const u = new URL(gets[0].url);
    expect(u.pathname).toBe(`/drive/v3/files/${DOSSIE}`);
    expect(u.searchParams.get("supportsAllDrives")).toBe("true");
    expect(rpcs.find((x) => x.nome === "ged_cadastrar_raiz")?.args).toEqual({
      p_perfil: PERFIL, p_drive_id: DOSSIE, p_nome: "01 - PASTA FICTICIA", p_drive_compartilhado_id: DRIVE_COMPARTILHADO_GED,
      p_area: "contratos", p_areas_leitura: ["comercial"], p_area_operacao: "contratos",
    });
    expect(logs).toEqual(["ged-cadastro: resultado=ok"]);
    expect(logs.join() + JSON.stringify(rpcs.filter((x) => x.nome !== "ged_cadastrar_raiz"))).not.toMatch(/FICTICIA|rt-ficticio|at-ficticio/);
  });

  it("pasta que não serve (outro Drive, lixeira, arquivo, ID trocado): 422 sem gravar", async () => {
    for (const o of [{ driveId: "outro-drive" }, { trashed: true }, { mimeType: "application/pdf" }, { id: ELABORACAO }, { name: " " }]) {
      const { r, rpcs } = await cadastrar(pedido(DOSSIE), { drive: pastaDrive(o) });
      expect([r.status, corpo(r)]).toEqual([422, { erro: "pasta_invalida" }]);
      expect(rpcs.map((x) => x.nome)).not.toContain("ged_cadastrar_raiz");
    }
  });

  it("Drive 403 e recusa do banco viram códigos fixos; mensagem técnica do banco não vaza", async () => {
    const semAcesso = await cadastrar(pedido(DOSSIE), { drive: () => new Response("{}", { status: 403 }) });
    expect([semAcesso.r.status, corpo(semAcesso.r)]).toEqual([502, { erro: "sem_permissao_drive" }]);
    for (const [mensagem, status, erro] of [
      ["ged:raiz_travada", 409, "raiz_travada"], ["ged:raiz_existente", 409, "raiz_existente"], ["ged:area_invalida", 409, "area_invalida"],
      ["ged:sem_permissao", 403, "sem_permissao"], ["duplicate key value violates unique constraint", 500, "banco"],
    ] as const) {
      const { r } = await cadastrar(pedido(DOSSIE), { cadastro: { data: null, error: { message: mensagem } } });
      expect([r.status, corpo(r)]).toEqual([status, { erro }]);
    }
  });
});
