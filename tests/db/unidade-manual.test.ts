import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// 0182: a unidade segue o documento (400 = Filial), mas o gestor corrige a exceção (ex.: 4000482U, NF 482 da Matriz).
let db: PGlite;
let gestor: string;
let operador: string;
let filial: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const definir = (quem: string, id: string, unidade: string, motivo = "NF da Matriz na série 2") =>
  como(db, quem, () => q(`select rec_definir_unidade($1, $2, $3) as r`, [id, unidade, motivo]));
const unidade = async (id: string) => (await q(`select unidade from rec_vw_titulos where id = $1`, [id])).rows[0].unidade as string;

async function titulo(documento: string) {
  const n = ++contador;
  const cp = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ($1, '{cliente}', $2) returning id`, [`CLIENTE M${n}`, `m${n}`])).rows[0].id;
  return (await q(
    `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio) values ($1, $2, $3, '1', current_date, 350000, 'aguardando_boleto') returning id`,
    [empresa, cp, documento],
  )).rows[0].id as string;
}

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  gestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  operador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  filial = await novoUsuario(db, "filial@neo.com", { financeiro: "operador" });
  await q(`update perfis set unidade_restrita = 'contagem' where id = $1`, [filial]);
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
});

describe("rec_definir_unidade", () => {
  it("o gestor corrige o título 400 para a Matriz, com histórico; a correção sobrevive à atualização do título", async () => {
    const id = await titulo("4000482U");
    expect(await unidade(id)).toBe("contagem");

    const r = await definir(gestor, id, "matriz");
    expect(r.rows[0].r).toMatchObject({ titulo: "4000482U", de: "contagem", para: "matriz" });
    expect(await unidade(id)).toBe("matriz");
    const h = (await q(`select tipo, descricao, usuario_id from interacoes where referencia_id = $1`, [id])).rows;
    expect(h).toEqual([{ tipo: "unidade_alterada", descricao: "Unidade corrigida: Filial Contagem → Matriz. NF da Matriz na série 2", usuario_id: gestor }]);

    // A sincronização atualiza valor e vencimento sem tocar na correção.
    await q(`update rec_titulos set valor = 360000, vencimento = current_date + 1 where id = $1`, [id]);
    expect(await unidade(id)).toBe("matriz");
  });

  it("voltar para a unidade da regra apaga a correção", async () => {
    const id = await titulo("4000483U");
    await definir(gestor, id, "matriz");
    await definir(gestor, id, "contagem");
    expect((await q(`select unidade, unidade_manual from rec_titulos where id = $1`, [id])).rows[0]).toEqual({ unidade: "contagem", unidade_manual: null });
  });

  it("título da Matriz também pode ir para a Filial", async () => {
    const id = await titulo("1001400U");
    await definir(gestor, id, "contagem");
    expect(await unidade(id)).toBe("contagem");
  });

  it("recusa: operador, motivo curto, unidade inválida ou igual à atual", async () => {
    const id = await titulo("4000484U");
    await expect(definir(operador, id, "matriz")).rejects.toThrow(/Somente o gestor/);
    await expect(definir(gestor, id, "matriz", "abc")).rejects.toThrow(/motivo/);
    await expect(definir(gestor, id, "fortaleza")).rejects.toThrow(/Unidade inválida/);
    await expect(definir(gestor, id, "contagem")).rejects.toThrow(/já é da unidade Filial Contagem/);
    expect(await unidade(id)).toBe("contagem");
  });

  it("recusa título ligado a kit da Filial", async () => {
    const id = await titulo("4002400U");
    await q(`insert into rec_kits (empresa_id, nota_fiscal, cliente_nome) values ($1, '002400', 'CLIENTE KIT')`, [empresa]);
    expect((await q(`select count(*)::int n from rec_kit_titulos where titulo_id = $1`, [id])).rows[0].n).toBe(1);
    await expect(definir(gestor, id, "matriz")).rejects.toThrow(/kit da Filial/);
  });

  it("a usuária restrita à Filial não muda a unidade (nem pela função, nem direto na tabela)", async () => {
    const id = await titulo("4000485U");
    await expect(definir(filial, id, "matriz")).rejects.toThrow(/Somente o gestor/);
    await expect(como(db, filial, () => q(`update rec_titulos set unidade_manual = 'matriz' where id = $1`, [id]))).rejects.toThrow(/só se alteram os dados da cobrança/);
    expect(await unidade(id)).toBe("contagem");
  });

  it("título corrigido para a Matriz some da visão da Filial", async () => {
    const id = await titulo("4000486U");
    const ver = () => como(db, filial, () => q(`select id from rec_titulos where id = $1`, [id]));
    expect((await ver()).rows).toHaveLength(1);
    await definir(gestor, id, "matriz");
    expect((await ver()).rows).toHaveLength(0);
  });
});
