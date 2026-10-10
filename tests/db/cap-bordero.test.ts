import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));

async function antecipacao(valor: number, temBordero: boolean | null) {
  const n = ++contador;
  return (await como(db, "service", () => q(
    `insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, data_emissao, valor_documento, valor_atualizado, tem_bordero, bordero_visto_em)
     values ($1, $2, 'A', '382', $2, '2026-10-01', $3::numeric, $3::numeric, $4::boolean, case when $4::boolean is null then null else now() end) returning id`,
    [empresa, `A${n}`, valor, temBordero],
  ))).rows[0].id as string;
}
const criar = (usuario: string, ids: string[], caixa: number | null = null) =>
  rpc(usuario, `select cap_criar_autorizacao($1, $2::uuid[], null, null, false, $3::numeric) as r`, [empresa, ids, caixa]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
});

describe("borderô (0123)", () => {
  it("a view de pendentes expõe tem_bordero; a service role grava a marca", async () => {
    const paga = await antecipacao(100, true);
    const aPagar = await antecipacao(200, false);
    const semVerificar = await antecipacao(300, null);
    const r = await rpc(finConsulta, `select cod_lancamento, tem_bordero, bordero_visto_em is not null as vista from cap_vw_pendentes where id = any($1::uuid[]) order by cod_lancamento`, [[paga, aPagar, semVerificar]]);
    expect(r.rows.map((l) => [l.tem_bordero, l.vista])).toEqual([[true, true], [false, true], [null, false]]);
  });
  it("antecipação com borderô não entra em autorização; sem borderô ou não verificada entra", async () => {
    const paga = await antecipacao(100, true);
    const aPagar = await antecipacao(200, false);
    const semVerificar = await antecipacao(300, null);
    await expect(criar(finOperador, [paga])).rejects.toThrow(/já foi paga \(tem borderô/);
    expect((await criar(finOperador, [aPagar, semVerificar])).rows[0].r.itens).toBe(2);
  });
  it("antecipação com borderô não pode ser marcada como 'paga fora' (já consta como paga)", async () => {
    const paga = await antecipacao(100, true);
    await expect(rpc(finOperador, `select cap_marcar_antecipacao_tratada($1, 'teste')`, [paga])).rejects.toThrow(/já consta como paga/);
  });
});

describe("caixa disponível (0123)", () => {
  it("grava o caixa na autorização e a view calcula o excedente", async () => {
    const a = await antecipacao(150, false);
    const r = (await criar(finOperador, [a], 100)).rows[0].r;
    expect(r.caixa_disponivel).toBe(100);
    const v = (await rpc(finConsulta, `select caixa_disponivel, total, excedente from cap_vw_autorizacoes where id = $1`, [r.id])).rows[0];
    expect([Number(v.caixa_disponivel), Number(v.total), Number(v.excedente)]).toEqual([100, 150, 50]);
    // sem caixa: excedente nulo
    const b = await antecipacao(10, false);
    const r2 = (await criar(finOperador, [b])).rows[0].r;
    expect((await rpc(finConsulta, `select excedente from cap_vw_autorizacoes where id = $1`, [r2.id])).rows[0].excedente).toBeNull();
  });
  it("cap_definir_caixa ajusta só em rascunho; caixa negativo é recusado", async () => {
    const a = await antecipacao(50, false);
    const r = (await criar(finOperador, [a])).rows[0].r;
    await expect(rpc(finOperador, `select cap_definir_caixa($1, -1)`, [r.id])).rejects.toThrow(/inválido/);
    await rpc(finOperador, `select cap_definir_caixa($1, 40)`, [r.id]);
    expect(Number((await q(`select caixa_disponivel from cap_autorizacoes where id = $1`, [r.id])).rows[0].caixa_disponivel)).toBe(40);
    await rpc(finGestor, `select cap_autorizar($1)`, [r.id]);
    await expect(rpc(finGestor, `select cap_definir_caixa($1, 60)`, [r.id])).rejects.toThrow(/rascunho/);
    await expect(rpc(finGestor, `update cap_autorizacoes set caixa_disponivel = 60 where id = $1`, [r.id])).rejects.toThrow(/caixa disponível só pode ser alterado/);
  });
});
