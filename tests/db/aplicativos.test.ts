import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, fiscalConsulta: string, finGestor: string, semAcesso: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  fiscalConsulta = await novoUsuario(db, "fiscal.consulta@neo.com", { fiscal: "consulta" });
  finGestor = await novoUsuario(db, "fin.gestor@neo.com", { financeiro: "gestor" });
  semAcesso = await novoUsuario(db, "sem@neo.com");
});

describe("aplicativos externos (migration 0006)", () => {
  it("carga inicial: área Produção e os dois aplicativos de hoje", async () => {
    expect((await q(`select codigo from areas where codigo = 'producao'`)).rows).toHaveLength(1);
    const apps = await q(`select codigo, area, abrir, ativo from aplicativos order by codigo`);
    expect(apps.rows).toEqual([
      { codigo: "neocontrol", area: "rh", abrir: "embutido", ativo: true },
      { codigo: "vigilancia_fiscal", area: "fiscal", abrir: "embutido", ativo: true },
    ]);
  });

  it("quem tem a área (consulta basta) lê só os apps dela; sem acesso não lê nada", async () => {
    await como(db, fiscalConsulta, async () => {
      expect((await q(`select codigo from aplicativos`)).rows).toEqual([{ codigo: "vigilancia_fiscal" }]);
    });
    await como(db, semAcesso, async () => {
      expect((await q(`select codigo from aplicativos`)).rows).toHaveLength(0);
    });
    await como(db, admin, async () => {
      expect((await q(`select codigo from aplicativos`)).rows).toHaveLength(2);
    });
  });

  it("só admin_geral cadastra, altera e desativa; gestor de área não", async () => {
    await como(db, finGestor, async () => {
      await expect(q(`insert into aplicativos (codigo, nome, area, url) values ('x_app', 'X App', 'financeiro', 'https://x.app')`))
        .rejects.toThrow(/row-level security/);
      expect((await q(`update aplicativos set ativo = false where codigo = 'vigilancia_fiscal'`)).affectedRows).toBe(0);
    });
    await como(db, admin, async () => {
      await q(`insert into aplicativos (codigo, nome, area, url, abrir, ordem) values ('producao_app', 'App da Produção', 'producao', 'https://producao.app', 'nova_aba', 3)`);
      await q(`update aplicativos set ativo = false where codigo = 'producao_app'`);
    });
    const r = await q(`select ativo from aplicativos where codigo = 'producao_app'`);
    expect(r.rows[0].ativo).toBe(false);
  });

  it("recusa código fora do padrão, endereço sem https e modo desconhecido; e fica na auditoria", async () => {
    await expect(q(`insert into aplicativos (codigo, nome, area, url) values ('Com Espaço', 'X', 'fiscal', 'https://x.app')`)).rejects.toThrow(/check/);
    await expect(q(`insert into aplicativos (codigo, nome, area, url) values ('inseguro', 'X', 'fiscal', 'http://x.app')`)).rejects.toThrow(/check/);
    await expect(q(`insert into aplicativos (codigo, nome, area, url, abrir) values ('popup', 'X', 'fiscal', 'https://x.app', 'popup')`)).rejects.toThrow(/check/);
    // a carga inicial da migration também é auditada; olha só o app criado neste teste
    const aud = await q(`select acao from auditoria where tabela = 'aplicativos' and coalesce(depois, antes) ->> 'codigo' = 'producao_app' order by id`);
    expect(aud.rows.map((x) => x.acao)).toEqual(["INSERT", "UPDATE"]);
  });
});
