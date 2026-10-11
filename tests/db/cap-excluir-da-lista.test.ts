import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finOperador: string, finGestor: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));

async function rascunho() {
  const n = ++contador;
  const t = (await como(db, "service", () => q(
    `insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, data_emissao, data_vencimento, valor_documento, valor_atualizado)
     values ($1, $2, 'C', '382', $2, '2026-10-01', '2026-10-05', 10, 10) returning id`, [empresa, `T${n}`],
  ))).rows[0].id as string;
  return (await rpc(finOperador, `select cap_criar_autorizacao($1, $2::uuid[]) as r`, [empresa, [t]])).rows[0].r as { id: string; codigo: string };
}

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
});

describe("excluir autorização cancelada da lista (0128)", () => {
  it("só cancelada, só gestor, uma vez; fica gravada com quem e quando", async () => {
    const r = await rascunho();
    await expect(rpc(finGestor, `select cap_excluir_da_lista($1)`, [r.id])).rejects.toThrow(/Só autorização cancelada/);
    await rpc(finGestor, `select cap_cancelar($1, 'teste')`, [r.id]);
    await expect(rpc(finOperador, `select cap_excluir_da_lista($1)`, [r.id])).rejects.toThrow(/Somente gestor/);
    const ok = (await rpc(finGestor, `select cap_excluir_da_lista($1, 'era teste') as r`, [r.id])).rows[0].r;
    expect(ok).toEqual({ codigo: r.codigo });
    const linha = (await q(`select excluida_por, motivo_exclusao, excluida_em is not null as excluida, status from cap_autorizacoes where id = $1`, [r.id])).rows[0];
    expect(linha).toMatchObject({ excluida_por: finGestor, motivo_exclusao: "era teste", excluida: true, status: "cancelada" });
    await expect(rpc(finGestor, `select cap_excluir_da_lista($1)`, [r.id])).rejects.toThrow(/já excluída|não encontrada/);
    // continua no banco (nada apagado) e a view expõe a exclusão
    const vw = (await rpc(finGestor, `select excluida_por_nome from cap_vw_autorizacoes where id = $1`, [r.id])).rows[0];
    expect(vw.excluida_por_nome).toBeTruthy();
  });
  it("sem motivo grava o padrão; ao excluir nada mais pode mudar; o resto da regra continua", async () => {
    const r = await rascunho();
    await rpc(finGestor, `select cap_cancelar($1, 'teste')`, [r.id]);
    await expect(rpc(finGestor, `update cap_autorizacoes set excluida_em = now(), observacao = 'x' where id = $1`, [r.id])).rejects.toThrow(/nada mais/);
    await rpc(finGestor, `select cap_excluir_da_lista($1)`, [r.id]);
    expect((await q(`select motivo_exclusao from cap_autorizacoes where id = $1`, [r.id])).rows[0].motivo_exclusao).toBe("Excluída da lista");
    await expect(rpc(finGestor, `update cap_autorizacoes set observacao = 'x' where id = $1`, [r.id])).rejects.toThrow(/cancelada/);
  });
});
