import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, semAcesso: string;
let empresa: string, cliente: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

async function titulo(portador: string | null, estagio = "boleto_enviado", cedido = false) {
  const n = ++contador;
  return (await q(
    `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio, cod_portador, cedido)
     values ($1, $2, $3, '1', current_date + 20, 1000, $4, $5, $6) returning id`,
    [empresa, cliente, `AKF${n}`, estagio, portador, cedido],
  )).rows[0].id as string;
}
const cedidoDe = async (id: string) => (await q(`select cedido from rec_titulos where id = $1`, [id])).rows[0].cedido as boolean;
const marcar = (usuario: string, ids: string[], cedido: boolean, descricao: string | null = null) =>
  como(db, usuario, () => q(`select akf_marcar_cedido($1::uuid[], $2, $3) as r`, [ids, cedido, descricao]));

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  semAcesso = await novoUsuario(db, "sem@neo.com", { fiscal: "consulta" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
  cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Cliente AKF', '{cliente}', 'a1') returning id`)).rows[0].id;
});

describe("módulo e parâmetros", () => {
  it("o módulo financeiro.akf está ativo na área financeiro", async () => {
    const m = (await q(`select area, nome, ativo from modulos where codigo = 'financeiro.akf'`)).rows[0];
    expect(m).toEqual({ area: "financeiro", nome: "AKF", ativo: true });
  });
  it("parâmetros do Gestor AKF estão em configuracoes", async () => {
    const c = Object.fromEntries((await q(`select chave, valor from configuracoes where chave like 'financeiro.akf.%'`)).rows.map((r) => [r.chave, r.valor]));
    expect(c["financeiro.akf.taxa_referencia_am"]).toBe(0.0218);
    expect(c["financeiro.akf.multa_recompra"]).toBe(0.02);
    expect(c["financeiro.akf.clientes_sem_boleto"]).toEqual(["MIP", "MB", "JANEIRO", "CAPARAO", "HOUSE GARDEN", "QRTZ 39"]);
  });
  it("quem só tem a área fiscal não enxerga o módulo AKF do financeiro", async () => {
    const r = await como(db, semAcesso, () => q(`select tem_acesso_modulo('financeiro.akf', 'consulta') as ok`));
    expect(r.rows[0].ok).toBe(false);
    const r2 = await como(db, finConsulta, () => q(`select tem_acesso_modulo('financeiro.akf', 'consulta') as ok`));
    expect(r2.rows[0].ok).toBe(true);
  });
});

describe("portador 998 = cedido (gatilho)", () => {
  it("título que entra com o portador 998 já nasce cedido", async () => {
    expect(await cedidoDe(await titulo("998"))).toBe(true);
    expect(await cedidoDe(await titulo("91"))).toBe(false);
    expect(await cedidoDe(await titulo(null))).toBe(false);
  });
  it("título que passa para o 998 vira cedido", async () => {
    const id = await titulo("91");
    await q(`update rec_titulos set cod_portador = '998' where id = $1`, [id]);
    expect(await cedidoDe(id)).toBe(true);
  });
  it("título que sai do 998 deixa de ser cedido (volta à régua de Recebíveis)", async () => {
    const id = await titulo("998");
    await q(`update rec_titulos set cod_portador = '237' where id = $1`, [id]);
    expect(await cedidoDe(id)).toBe(false);
  });
  it("mudar outro campo não mexe no cedido marcado à mão", async () => {
    const id = await titulo("91", "boleto_enviado", true);
    await q(`update rec_titulos set vencimento = vencimento + 1 where id = $1`, [id]);
    expect(await cedidoDe(id)).toBe(true);
    await q(`update rec_titulos set cod_portador = '237' where id = $1`, [id]); // trocou de portador comum: sem regra, fica como está
    expect(await cedidoDe(id)).toBe(true);
  });
});

describe("akf_marcar_cedido", () => {
  it("marca e desmarca, e registra a interação no histórico", async () => {
    const a = await titulo("91");
    const b = await titulo("91");
    const r = await marcar(finOperador, [a, b], true, "Operação de 06/10.");
    expect(r.rows[0].r).toEqual({ titulos: 2, alterados: 2 });
    expect(await cedidoDe(a)).toBe(true);
    const i = await q(`select modulo, tipo, canal, usuario_id, descricao from interacoes where referencia_id = $1`, [a]);
    expect(i.rows).toEqual([{ modulo: "financeiro.akf", tipo: "akf_cessao", canal: "interno", usuario_id: finOperador, descricao: "Marcado como cedido à AKF. Operação de 06/10." }]);

    await marcar(finOperador, [a], false);
    expect(await cedidoDe(a)).toBe(false);
    expect(await cedidoDe(b)).toBe(true);
    const i2 = await q(`select tipo from interacoes where referencia_id = $1 order by criado_em`, [a]);
    expect(i2.rows.map((x) => x.tipo)).toEqual(["akf_cessao", "akf_retirada"]);
  });

  it("recusa título encerrado e lista vazia ou grande demais, sem mudar nada", async () => {
    const aberto = await titulo("91");
    const pago = (await q(
      `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio, data_pagamento) values ($1, $2, 'AKF-PAGO', '1', current_date - 5, 100, 'pago', current_date) returning id`,
      [empresa, cliente],
    )).rows[0].id as string;
    await expect(marcar(finOperador, [aberto, pago], true)).rejects.toThrow(/já está encerrado/);
    expect(await cedidoDe(aberto)).toBe(false);
    await expect(marcar(finOperador, [], true)).rejects.toThrow(/pelo menos um título/);
    const muitos = Array.from({ length: 101 }, () => crypto.randomUUID());
    await expect(marcar(finOperador, muitos, true)).rejects.toThrow(/No máximo 100/);
  });

  it("quem só consulta não consegue marcar nem desmarcar", async () => {
    const a = await titulo("91");
    await expect(marcar(finConsulta, [a], true)).rejects.toThrow();
    expect(await cedidoDe(a)).toBe(false);
    const b = await titulo("91", "boleto_enviado", true);
    await expect(marcar(finConsulta, [b], false)).rejects.toThrow();
    expect(await cedidoDe(b)).toBe(true);
  });
});
