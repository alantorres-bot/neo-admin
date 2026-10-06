import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let operador: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

beforeAll(async () => {
  db = await criarBanco(); // roda todas as migrations, inclusive a 0114
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  operador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
});

describe("contatos (migration 0114)", () => {
  it("telefone, criado_em e criado_por: quem cadastrou fica registrado", async () => {
    const cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Cliente C1', '{cliente}', 'c1') returning id`)).rows[0].id as string;
    await como(db, operador, () => q(`insert into contatos (contraparte_id, nome, telefone, whatsapp, finalidades) values ($1, 'Ana', '+556532220000', '+5565999990000', '{cobranca}')`, [cliente]));
    const r = (await q(`select telefone, whatsapp, criado_por, criado_em is not null as com_data from contatos where contraparte_id = $1`, [cliente])).rows[0];
    expect(r).toEqual({ telefone: "+556532220000", whatsapp: "+5565999990000", criado_por: operador, com_data: true });
  });

  it("o mesmo código do Consistem não vira dois cadastros; vazio e nulo podem repetir", async () => {
    await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Cliente U1', '{cliente}', 'dup1')`);
    await expect(q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Cliente U2', '{cliente}', 'dup1')`)).rejects.toThrow();
    await q(`insert into contrapartes (nome, tipos) values ('Sem código A', '{cliente}')`);
    await q(`insert into contrapartes (nome, tipos) values ('Sem código B', '{cliente}')`);
    await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Vazio A', '{cliente}', '')`);
    await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Vazio B', '{cliente}', '')`);
  });
});

describe("normalização das finalidades já gravadas (trecho da 0114)", () => {
  // O mesmo SQL do update da migration, aplicado a linhas inseridas de propósito com a grafia antiga.
  it("'Cobrança', ' BOLETO ' e repetidas viram minúsculas, sem acento e sem repetição", async () => {
    const cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Cliente N1', '{cliente}', 'n1') returning id`)).rows[0].id as string;
    const id = (await q(`insert into contatos (contraparte_id, nome, finalidades) values ($1, 'Bia', array['Cobrança', ' BOLETO ', 'boleto', '', 'Confirmação']) returning id`, [cliente])).rows[0].id as string;
    await q(`update contatos
       set finalidades = coalesce(
         (select array_agg(distinct translate(lower(trim(f)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))
            from unnest(finalidades) as f where trim(f) <> ''), '{}')
     where id = $1`, [id]);
    const f = (await q(`select finalidades from contatos where id = $1`, [id])).rows[0].finalidades as string[];
    expect([...f].sort()).toEqual(["boleto", "cobranca", "confirmacao"]);
  });
});
