import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, semAcesso: string, inativo: string;
let finConsulta: string, finOperador: string, rhOperador: string, rhConsulta: string, fiscalConsulta: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  semAcesso = await novoUsuario(db, "sem@neo.com");
  inativo = await novoUsuario(db, "inativo@neo.com", { financeiro: "gestor" }, { ativo: false });
  finConsulta = await novoUsuario(db, "fin.consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "fin.operador@neo.com", { financeiro: "operador" });
  rhOperador = await novoUsuario(db, "rh.operador@neo.com", { rh: "operador" });
  rhConsulta = await novoUsuario(db, "rh.consulta@neo.com", { rh: "consulta" });
  fiscalConsulta = await novoUsuario(db, "fiscal.consulta@neo.com", { fiscal: "consulta" });
  await q(`insert into empresas (razao_social, nome_curto, cnpj) values ('Neo Formas Ltda', 'Neo Formas', '00.000.000/0001-00')`);
});

describe("primeiro acesso", () => {
  it("o primeiro usuário vira admin_geral e os demais não", async () => {
    const r = await q(`select id, admin_geral, nome from perfis order by email`);
    const porId = Object.fromEntries(r.rows.map((x) => [x.id, x]));
    expect(porId[admin].admin_geral).toBe(true);
    expect(porId[semAcesso].admin_geral).toBe(false);
    expect(porId[semAcesso].nome).toBe("sem");
  });

  it("não permite desativar nem rebaixar o último admin_geral", async () => {
    await expect(q(`update perfis set admin_geral = false where id = $1`, [admin])).rejects.toThrow(/ao menos um administrador/);
    await expect(q(`update perfis set ativo = false where id = $1`, [admin])).rejects.toThrow(/ao menos um administrador/);
  });

  it("permite rebaixar quando existe outro admin_geral ativo", async () => {
    const outro = await novoUsuario(db, "admin2@neo.com");
    await q(`update perfis set admin_geral = true where id = $1`, [outro]);
    await q(`update perfis set admin_geral = false where id = $1`, [outro]);
  });
});

describe("sem login, sem permissão e inativo", () => {
  it("anon não lê nada", async () => {
    await expect(como(db, "anon", () => q(`select * from empresas`))).rejects.toThrow(/permission denied/);
    await expect(como(db, "anon", () => q(`select * from perfis`))).rejects.toThrow(/permission denied/);
  });

  it("usuário sem permissão em nenhuma área não vê empresas, configurações nem outros perfis", async () => {
    await como(db, semAcesso, async () => {
      expect((await q(`select * from empresas`)).rows).toHaveLength(0);
      expect((await q(`select * from configuracoes`)).rows).toHaveLength(0);
      const perfis = await q(`select id from perfis`);
      expect(perfis.rows.map((x) => x.id)).toEqual([semAcesso]);
    });
  });

  it("usuário inativo não enxerga nada, nem as áreas", async () => {
    await como(db, inativo, async () => {
      expect((await q(`select * from areas`)).rows).toHaveLength(0);
      expect((await q(`select * from empresas`)).rows).toHaveLength(0);
    });
  });

  it("usuário ativo vê as áreas e os módulos (para montar o menu)", async () => {
    await como(db, semAcesso, async () => {
      expect((await q(`select * from areas`)).rows).toHaveLength(7); // 6 do núcleo + Produção (0006)
      expect((await q(`select * from modulos`)).rows.length).toBeGreaterThan(10);
    });
  });
});

describe("permissões, empresas e configurações", () => {
  it("só o admin_geral altera permissões; o usuário lê as próprias", async () => {
    await como(db, finOperador, async () => {
      await expect(q(`insert into permissoes (perfil_id, area, nivel) values ($1, 'juridico', 'gestor')`, [finOperador])).rejects.toThrow(/row-level security/);
      const r = await q(`select area, nivel from permissoes`);
      expect(r.rows).toEqual([{ area: "financeiro", nivel: "operador" }]);
    });
    await como(db, admin, async () => {
      await q(`insert into permissoes (perfil_id, area, nivel) values ($1, 'administrativo', 'consulta')`, [semAcesso]);
    });
    await q(`delete from permissoes where perfil_id = $1`, [semAcesso]);
  });

  it("consulta lê empresas mas não grava; admin grava", async () => {
    await como(db, finConsulta, async () => {
      expect((await q(`select * from empresas`)).rows).toHaveLength(1);
      await expect(q(`insert into empresas (razao_social, nome_curto) values ('X', 'X')`)).rejects.toThrow(/row-level security/);
    });
    await como(db, finOperador, async () => {
      await expect(q(`insert into empresas (razao_social, nome_curto) values ('X', 'X')`)).rejects.toThrow(/row-level security/);
    });
    await como(db, admin, async () => {
      await q(`insert into empresas (razao_social, nome_curto) values ('Neo Serviços Ltda', 'Neo Serviços')`);
    });
  });

  it("configurações: leitura para quem tem área; escrita só do admin_geral", async () => {
    await como(db, finOperador, async () => {
      expect((await q(`select * from configuracoes where chave = 'modo_rascunho'`)).rows).toHaveLength(1);
      const r = await q(`update configuracoes set valor = 'false' where chave = 'modo_rascunho'`);
      expect(r.affectedRows).toBe(0);
    });
    expect((await q(`select valor from configuracoes where chave = 'modo_rascunho'`)).rows[0].valor).toBe(true);
  });
});

describe("contrapartes e contatos", () => {
  let cliente: string, colaborador: string;

  it("operador de qualquer área cria cliente; consulta não", async () => {
    await como(db, finOperador, async () => {
      const r = await q(`insert into contrapartes (nome, documento, tipos) values ('Construtora Alfa', '11.111.111/0001-11', '{cliente}') returning id`);
      cliente = r.rows[0].id;
    });
    await como(db, finConsulta, async () => {
      await expect(q(`insert into contrapartes (nome, tipos) values ('Beta', '{cliente}')`)).rejects.toThrow(/row-level security/);
    });
  });

  it("colaborador: operador do financeiro não cria nem converte; operador do rh cria", async () => {
    await como(db, finOperador, async () => {
      await expect(q(`insert into contrapartes (nome, tipos) values ('João Silva', '{colaborador}')`)).rejects.toThrow(/row-level security/);
      // não pode transformar um cliente existente em colaborador para escapar da regra
      await expect(q(`update contrapartes set tipos = '{cliente,colaborador}' where id = $1`, [cliente])).rejects.toThrow(/row-level security/);
    });
    await como(db, rhOperador, async () => {
      colaborador = (await q(`insert into contrapartes (nome, tipos) values ('João Silva', '{colaborador}') returning id`)).rows[0].id;
      await q(`insert into contrapartes (nome, tipos) values ('Maria Souza', '{fornecedor,colaborador}')`);
    });
  });

  it("colaborador só é visível para quem tem a área rh (inclui tipos mistos)", async () => {
    const nomes = async (quem: string) =>
      (await como(db, quem, () => q(`select nome from contrapartes order by nome`))).rows.map((x) => x.nome);
    expect(await nomes(finConsulta)).toEqual(["Construtora Alfa"]);
    expect(await nomes(fiscalConsulta)).toEqual(["Construtora Alfa"]);
    expect(await nomes(rhConsulta)).toEqual(["Construtora Alfa", "João Silva", "Maria Souza"]);
    expect(await nomes(admin)).toEqual(["Construtora Alfa", "João Silva", "Maria Souza"]);
    expect(await nomes(semAcesso)).toEqual([]);
  });

  it("rh em modo consulta não edita colaborador; sem delete para ninguém", async () => {
    await como(db, rhConsulta, async () => {
      expect((await q(`update contrapartes set observacoes = 'x' where id = $1`, [colaborador])).affectedRows).toBe(0);
    });
    await como(db, rhOperador, async () => {
      expect((await q(`update contrapartes set observacoes = 'ok' where id = $1`, [colaborador])).affectedRows).toBe(1);
    });
    await como(db, admin, async () => {
      expect((await q(`delete from contrapartes where id = $1`, [cliente])).affectedRows).toBe(0);
    });
  });

  it("contato segue a regra da contraparte", async () => {
    await como(db, finOperador, async () => {
      await q(`insert into contatos (contraparte_id, nome, email) values ($1, 'Ana (financeiro)', 'ana@alfa.com')`, [cliente]);
      await expect(q(`insert into contatos (contraparte_id, nome) values ($1, 'Pessoal')`, [colaborador])).rejects.toThrow(/row-level security/);
    });
    await como(db, rhOperador, async () => {
      await q(`insert into contatos (contraparte_id, nome, whatsapp) values ($1, 'João', '+5565999999999')`, [colaborador]);
    });
    const nomes = async (quem: string) =>
      (await como(db, quem, () => q(`select nome from contatos order by nome`))).rows.map((x) => x.nome);
    expect(await nomes(finConsulta)).toEqual(["Ana (financeiro)"]);
    expect(await nomes(rhConsulta)).toEqual(["Ana (financeiro)", "João"]);
    await como(db, finConsulta, async () => {
      expect((await q(`update contatos set nome = 'x' where contraparte_id = $1`, [cliente])).affectedRows).toBe(0);
    });
  });
});

describe("usuarios_da_area", () => {
  it("só o gestor da área lista quem pode receber pendências", async () => {
    const gestor = await novoUsuario(db, "fin.gestor@neo.com", { financeiro: "gestor" });
    await como(db, gestor, async () => {
      const nomes = (await q(`select nome from usuarios_da_area('financeiro')`)).rows.map((x) => x.nome);
      expect(nomes).toEqual(expect.arrayContaining(["admin", "fin.gestor", "fin.operador"]));
      expect(nomes).not.toContain("fin.consulta");
      expect(nomes).not.toContain("inativo");
    });
    await como(db, finOperador, async () => {
      expect((await q(`select * from usuarios_da_area('financeiro')`)).rows).toHaveLength(0);
    });
  });
});
