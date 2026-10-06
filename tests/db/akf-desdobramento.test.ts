import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string;
let empresa: string, cliente: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

/** Título de R$ 1.000,00 a vencer em 20 dias. */
async function titulo(valor = 1000, estagio = "boleto_enviado") {
  const n = ++contador;
  return (await q(
    `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, emissao, vencimento, valor, estagio, data_pagamento)
     values ($1, $2, $3, '1', current_date - 30, current_date + 20, $4, $5::rec_estagio, case when $6::boolean then current_date end) returning id`,
    [empresa, cliente, `DES${n}`, valor, estagio, estagio === "pago"],
  )).rows[0].id as string;
}
const desdobrar = (usuario: string, id: string, valor: number, dias = 15, obs: string | null = null, dataOp: string | null = null) =>
  como(db, usuario, () => q(`select akf_desdobrar_titulo($1::uuid, $2::numeric, current_date + $3::int, $4::date, $5::text) as r`, [id, valor, dias, dataOp, obs]));
const encerrar = (usuario: string, id: string, motivo: string) => como(db, usuario, () => q(`select akf_encerrar_desdobramento($1::uuid, $2) as r`, [id, motivo]));
const restante = async (id: string) => (await q(`select valor_akf::float as akf, valor_restante::float as restante, partes from akf_vw_valor_restante where titulo_id = $1`, [id])).rows[0];
const partes = async (id: string) => (await q(`select id, valor::float as valor, status from akf_desdobramentos where titulo_id = $1 order by criado_em`, [id])).rows;

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
  cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Cliente Parcial', '{cliente}', 'p1') returning id`)).rows[0].id;
});

describe("akf_desdobrar_titulo", () => {
  it("antecipa uma parte: grava valor e vencimento da parte, o restante fica com a Neo e o histórico registra", async () => {
    const id = await titulo(1000);
    const r = await desdobrar(finOperador, id, 400, 15, "Operação 8601.");
    expect(r.rows[0].r.restante).toBe(600);
    expect(await restante(id)).toEqual({ akf: 400, restante: 600, partes: 1 });
    const d = (await q(`select valor::float as valor, (vencimento - current_date) as dias, status, criado_por from akf_desdobramentos where titulo_id = $1`, [id])).rows[0];
    expect(d).toEqual({ valor: 400, dias: 15, status: "ativo", criado_por: finOperador });
    const i = (await q(`select tipo, descricao from interacoes where referencia_id = $1`, [id])).rows[0];
    expect(i.tipo).toBe("akf_desdobramento");
    expect(i.descricao).toMatch(/^Antecipação parcial na AKF: R\$ 400,00 com vencimento em \d\d\/\d\d\/\d{4}\. Restante com a Neo: R\$ 600,00\. Operação 8601\.$/);
    // o título original não muda (a sincronização com o Consistem não o reescreve com nada nosso)
    const t = (await q(`select valor::float as valor, cedido from rec_titulos where id = $1`, [id])).rows[0];
    expect(t).toEqual({ valor: 1000, cedido: false });
  });

  it("aceita várias antecipações parciais e o restante é o título menos a soma", async () => {
    const id = await titulo(1000);
    await desdobrar(finOperador, id, 300);
    await desdobrar(finOperador, id, 250, 30);
    expect(await restante(id)).toEqual({ akf: 550, restante: 450, partes: 2 });
  });

  it("recusa valor que esgota ou passa do título (para o título inteiro, usa-se 'na AKF')", async () => {
    const id = await titulo(1000);
    await expect(desdobrar(finOperador, id, 1000)).rejects.toThrow(/menor que o do título/);
    await expect(desdobrar(finOperador, id, 1200)).rejects.toThrow(/menor que o do título/);
    await desdobrar(finOperador, id, 700);
    await expect(desdobrar(finOperador, id, 300)).rejects.toThrow(/menor que o do título/);
    expect((await partes(id))).toHaveLength(1);
  });

  it("valida valor, casas decimais, vencimento e data da operação", async () => {
    const id = await titulo(1000);
    await expect(desdobrar(finOperador, id, 0)).rejects.toThrow(/Informe o valor/);
    await expect(desdobrar(finOperador, id, -5)).rejects.toThrow(/Informe o valor/);
    await expect(desdobrar(finOperador, id, 10.123)).rejects.toThrow(/2 casas/);
    await expect(desdobrar(finOperador, id, 100, -40)).rejects.toThrow(/anterior à emissão/); // emissão = hoje - 30
    await expect(desdobrar(finOperador, id, 100, 2000)).rejects.toThrow(/longe demais/);
    await expect(desdobrar(finOperador, id, 100, 10, null, "2999-01-01")).rejects.toThrow(/não pode ser futura/);
    expect(await partes(id)).toHaveLength(0);
  });

  it("não desdobra título encerrado, inexistente nem título inteiro na AKF", async () => {
    const pago = await titulo(1000, "pago");
    await expect(desdobrar(finOperador, pago, 100)).rejects.toThrow(/já está encerrado/);
    await expect(desdobrar(finOperador, crypto.randomUUID(), 100)).rejects.toThrow(/não encontrado/);
    const inteiro = await titulo(1000);
    await q(`update rec_titulos set cedido = true where id = $1`, [inteiro]);
    await expect(desdobrar(finOperador, inteiro, 100)).rejects.toThrow(/título inteiro já está na AKF/);
  });

  it("quem só consulta não consegue", async () => {
    const id = await titulo(1000);
    await expect(desdobrar(finConsulta, id, 100)).rejects.toThrow();
    expect(await partes(id)).toHaveLength(0);
  });
});

describe("akf_encerrar_desdobramento", () => {
  it("encerra a parte com motivo: o restante volta a ser o título inteiro e fica no histórico", async () => {
    const id = await titulo(1000);
    await desdobrar(finOperador, id, 400);
    const parte = (await partes(id))[0].id as string;
    await encerrar(finOperador, parte, "Recompra do título.");
    expect(await restante(id)).toBeUndefined(); // sem parte ativa, sai da view
    const d = (await q(`select status, encerrado_por, motivo_encerramento from akf_desdobramentos where id = $1`, [parte])).rows[0];
    expect(d).toEqual({ status: "encerrado", encerrado_por: finOperador, motivo_encerramento: "Recompra do título." });
    const tipos = (await q(`select tipo from interacoes where referencia_id = $1 order by criado_em`, [id])).rows.map((x) => x.tipo);
    expect(tipos).toEqual(["akf_desdobramento", "akf_desdobramento_encerrado"]);
  });

  it("exige motivo, recusa parte já encerrada e quem só consulta", async () => {
    const id = await titulo(1000);
    await desdobrar(finOperador, id, 400);
    const parte = (await partes(id))[0].id as string;
    await expect(encerrar(finOperador, parte, "x")).rejects.toThrow(/motivo/);
    await expect(encerrar(finConsulta, parte, "Teste de permissão")).rejects.toThrow();
    expect((await partes(id))[0].status).toBe("ativo");
    await encerrar(finOperador, parte, "Lançamento duplicado.");
    await expect(encerrar(finOperador, parte, "Outra vez.")).rejects.toThrow(/já está encerrada/);
  });

  it("não há exclusão de antecipações", async () => {
    const id = await titulo(1000);
    await desdobrar(finOperador, id, 400);
    await como(db, finOperador, () => q(`delete from akf_desdobramentos where titulo_id = $1`, [id]));
    expect(await partes(id)).toHaveLength(1);
  });
});

describe("integração com o título", () => {
  it("título pago (ou cancelado) encerra as partes sozinho", async () => {
    const id = await titulo(1000);
    await desdobrar(finOperador, id, 400);
    await q(`update rec_titulos set estagio = 'pago', data_pagamento = current_date where id = $1`, [id]);
    const p = (await q(`select status, motivo_encerramento from akf_desdobramentos where titulo_id = $1`, [id])).rows[0];
    expect(p).toEqual({ status: "encerrado", motivo_encerramento: "Título encerrado em Recebíveis (pago)." });
    expect(await restante(id)).toBeUndefined();
  });

  it("título inteiro marcado como na AKF: as partes deixam de contar na visão, e marcar à mão exige encerrar as partes", async () => {
    const id = await titulo(1000);
    await desdobrar(finOperador, id, 400);
    await expect(como(db, finOperador, () => q(`select akf_marcar_cedido($1::uuid[], true, null)`, [[id]]))).rejects.toThrow(/encerre as partes/);
    await q(`update rec_titulos set cedido = true where id = $1`, [id]); // por exemplo, o portador virou 998
    expect(await restante(id)).toBeUndefined();
  });

  it("quem só consulta lê a visão, e o restante nunca é negativo", async () => {
    const id = await titulo(1000);
    await desdobrar(finOperador, id, 999.99);
    const r = await como(db, finConsulta, () => q(`select valor_restante::float as restante from akf_vw_valor_restante where titulo_id = $1`, [id]));
    expect(r.rows[0].restante).toBeCloseTo(0.01, 2);
  });
});
