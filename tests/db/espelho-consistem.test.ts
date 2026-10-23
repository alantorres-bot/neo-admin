import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// 0183: Recebíveis é espelho do Consistem. Baixa só do que saiu da lista de abertos; reabertura só do que o Consistem lista em
// aberto; ninguém grava estágio de baixa, valor ou vencimento direto na tabela.
let db: PGlite;
let operador: string;
let consulta: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";

async function novoTitulo(estagio = "vencido", origem = "importacao") {
  const n = ++contador;
  const cp = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ($1, '{cliente}', $2) returning id`, [`CLIENTE E${n}`, `e${n}`])).rows[0].id;
  return (await q(
    `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, emissao, vencimento, valor, estagio, origem)
     values ($1, $2, $3, '1', current_date - 40, current_date - 10, 1000, $4, $5) returning id`,
    [empresa, cp, `E${n}`, estagio, origem],
  )).rows[0].id as string;
}
const pendencia = (id: string, titulo: string) =>
  q(`insert into pendencias (modulo, titulo, prazo, referencia_tabela, referencia_id) values ($1, $2, current_date, 'rec_titulos', $3)`, [MOD, titulo, id]);
const baixar = (quem: string, id: string) =>
  como(db, quem, () => q(`select rec_registrar_baixa($1, 'pago', current_date - 1, 1000, null) as r`, [id]));
const reabrir = (quem: string, id: string, motivo = "Estorno da baixa no Consistem") =>
  como(db, quem, () => q(`select rec_reabrir_titulo($1, $2) as r`, [id, motivo]));
const linha = async (id: string) =>
  (await q(`select estagio::text, data_pagamento, valor_pago, estagio_antes_baixa::text from rec_titulos where id = $1`, [id])).rows[0];
const statusPendencias = async (id: string) =>
  Object.fromEntries((await q(`select titulo, status from pendencias where referencia_id = $1`, [id])).rows.map((r) => [r.titulo, r.status]));

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  operador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  consulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
});

describe("baixa só do que saiu do Consistem", () => {
  it("título ainda em aberto no Consistem (sem Possível baixa) não é baixado", async () => {
    const id = await novoTitulo();
    await expect(baixar(operador, id)).rejects.toThrow(/ainda está em aberto no Consistem/);
    expect((await linha(id)).estagio).toBe("vencido");
  });

  it("com Possível baixa, baixa e guarda o estágio de antes", async () => {
    const id = await novoTitulo("confirmado_cliente");
    await pendencia(id, "Possível baixa: X");
    await baixar(operador, id);
    expect(await linha(id)).toMatchObject({ estagio: "pago", estagio_antes_baixa: "confirmado_cliente" });
  });

  it("título lançado à mão (fora do Consistem) não depende da Possível baixa", async () => {
    const id = await novoTitulo("vencido", "manual");
    await baixar(operador, id);
    expect((await linha(id)).estagio).toBe("pago");
  });
});

describe("trava contra gravação direta", () => {
  it("operador não grava pago, valor, vencimento nem data da baixa direto na tabela", async () => {
    const id = await novoTitulo();
    const direto = (sql: string) => como(db, operador, () => q(sql, [id]));
    await expect(direto(`update rec_titulos set estagio = 'pago', data_pagamento = current_date where id = $1`)).rejects.toThrow(/Baixas a conferir/);
    await expect(direto(`update rec_titulos set estagio = 'cancelado' where id = $1`)).rejects.toThrow(/Baixas a conferir/);
    await expect(direto(`update rec_titulos set valor = 1 where id = $1`)).rejects.toThrow(/só mudam pela sincronização/);
    await expect(direto(`update rec_titulos set vencimento = current_date + 30 where id = $1`)).rejects.toThrow(/só mudam pela sincronização/);
    await expect(direto(`update rec_titulos set valor_pago = 10 where id = $1`)).rejects.toThrow(/só mudam pela baixa/);
    // O que é da cobrança continua livre (as funções de boleto, confirmação e cobrança dependem disso).
    await direto(`update rec_titulos set linha_digitavel = '1', regua_pausada_ate = current_date + 3 where id = $1`);
  });

  it("operador não tira o título de pago direto na tabela", async () => {
    const id = await novoTitulo();
    await pendencia(id, "Possível baixa: Y");
    await baixar(operador, id);
    await expect(como(db, operador, () => q(`update rec_titulos set estagio = 'vencido' where id = $1`, [id]))).rejects.toThrow(/só pode ser reaberto/);
  });

  it("a sincronização (fora do papel authenticated) continua atualizando os dados do Consistem", async () => {
    const id = await novoTitulo();
    await q(`update rec_titulos set valor = 1200, vencimento = current_date + 5 where id = $1`, [id]);
    expect(Number((await q(`select valor from rec_titulos where id = $1`, [id])).rows[0].valor)).toBe(1200);
  });
});

describe("rec_reabrir_titulo", () => {
  async function baixado(estagio = "promessa") {
    const id = await novoTitulo(estagio);
    await pendencia(id, "Possível baixa: Z");
    await baixar(operador, id);
    return id;
  }

  it("recusa enquanto o Consistem não lista o título em aberto", async () => {
    const id = await baixado();
    await expect(reabrir(operador, id)).rejects.toThrow(/não está em aberto no Consistem/);
    expect((await linha(id)).estagio).toBe("pago");
  });

  it("aberto no Consistem: volta ao estágio de antes, limpa a baixa, registra e conclui o aviso", async () => {
    const id = await baixado("promessa");
    await pendencia(id, "Baixado aqui, aberto no Consistem: E1");
    const r = await reabrir(operador, id);
    expect(r.rows[0].r).toMatchObject({ estagio: "promessa", partes_akf: 0 });
    expect(await linha(id)).toEqual({ estagio: "promessa", data_pagamento: null, valor_pago: null, estagio_antes_baixa: null });
    const h = (await q(`select tipo, descricao, usuario_id from interacoes where referencia_id = $1 and tipo = 'reabertura'`, [id])).rows;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ usuario_id: operador });
    expect(h[0].descricao).toMatch(/^Título reaberto \(estava pago; voltou para promessa de pagamento\).*Estorno da baixa no Consistem$/);
    // O histórico da baixa continua (regra 4).
    expect((await q(`select count(*)::int n from interacoes where referencia_id = $1 and tipo = 'baixa'`, [id])).rows[0].n).toBe(1);
    expect((await statusPendencias(id))["Baixado aqui, aberto no Consistem: E1"]).toBe("concluida");
  });

  it("baixa anterior à 0183 (sem estágio guardado) volta pela data", async () => {
    const id = await novoTitulo();
    await q(`update rec_titulos set estagio = 'cancelado' where id = $1`, [id]); // como as baixas antigas: sem estagio_antes_baixa
    await pendencia(id, "Baixado aqui, aberto no Consistem: E2");
    await reabrir(operador, id);
    expect((await linha(id)).estagio).toBe("vencido");
  });

  it("partes da AKF encerradas pela baixa voltam a valer; as encerradas por uma pessoa ficam", async () => {
    const id = await novoTitulo();
    const parte = (await q(`insert into akf_desdobramentos (titulo_id, valor, vencimento) values ($1, 400, current_date + 30) returning id`, [id])).rows[0].id;
    const manual = (await q(
      `insert into akf_desdobramentos (titulo_id, valor, vencimento, status, encerrado_em, encerrado_por, motivo_encerramento)
       values ($1, 100, current_date + 30, 'encerrado', now(), $2, 'Recompra') returning id`, [id, operador])).rows[0].id;
    await pendencia(id, "Possível baixa: W");
    await baixar(operador, id);
    expect((await q(`select status from akf_desdobramentos where id = $1`, [parte])).rows[0].status).toBe("encerrado");

    await pendencia(id, "Baixado aqui, aberto no Consistem: E3");
    const r = await reabrir(operador, id);
    expect(r.rows[0].r).toMatchObject({ partes_akf: 1 });
    expect((await q(`select status, motivo_encerramento from akf_desdobramentos where id = $1`, [parte])).rows[0]).toEqual({ status: "ativo", motivo_encerramento: null });
    expect((await q(`select status from akf_desdobramentos where id = $1`, [manual])).rows[0].status).toBe("encerrado");
  });

  it("recusa: quem só consulta, motivo curto, título que não está encerrado", async () => {
    const id = await baixado();
    await pendencia(id, "Baixado aqui, aberto no Consistem: E4");
    await expect(reabrir(consulta, id)).rejects.toThrow(/operador do Financeiro/);
    await expect(reabrir(operador, id, "abc")).rejects.toThrow(/motivo/);
    const aberto = await novoTitulo();
    await expect(reabrir(operador, aberto)).rejects.toThrow(/não está baixado nem cancelado/);
  });
});
