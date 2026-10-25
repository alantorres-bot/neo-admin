// GED: primeira leitura controlada do Drive (só metadados) — tratarConsultaMetadados e consultarMetadados (Edge Function
// nucleo-ged-metadados). Tudo fictício: nenhuma credencial, conta, arquivo ou URL real.
import { describe, expect, it, vi } from "vitest";
import { ESCOPO_DRIVE_LEITURA, LIMITE_METADADOS, tratarConsultaMetadados, type DepsMetadados } from "../../../supabase/functions/_shared/ged";

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
  token?: () => Response; drive?: (url: string) => Response;
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
