// GED — padronização de nomes (0811) de ponta a ponta: seleção dos próximos, gravação, decisões com histórico, acesso só do admin
// geral e o handler da Edge Function (tratarAnalise) contra o banco das migrations e um Drive SIMULADO que serve o conteúdo.
// Dados fictícios; nada vai ao Google.
import { beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { getDocumentProxy } from "unpdf";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";
import { pdfComTexto } from "../../lib/nucleo/ged/pdf-teste";
import {
  criarExtratores, ESCOPO_DRIVE_LEITURA, tratarAnalise, type DepsAnalise,
} from "../../supabase/functions/_shared/ged";

const DOSSIE = "1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak";
const ENV: Record<string, string> = {
  GED_DRIVE_CLIENT_ID: "cliente-ficticio.apps.googleusercontent.com", GED_DRIVE_CLIENT_SECRET: "segredo-cliente-ficticio",
  GED_DRIVE_REDIRECT_URI: "https://projeto-ficticio.supabase.co/functions/v1/nucleo-ged-conectar", NEO_ADMIN_URL: "https://neoadmin.exemplo.invalid",
};
let db: PGlite;
let admin: string, comum: string, raiz: string;
const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const negado = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied/);
const idDoc = async (drive: string) => (await q(`select id from ged_documentos where drive_id = $1`, [drive])).rows[0].id as string;
const decidir = (quem: string, doc: string, decisao: string, nome: string | null = null, motivo: string | null = null) =>
  como(db, quem, () => q(`select ged_decidir_analise($1, $2, $3, $4)`, [doc, decisao, nome, motivo]));

// Drive simulado: só serve conteúdo (alt=media) dos arquivos abaixo; registra cada pedido.
const conteudos = new Map<string, Uint8Array>();
const pedidos: URL[] = [];
async function docx(texto: string) {
  const z = new JSZip();
  z.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>${texto}</w:t></w:r></w:p></w:body></w:document>`);
  return z.generateAsync({ type: "uint8array" });
}
function deps(o: { admin?: boolean } = {}): DepsAnalise & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    env: (k) => ENV[k],
    agoraSeg: () => 1_800_000_000,
    perfilAdmin: async () => (o.admin === false ? null : admin),
    rpc: async (nome, args) => {
      if (nome === "ged_refresh_token") return { data: { refresh_token: "rt-ficticio" }, error: null };
      const nomes = Object.keys(args);
      const valores = nomes.map((k) => (args[k] !== null && typeof args[k] === "object" && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k]));
      const ehJson = (k: string) => k === "p_lote";
      try {
        const r = await como(db, "service", () => q(`select * from ${nome}(${nomes.map((k, i) => `${k} => $${i + 1}${ehJson(k) ? "::jsonb" : ""}`).join(", ")})`,
          valores.map((v, i) => (ehJson(nomes[i]) ? JSON.stringify(args[nomes[i]]) : v))));
        return { data: nome === "ged_proximos_para_analisar" ? r.rows : r.rows[0]?.[nome] ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
    fetch: (async () => new Response(JSON.stringify({ access_token: "at-ficticio", scope: `openid ${ESCOPO_DRIVE_LEITURA}` }), { status: 200 })) as unknown as DepsAnalise["fetch"],
    fetchDrive: async (url) => {
      const u = new URL(url);
      pedidos.push(u);
      const id = /\/files\/([^/]+)$/.exec(u.pathname)?.[1] ?? "";
      const corpo = u.searchParams.get("alt") === "media" ? conteudos.get(id) : undefined;
      return corpo ? new Response(corpo as BodyInit, { status: 200 }) : new Response("{}", { status: 404 });
    },
    esperar: async () => {},
    agoraMs: () => 0,
    cadastros: async () => ({
      clientes: (await q(`select id, nome, documento from contrapartes where 'cliente' = any(tipos)`)).rows as never,
      cnpjsProprios: ["17209767000128"],
    }),
    extratores: criarExtratores({ abrirPdf: (b) => getDocumentProxy(b), abrirZip: (b) => JSZip.loadAsync(b) }),
    log: (m) => logs.push(m),
  };
}
const analisar = (corpo: unknown, o: { admin?: boolean } = {}) => {
  const d = deps(o);
  return tratarAnalise({ method: "POST", jwt: "jwt", corpo }, d).then((r) => ({ status: r.status, corpo: JSON.parse(r.corpo ?? "null"), logs: d.logs }));
};

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@exemplo.invalid");
  comum = await novoUsuario(db, "comum@exemplo.invalid", { contratos: "gestor", comercial: "gestor" });
  await q(`insert into contrapartes (nome, documento, tipos) values ('ALFA CONSTRUTORA LTDA', '11.222.333/0001-81', '{cliente}')`);
  raiz = (await servico(`select ged_cadastrar_raiz($1, $2, 'Raiz ficticia', null, 'contratos', '{}', 'contratos') id`, [admin, DOSSIE])).rows[0].id;
  await servico(`select ged_registrar_verificacao_raiz($1, $2, 3, 'ok')`, [admin, DOSSIE]);
  await como(db, admin, () => q(`select ged_definir_situacao_raiz($1, 'ativa')`, [raiz]));
  await q(`update configuracoes set valor = 'true' where chave = 'administrativo.ged.indexar'`);
  // Índice fictício: pasta do cliente "Alfa" (nível 1) > "2º Jogo" (nível 2) com 4 arquivos.
  const rodada = (await servico(`select ged_iniciar_indexacao($1, 'inicial', false, null) id`, [raiz])).rows[0].id;
  const doc = (drive_id: string, nome: string, pasta: string, ext: string, extra: Record<string, unknown> = {}) =>
    ({ drive_id, pasta_drive_id: pasta, nome, nome_normalizado: nome.toLowerCase(), mime: "x", extensao: ext, situacao: "vigente", drive_revisao: "r1", tamanho_bytes: 100, ...extra });
  await servico(`select ged_gravar_indice($1, $2::jsonb, $3::jsonb)`, [rodada,
    JSON.stringify([
      { drive_id: DOSSIE, nome: "Raiz", mae_drive_id: null, profundidade: 0, situacao: "ativa" },
      { drive_id: "P1", nome: "Alfa", mae_drive_id: DOSSIE, profundidade: 1, situacao: "ativa" },
      { drive_id: "P2", nome: "2º Jogo", mae_drive_id: "P1", profundidade: 2, situacao: "ativa" },
    ]),
    JSON.stringify([
      doc("d-nf", "NF 794 - REM 02 ALFA.docx", "P2", "docx"),
      doc("d-scan", "scan0001.pdf", "P2", "pdf"),
      doc("d-zip", "contrato.zip", "P2", "zip"),
      doc("d-grande", "NF 900 - ALFA.pdf", "P2", "pdf", { tamanho_bytes: 50 * 1024 * 1024 }),
    ])]);
  await servico(`select ged_concluir_indexacao($1, '{}', 'tok', null)`, [rodada]);
  conteudos.set("d-scan", await pdfComTexto(""));                            // como um escaneado: PDF sem camada de texto
  conteudos.set("d-nf", await docx("DANFE NF-e Nº 000.000.794 Natureza da operação REMESSA DE FÔRMAS Destinatário 11.222.333/0001-81 Data de emissão 14/07/2025"));
}, 120_000);

describe("seleção e gravação (0811)", () => {
  it("próximos: vigentes sem análise, com a pasta, a pasta de 1º nível (cliente) e os nomes da pasta; no máximo 20", async () => {
    const r = (await servico(`select * from ged_proximos_para_analisar(50, null)`)).rows;
    expect(r).toHaveLength(4);
    expect(r[0]).toMatchObject({ pasta: "2º Jogo", pasta_nivel1: "Alfa", finalidade: "dossie_cliente" });
    expect([...r[0].nomes_na_pasta].sort()).toEqual(["NF 794 - REM 02 ALFA.docx", "NF 900 - ALFA.pdf", "contrato.zip", "scan0001.pdf"]);
    await negado(como(db, admin, () => q(`select * from ged_proximos_para_analisar(5, null)`)));
  });

  it("não-admin: 403 sem ler o Drive", async () => {
    const r = await analisar({ limite: 5 }, { admin: false });
    expect(r.status).toBe(403);
    expect(pedidos).toEqual([]);
  });

  it("rodada: baixa só o que tem texto (GET alt=media), sugere o nome, marca escaneado/zip/grande; log só com contagens", async () => {
    const r = await analisar({ limite: 20 });
    expect(r.corpo).toEqual({ analisados: 4, sugerida: 1, sem_texto: 1, nao_suportado: 2, erro: 0, pendentes: 0 });
    expect(pedidos.map((u) => [u.pathname.endsWith("/files/d-nf") || u.pathname.endsWith("/files/d-scan"), u.searchParams.get("alt")]))
      .toEqual([[true, "media"], [true, "media"]]);                               // zip e o arquivo grande nem são baixados
    const a = (await q(`select a.situacao, a.tipo, a.nome_sugerido, a.confianca, a.metodo, a.campos, a.contraparte_id is not null cadastro from ged_analises a
                          join ged_documentos d on d.id = a.documento_id where d.drive_id = 'd-nf'`)).rows[0];
    expect(a).toMatchObject({ situacao: "sugerida", tipo: "nf_remessa", confianca: "alta", metodo: "texto", cadastro: true,
      nome_sugerido: "NF REMESSA - 794 - Remessa 02 - ALFA CONSTRUTORA LTDA - 2025-07-14.docx" });
    expect(JSON.stringify(a.campos)).not.toMatch(/DANFE|Natureza/);           // o texto não é gravado
    const outros = Object.fromEntries((await q(`select d.drive_id, a.situacao, a.erro from ged_analises a join ged_documentos d on d.id = a.documento_id`)).rows
      .map((x) => [x.drive_id, [x.situacao, x.erro]]));
    expect(outros).toMatchObject({ "d-scan": ["sem_texto", null], "d-zip": ["nao_suportado", null], "d-grande": ["nao_suportado", "arquivo_grande"] });
    expect(r.logs).toEqual(["ged-analise: analisados=4 sugeridas=1 sem_texto=1 nao_suportado=2 erro=0 pendentes=0"]);
    expect((await servico(`select count(*)::int n from ged_proximos_para_analisar(20, null)`)).rows[0].n).toBe(0); // retomável: nada pendente
  });

  it("pedido inválido: mais de 20 ids ou id que não é uuid", async () => {
    expect((await analisar({ documentos: Array(21).fill("00000000-0000-0000-0000-000000000000") })).status).toBe(400);
    expect((await analisar({ documentos: ["x"] })).status).toBe(400);
  });
});

describe("decisões e histórico", () => {
  it("só o admin geral lê e decide; a tabela não aceita escrita direta nem delete", async () => {
    expect((await como(db, admin, () => q(`select count(*)::int n from ged_analises`))).rows[0].n).toBe(4);
    expect((await como(db, comum, () => q(`select count(*)::int n from ged_analises`))).rows[0].n).toBe(0);
    await expect(decidir(comum, await idDoc("d-nf"), "aprovar")).rejects.toThrow(/ged:sem_permissao/);
    await negado(como(db, admin, () => q(`update ged_analises set situacao = 'aprovada'`)));
    await expect(q(`delete from ged_analises`)).rejects.toThrow(/não podem ser excluídos/);
  });

  it("aprovar, editar (validado) e rejeitar (motivo obrigatório); cada decisão vai para a auditoria", async () => {
    const nf = await idDoc("d-nf");
    await decidir(admin, nf, "aprovar");
    expect((await q(`select situacao, nome_final from ged_analises where documento_id = $1`, [nf])).rows[0])
      .toEqual({ situacao: "aprovada", nome_final: "NF REMESSA - 794 - Remessa 02 - ALFA CONSTRUTORA LTDA - 2025-07-14.docx" });
    await expect(decidir(admin, nf, "editar", "NF: inválido.docx")).rejects.toThrow(/ged:nome_invalido/);
    await decidir(admin, nf, "editar", "NF REMESSA - 794 - Alfa.docx");
    const scan = await idDoc("d-scan");
    await expect(decidir(admin, scan, "rejeitar")).rejects.toThrow(/ged:motivo_obrigatorio/);
    await decidir(admin, scan, "rejeitar", null, "documento ilegível");
    const hist = (await q(`select acao, depois ->> 'situacao' situacao, usuario_id from auditoria where tabela = 'ged_analises' order by id`)).rows;
    expect(hist).toEqual([
      { acao: "aprovar", situacao: "aprovada", usuario_id: admin },
      { acao: "editar", situacao: "editada", usuario_id: admin },
      { acao: "rejeitar", situacao: "rejeitada", usuario_id: admin },
    ]);
  });

  it("nova análise da mesma revisão preserva a decisão; revisão nova reabre como sugestão", async () => {
    const nf = await idDoc("d-nf");
    await analisar({ documentos: [nf] });
    expect((await q(`select situacao, nome_final from ged_analises where documento_id = $1`, [nf])).rows[0])
      .toEqual({ situacao: "editada", nome_final: "NF REMESSA - 794 - Alfa.docx" });
    await q(`update ged_documentos set drive_revisao = 'r2' where id = $1`, [nf]);
    expect((await servico(`select documento_id from ged_proximos_para_analisar(20, null)`)).rows.map((x) => x.documento_id)).toEqual([nf]);
    await analisar({ limite: 20 });
    expect((await q(`select situacao, nome_final, drive_revisao from ged_analises where documento_id = $1`, [nf])).rows[0])
      .toEqual({ situacao: "sugerida", nome_final: null, drive_revisao: "r2" });
  });

  it("privilégios: seleção e gravação só da service role; decisão do usuário logado (a função confere o admin)", async () => {
    const esperado: Record<string, string[]> = {
      "ged_proximos_para_analisar(integer,uuid[])": ["service_role"],
      "ged_gravar_analises(jsonb)": ["service_role"],
      "ged_decidir_analise(uuid,text,text,text)": ["authenticated"],
    };
    for (const [fn, papeis] of Object.entries(esperado)) {
      for (const papel of ["anon", "authenticated", "service_role"]) {
        expect((await q(`select has_function_privilege($1, $2, 'execute') ok`, [papel, fn])).rows[0].ok, `${papel} → ${fn}`).toBe(papeis.includes(papel));
      }
    }
    await expect(servico(`select ged_gravar_analises('[{"situacao":"aprovada"}]'::jsonb)`)).rejects.toThrow(/ged:situacao_invalida/);
  });
});
