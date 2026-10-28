// GED: indexação de ponta a ponta (tratarIndexacao, a mesma lógica da Edge Function nucleo-ged-indexar) contra o banco real das
// migrations (PGlite) e um Drive SIMULADO: paginação do files.list e do changes.list, falha no meio, repetição, duas raízes.
// Tudo fictício; nenhum Google, nenhuma credencial real.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";
import { ESCOPO_DRIVE_LEITURA, MIME_PASTA, tratarIndexacao, type ArquivoDrive, type DepsIndexacao } from "../../supabase/functions/_shared/ged";

const ELAB = "1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR";
const DOSSIE = "1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak";
const COMPARTILHADO = "0ADGzgMWcDLTWUk9PVA";
const SEGREDO = "s".repeat(40);
const ENV: Record<string, string> = {
  GED_DRIVE_CLIENT_ID: "cliente-ficticio.apps.googleusercontent.com",
  GED_DRIVE_CLIENT_SECRET: "segredo-cliente-ficticio",
  GED_DRIVE_REDIRECT_URI: "https://projeto-ficticio.supabase.co/functions/v1/nucleo-ged-conectar",
  NEO_ADMIN_URL: "https://neoadmin.exemplo.invalid",
  SINCRONIZACAO_SEGREDO: SEGREDO,
};

let db: PGlite;
let admin: string, ctrOperador: string, comercial: string;
const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

// ───────────── Drive simulado: árvore viva + registro de mudanças (changes.list) ─────────────
const POR_PAGINA = 2;
const arquivos = new Map<string, ArquivoDrive>();
const mudancas: string[] = [];                                           // ids alterados, em ordem; o token é o índice
let falharEm: ((u: URL) => boolean) | null = null;
let relogio = 0;
const logs: string[] = [];                                                // tudo o que a função registra no log                                                         // agoraMs: 0 = "antes" de tudo (nunca reconcilia)
const chamadas = { drive: 0, token: 0 };

const pasta = (id: string, mae: string): ArquivoDrive => ({ id, name: `Pasta ficticia ${id}`, mimeType: MIME_PASTA, parents: [mae] });
const arq = (id: string, mae: string, rev = "r1"): ArquivoDrive => ({
  id, name: `Documento ficticio ${id}.pdf`, mimeType: "application/pdf", parents: [mae], headRevisionId: rev, size: "10",
  modifiedTime: "2026-10-20T12:00:00.000Z", createdTime: "2026-10-01T12:00:00.000Z",
});
function mudar(f: ArquivoDrive) {
  arquivos.set(f.id, f);
  mudancas.push(f.id);
}
const pagina = (lista: unknown[], desde: number, chave: string, fim: Record<string, string>) => {
  const fatia = lista.slice(desde, desde + POR_PAGINA);
  const mais = desde + POR_PAGINA < lista.length;
  return new Response(JSON.stringify({ [chave]: fatia, ...(mais ? { nextPageToken: String(desde + POR_PAGINA) } : fim) }), { status: 200 });
};
async function driveSimulado(url: string): Promise<Response> {
  chamadas.drive++;
  const u = new URL(url);
  // Só metadados: qualquer pedido de conteúdo (download/exportação) reprova o teste.
  if (u.searchParams.has("alt") || u.pathname.includes("/export")) throw new Error("pedido de conteúdo do arquivo");
  if (falharEm?.(u)) return new Response("{}", { status: 500 });
  const umArquivo = /\/files\/([A-Za-z0-9_-]+)$/.exec(u.pathname)?.[1];
  if (umArquivo) {                                                       // files.get da reconciliação: 404 se sumiu
    const f = arquivos.get(umArquivo);
    return f ? new Response(JSON.stringify(f), { status: 200 }) : new Response(JSON.stringify({ error: { status: "NOT_FOUND" } }), { status: 404 });
  }
  if (u.pathname.endsWith("/changes/startPageToken")) return new Response(JSON.stringify({ startPageToken: String(mudancas.length) }), { status: 200 });
  if (u.pathname.endsWith("/changes")) {
    const desde = Number(u.searchParams.get("pageToken"));
    const lista = mudancas.map((id) => ({ fileId: id, file: arquivos.get(id) }));
    return pagina(lista, desde, "changes", { newStartPageToken: String(mudancas.length) });
  }
  const mae = /^'([^']+)' in parents/.exec(u.searchParams.get("q") ?? "")?.[1] ?? "";
  const filhos = [...arquivos.values()].filter((f) => f.parents?.includes(mae) && !f.trashed);
  return pagina(filhos, Number(u.searchParams.get("pageToken") ?? 0), "files", {});
}

function deps(): DepsIndexacao {
  return {
    env: (k) => ENV[k],
    agoraSeg: () => 1_800_000_000,
    perfilAdmin: async () => null,
    rpc: async (nome, args) => {
      if (nome === "ged_refresh_token") return { data: { refresh_token: "rt-ficticio" }, error: null };
      const nomes = Object.keys(args);
      const valores = nomes.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
      try {
        const r = await como(db, "service", () => q(`select ${nome}(${nomes.map((k, i) => `${k} => $${i + 1}`).join(", ")}) r`, valores));
        return { data: r.rows[0]?.r ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
    fetch: (async () => {
      chamadas.token++;
      return new Response(JSON.stringify({ access_token: "at-ficticio", scope: `openid ${ESCOPO_DRIVE_LEITURA}` }), { status: 200 });
    }) as unknown as DepsIndexacao["fetch"],
    fetchDrive: (url) => driveSimulado(url),
    esperar: async () => {},
    log: (m) => logs.push(m),
    agoraMs: () => relogio,
    raizesAtivas: async () =>
      (await q(`select id, drive_id, drive_compartilhado_id, page_token, indexada_em, reconciliada_em from ged_pastas_raiz where situacao = 'ativa' order by finalidade`)).rows
        .map((r) => ({
          id: r.id, driveId: r.drive_id, driveIdCompartilhado: r.drive_compartilhado_id, pageToken: r.page_token,
          indexadaEm: r.indexada_em?.toISOString() ?? null, reconciliadaEm: r.reconciliada_em?.toISOString() ?? null,
        })),
  };
}
const indexar = (segredo: string | null = SEGREDO) => tratarIndexacao({ method: "POST", segredo }, deps()).then((r) => ({ status: r.status, corpo: JSON.parse(r.corpo ?? "null") }));
const tokens = async () => Object.fromEntries((await q(`select finalidade, page_token from ged_pastas_raiz`)).rows.map((r) => [r.finalidade, r.page_token]));
const contagem = async () => (await q(`select (select count(*) from ged_pastas)::int pastas, (select count(*) from ged_documentos)::int docs, (select count(*) from ged_documento_revisoes)::int revisoes`)).rows[0];
const docs = async () => Object.fromEntries((await q(`select d.drive_id, d.situacao, d.nome, r.drive_id raiz from ged_documentos d join ged_pastas_raiz r on r.id = d.raiz_id`)).rows
  .map((x) => [x.drive_id, { situacao: x.situacao, raiz: x.raiz === ELAB ? "elab" : "dossie" }]));

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@exemplo.invalid");
  ctrOperador = await novoUsuario(db, "ctr.op@exemplo.invalid", { contratos: "operador" });
  comercial = await novoUsuario(db, "comercial@exemplo.invalid", { comercial: "consulta" });
  for (const [drive, leitura] of [[ELAB, []], [DOSSIE, ["comercial"]]] as const) {
    const id = (await como(db, "service", () => q(`select ged_cadastrar_raiz($1, $2, 'Raiz ficticia', $3, 'contratos', $4, 'contratos') id`,
      [admin, drive, COMPARTILHADO, leitura]))).rows[0].id;
    await como(db, "service", () => q(`select ged_registrar_verificacao_raiz($1, $2, 5, 'ok')`, [admin, drive]));
    await como(db, admin, () => q(`select ged_definir_situacao_raiz($1, 'ativa')`, [id]));
  }
  // Drive: elaboração com 1 subpasta e 5 arquivos (pagina em 2); dossiê com 2 clientes; uma pasta FORA das raízes.
  for (const f of [pasta("E1", ELAB), arq("e1", ELAB), arq("e2", ELAB), arq("e3", "E1"), arq("e4", "E1"), arq("e5", "E1"),
    pasta("C1", DOSSIE), pasta("C2", DOSSIE), arq("c1", "C1"), arq("c2", "C2"), pasta("FORA", COMPARTILHADO), arq("f1", "FORA")]) arquivos.set(f.id, f);
}, 120_000);

describe("indexação de ponta a ponta (5.3)", () => {
  it("segredo errado: 401; interruptor desligado: para sem nenhuma chamada ao Google", async () => {
    expect((await indexar("x".repeat(40))).status).toBe(401);
    expect((await indexar(null)).status).toBe(401);
    expect((await indexar()).corpo).toEqual({ parada: "indexacao_desligada", raizes: [] });
    expect(chamadas).toEqual({ drive: 0, token: 0 });
    expect((await q(`select count(*)::int n from ged_indexacoes`)).rows[0].n).toBe(0);
    await q(`update configuracoes set valor = 'true' where chave = 'administrativo.ged.indexar'`);
  });

  it("carga inicial das duas raízes, paginada; cada raiz com o seu ponto de continuação; nada de fora das raízes", async () => {
    mudar(arq("antes", "FORA")); // mudança anterior à carga: o token pego antes da leitura já a deixa para trás
    const r = await indexar();
    expect(r.corpo.raizes).toEqual([
      { tipo: "inicial", resultado: "ok", completa: true, itens: 4, novos: 2, alterados: 0, removidos: 0, ignorados: 0, pastas: 2 },
      { tipo: "inicial", resultado: "ok", completa: true, itens: 6, novos: 5, alterados: 0, removidos: 0, ignorados: 0, pastas: 1 },
    ]);
    // O mesmo resumo fica na rodada (observabilidade, sem nomes): itens examinados e leitura completa.
    expect((await q(`select resumo from ged_indexacoes where erro is null order by iniciada_em`)).rows.map((x) => [x.resumo.itens, x.resumo.completa]))
      .toEqual([[4, true], [6, true]]);
    expect(await tokens()).toEqual({ dossie_cliente: "1", elaboracao: "1" });
    expect(await contagem()).toEqual({ pastas: 5, docs: 7, revisoes: 7 }); // 2 raízes + E1 + C1 + C2
    const d = await docs();
    expect(Object.keys(d).sort()).toEqual(["c1", "c2", "e1", "e2", "e3", "e4", "e5"]);
    expect([d.e3.raiz, d.c1.raiz]).toEqual(["elab", "dossie"]);
    expect(JSON.stringify(r.corpo)).not.toMatch(/ficticia|ficticio|[A-Za-z0-9_-]{20,}/); // só contagens
  });

  it("repetição sem mudanças: nada novo, nada duplicado, token igual", async () => {
    const antes = await contagem();
    const r = await indexar();
    expect(r.corpo.raizes.map((x: Linha) => [x.tipo, x.resultado, x.novos, x.alterados])).toEqual([["incremental", "ok", 0, 0], ["incremental", "ok", 0, 0]]);
    expect(await contagem()).toEqual(antes);
    expect(await tokens()).toEqual({ dossie_cliente: "1", elaboracao: "1" });
  });

  it("incremental paginado: novo, renomeado com revisão nova, na lixeira e mudança fora das raízes; isolamento entre raízes", async () => {
    await q(`update ged_documentos set situacao = 'substituido' where drive_id = 'e5'`); // decisão de pessoa
    mudar(arq("e6", "E1"));
    mudar({ ...arq("c1", "C1", "r2"), name: "Documento ficticio c1 V2.pdf" });
    mudar({ ...arq("e2", ELAB), trashed: true });
    mudar(arq("f2", "FORA"));
    mudar({ ...arq("e5", "E1", "r2") });
    await indexar();
    const d = await docs();
    expect(d.e6).toEqual({ situacao: "vigente", raiz: "elab" });
    expect(d.e2.situacao).toBe("removido_no_drive");
    expect(d.e5.situacao).toBe("substituido");
    expect(d.f2).toBeUndefined();
    expect((await q(`select r.drive_revisao from ged_documento_revisoes r join ged_documentos d on d.id = r.documento_id where d.drive_id = 'c1' order by 1`)).rows
      .map((x) => x.drive_revisao)).toEqual(["r1", "r2"]);
    expect(await tokens()).toEqual({ dossie_cliente: "6", elaboracao: "6" });
    expect((await q(`select count(*)::int n from ged_documentos where drive_id in ('e6', 'e2', 'e5') and raiz_id <> (select id from ged_pastas_raiz where drive_id = $1)`, [ELAB])).rows[0].n).toBe(0);
  });

  it("falha no meio do changes.list: o que foi lido fica, o token NÃO avança; a próxima retoma sem duplicar", async () => {
    for (const id of ["e7", "e8", "e9", "e10"]) mudar(arq(id, "E1"));
    falharEm = (u) => u.pathname.endsWith("/changes") && u.searchParams.get("pageToken") === "8";
    const r = await indexar();
    expect(r.corpo.raizes.map((x: Linha) => [x.resultado, x.etapa])).toEqual([["drive", "leitura_drive"], ["drive", "leitura_drive"]]);
    expect((await q(`select resumo from ged_indexacoes where erro = 'drive' order by iniciada_em desc limit 1`)).rows[0].resumo)
      .toEqual({ completa: false, etapa: "leitura_drive" });
    expect(await tokens()).toEqual({ dossie_cliente: "6", elaboracao: "6" });
    expect((await q(`select erro from ged_indexacoes where concluida_em is not null order by iniciada_em desc limit 2`)).rows.map((x) => x.erro)).toEqual(["drive", "drive"]);
    expect(Object.keys(await docs())).toEqual(expect.arrayContaining(["e7", "e8"]));    // 1ª página gravada
    expect(Object.keys(await docs())).not.toContain("e9");
    falharEm = null;
    const antes = await contagem();
    await indexar();
    expect(await tokens()).toEqual({ dossie_cliente: "10", elaboracao: "10" });
    expect(await contagem()).toEqual({ ...antes, docs: antes.docs + 2, revisoes: antes.revisoes + 2 }); // só e9 e e10
    expect((await q(`select count(*)::int n from ged_trava where tomada_em is not null`)).rows[0].n).toBe(0);
  });

  it("a gravação dá certo mas a conclusão falha: o token não avança e a próxima rodada conclui sem duplicar", async () => {
    mudar(arq("e11", "E1"));
    const antes = { tokens: await tokens(), contagem: await contagem() };
    const d = deps();
    const rpc = d.rpc;
    let falhou = false;
    d.rpc = async (nome, args) => {
      if (nome === "ged_concluir_indexacao" && args.p_erro === null && !falhou) {
        falhou = true;
        return { data: null, error: { message: "falha simulada de rede" } };
      }
      return rpc(nome, args);
    };
    const r = await tratarIndexacao({ method: "POST", segredo: SEGREDO }, d);
    const corpo = JSON.parse(r.corpo ?? "null");
    expect(corpo.raizes.map((x: Linha) => [x.resultado, x.etapa])).toEqual([["falha", "conclusao"], ["ok", undefined]]);
    expect((await tokens()).dossie_cliente).toBe(antes.tokens.dossie_cliente);   // a 1ª raiz não avançou
    expect((await docs()).e11).toEqual({ situacao: "vigente", raiz: "elab" });       // a 2ª gravou e concluiu
    await indexar();
    expect(await tokens()).toEqual({ dossie_cliente: "11", elaboracao: "11" });
    expect((await contagem()).docs).toBe(antes.contagem.docs + 1);
  });

  it("outra rodada em andamento: para sem chamar o Google", async () => {
    const aberta = (await como(db, "service", () => q(`select ged_iniciar_indexacao((select id from ged_pastas_raiz where drive_id = $1), 'incremental', false, null) id`, [ELAB]))).rows[0].id;
    const antes = { ...chamadas };
    expect((await indexar()).corpo).toEqual({ parada: "em_andamento", raizes: [] });
    expect(chamadas).toEqual(antes);
    await como(db, "service", () => q(`select ged_concluir_indexacao($1, '{}', null, 'teste')`, [aberta]));
  });

  it("reconciliação semanal (5.3.4): acha o que o incremental perdeu, marca o sumido e não mexe no ponto de continuação", async () => {
    arquivos.delete("c2");                                               // apagado sem aparecer no changes.list
    arquivos.set("c3", arq("c3", "C2"));                                 // criado sem aparecer no changes.list
    relogio = Date.now() + 8 * 86_400_000;
    const r = await indexar();
    expect(r.corpo.raizes.map((x: Linha) => [x.tipo, x.resultado])).toEqual([["reconciliacao", "ok"], ["reconciliacao", "ok"]]);
    const d = await docs();
    expect(d.c2.situacao).toBe("removido_no_drive");
    expect(d.c3).toEqual({ situacao: "vigente", raiz: "dossie" });
    expect(await tokens()).toEqual({ dossie_cliente: "11", elaboracao: "11" });
    expect((await q(`select count(*)::int n from ged_pastas_raiz where reconciliada_em is not null`)).rows[0].n).toBe(2);
    relogio = Date.now() + 3_600_000;                                    // logo depois: volta ao incremental
    expect((await indexar()).corpo.raizes.map((x: Linha) => x.tipo)).toEqual(["incremental", "incremental"]);
  });

  it("autorização no resultado (0809): só o admin geral vê o que foi indexado; Contratos e Comercial, nada", async () => {
    const ver = (quem: string) => como(db, quem, () => q(`select drive_id from ged_documentos order by drive_id`)).then((r) => r.rows.map((x) => x.drive_id));
    expect((await ver(admin)).length).toBe((await q(`select count(*)::int n from ged_documentos`)).rows[0].n);
    expect(await ver(comercial)).toEqual([]);
    expect(await ver(ctrOperador)).toEqual([]);
  });

  it("log da função: só códigos e contagens; nunca o segredo, token, nome, id de arquivo ou link", () => {
    expect(logs.length).toBeGreaterThan(0);
    for (const linha of logs) {
      expect(linha).toMatch(/^ged-indexacao: (tipo=[a-z]+ )?resultado=[a-z_]+( [a-z]+=[a-z0-9_]+)*$/);
      expect(linha).not.toContain(SEGREDO);
      expect(linha).not.toMatch(/ficticio|ficticia|at-ficticio|rt-ficticio|https?:/);
    }
  });

  it("diagnóstico (scripts/ged-diagnostico.sql): estados inequívocos e nenhuma inconsistência por raiz", async () => {
    const [rodadas, raizes] = await db.exec(readFileSync(join(process.cwd(), "scripts", "ged-diagnostico.sql"), "utf8"));
    const estados = new Set(rodadas.rows.map((r) => (r as Linha).estado));
    expect([...estados].every((e) => ["concluida", "incompleta", "falha", "interrompida", "em_andamento", "esquecida", "orfa"].includes(e))).toBe(true);
    expect(estados.has("concluida")).toBe(true);
    expect(estados.has("falha")).toBe(true);
    for (const r of raizes.rows as Linha[]) {
      expect([r.token_sem_raiz_no_indice, r.carga_completa_sem_token, r.documento_fora_da_raiz], r.raiz).toEqual([false, false, false]);
      expect(r.rodadas_abertas).toBe(0);
    }
  });
});

