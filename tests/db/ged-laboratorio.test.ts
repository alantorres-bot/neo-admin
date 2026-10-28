// GED — testes de LABORATÓRIO no PGlite, sem migration do GED (ainda bloqueada: GED-P3/P13/P17 e PENDENTES da seção 13).
// As tabelas `lab_*` são criadas só aqui, em memória, para comprovar:
//   1. os fatos de Postgres/Supabase em que se apoia a recomendação da GED-P17 (proposta, NÃO aprovada);
//   2. que a gravação em três passos de `_shared/ged.ts` funciona com chaves estrangeiras, transação e repetição.
// O esquema `lab_*` NÃO é o modelo aprovado nem uma proposta de migration.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";
import {
  cargaInicial,
  criarClienteDrive,
  documentosParaGravar,
  MIME_PASTA,
  pastasParaGravar,
  revisoesParaGravar,
  type ArquivoDrive,
  type EstadoIndice,
  type PastaIndice,
} from "../../supabase/functions/_shared/ged";

let db: PGlite;
let admin: string, comum: string;
const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const ddl = (sql: string) => db.exec(sql);
const negado = async (fn: () => Promise<unknown>) => expect(fn()).rejects.toThrow(/permission denied/);

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@exemplo.com"); // o primeiro vira admin geral
  comum = await novoUsuario(db, "comum@exemplo.com", { contratos: "consulta" });
}, 120_000);

describe("GED-P17 — fatos que sustentam a recomendação (laboratório)", () => {
  it("permissão por coluna é desfeita em silêncio por um grant de tabela posterior", async () => {
    await ddl(`create table lab_coluna (id int primary key, nome text, segredo text);
             insert into lab_coluna values (1, 'raiz', 'token-ficticio');
             alter table lab_coluna enable row level security;
             create policy lab_ler on lab_coluna for select to authenticated using (true);
             revoke select on lab_coluna from authenticated;
             grant select (id, nome) on lab_coluna to authenticated;`);
    expect((await como(db, comum, () => q(`select id, nome from lab_coluna`))).rows).toHaveLength(1);
    await negado(() => como(db, comum, () => q(`select segredo from lab_coluna`)));
    await negado(() => como(db, comum, () => q(`select * from lab_coluna`))); // o "select=*" da API passa a falhar

    await q(`grant select on lab_coluna to authenticated`); // ex.: uma migration futura, sem intenção
    const vazou = await como(db, comum, () => q(`select segredo from lab_coluna`));
    expect(vazou.rows[0].segredo).toBe("token-ficticio");
  });

  it("view security_invoker não esconde coluna: quem lê a view lê a tabela base inteira", async () => {
    await ddl(`create table lab_base (id int primary key, nome text, segredo text);
             insert into lab_base values (1, 'raiz', 'token-ficticio');
             alter table lab_base enable row level security;
             create policy lab_ler on lab_base for select to authenticated using (true);
             create view lab_vw with (security_invoker = true) as select id, nome from lab_base;`);
    expect((await como(db, comum, () => q(`select * from lab_vw`))).rows[0]).toEqual({ id: 1, nome: "raiz" });
    const direto = await como(db, comum, () => q(`select segredo from lab_base`));
    expect(direto.rows[0].segredo).toBe("token-ficticio");
  });

  it("tabela separada sem política e com revoke all: usuário não lê nem grava; só a função do admin projeta", async () => {
    await ddl(`create table lab_operacional (id int primary key, nome text);
             create table lab_protegido (raiz_id int primary key references lab_operacional, page_token text, verificacao jsonb);
             insert into lab_operacional values (1, 'raiz');
             insert into lab_protegido values (1, 'token-ficticio', '{"pastas": 3}');
             alter table lab_protegido enable row level security;
             revoke all on lab_protegido from authenticated, anon;
             create function lab_resumo_admin() returns table (raiz_id int, pastas int)
               language sql stable security definer set search_path = public as $$
               select raiz_id, (verificacao->>'pastas')::int from lab_protegido where eh_admin_geral() $$;
             revoke all on function lab_resumo_admin() from public, anon;
             grant execute on function lab_resumo_admin() to authenticated;`);
    await negado(() => como(db, comum, () => q(`select * from lab_protegido`)));
    await negado(() => como(db, comum, () => q(`update lab_protegido set page_token = 'x'`)));
    await negado(() => como(db, comum, () => q(`insert into lab_protegido values (2, 'x', null)`)));
    expect((await como(db, comum, () => q(`select * from lab_resumo_admin()`))).rows).toEqual([]);
    expect((await como(db, admin, () => q(`select * from lab_resumo_admin()`))).rows).toEqual([{ raiz_id: 1, pastas: 3 }]);
    // nem a função de projeção devolve o page_token, nem para o admin
    expect(Object.keys((await como(db, admin, () => q(`select * from lab_resumo_admin()`))).rows[0])).not.toContain("page_token");
  });
});

describe("A0 — revisão de segurança do plano (laboratório)", () => {
  it("fn_auditoria do projeto exige id uuid: tabela com id smallint (plano original) falha em toda gravação", async () => {
    await ddl(`create table lab_conexao_smallint (id smallint primary key default 1 check (id = 1), email text);
               create trigger lab_aud after insert or update on lab_conexao_smallint for each row execute function fn_auditoria();`);
    await expect(q(`insert into lab_conexao_smallint (email) values ('conta@exemplo.invalid')`)).rejects.toThrow(/uuid/);
  });

  it("fn_auditoria copia a linha inteira: segredo_id iria para a auditoria, que o admin geral lê", async () => {
    await ddl(`create table lab_conexao (id uuid primary key default gen_random_uuid(), email text, segredo_id uuid);
               create trigger lab_aud after insert on lab_conexao for each row execute function fn_auditoria();`);
    await q(`insert into lab_conexao (email, segredo_id) values ('conta@exemplo.invalid', '00000000-0000-0000-0000-000000000001')`);
    const lido = await como(db, admin, () => q(`select depois from auditoria where tabela = 'lab_conexao'`));
    expect(lido.rows[0].depois.segredo_id).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("função nova em public nasce executável por anon e authenticated; revogar só de PUBLIC não basta", async () => {
    await ddl(`create function lab_so_servico() returns int language sql security definer set search_path = public as $$ select 1 $$;
               revoke all on function lab_so_servico() from public;`);
    const r = await q(`select has_function_privilege('anon', 'lab_so_servico()', 'execute') a,
                              has_function_privilege('authenticated', 'lab_so_servico()', 'execute') b`);
    expect(r.rows[0]).toEqual({ a: true, b: true });
    await ddl(`revoke all on function lab_so_servico() from anon, authenticated; grant execute on function lab_so_servico() to service_role;`);
    const s = await q(`select has_function_privilege('anon', 'lab_so_servico()', 'execute') a,
                              has_function_privilege('authenticated', 'lab_so_servico()', 'execute') b,
                              has_function_privilege('service_role', 'lab_so_servico()', 'execute') c`);
    expect(s.rows[0]).toEqual({ a: false, b: false, c: true });
  });

  it("segredo criado numa função que falha depois é desfeito junto (mesma transação; Vault mínimo de teste)", async () => {
    await ddl(`create schema if not exists lab_vault;
               create table lab_vault.secrets (id uuid primary key default gen_random_uuid(), secret text);
               create table lab_conexao_unica (id uuid primary key default gen_random_uuid(), segredo_id uuid not null, email text not null);
               create function lab_concluir(p_email text, p_token text) returns void language plpgsql security definer set search_path = public as $$
               declare v uuid;
               begin
                 insert into lab_vault.secrets (secret) values (p_token) returning id into v;
                 insert into lab_conexao_unica (segredo_id, email) values (v, p_email); -- email nulo viola not null
               end $$;`);
    await expect(q(`select lab_concluir(null, 'token-ficticio')`)).rejects.toThrow(/null value/);
    expect((await q(`select count(*)::int n from lab_vault.secrets`)).rows[0].n).toBe(0);
  });

  it("desenho revisado no Postgres: check do destino com lookahead e linha única por coluna 'unica'", async () => {
    await ddl(`create table lab_estados (destino text not null check (destino ~ '^/(?!/)[a-z0-9_-]+(/[a-z0-9_-]+)*$'));
               create table lab_unica (id uuid primary key default gen_random_uuid(), unica boolean not null default true unique check (unica));`);
    await q(`insert into lab_estados values ('/configuracoes/documentos')`);
    for (const ruim of ["//evil", "/\\evil", "/a/../b", "https://evil", "/%2F%2Fevil"]) {
      await expect(q(`insert into lab_estados values ($1)`, [ruim]), ruim).rejects.toThrow(/check constraint/);
    }
    await q(`insert into lab_unica default values`);
    await expect(q(`insert into lab_unica default values`)).rejects.toThrow(/unique/);
    await expect(q(`insert into lab_unica (unica) values (false)`)).rejects.toThrow(/check constraint/);
  });

  it("o padrão de destino do plano original aceitaria '//host' (redirecionamento externo)", () => {
    const doPlano = /^\/[a-z0-9/_-]*$/;
    expect(doPlano.test("//evil")).toBe(true); // defeito do plano: precisa ser recusado
    const revisado = /^\/(?!\/)[a-z0-9_-]+(\/[a-z0-9_-]+)*$/;
    for (const ruim of ["//evil", "/\\evil", "/%2F%2Fevil", "/a\r\nLocation: x", "https://evil", "/a/../b", "/"]) expect(revisado.test(ruim), ruim).toBe(false);
    expect(revisado.test("/configuracoes/documentos")).toBe(true);
  });
});

describe("gravação em três passos com chaves estrangeiras (laboratório)", () => {
  const pasta = (id: string, mae: string): ArquivoDrive => ({ id, name: `Pasta ${id}`, mimeType: MIME_PASTA, parents: [mae] });
  const arq = (id: string, mae: string, rev = "r1"): ArquivoDrive => ({ id, name: `${id}.pdf`, mimeType: "application/pdf", parents: [mae], headRevisionId: rev });
  const RAIZ: PastaIndice = { driveId: "R", maeDriveId: null, nome: "Raiz", profundidade: 0, situacao: "ativa" };
  const indice = (): EstadoIndice => ({ pastas: new Map([["R", RAIZ]]), documentos: new Map(), profundidadeMax: 3 });
  const driveCom = (conteudo: Record<string, ArquivoDrive[]>) =>
    criarClienteDrive(async () => "token-ficticio", {
      fazerFetch: async (url) => {
        const u = new URL(url);
        if (u.pathname.endsWith("/startPageToken")) return new Response(JSON.stringify({ startPageToken: "s1" }), { status: 200 });
        const id = /^'([^']+)' in parents/.exec(u.searchParams.get("q") ?? "")?.[1] ?? "";
        return new Response(JSON.stringify({ files: conteudo[id] ?? [] }), { status: 200 });
      },
    });

  beforeAll(async () => {
    await ddl(`create table lab_pastas (id uuid primary key default gen_random_uuid(), raiz_id text not null, drive_id text unique not null,
               nome text, mae_drive_id text, profundidade int, situacao text not null);
             create table lab_documentos (id uuid primary key default gen_random_uuid(), origem text, drive_id text unique not null,
               raiz_id text not null, pasta_id uuid not null references lab_pastas, nome text, nome_normalizado text, mime text, extensao text,
               tamanho_bytes bigint, md5 text, drive_revisao text, criado_no_drive_em text, alterado_no_drive_em text, web_link text,
               atalho_para text, situacao text not null);
             create table lab_revisoes (documento_id uuid not null references lab_documentos, drive_revisao text not null,
               alterado_no_drive_em text, tamanho_bytes bigint, md5 text, primary key (documento_id, drive_revisao));`);
  });

  /** Grava como a Edge Function faria, numa transação: pastas → documentos → revisões. */
  async function gravar(resultados: Parameters<typeof pastasParaGravar>[0], falharNasRevisoes = false) {
    await db.transaction(async (tx) => {
      // A raiz entra como pasta para os documentos da raiz terem pasta_id (no modelo real ela é ged_pastas_raiz).
      await tx.query(`insert into lab_pastas (raiz_id, drive_id, nome, profundidade, situacao) values ('raiz-1', 'R', 'Raiz', 0, 'ativa')
                      on conflict (drive_id) do nothing`);
      for (const p of pastasParaGravar(resultados, "raiz-1")) {
        await tx.query(
          `insert into lab_pastas (raiz_id, drive_id, nome, mae_drive_id, profundidade, situacao) values ($1,$2,$3,$4,$5,$6)
           on conflict (drive_id) do update set nome = excluded.nome, situacao = excluded.situacao`,
          [p.raiz_id, p.drive_id, p.nome, p.mae_drive_id, p.profundidade, p.situacao],
        );
      }
      const idsPasta = new Map((await tx.query<Linha>(`select drive_id, id from lab_pastas`)).rows.map((r) => [r.drive_id, r.id]));
      for (const d of documentosParaGravar(resultados, "raiz-1", (id) => idsPasta.get(id))) {
        const cols = Object.keys(d);
        await tx.query(
          `insert into lab_documentos (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})
           on conflict (drive_id) do update set ${cols.filter((c) => c !== "drive_id").map((c) => `${c} = excluded.${c}`).join(",")}`,
          Object.values(d),
        );
      }
      if (falharNasRevisoes) throw new Error("falha simulada nas revisões");
      const idsDoc = new Map((await tx.query<Linha>(`select drive_id, id from lab_documentos`)).rows.map((r) => [r.drive_id, r.id]));
      for (const r of revisoesParaGravar(resultados, (id) => idsDoc.get(id))) {
        await tx.query(
          `insert into lab_revisoes values ($1,$2,$3,$4,$5) on conflict do nothing`,
          [r.documento_id, r.drive_revisao, r.alterado_no_drive_em, r.tamanho_bytes, r.md5],
        );
      }
    });
  }
  const contar = async () => (await q(`select (select count(*) from lab_pastas)::int p, (select count(*) from lab_documentos)::int d,
                                      (select count(*) from lab_revisoes)::int r`)).rows[0];

  it("falha no meio da gravação desfaz tudo (transação), sem pasta nem documento órfão", async () => {
    const carga = await cargaInicial(driveCom({ R: [pasta("A", "R")], A: [arq("d1", "A")] }), { driveId: "R" }, indice(), { maxItens: 100 });
    await expect(gravar(carga.resultados, true)).rejects.toThrow("falha simulada");
    expect(await contar()).toEqual({ p: 0, d: 0, r: 0 });
  });

  it("carga gravada duas vezes não duplica; revisão nova entra uma vez; nada é apagado", async () => {
    const conteudo = { R: [pasta("A", "R"), arq("d0", "R")], A: [pasta("A1", "A"), arq("d1", "A")], A1: [arq("d2", "A1")] };
    const primeira = await cargaInicial(driveCom(conteudo), { driveId: "R" }, indice(), { maxItens: 100 });
    await gravar(primeira.resultados);
    await gravar(primeira.resultados);
    expect(await contar()).toEqual({ p: 3, d: 3, r: 3 });

    const conteudo2 = { R: [pasta("A", "R"), arq("d0", "R")], A: [pasta("A1", "A"), arq("d1", "A", "r2")], A1: [arq("d2", "A1")] };
    const segunda = await cargaInicial(driveCom(conteudo2), { driveId: "R" }, indice(), { maxItens: 100 });
    await gravar(segunda.resultados);
    expect(await contar()).toEqual({ p: 3, d: 3, r: 4 });
    const d1 = await q(`select d.drive_revisao, p.drive_id as pasta from lab_documentos d join lab_pastas p on p.id = d.pasta_id where d.drive_id = 'd1'`);
    expect(d1.rows[0]).toEqual({ drive_revisao: "r2", pasta: "A" });
  });

  it("a chave estrangeira recusa documento com pasta inexistente (segunda barreira contra órfãos)", async () => {
    await expect(
      q(`insert into lab_documentos (drive_id, raiz_id, pasta_id, situacao) values ('orfao', 'raiz-1', gen_random_uuid(), 'vigente')`),
    ).rejects.toThrow(/foreign key/);
  });
});
