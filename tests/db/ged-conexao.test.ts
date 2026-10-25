// GED A0-conexão (migration 0801): tabelas protegidas, privilégios, state, PKCE, conta, escopos, Vault, auditoria saneada,
// desconexão. Dados fictícios; Vault mínimo como em filial-gmail-envio.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, comum: string, adminSenhaPendente: string;
let audDesde = 0; // a auditoria é imutável: cada teste lê só o que veio depois deste id
const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const CONTA = "ged.drive@exemplo.invalid";
const DRIVE = "https://www.googleapis.com/auth/drive.readonly";
const ESCOPOS = ["openid", "https://www.googleapis.com/auth/userinfo.email", DRIVE];

const iniciar = (quem: string, destino = "/configuracoes/documentos") =>
  como(db, quem, async () => (await q(`select ged_iniciar_conexao($1) s`, [destino])).rows[0].s as string, { oauth: true });
const servico = <T>(sql: string, p: unknown[] = []) => como(db, "service", async () => (await q(sql, p)).rows[0] as T);
const validar = (s: string) => servico<Linha>(`select ged_validar_estado($1) v`, [s]).then((r) => r.v);
const consumir = (s: string) => servico<Linha>(`select ged_consumir_estado($1) v`, [s]).then((r) => r.v);
const concluir = (s: string, o: { email?: string; sub?: string; escopos?: string[]; token?: string } = {}) =>
  servico<Linha>(`select ged_concluir_conexao($1, $2, $3, $4, $5) d`, [
    s, o.email ?? CONTA, o.sub ?? "sub-1", o.escopos ?? ESCOPOS, o.token ?? "rt-ficticio",
  ]).then((r) => r.d);
async function conectar(o: Parameters<typeof concluir>[1] = {}) {
  const s = await iniciar(admin);
  await consumir(s);
  return concluir(s, o);
}
const negado = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied/);

beforeAll(async () => {
  db = await criarBanco();
  await db.exec(`
    create schema if not exists vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text, name text unique, description text);
    create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(p_secret text, p_name text default null, p_description text default null) returns uuid
      language sql as $$ insert into vault.secrets (secret, name, description) values (p_secret, p_name, p_description) returning id $$;
    create function vault.update_secret(p_id uuid, p_secret text) returns void
      language sql as $$ update vault.secrets set secret = p_secret where id = p_id $$;
  `);
  admin = await novoUsuario(db, "admin@exemplo.invalid"); // primeiro usuário = admin geral
  comum = await novoUsuario(db, "comum@exemplo.invalid", { contratos: "gestor" });
  adminSenhaPendente = await novoUsuario(db, "admin2@exemplo.invalid", {}, { deveTrocarSenha: true });
  await q(`update perfis set admin_geral = true where id = $1`, [adminSenhaPendente]);
}, 120_000);

beforeEach(async () => {
  // Estado limpo por teste (como dono, contornando o bloqueio de delete só aqui, em memória).
  await db.exec(`alter table ged_conexao disable trigger trg_ged_conexao_sem_delete;
                 delete from ged_conexao; delete from ged_conexao_estados; delete from vault.secrets;
                 alter table ged_conexao enable trigger trg_ged_conexao_sem_delete;`);
  await q(`update configuracoes set valor = to_jsonb($1::text) where chave = 'administrativo.ged.conta'`, [CONTA]);
  audDesde = Number((await q(`select coalesce(max(id), 0) m from auditoria`)).rows[0].m);
});

describe("início e state", () => {
  it("admin inicia; state e verificador de 64 hex; não-admin e troca de senha pendente são recusados", async () => {
    const s = await iniciar(admin);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    const v = await validar(s);
    expect(v.code_verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(v).toMatchObject({ destino: "/configuracoes/documentos", conta: CONTA });
    await expect(iniciar(comum)).rejects.toThrow(/administrador geral/);
    await expect(como(db, adminSenhaPendente, () => q(`select ged_iniciar_conexao('/configuracoes/documentos')`))).rejects.toThrow(/administrador geral/);
  });

  it("sem conta configurada, não inicia", async () => {
    await q(`update configuracoes set valor = 'null' where chave = 'administrativo.ged.conta'`);
    await expect(iniciar(admin)).rejects.toThrow(/Configure a conta/);
  });

  it("destino só relativo: recusa //host, barra invertida, codificação, CRLF, absoluto e ..", async () => {
    for (const d of ["//evil", "/\\evil", "/%2F%2Fevil", "/a\r\nx", "https://evil.invalid/x", "/a/../b", "/"]) {
      await expect(iniciar(admin, d), JSON.stringify(d)).rejects.toThrow(/Destino inválido/);
    }
  });

  it("state vencido, consumido ou inexistente: validar e consumir dão nulo; segundo consumo dá nulo", async () => {
    const s = await iniciar(admin);
    expect(await consumir(s)).not.toBeNull();
    expect(await consumir(s)).toBeNull();
    expect(await validar(s)).toBeNull();
    const velho = await iniciar(admin);
    await q(`update ged_conexao_estados set criado_em = now() - interval '16 minutes' where state = $1`, [velho]);
    expect(await validar(velho)).toBeNull();
    expect(await consumir(velho)).toBeNull();
    expect(await consumir("0".repeat(64))).toBeNull();
  });

  it("perfil que perdeu o admin entre a ida e a volta é recusado", async () => {
    const s = await iniciar(admin);
    await q(`update perfis set admin_geral = false where id = $1`, [admin]);
    try {
      expect(await validar(s)).toBeNull();
      expect(await consumir(s)).toBeNull();
    } finally {
      await q(`update perfis set admin_geral = true where id = $1`, [admin]);
    }
  });

  it("limite de 5 conexões em andamento por perfil", async () => {
    for (let i = 0; i < 5; i++) await iniciar(admin);
    await expect(iniciar(admin)).rejects.toThrow(/Muitas tentativas/);
  });
});

describe("conclusão", () => {
  it("conecta: token só no Vault, linha sem token, auditoria saneada, destino devolvido", async () => {
    expect(await conectar()).toBe("/configuracoes/documentos");
    const c = (await q(`select * from ged_conexao`)).rows[0];
    expect(c).toMatchObject({ email: CONTA, google_sub: "sub-1", escopos: ESCOPOS });
    expect((await q(`select secret from vault.secrets where id = $1`, [c.segredo_id])).rows[0].secret).toBe("rt-ficticio");
    expect(JSON.stringify(c)).not.toContain("rt-ficticio");
    const aud = (await q(`select acao, depois, usuario_id from auditoria where tabela = 'ged_conexao' and id > $1`, [audDesde])).rows;
    expect(aud).toEqual([{ acao: "conectou", depois: { email: CONTA, escopos: ESCOPOS }, usuario_id: admin }]);
    expect(JSON.stringify(aud)).not.toMatch(/segredo_id|sub-1|rt-ficticio|code_verifier/);
  });

  it("exige state consumido, não concluído, consumido há no máximo 2 minutos", async () => {
    const s = await iniciar(admin);
    await expect(concluir(s)).rejects.toThrow(/ged:estado_invalido/); // não consumido
    await consumir(s);
    await q(`update ged_conexao_estados set consumido_em = now() - interval '3 minutes' where state = $1`, [s]);
    await expect(concluir(s)).rejects.toThrow(/ged:estado_invalido/);
    const s2 = await iniciar(admin);
    await consumir(s2);
    await concluir(s2);
    await expect(concluir(s2)).rejects.toThrow(/ged:estado_invalido/); // já concluído
  });

  it("conta divergente (inclusive com maiúsculas diferentes aceitas) e sem sub", async () => {
    await expect(conectar({ email: "outra@exemplo.invalid" })).rejects.toThrow(/ged:conta_divergente/);
    await expect(conectar({ sub: " " })).rejects.toThrow(/ged:identidade_invalida/);
    expect(await conectar({ email: "GED.Drive@Exemplo.invalid" })).toBe("/configuracoes/documentos");
  });

  it("escopos: a mais, a menos ou estranhos são recusados", async () => {
    await expect(conectar({ escopos: [...ESCOPOS, "https://www.googleapis.com/auth/drive"] })).rejects.toThrow(/ged:escopo_divergente/);
    await expect(conectar({ escopos: [...ESCOPOS, "https://www.googleapis.com/auth/drive.file"] })).rejects.toThrow(/ged:escopo_divergente/);
    await expect(conectar({ escopos: ["openid", "email"] })).rejects.toThrow(/ged:escopo_divergente/);
    await expect(conectar({ escopos: [DRIVE + "x"] })).rejects.toThrow(/ged:escopo_divergente/);
  });

  it("refresh token ausente é recusado e nada é gravado", async () => {
    await expect(conectar({ token: "" })).rejects.toThrow(/ged:token_ausente/);
    expect((await q(`select count(*)::int n from ged_conexao`)).rows[0].n).toBe(0);
    expect((await q(`select count(*)::int n from vault.secrets`)).rows[0].n).toBe(0);
  });

  it("reconexão da mesma conta atualiza o segredo existente; outra conta com conexão ativa é recusada (D-TROCA)", async () => {
    await conectar();
    const id1 = (await q(`select segredo_id from ged_conexao`)).rows[0].segredo_id;
    await conectar({ token: "rt-novo" });
    const r = (await q(`select segredo_id from ged_conexao`)).rows[0];
    expect(r.segredo_id).toBe(id1);
    expect((await q(`select secret from vault.secrets`)).rows).toEqual([{ secret: "rt-novo" }]);
    const acoes = await q(`select acao from auditoria where tabela = 'ged_conexao' and id > $1 order by id`, [audDesde]);
    expect(acoes.rows.map((x) => x.acao)).toEqual(["conectou", "substituiu"]);
    await expect(conectar({ sub: "sub-outra" })).rejects.toThrow(/ged:conta_divergente/);
  });

  it("falha do Vault: nada é gravado, nem a conclusão do state", async () => {
    await db.exec(`create or replace function vault.create_secret(p_secret text, p_name text default null, p_description text default null) returns uuid
                     language plpgsql as $$ begin raise exception 'vault indisponível'; end $$;`);
    try {
      const s = await iniciar(admin);
      await consumir(s);
      await expect(concluir(s)).rejects.toThrow(/vault indisponível/);
      expect((await q(`select count(*)::int n from ged_conexao`)).rows[0].n).toBe(0);
      expect((await q(`select concluido_em from ged_conexao_estados where state = $1`, [s])).rows[0].concluido_em).toBeNull();
    } finally {
      await db.exec(`create or replace function vault.create_secret(p_secret text, p_name text default null, p_description text default null) returns uuid
                       language sql as $$ insert into vault.secrets (secret, name, description) values (p_secret, p_name, p_description) returning id $$;`);
    }
  });

  it("falha depois de gravar o segredo e antes da linha: o segredo é desfeito junto", async () => {
    await db.exec(`create function lab_falhar() returns trigger language plpgsql as $$ begin raise exception 'falha simulada'; end $$;
                   create trigger lab_falhar before insert on ged_conexao for each row execute function lab_falhar();`);
    try {
      await expect(conectar()).rejects.toThrow(/falha simulada/);
      expect((await q(`select count(*)::int n from vault.secrets`)).rows[0].n).toBe(0);
    } finally {
      await db.exec(`drop trigger lab_falhar on ged_conexao; drop function lab_falhar();`);
    }
  });
});

describe("situação, erros e desconexão", () => {
  const situacao = (quem: string) => como(db, quem, async () => (await q(`select * from ged_situacao_conexao()`)).rows, { oauth: true });
  const desconectar = (perfil: string, rev = "ok") => servico(`select ged_desconectar($1, $2)`, [perfil, rev]);

  it("situação: admin vê sem segredo_id nem sub; os demais recebem vazio", async () => {
    await conectar();
    const s = await situacao(admin);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ email: CONTA, situacao: "conectada" });
    expect(Object.keys(s[0])).not.toEqual(expect.arrayContaining(["segredo_id"]));
    expect(JSON.stringify(s)).not.toMatch(/sub-1|rt-ficticio/);
    expect(await situacao(comum)).toEqual([]);
  });

  it("invalid_grant: com_erro; código fora da lista é recusado", async () => {
    await conectar();
    await servico(`select ged_registrar_erro_conexao('invalid_grant')`);
    expect((await situacao(admin))[0]).toMatchObject({ situacao: "com_erro", ultimo_erro: "invalid_grant" });
    await expect(servico(`select ged_registrar_erro_conexao('token: abc')`)).rejects.toThrow(/ged:codigo_invalido/);
  });

  it("0802: tentativa de conexão que falhou (com state) NÃO derruba a conexão ativa; só vai para a auditoria", async () => {
    await conectar();
    const s = await iniciar(admin);
    await consumir(s);
    await servico(`select ged_registrar_erro_conexao('conta_divergente', $1)`, [s]);
    expect((await situacao(admin))[0]).toMatchObject({ situacao: "conectada", ultimo_erro: null });
    expect((await q(`select acao, depois, usuario_id from auditoria where tabela = 'ged_conexao' and id > $1 and acao = 'tentativa_falhou'`, [audDesde])).rows).toEqual([
      { acao: "tentativa_falhou", depois: { codigo: "conta_divergente" }, usuario_id: admin },
    ]);
  });

  it("0802: consulta de metadados auditada só com contagem e resultado; perfil não-admin e código fora da lista recusados", async () => {
    await conectar();
    await servico(`select ged_registrar_consulta_metadados($1, 42, 'ok')`, [admin]);
    const aud = (await q(`select acao, depois, usuario_id from auditoria where tabela = 'ged_conexao' and acao = 'consultou_metadados' and id > $1`, [audDesde])).rows;
    expect(aud).toEqual([{ acao: "consultou_metadados", depois: { itens: 42, resultado: "ok" }, usuario_id: admin }]);
    await expect(servico(`select ged_registrar_consulta_metadados($1, 1, 'ok')`, [comum])).rejects.toThrow(/ged:sem_permissao/);
    await expect(servico(`select ged_registrar_consulta_metadados($1, 1, 'arquivo.pdf')`, [admin])).rejects.toThrow(/ged:codigo_invalido/);
    await negado(como(db, admin, () => q(`select ged_registrar_consulta_metadados($1, 1, 'ok')`, [admin]), { oauth: true }));
  });

  it("0803: verificação de raiz auditada só com a raiz candidata, contagem e resultado; ID fora da lista recusado", async () => {
    await conectar();
    await servico(`select ged_registrar_verificacao_raiz($1, '1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak', 12, 'ok')`, [admin]);
    expect((await q(`select depois, usuario_id from auditoria where tabela = 'ged_conexao' and acao = 'verificou_raiz' and id > $1`, [audDesde])).rows).toEqual([
      { depois: { raiz: "1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak", itens: 12, resultado: "ok" }, usuario_id: admin },
    ]);
    await expect(servico(`select ged_registrar_verificacao_raiz($1, 'outra-pasta', 1, 'ok')`, [admin])).rejects.toThrow(/ged:raiz_invalida/);
    await expect(servico(`select ged_registrar_verificacao_raiz($1, '1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak', 1, 'ok')`, [comum])).rejects.toThrow(/ged:sem_permissao/);
  });

  it("desconecta: apaga o segredo, preserva o registro, audita; repetir não faz nada; não-admin recusado", async () => {
    await conectar();
    await expect(desconectar(comum)).rejects.toThrow(/ged:sem_permissao/);
    await desconectar(admin, "falhou");
    await desconectar(admin, "ok");
    const c = (await q(`select segredo_id, desconectado_por, revogacao_remota from ged_conexao`)).rows;
    expect(c).toEqual([{ segredo_id: null, desconectado_por: admin, revogacao_remota: "falhou" }]);
    expect((await q(`select count(*)::int n from vault.secrets`)).rows[0].n).toBe(0);
    expect((await situacao(admin))[0].situacao).toBe("desconectada");
    expect((await q(`select acao, depois from auditoria where tabela = 'ged_conexao' and acao = 'desconectou' and id > $1`, [audDesde])).rows).toEqual([
      { acao: "desconectou", depois: { email: CONTA, revogacao_remota: "falhou" } },
    ]);
    await expect(q(`delete from ged_conexao`)).rejects.toThrow(/não podem ser excluídos|excluídos/);
    // depois de desconectado, outra conta pode conectar (troca explícita)
    expect(await conectar({ sub: "sub-nova" })).toBe("/configuracoes/documentos");
  });

  it("ged_perfil_admin_atual: id do admin logado; nulo para os demais", async () => {
    expect((await como(db, admin, () => q(`select ged_perfil_admin_atual() p`), { oauth: true })).rows[0].p).toBe(admin);
    expect((await como(db, comum, () => q(`select ged_perfil_admin_atual() p`), { oauth: true })).rows[0].p).toBeNull();
  });
});

describe("privilégios (GED-P17)", () => {
  it("usuários não leem nem gravam as tabelas protegidas", async () => {
    await conectar();
    for (const quem of [comum, admin]) {
      await negado(como(db, quem, () => q(`select * from ged_conexao`)));
      await negado(como(db, quem, () => q(`select * from ged_conexao_estados`)));
      await negado(como(db, quem, () => q(`update ged_conexao set email = 'x'`)));
      await negado(como(db, quem, () => q(`insert into ged_conexao_estados (state, perfil_id, destino, code_verifier) values ('x', $1, '/a', 'v')`, [quem])));
    }
    await negado(como(db, "anon", () => q(`select * from ged_conexao`)));
  });

  it("matriz de execução das funções por papel", async () => {
    const esperado: Record<string, string[]> = {
      "ged_iniciar_conexao(text)": ["authenticated"],
      "ged_situacao_conexao()": ["authenticated"],
      "ged_perfil_admin_atual()": ["authenticated"],
      "ged_validar_estado(text)": ["service_role"],
      "ged_consumir_estado(text)": ["service_role"],
      "ged_concluir_conexao(text,text,text,text[],text)": ["service_role"],
      "ged_registrar_erro_conexao(text,text)": ["service_role"],
      "ged_refresh_token()": ["service_role"],
      "ged_desconectar(uuid,text)": ["service_role"],
      "ged_registrar_consulta_metadados(uuid,integer,text)": ["service_role"],
      "ged_registrar_verificacao_raiz(uuid,text,integer,text)": ["service_role"],
      "ged_perfil_admin(uuid)": [],
      "ged_conta_configurada()": [],
    };
    for (const [fn, papeis] of Object.entries(esperado)) {
      for (const papel of ["anon", "authenticated", "service_role"]) {
        const r = await q(`select has_function_privilege($1, $2, 'execute') ok`, [papel, fn]);
        expect(r.rows[0].ok, `${papel} → ${fn}`).toBe(papeis.includes(papel));
      }
    }
  });

  it("a migration não dá grant a anon/authenticated nas tabelas protegidas", () => {
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "0801_ged_conexao.sql"), "utf8");
    expect(sql).not.toMatch(/grant\s+[^;]*\bon\s+(table\s+)?ged_conexao(_estados)?\b[^;]*\bto\s+[^;]*(anon|authenticated)/i);
  });
});
