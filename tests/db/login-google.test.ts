// Migration 0007: perfil criado a partir da conta Google e troca de senha pendente que só prende sessão por senha.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

async function usuarioDoGoogle(email: string, meta: Record<string, string>): Promise<string> {
  // Conta criada pelo login Google: sem senha, metadados que o Google envia (full_name/name).
  const r = await q(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, JSON.stringify(meta)]);
  return r.rows[0].id as string;
}

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neoformas.com.br");
  await q(`insert into empresas (razao_social, nome_curto) values ('Neo Formas Ltda', 'Neo Formas')`);
});

describe("perfil criado a partir da conta Google", () => {
  it("usa full_name quando o admin não informou nome", async () => {
    const id = await usuarioDoGoogle("maria@neoformas.com.br", { full_name: "Maria Silva", name: "Maria" });
    expect((await q(`select nome from perfis where id = $1`, [id])).rows[0].nome).toBe("Maria Silva");
  });

  it("o nome dado pelo admin vence o do Google", async () => {
    const id = await usuarioDoGoogle("joao@neoformas.com.br", { nome: "João da Contabilidade", full_name: "Joao Souza" });
    expect((await q(`select nome from perfis where id = $1`, [id])).rows[0].nome).toBe("João da Contabilidade");
  });

  it("sem nome nenhum, fica o começo do e-mail", async () => {
    const id = await usuarioDoGoogle("logistica@neoformas.com.br", {});
    expect((await q(`select nome from perfis where id = $1`, [id])).rows[0].nome).toBe("logistica");
  });

  it("nasce sem permissões e sem troca de senha pendente", async () => {
    const id = await usuarioDoGoogle("novo@neoformas.com.br", { full_name: "Novo" });
    const p = (await q(`select admin_geral, deve_trocar_senha from perfis where id = $1`, [id])).rows[0];
    expect(p).toEqual({ admin_geral: false, deve_trocar_senha: false });
    expect((await q(`select * from permissoes where perfil_id = $1`, [id])).rows).toHaveLength(0);
  });
});

describe("troca de senha pendente × forma de entrar", () => {
  let forcado: string;

  beforeAll(async () => {
    forcado = await novoUsuario(db, "forcado@neoformas.com.br", { financeiro: "gestor" }, { deveTrocarSenha: true });
  });

  it("por senha continua sem acesso a nada", async () => {
    await como(db, forcado, async () => {
      expect((await q(`select usuario_ativo() as v`)).rows[0].v).toBe(false);
      expect((await q(`select nivel_area('financeiro') as v`)).rows[0].v).toBe("sem_acesso");
      expect((await q(`select tem_acesso_alguma_area() as v`)).rows[0].v).toBe(false);
      expect((await q(`select * from empresas`)).rows).toHaveLength(0);
    });
  });

  it("pelo Google entra normalmente, com as permissões que tem", async () => {
    await como(db, forcado, async () => {
      expect((await q(`select usuario_ativo() as v`)).rows[0].v).toBe(true);
      expect((await q(`select nivel_area('financeiro') as v`)).rows[0].v).toBe("gestor");
      expect((await q(`select nivel_area('fiscal') as v`)).rows[0].v).toBe("sem_acesso");
      expect((await q(`select tem_acesso_alguma_area('gestor') as v`)).rows[0].v).toBe(true);
      expect((await q(`select * from empresas`)).rows).toHaveLength(1);
    }, { oauth: true });
  });

  it("admin_geral com troca pendente: pelo Google tem poderes, por senha não", async () => {
    const admin2 = await novoUsuario(db, "admin2@neoformas.com.br", {}, { deveTrocarSenha: true });
    await q(`update perfis set admin_geral = true where id = $1`, [admin2]);
    await como(db, admin2, async () => {
      expect((await q(`select eh_admin_geral() as v`)).rows[0].v).toBe(false);
    });
    await como(db, admin2, async () => {
      expect((await q(`select eh_admin_geral() as v`)).rows[0].v).toBe(true);
      expect((await q(`select nivel_area('juridico') as v`)).rows[0].v).toBe("administrador");
    }, { oauth: true });
  });

  it("conta desativada não entra nem pelo Google", async () => {
    const inativo = await novoUsuario(db, "inativo@neoformas.com.br", { financeiro: "gestor" }, { ativo: false });
    await como(db, inativo, async () => {
      expect((await q(`select usuario_ativo() as v`)).rows[0].v).toBe(false);
      expect((await q(`select nivel_area('financeiro') as v`)).rows[0].v).toBe("sem_acesso");
    }, { oauth: true });
  });

  it("trocar a senha continua liberando a sessão por senha", async () => {
    await q(`update auth.users set encrypted_password = 'hash-novo' where id = $1`, [forcado]);
    await como(db, forcado, async () => {
      expect((await q(`select usuario_ativo() as v`)).rows[0].v).toBe(true);
    });
  });

  it("sem usuário logado (service role, auth.uid() nulo) as funções não liberam nada", async () => {
    await como(db, "service", async () => {
      expect((await q(`select usuario_ativo() as v`)).rows[0].v).toBe(false);
      expect((await q(`select eh_admin_geral() as v`)).rows[0].v).toBe(false);
    });
  });
});
