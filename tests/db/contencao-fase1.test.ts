import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// 0186: contenção da Fase 1 (plano de reestruturação do Contas a receber): restante AKF nunca negativo (H1), antecipação
// com trava (F8) e uma sincronização por vez (F7).
let db: PGlite;
let operador: string;
let empresa: string, cliente: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

async function titulo(valor: number) {
  return (await q(
    `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, emissao, vencimento, valor, estagio)
     values ($1, $2, $3, '1', current_date - 30, current_date + 20, $4, 'boleto_enviado') returning id`,
    [empresa, cliente, `CF${++contador}`, valor],
  )).rows[0].id as string;
}
const desdobrar = (id: string, valor: number) =>
  como(db, operador, () => q(`select akf_desdobrar_titulo($1::uuid, $2::numeric, current_date + 15) as r`, [id, valor]));
const restante = async (id: string) =>
  (await q(`select valor_restante::float as restante, excedido from akf_vw_valor_restante where titulo_id = $1`, [id])).rows[0];
const iniciar = async () => (await como(db, "service", () => q(`select rec_sincronizacao_iniciar() as ok`))).rows[0].ok;

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  operador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
  cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Cliente Contenção', '{cliente}', 'cf1') returning id`)).rows[0].id;
});

describe("akf_vw_valor_restante (H1)", () => {
  it("o Consistem reduz o valor abaixo da parte na AKF: restante 0 e excedido, nunca negativo", async () => {
    const id = await titulo(1000);
    await desdobrar(id, 400);
    expect(await restante(id)).toEqual({ restante: 600, excedido: false });

    await q(`update rec_titulos set valor = 300 where id = $1`, [id]); // como a sincronização faria
    expect(await restante(id)).toEqual({ restante: 0, excedido: true });
  });
});

describe("akf_desdobrar_titulo com trava (F8)", () => {
  it("o operador continua antecipando e a soma das partes não passa do título", async () => {
    const id = await titulo(1000);
    expect((await desdobrar(id, 500)).rows[0].r.restante).toBe(500);
    await expect(desdobrar(id, 500)).rejects.toThrow(/precisa ser menor/);
  });
});

describe("rec_sincronizacao_iniciar / terminar (F7)", () => {
  it("uma rodada por vez; a trava se solta ao terminar ou depois de 15 minutos", async () => {
    expect(await iniciar()).toBe(true);
    expect(await iniciar()).toBe(false);

    await como(db, "service", () => q(`select rec_sincronizacao_terminar()`));
    expect(await iniciar()).toBe(true);

    await q(`update rec_sincronizacao_trava set desde = now() - interval '16 minutes'`); // rodada que morreu no meio
    expect(await iniciar()).toBe(true);
    await como(db, "service", () => q(`select rec_sincronizacao_terminar()`));
  });

  it("quem usa o app não mexe na trava", async () => {
    await expect(como(db, operador, () => q(`select rec_sincronizacao_iniciar()`))).rejects.toThrow(/permission denied/);
    await expect(como(db, operador, () => q(`update rec_sincronizacao_trava set desde = null`))).rejects.toThrow(/permission denied/);
  });
});
