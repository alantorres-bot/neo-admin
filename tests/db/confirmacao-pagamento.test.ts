import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, outroOperador: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";

type Cenario = { cliente: string; a: string; b: string; outroCliente: string };

/** Cada teste ganha um cliente novo com duas parcelas, uma pendência de confirmação, e uma parcela de outro cliente. */
async function preparar(estagio = "boleto_enviado"): Promise<Cenario> {
  const n = ++contador;
  const cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ($1, '{cliente}', $2) returning id`, [`CLIENTE ${n}`, String(n)])).rows[0].id as string;
  const outro = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ($1, '{cliente}', $2) returning id`, [`OUTRO ${n}`, `o${n}`])).rows[0].id as string;
  const novo = async (cp: string, doc: string) =>
    (await q(`insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio, data_pagamento) values ($1, $2, $3, '1', '2026-10-20', 20000, $4, case when $5::boolean then current_date end) returning id`, [empresa, cp, doc, estagio, estagio === "pago"])).rows[0].id as string;
  const a = await novo(cliente, `A${n}`);
  const b = await novo(cliente, `B${n}`);
  const outroCliente = await novo(outro, `O${n}`);
  await q(`insert into pendencias (modulo, titulo, prazo, referencia_tabela, referencia_id) values ($1, $2, current_date, 'contrapartes', $3)`, [MOD, `Confirmar pagamento: CLIENTE ${n} — vence 20/10`, cliente]);
  return { cliente, a, b, outroCliente };
}

const registrar = (usuario: string, ids: string[], resultado: string, canal = "whatsapp", descricao: string | null = "teste") =>
  como(db, usuario, () => q(`select rec_registrar_confirmacao($1::uuid[], $2, $3::canal, $4) as r`, [ids, resultado, canal, descricao]));

const pendencias = async (cliente: string) => (await q(`select titulo, status from pendencias where referencia_id = $1 order by titulo`, [cliente])).rows;

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  outroOperador = await novoUsuario(db, "operador2@neo.com", { financeiro: "operador" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
});

describe("configuração", () => {
  it("o valor mínimo vem semeado em R$ 25.000", async () => {
    const r = await q(`select valor from configuracoes where chave = 'financeiro.recebiveis.confirmacao_valor_minimo'`);
    expect(Number(r.rows[0].valor)).toBe(25000);
  });
});

describe("rec_registrar_confirmacao: cliente confirmou", () => {
  it("passa as parcelas para confirmado_cliente, registra a interação e conclui a pendência", async () => {
    const c = await preparar();
    const r = await registrar(finOperador, [c.a, c.b], "confirmou", "whatsapp", "Confirmou pagamento para 20/10.");
    expect(r.rows[0].r).toEqual({ parcelas: 2, pendencias_concluidas: 1, pendencia_ligar: 0 });

    const t = await q(`select estagio from rec_titulos where id = any($1::uuid[])`, [[c.a, c.b]]);
    expect(t.rows.every((x) => x.estagio === "confirmado_cliente")).toBe(true);
    const i = await q(`select tipo, canal, usuario_id, descricao from interacoes where referencia_id = any($1::uuid[])`, [[c.a, c.b]]);
    expect(i.rows).toHaveLength(2);
    expect(i.rows.every((x) => x.tipo === "confirmacao" && x.canal === "whatsapp" && x.usuario_id === finOperador && x.descricao === "Confirmou pagamento para 20/10.")).toBe(true);
    expect((await pendencias(c.cliente))[0].status).toBe("concluida");
    expect((await q(`select estagio from rec_titulos where id = $1`, [c.outroCliente])).rows[0].estagio).toBe("boleto_enviado"); // outro cliente intocado
  });

  it("parcelas ainda sem boleto (importado/aguardando) também podem ser confirmadas", async () => {
    for (const estagio of ["importado", "aguardando_boleto"]) {
      const c = await preparar(estagio);
      expect((await registrar(finOperador, [c.a], "confirmou")).rows[0].r.parcelas).toBe(1);
    }
  });

  it("não confirma duas vezes, nem parcela paga, nem lista vazia", async () => {
    const c = await preparar();
    await registrar(finOperador, [c.a], "confirmou");
    await expect(registrar(finOperador, [c.a], "confirmou")).rejects.toThrow(/já foi confirmada, paga ou encerrada/);
    const p = await preparar("pago");
    await expect(registrar(finOperador, [p.a], "confirmou")).rejects.toThrow(/já foi confirmada/);
    await expect(registrar(finOperador, [], "confirmou")).rejects.toThrow(/pelo menos uma parcela/);
  });

  it("parcelas de clientes diferentes numa mesma confirmação são recusadas, sem alterar nada", async () => {
    const c = await preparar();
    await expect(registrar(finOperador, [c.a, c.outroCliente], "confirmou")).rejects.toThrow(/mesmo cliente/);
    expect((await q(`select estagio from rec_titulos where id = $1`, [c.a])).rows[0].estagio).toBe("boleto_enviado");
  });

  it("quem só consulta não consegue, e resultado inválido é recusado", async () => {
    const c = await preparar();
    await expect(registrar(finConsulta, [c.a], "confirmou")).rejects.toThrow(/permissão/);
    expect((await q(`select estagio from rec_titulos where id = $1`, [c.a])).rows[0].estagio).toBe("boleto_enviado");
    expect((await q(`select 1 from interacoes where referencia_id = $1`, [c.a])).rows).toHaveLength(0);
    await expect(registrar(finOperador, [c.a], "talvez")).rejects.toThrow(/Resultado inválido/);
  });

  it("pendência que é de outra pessoa não é concluída por operador (a confirmação fica registrada)", async () => {
    const c = await preparar();
    await q(`update pendencias set responsavel_id = $1 where referencia_id = $2`, [outroOperador, c.cliente]);
    const r = await registrar(finOperador, [c.a, c.b], "confirmou");
    expect(r.rows[0].r.pendencias_concluidas).toBe(0);
    expect((await pendencias(c.cliente))[0].status).toBe("aberta");
    expect((await q(`select estagio from rec_titulos where id = $1`, [c.a])).rows[0].estagio).toBe("confirmado_cliente");
  });
});

describe("rec_registrar_confirmacao: sem resposta", () => {
  it("mantém o estágio, registra, conclui a confirmação e abre a ligação (alta, prazo hoje, sem duplicar)", async () => {
    const c = await preparar();
    const r = await registrar(finOperador, [c.a, c.b], "sem_resposta");
    expect(r.rows[0].r).toEqual({ parcelas: 2, pendencias_concluidas: 1, pendencia_ligar: 1 });
    expect((await q(`select estagio from rec_titulos where id = $1`, [c.a])).rows[0].estagio).toBe("boleto_enviado");
    expect((await q(`select tipo from interacoes where referencia_id = $1`, [c.a])).rows[0].tipo).toBe("sem_resposta_confirmacao");

    const ps = await pendencias(c.cliente);
    expect(ps.map((x) => `${x.titulo.split(":")[0]}|${x.status}`)).toEqual(["Confirmar pagamento|concluida", "Ligar para confirmar pagamento|aberta"]);
    const ligar = (await q(`select criticidade, prazo, link, referencia_tabela from pendencias where titulo like 'Ligar para confirmar pagamento:%' and referencia_id = $1`, [c.cliente])).rows[0];
    expect(ligar.criticidade).toBe("alta");
    expect(ligar.referencia_tabela).toBe("contrapartes");
    expect(ligar.link).toBe(`/financeiro/recebiveis/confirmar/${c.cliente}`);

    // registrar "sem resposta" de novo não cria outra ligação aberta
    const de_novo = await registrar(finOperador, [c.a], "sem_resposta");
    expect(de_novo.rows[0].r.pendencia_ligar).toBe(0);
    expect((await q(`select count(*)::int as n from pendencias where titulo like 'Ligar para%' and referencia_id = $1 and status = 'aberta'`, [c.cliente])).rows[0].n).toBe(1);
  });

  it("depois de sem resposta, ainda dá para registrar que o cliente confirmou", async () => {
    const c = await preparar();
    await registrar(finOperador, [c.a], "sem_resposta");
    const r = await registrar(finOperador, [c.a], "confirmou", "telefone");
    expect(r.rows[0].r.parcelas).toBe(1);
    expect((await q(`select estagio from rec_titulos where id = $1`, [c.a])).rows[0].estagio).toBe("confirmado_cliente");
    // a ligação (aberta pelo "sem resposta") acaba junto: não fica órfã na Fila do dia
    expect(r.rows[0].r.pendencias_concluidas).toBe(1);
    expect((await pendencias(c.cliente)).map((x) => `${x.titulo.split(":")[0]}|${x.status}`)).toEqual(["Confirmar pagamento|concluida", "Ligar para confirmar pagamento|concluida"]);
  });
});
