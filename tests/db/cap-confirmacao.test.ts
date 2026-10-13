import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// Migration 0129: confirmação dos documentos no Consistem (CCFFB014), só leitura. A sincronização (service role) anota
// cap_lancamentos.confirmado_consistem e cap_autorizacao_itens.confirmado_consistem_em; as views refletem isso.
// Migration 0161 (13/10/2026): o Consistem passou a "Sem Controle" (CCFFB000); a pendência não manda mais confirmar no CCFFB014.
// As colunas ficam como histórico (a sincronização parou de preenchê-las).

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));

async function titulo(valor: number, confirmado: boolean | null) {
  const n = ++contador;
  return (await servico(
    `insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, data_emissao, data_vencimento, valor_documento, valor_atualizado, confirmado_consistem, confirmacao_vista_em)
     values ($1, $2, 'C', '205', $2, '2026-10-01', '2026-10-20', $3::numeric, $3::numeric, $4::boolean, case when $4::boolean is null then null else now() end) returning id`,
    [empresa, `C${n}`, valor, confirmado],
  )).rows[0].id as string;
}
const criar = (usuario: string, ids: string[]) => rpc(usuario, `select cap_criar_autorizacao($1, $2::uuid[], null, null, false, null) as r`, [empresa, ids]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
});

describe("confirmação no Consistem (0129)", () => {
  it("a view de pendentes expõe confirmado_consistem e confirmacao_vista_em", async () => {
    const sim = await titulo(100, true);
    const nao = await titulo(200, false);
    const semVerificar = await titulo(300, null);
    const r = await rpc(finConsulta, `select confirmado_consistem, confirmacao_vista_em is not null as vista from cap_vw_pendentes where id = any($1::uuid[]) order by cod_lancamento`, [[sim, nao, semVerificar]]);
    expect(r.rows.map((l) => [l.confirmado_consistem, l.vista])).toEqual([[true, true], [false, true], [null, false]]);
  });

  it("a service role anota e limpa confirmado_consistem_em no item; usuário não consegue; a view conta só os não baixados", async () => {
    const a = await titulo(100, null);
    const b = await titulo(200, null);
    const c = await titulo(300, null);
    const r = (await criar(finOperador, [a, b, c])).rows[0].r;
    const item = (lanc: string) => q(`select id from cap_autorizacao_itens where autorizacao_id = $1 and lancamento_id = $2`, [r.id, lanc]).then((x) => x.rows[0].id as string);
    const [ia, ib, ic] = await Promise.all([item(a), item(b), item(c)]);

    await expect(rpc(finGestor, `update cap_autorizacao_itens set confirmado_consistem_em = current_date where id = $1`, [ia])).rejects.toThrow(/imutáveis/);

    await servico(`update cap_autorizacao_itens set confirmado_consistem_em = current_date where id = any($1::uuid[])`, [[ia, ib]]);
    await servico(`update cap_autorizacao_itens set baixado_consistem_em = current_date where id = $1`, [ib]); // confirmado e já baixado: não conta
    let v = (await rpc(finConsulta, `select itens, baixados, confirmados from cap_vw_autorizacoes where id = $1`, [r.id])).rows[0];
    expect([v.itens, v.baixados, v.confirmados]).toEqual([3, 1, 1]);

    await servico(`update cap_autorizacao_itens set confirmado_consistem_em = null where id = $1`, [ia]); // deixou de constar confirmado
    v = (await rpc(finConsulta, `select confirmados from cap_vw_autorizacoes where id = $1`, [r.id])).rows[0];
    expect(v.confirmados).toBe(0);
    expect(ic).toBeTruthy();
  });

  it("cap_autorizar (0161): a pendência não pede mais a confirmação no CCFFB014", async () => {
    const a = await titulo(100, true);
    const b = await titulo(50, null);
    const r = (await criar(finOperador, [a, b])).rows[0].r;
    await servico(`update cap_autorizacao_itens set confirmado_consistem_em = current_date where autorizacao_id = $1 and lancamento_id = $2`, [r.id, a]);
    const aut = (await rpc(finGestor, `select cap_autorizar($1) as r`, [r.id])).rows[0].r;
    expect([aut.itens, aut.confirmados]).toEqual([2, undefined]);
    const p = (await q(`select descricao from pendencias where referencia_tabela = 'cap_autorizacoes' and referencia_id = $1 and status = 'aberta'`, [r.id])).rows[0];
    expect(p.descricao).toMatch(/Abra a autorização, monte o borderô, faça os pagamentos, confira com o banco e dê baixa no Consistem\./);
    expect(p.descricao).not.toMatch(/CCFFB014/);
  });

  it("item novo nasce sem confirmação mesmo que o lançamento já esteja confirmado (a sincronização anota depois)", async () => {
    const a = await titulo(100, true);
    const r = (await criar(finOperador, [a])).rows[0].r;
    const i = (await q(`select confirmado_consistem_em from cap_autorizacao_itens where autorizacao_id = $1`, [r.id])).rows[0];
    expect(i.confirmado_consistem_em).toBeNull();
  });
});
