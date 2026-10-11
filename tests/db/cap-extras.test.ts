import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));

async function titulo(valor: number) {
  const n = ++contador;
  return (await como(db, "service", () => q(
    `insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, data_emissao, data_vencimento, valor_documento, valor_atualizado)
     values ($1, $2, 'C', '382', $2, '2026-10-01', '2099-01-20', $3::numeric, $3::numeric) returning id`,
    [empresa, `T${n}`, valor],
  ))).rows[0].id as string;
}
const criar = (usuario: string, ids: string[], opcoes: { autorizar?: boolean; caixa?: number | null } = {}) =>
  rpc(usuario, `select cap_criar_autorizacao($1, $2::uuid[], null, null, $3::boolean, $4::numeric) as r`, [empresa, ids, opcoes.autorizar ?? false, opcoes.caixa ?? null]);
const incluir = (usuario: string, autorizacao: string, descricao: string, favorecido: string, valor: number | null) =>
  rpc(usuario, `select cap_incluir_extra($1, $2, $3, $4::numeric) as r`, [autorizacao, descricao, favorecido, valor]);
const vw = async (id: string) => (await rpc(finConsulta, `select itens, extras, total_titulos, total_extras, total, excedente, status from cap_vw_autorizacoes where id = $1`, [id])).rows[0];

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
});

describe("pagamentos extras (0126)", () => {
  it("operador inclui no rascunho; a view soma itens + extras no total e no excedente", async () => {
    const t = await titulo(100);
    const r = (await criar(finOperador, [t], { caixa: 150 })).rows[0].r;
    const x = (await incluir(finOperador, r.id, "Frete avulso — NF 123", "Transportadora XPTO", 80.5)).rows[0].r;
    expect(x).toMatchObject({ codigo: r.codigo, extras: 1 });
    expect(Number(x.total)).toBe(180.5);
    const v = await vw(r.id);
    expect(v).toMatchObject({ itens: 1, extras: 1 });
    expect([Number(v.total_titulos), Number(v.total_extras), Number(v.total), Number(v.excedente)]).toEqual([100, 80.5, 180.5, 30.5]);
    const linha = (await q(`select descricao, favorecido, valor, criado_por, ordem from cap_autorizacao_extras where id = $1`, [x.id])).rows[0];
    expect(linha).toMatchObject({ descricao: "Frete avulso — NF 123", favorecido: "Transportadora XPTO", criado_por: finOperador, ordem: 1 });
    expect(Number(linha.valor)).toBe(80.5);
    // auditoria registra
    expect((await q(`select count(*)::int as n from auditoria where tabela = 'cap_autorizacao_extras' and registro_id = $1`, [x.id])).rows[0].n).toBeGreaterThanOrEqual(1);
  });
  it("recusa: consulta, descrição curta, favorecido vazio, valor zero/negativo, autorização inexistente", async () => {
    const t = await titulo(10);
    const r = (await criar(finOperador, [t])).rows[0].r;
    await expect(incluir(finConsulta, r.id, "Frete", "Alguém", 10)).rejects.toThrow(/Somente operador/);
    await expect(incluir(finOperador, r.id, "ab", "Alguém", 10)).rejects.toThrow(/descrição/);
    await expect(incluir(finOperador, r.id, "Frete avulso", " ", 10)).rejects.toThrow(/favorecido/);
    await expect(incluir(finOperador, r.id, "Frete avulso", "Alguém", 0)).rejects.toThrow(/Valor inválido/);
    await expect(incluir(finOperador, r.id, "Frete avulso", "Alguém", -5)).rejects.toThrow(/Valor inválido/);
    await expect(incluir(finOperador, r.id, "Frete avulso", "Alguém", null)).rejects.toThrow(/Valor inválido/);
    await expect(incluir(finOperador, "00000000-0000-0000-0000-000000000000", "Frete avulso", "Alguém", 10)).rejects.toThrow(/não encontrada/);
  });
  it("não entra em autorizada nem em cancelada; extra é imutável; delete bloqueado", async () => {
    const t = await titulo(10);
    const r = (await criar(finGestor, [t], { autorizar: true })).rows[0].r;
    await expect(incluir(finGestor, r.id, "Frete avulso", "Alguém", 10)).rejects.toThrow(/rascunho/);
    const t2 = await titulo(10);
    const r2 = (await criar(finOperador, [t2])).rows[0].r;
    const x = (await incluir(finOperador, r2.id, "Taxa cartório", "Cartório 1º Ofício", 55)).rows[0].r;
    await expect(rpc(finOperador, `update cap_autorizacao_extras set valor = 1 where id = $1`, [x.id])).rejects.toThrow(/imutáveis/);
    await expect(rpc(finOperador, `update cap_autorizacao_extras set descricao = 'outra' where id = $1`, [x.id])).rejects.toThrow(/imutáveis/);
    expect((await rpc(finGestor, `delete from cap_autorizacao_extras where id = $1 returning id`, [x.id])).rows).toHaveLength(0);
    await expect(como(db, "service", () => q(`delete from cap_autorizacao_extras where id = $1`, [x.id]))).rejects.toThrow(/não podem ser excluídos/);
    await rpc(finGestor, `select cap_cancelar($1, 'teste')`, [r2.id]);
    await expect(incluir(finOperador, r2.id, "Frete avulso", "Alguém", 10)).rejects.toThrow(/rascunho/);
  });
  it("remover: exige motivo, só em rascunho, não repete; o total cai", async () => {
    const t = await titulo(100);
    const r = (await criar(finOperador, [t])).rows[0].r;
    const x = (await incluir(finOperador, r.id, "Reembolso viagem", "João", 40)).rows[0].r;
    await expect(rpc(finOperador, `select cap_remover_extra($1, '  ')`, [x.id])).rejects.toThrow(/motivo/);
    const rem = (await rpc(finOperador, `select cap_remover_extra($1, 'lançado no Consistem') as r`, [x.id])).rows[0].r;
    expect(rem.restantes).toBe(0);
    expect(Number(rem.total)).toBe(100);
    expect((await vw(r.id)).extras).toBe(0);
    await expect(rpc(finOperador, `select cap_remover_extra($1, 'de novo')`, [x.id])).rejects.toThrow(/já removido|não encontrado/);
    const linha = (await q(`select removido_por, motivo_remocao from cap_autorizacao_extras where id = $1`, [x.id])).rows[0];
    expect(linha).toMatchObject({ removido_por: finOperador, motivo_remocao: "lançado no Consistem" });
    // em autorizada não sai
    const x2 = (await incluir(finOperador, r.id, "Reembolso viagem", "João", 40)).rows[0].r;
    await rpc(finGestor, `select cap_autorizar($1)`, [r.id]);
    await expect(rpc(finGestor, `select cap_remover_extra($1, 'tarde')`, [x2.id])).rejects.toThrow(/rascunho/);
  });
  it("rascunho vazio só com extras pode ser autorizado; a pendência traz o total com extras", async () => {
    await expect(criar(finOperador, [], { autorizar: true })).rejects.toThrow(/pelo menos um item/);
    const r = (await criar(finOperador, [])).rows[0].r;
    expect(r).toMatchObject({ itens: 0, status: "rascunho" });
    await expect(rpc(finGestor, `select cap_autorizar($1)`, [r.id])).rejects.toThrow(/não tem itens/);
    await incluir(finOperador, r.id, "Frete avulso — NF 123", "Transportadora XPTO", 1234.56);
    await incluir(finOperador, r.id, "Taxa DETRAN", "DETRAN-MT", 100);
    const ok = (await rpc(finGestor, `select cap_autorizar($1) as r`, [r.id])).rows[0].r;
    expect(ok).toMatchObject({ codigo: r.codigo, itens: 0, extras: 2 });
    expect(Number(ok.total)).toBe(1334.56);
    const p = (await q(`select titulo, descricao from pendencias where referencia_tabela = 'cap_autorizacoes' and referencia_id = $1`, [r.id])).rows[0];
    expect(p.titulo).toBe(`Executar autorização de pagamento ${r.codigo} — R$ 1.334,56`);
    expect(p.descricao).toContain("0 itens e 2 pagamentos extras");
  });
  it("pendência de autorização com itens e extras soma os dois", async () => {
    const t = await titulo(100);
    const r = (await criar(finOperador, [t])).rows[0].r;
    await incluir(finOperador, r.id, "Frete avulso", "Transportadora", 50);
    const ok = (await rpc(finGestor, `select cap_autorizar($1) as r`, [r.id])).rows[0].r;
    expect(ok).toMatchObject({ itens: 1, extras: 1 });
    expect(Number(ok.total)).toBe(150);
    const p = (await q(`select titulo from pendencias where referencia_tabela = 'cap_autorizacoes' and referencia_id = $1`, [r.id])).rows[0];
    expect(p.titulo).toBe(`Executar autorização de pagamento ${r.codigo} — R$ 150,00`);
  });
});
