import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let empresa: string, empresa2: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));

async function titulo(valor: number, emp = empresa) {
  const n = ++contador;
  return (await como(db, "service", () => q(
    `insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, data_emissao, data_vencimento, valor_documento, valor_atualizado)
     values ($1, $2, 'C', '382', $2, '2026-10-01', '2099-01-20', $3::numeric, $3::numeric) returning id`,
    [emp, `T${n}`, valor],
  ))).rows[0].id as string;
}
const montar = (usuario: string, ids: string[], opcoes: { caixa?: number | null; observacao?: string | null; extra?: object | null; emp?: string } = {}) =>
  rpc(usuario, `select cap_montar_rascunho($1, $2::uuid[], $3::numeric, $4, $5::jsonb) as r`, [opcoes.emp ?? empresa, ids, opcoes.caixa ?? null, opcoes.observacao ?? null, opcoes.extra ? JSON.stringify(opcoes.extra) : null]);
const itensDe = async (id: string) => (await q(`select cod_lancamento, ordem, removido_em from cap_autorizacao_itens where autorizacao_id = $1 order by ordem`, [id])).rows;

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
  empresa2 = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Outra Ltda', 'Outra', '2') returning id`)).rows[0].id;
});

describe("montar rascunho na tela de seleção (0127)", () => {
  it("1ª chamada cria o rascunho com os itens; a 2ª acrescenta ao MESMO rascunho (não cria outro)", async () => {
    const [a, b, c] = [await titulo(100), await titulo(200), await titulo(50)];
    const r1 = (await montar(finOperador, [a, b], { caixa: 1000, observacao: "Semana 42" })).rows[0].r;
    expect(r1).toMatchObject({ criado: true, itens: 2, extras: 0, observacao: "Semana 42" });
    expect(Number(r1.total)).toBe(300);
    expect(Number(r1.caixa_disponivel)).toBe(1000);
    const r2 = (await montar(finOperador, [c])).rows[0].r;
    expect(r2).toMatchObject({ id: r1.id, codigo: r1.codigo, criado: false, itens: 3 });
    expect(Number(r2.total)).toBe(350);
    expect(Number(r2.caixa_disponivel)).toBe(1000); // caixa não informado na 2ª chamada: mantém
    expect((await itensDe(r1.id)).map((i) => i.ordem)).toEqual([1, 2, 3]);
    expect((await q(`select count(*)::int as n from cap_autorizacoes where empresa_id = $1 and status = 'rascunho'`, [empresa])).rows[0].n).toBe(1);
    // o item já está no rascunho: marcar de novo dá erro
    await expect(montar(finOperador, [a])).rejects.toThrow(new RegExp(`já está na autorização ${r1.codigo}`));
    // fecha o rascunho para os próximos testes
    await rpc(finGestor, `select cap_cancelar($1, 'teste')`, [r1.id]);
  });
  it("chamada só com extra cria rascunho vazio + extra; a seguinte acrescenta itens e outro extra; caixa e observação atualizam", async () => {
    const r1 = (await montar(finOperador, [], { extra: { descricao: "Frete avulso — NF 123", favorecido: "Transportadora", valor: 80.5 } })).rows[0].r;
    expect(r1).toMatchObject({ criado: true, itens: 0, extras: 1 });
    expect(Number(r1.total)).toBe(80.5);
    const t = await titulo(100);
    const r2 = (await montar(finOperador, [t], { caixa: 150, observacao: "obs nova", extra: { descricao: "Taxa DETRAN", favorecido: "DETRAN-MT", valor: 10 } })).rows[0].r;
    expect(r2).toMatchObject({ id: r1.id, criado: false, itens: 1, extras: 2, observacao: "obs nova" });
    expect([Number(r2.total), Number(r2.total_extras), Number(r2.caixa_disponivel)]).toEqual([190.5, 90.5, 150]);
    const vw = (await rpc(finConsulta, `select excedente from cap_vw_autorizacoes where id = $1`, [r1.id])).rows[0];
    expect(Number(vw.excedente)).toBe(40.5);
    await rpc(finGestor, `select cap_cancelar($1, 'teste')`, [r1.id]);
  });
  it("extra inválido derruba a chamada inteira (nada gravado)", async () => {
    const t = await titulo(100);
    await expect(montar(finOperador, [t], { extra: { descricao: "ab", favorecido: "x", valor: 0 } })).rejects.toThrow(/descrição/);
    expect((await q(`select count(*)::int as n from cap_autorizacoes where empresa_id = $1 and status = 'rascunho'`, [empresa])).rows[0].n).toBe(0);
  });
  it("rascunho é por empresa; item de outra empresa é recusado; consulta não monta", async () => {
    const t1 = await titulo(10);
    const t2 = await titulo(20, empresa2);
    const r1 = (await montar(finOperador, [t1])).rows[0].r;
    const r2 = (await montar(finOperador, [t2], { emp: empresa2 })).rows[0].r;
    expect(r2.id).not.toBe(r1.id);
    await expect(montar(finOperador, [t2])).rejects.toThrow(/não é desta empresa|já está na autorização/);
    await expect(montar(finConsulta, [t1])).rejects.toThrow(/Somente operador/);
    await rpc(finGestor, `select cap_cancelar($1, 'teste')`, [r1.id]);
    await rpc(finGestor, `select cap_cancelar($1, 'teste')`, [r2.id]);
  });
  it("item removido do rascunho e marcado de novo volta a ativo (sem linha duplicada); rascunho autorizado não recebe itens", async () => {
    const t = await titulo(100);
    const r = (await montar(finOperador, [t])).rows[0].r;
    const item = (await q(`select id from cap_autorizacao_itens where autorizacao_id = $1`, [r.id])).rows[0].id;
    await rpc(finOperador, `select cap_remover_item($1, 'segurar')`, [item]);
    expect((await montar(finOperador, [t])).rows[0].r.itens).toBe(1);
    const linhas = await itensDe(r.id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].removido_em).toBeNull();
    await rpc(finGestor, `select cap_autorizar($1)`, [r.id]);
    const t2 = await titulo(5);
    await expect(rpc(finOperador, `select cap_adicionar_itens($1, $2::uuid[])`, [r.id, [t2]])).rejects.toThrow(/rascunho/);
    // autorizada não é mais "em montagem": a próxima montagem cria um rascunho novo
    const novo = (await montar(finOperador, [t2])).rows[0].r;
    expect(novo.criado).toBe(true);
    expect(novo.id).not.toBe(r.id);
    await rpc(finGestor, `select cap_cancelar($1, 'teste')`, [novo.id]);
  });
  it("cap_criar_autorizacao continua igual: itens copiados, autorizar na hora, lista vazia só sem autorizar", async () => {
    const [a, b] = [await titulo(1), await titulo(2)];
    const r = (await rpc(finGestor, `select cap_criar_autorizacao($1, $2::uuid[], 'x', null, true) as r`, [empresa, [a, b]])).rows[0].r;
    expect(r).toMatchObject({ itens: 2, status: "autorizada" });
    expect((await itensDe(r.id)).map((i) => i.ordem)).toEqual([1, 2]);
    await expect(rpc(finOperador, `select cap_criar_autorizacao($1, '{}'::uuid[], null, null, true)`, [empresa])).rejects.toThrow(/pelo menos um item/);
    const vazio = (await rpc(finOperador, `select cap_criar_autorizacao($1, '{}'::uuid[]) as r`, [empresa])).rows[0].r;
    expect(vazio.itens).toBe(0);
    await rpc(finGestor, `select cap_cancelar($1, 'teste')`, [vazio.id]);
  });
});
