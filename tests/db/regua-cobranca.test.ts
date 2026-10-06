import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { calcularEncargos } from "../../supabase/functions/_shared/cobranca";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";

type Cenario = { cliente: string; a: string; b: string; outroCliente: string };

/** Cada teste ganha um cliente com duas parcelas vencidas, as pendências D+1 e D+5, e uma parcela de outro cliente. */
async function preparar(estagio = "vencido"): Promise<Cenario> {
  const n = ++contador;
  const cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ($1, '{cliente}', $2) returning id`, [`CLIENTE ${n}`, String(n)])).rows[0].id as string;
  const outro = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ($1, '{cliente}', $2) returning id`, [`OUTRO ${n}`, `o${n}`])).rows[0].id as string;
  const novo = async (cp: string, doc: string) =>
    (await q(`insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio) values ($1, $2, $3, '1', current_date - 3, 20000, $4) returning id`, [empresa, cp, doc, estagio])).rows[0].id as string;
  const a = await novo(cliente, `A${n}`);
  const b = await novo(cliente, `B${n}`);
  const outroCliente = await novo(outro, `O${n}`);
  for (const marco of ["D+1", "D+5"]) {
    await q(`insert into pendencias (modulo, titulo, prazo, referencia_tabela, referencia_id) values ($1, $2, current_date, 'contrapartes', $3)`, [MOD, `Cobrar ${marco}: CLIENTE ${n} — venc. 10/10`, cliente]);
  }
  return { cliente, a, b, outroCliente };
}

const registrar = (usuario: string, ids: string[], marco: number, resultado: string, canal = "whatsapp", data: string | null = null, descricao: string | null = null) =>
  como(db, usuario, () => q(`select rec_registrar_cobranca($1::uuid[], $2, $3, $4::canal, $5::date, $6) as r`, [ids, marco, resultado, canal, data, descricao]));

const pendencias = async (cliente: string) => (await q(`select titulo, status from pendencias where referencia_id = $1 order by titulo`, [cliente])).rows;
const titulo = async (id: string) => (await q(`select estagio, contestado, regua_pausada_ate::text as ate from rec_titulos where id = $1`, [id])).rows[0];
const emDias = async (n: number) => (await q(`select ((now() at time zone 'America/Cuiaba')::date + $1::int)::text as d`, [n])).rows[0].d as string;

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
});

describe("configuração", () => {
  it("a régua nasce com a data de corte de 06/10/2026", async () => {
    const r = await q(`select valor from configuracoes where chave = 'financeiro.recebiveis.regua_a_partir_de'`);
    expect(r.rows[0].valor).toBe("2026-10-06");
  });
});

describe("rec_registrar_cobranca: enviada", () => {
  it("registra a cobrança no histórico, conclui a pendência do marco e deixa os títulos como estão", async () => {
    const c = await preparar();
    const r = await registrar(finOperador, [c.a, c.b], 1, "enviada", "whatsapp", null, "Falei com a Ana.");
    expect(r.rows[0].r).toEqual({ parcelas: 2, pendencias_concluidas: 1 });
    expect((await titulo(c.a)).estagio).toBe("vencido");
    const i = await q(`select tipo, canal, usuario_id, descricao from interacoes where referencia_id = $1`, [c.a]);
    expect(i.rows).toEqual([{ tipo: "cobranca", canal: "whatsapp", usuario_id: finOperador, descricao: "Cobrança D+1 enviada por WhatsApp. Falei com a Ana." }]);
    expect(await pendencias(c.cliente)).toEqual([
      { titulo: expect.stringContaining("Cobrar D+1"), status: "concluida" },
      { titulo: expect.stringContaining("Cobrar D+5"), status: "aberta" },
    ]);
  });

  it("parcela de outro cliente na mesma chamada é recusada e nada muda", async () => {
    const c = await preparar();
    await expect(registrar(finOperador, [c.a, c.outroCliente], 1, "enviada")).rejects.toThrow(/mesmo cliente/);
    expect((await pendencias(c.cliente)).every((p) => p.status === "aberta")).toBe(true);
    expect((await q(`select 1 from interacoes where referencia_id = $1`, [c.a])).rows).toHaveLength(0);
  });

  it("título pago ou cancelado não é cobrado", async () => {
    const c = await preparar("importado");
    await q(`update rec_titulos set estagio = 'cancelado' where id = $1`, [c.b]);
    await expect(registrar(finOperador, [c.a, c.b], 1, "enviada")).rejects.toThrow(/já foi paga ou encerrada/);
  });

  it("resultado e marco inválidos, lista vazia", async () => {
    const c = await preparar();
    await expect(registrar(finOperador, [c.a], 1, "talvez")).rejects.toThrow(/Resultado inválido/);
    await expect(registrar(finOperador, [c.a], 7, "enviada")).rejects.toThrow(/Marco da régua inválido/);
    await expect(registrar(finOperador, [], 1, "enviada")).rejects.toThrow(/pelo menos uma parcela/);
  });

  it("quem só consulta não registra", async () => {
    const c = await preparar();
    await expect(registrar(finConsulta, [c.a], 1, "enviada")).rejects.toThrow();
    expect((await pendencias(c.cliente)).every((p) => p.status === "aberta")).toBe(true);
  });
});

describe("rec_registrar_cobranca: promessa", () => {
  it("pausa a régua até a data, grava a promessa e conclui a pendência do marco", async () => {
    const c = await preparar();
    const data = await emDias(5);
    const r = await registrar(finOperador, [c.a, c.b], 5, "promessa", "telefone", data);
    expect(r.rows[0].r).toEqual({ parcelas: 2, pendencias_concluidas: 1 });
    expect(await titulo(c.a)).toEqual({ estagio: "promessa", contestado: false, ate: data });
    const p = await q(`select data_prometida::text as d, valor_prometido::float as v from rec_promessas where titulo_id = $1`, [c.a]);
    expect(p.rows).toEqual([{ d: data, v: 20000 }]);
    const i = await q(`select tipo, descricao from interacoes where referencia_id = $1`, [c.a]);
    expect(i.rows[0].tipo).toBe("promessa");
    expect(i.rows[0].descricao).toContain("A régua fica pausada até essa data.");
  });

  it("exige data futura de até 90 dias", async () => {
    const c = await preparar();
    await expect(registrar(finOperador, [c.a], 1, "promessa", "whatsapp", null)).rejects.toThrow(/Informe a data prometida/);
    await expect(registrar(finOperador, [c.a], 1, "promessa", "whatsapp", await emDias(0))).rejects.toThrow(/futura/);
    await expect(registrar(finOperador, [c.a], 1, "promessa", "whatsapp", await emDias(91))).rejects.toThrow(/90 dias/);
    expect((await titulo(c.a)).estagio).toBe("vencido");
    expect((await q(`select 1 from rec_promessas where titulo_id = $1`, [c.a])).rows).toHaveLength(0);
  });

  it("quem só consulta não consegue registrar promessa", async () => {
    const c = await preparar();
    await expect(registrar(finConsulta, [c.a], 1, "promessa", "whatsapp", await emDias(3))).rejects.toThrow();
    expect((await titulo(c.a)).estagio).toBe("vencido");
  });
});

describe("rec_registrar_cobranca: contestou", () => {
  it("marca como contestado, guarda o motivo e conclui a pendência", async () => {
    const c = await preparar();
    const r = await registrar(finOperador, [c.a], 1, "contestou", "email", null, "Diz que a mercadoria veio incompleta.");
    expect(r.rows[0].r).toEqual({ parcelas: 1, pendencias_concluidas: 1 });
    expect((await titulo(c.a)).contestado).toBe(true);
    expect((await titulo(c.b)).contestado).toBe(false);
    const i = await q(`select tipo, descricao from interacoes where referencia_id = $1`, [c.a]);
    expect(i.rows).toEqual([{ tipo: "contestacao", descricao: "Cobrança D+1: o cliente contestou a cobrança (por e-mail). A régua fica pausada para estes títulos. Diz que a mercadoria veio incompleta." }]);
  });

  it("exige o motivo", async () => {
    const c = await preparar();
    await expect(registrar(finOperador, [c.a], 1, "contestou", "email", null, "  ")).rejects.toThrow(/motivo da contestação/);
    expect((await titulo(c.a)).contestado).toBe(false);
  });
});

describe("encargos: paridade da função em TypeScript com a view rec_vw_titulos", () => {
  it("o total atualizado é igual ao do banco para vários valores e atrasos", async () => {
    const casos: [number, number][] = [[12_345, 1], [99_999, 3], [1_000_000, 15], [1_234_567, 11], [3_333_333, 29], [76_543_21, 47], [50, 2], [24_999_99, 60]];
    for (const [centavos, dias] of casos) {
      const n = ++contador;
      const cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ($1, '{cliente}', $2) returning id`, [`PARIDADE ${n}`, `p${n}`])).rows[0].id as string;
      const id = (await q(
        `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio)
         values ($1, $2, $3, '1', (now() at time zone 'America/Cuiaba')::date - $4::int, $5::numeric / 100, 'vencido') returning id`,
        [empresa, cliente, `P${n}`, dias, centavos],
      )).rows[0].id as string;
      const v = (await q(`select (valor_atualizado * 100)::bigint::text as c, dias_atraso from rec_vw_titulos where id = $1`, [id])).rows[0];
      expect(Number(v.dias_atraso)).toBe(dias);
      expect(calcularEncargos(centavos, dias).totalCentavos, `${centavos} centavos, ${dias} dias`).toBe(Number(v.c));
    }
  });
});
