import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string;
let empresa: string, cliente: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";

/** NF com duas parcelas aguardando boleto, com a pendência "Anexar boleto" da NF. */
async function nf() {
  const n = ++contador;
  const nota = (await q(`insert into rec_notas_saida (empresa_id, nota, serie, pedidos) values ($1, $2, '1', '{199}') returning id`, [empresa, String(2000 + n)])).rows[0].id as string;
  const novo = async (doc: string) =>
    (await q(`insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio, nota_saida_id, entrou_esteira_em)
              values ($1, $2, $3, '1', '2999-01-01', 1000, 'aguardando_boleto', $4, now()) returning id`, [empresa, cliente, doc, nota])).rows[0].id as string;
  const a = await novo(`FA${n}`);
  const b = await novo(`FB${n}`);
  await q(`insert into pendencias (modulo, titulo, prazo, referencia_tabela, referencia_id) values ($1, 'Anexar boleto(s): NF (2 parcelas)', current_date, 'rec_notas_saida', $2)`, [MOD, nota]);
  return { nota, a, b };
}
const anexar = (id: string) => q(`insert into anexos (modulo, referencia_tabela, referencia_id, arquivo_path, nome_arquivo, tipo) values ($1, 'rec_titulos', $2, 'x/y.pdf', 'y.pdf', 'boleto')`, [MOD, id]);
const forma = (usuario: string, ids: string[], f: string) => como(db, usuario, () => q(`select rec_definir_forma_pagamento($1::uuid[], $2) as r`, [ids, f]));
const dados = (usuario: string, ids: string[], canal = "whatsapp", d: string | null = "teste") => como(db, usuario, () => q(`select rec_marcar_dados_enviados($1::uuid[], $2::canal, $3) as r`, [ids, canal, d]));
const boleto = (usuario: string, ids: string[]) => como(db, usuario, () => q(`select rec_marcar_boleto_enviado($1::uuid[], 'email'::canal, 'teste') as r`, [ids]));
const pendencia = async (nota: string) => (await q(`select status from pendencias where referencia_id = $1`, [nota])).rows[0].status as string;
const estado = async (id: string) => (await q(`select forma_pagamento, estagio from rec_titulos where id = $1`, [id])).rows[0];

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
  cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Cliente Forma', '{cliente}', 'f1') returning id`)).rows[0].id;
});

describe("forma de pagamento", () => {
  it("o padrão é boleto, e as empresas ganharam o campo de dados de pagamento", async () => {
    const c = await nf();
    expect((await estado(c.a)).forma_pagamento).toBe("boleto");
    await q(`update empresas set dados_pagamento = 'Banco X, ag. 1, c/c 2' where id = $1`, [empresa]);
    expect((await q(`select dados_pagamento from empresas where id = $1`, [empresa])).rows[0].dados_pagamento).toBe("Banco X, ag. 1, c/c 2");
  });

  it("os modelos de mensagem de dados para pagamento existem (e-mail e WhatsApp)", async () => {
    const r = await q(`select canal, corpo like '%{dados_pagamento}%' as tem from modelos_mensagem where nome like 'Dados para pagamento%' order by canal`);
    expect(r.rows).toEqual([{ canal: "email", tem: true }, { canal: "whatsapp", tem: true }]);
  });

  it("troca a forma, registra no histórico e conclui 'Anexar boleto' quando nenhuma parcela da NF precisa de boleto", async () => {
    const c = await nf();
    const r1 = await forma(finOperador, [c.a], "transferencia");
    expect(r1.rows[0].r).toEqual({ titulos: 1, alterados: 1, pendencias_concluidas: 0 }); // a outra parcela ainda precisa de boleto
    expect(await pendencia(c.nota)).toBe("aberta");
    const r2 = await forma(finOperador, [c.b], "transferencia");
    expect(r2.rows[0].r.pendencias_concluidas).toBe(1);
    expect(await pendencia(c.nota)).toBe("concluida");
    const i = await q(`select tipo, descricao from interacoes where referencia_id = $1`, [c.a]);
    expect(i.rows).toEqual([{ tipo: "forma_pagamento", descricao: "Forma de pagamento: transferência (PIX/TED), sem boleto." }]);
  });

  it("valida a forma, lista vazia, limite, título encerrado (tudo ou nada) e permissão", async () => {
    const c = await nf();
    await expect(forma(finOperador, [c.a], "cheque")).rejects.toThrow(/inválida/);
    await expect(forma(finOperador, [], "boleto")).rejects.toThrow(/pelo menos um título/);
    await expect(forma(finOperador, Array.from({ length: 101 }, () => crypto.randomUUID()), "boleto")).rejects.toThrow(/No máximo 100/);
    const pago = (await q(`insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio, data_pagamento) values ($1, $2, 'FPAGO', '1', current_date - 3, 10, 'pago', current_date) returning id`, [empresa, cliente])).rows[0].id as string;
    await expect(forma(finOperador, [c.a, pago], "transferencia")).rejects.toThrow(/já está encerrado/);
    expect((await estado(c.a)).forma_pagamento).toBe("boleto");
    await expect(forma(finConsulta, [c.a], "transferencia")).rejects.toThrow();
    expect((await estado(c.a)).forma_pagamento).toBe("boleto");
  });
});

describe("rec_marcar_dados_enviados e o envio do boleto", () => {
  it("transferência: marca como enviado SEM boleto, registra a interação e o estágio avança", async () => {
    const c = await nf();
    await forma(finOperador, [c.a], "transferencia");
    const r = await dados(finOperador, [c.a]);
    expect(r.rows[0].r).toEqual({ parcelas: 1 });
    expect((await estado(c.a)).estagio).toBe("boleto_enviado");
    const i = await q(`select tipo, canal, usuario_id from interacoes where referencia_id = $1 and tipo = 'dados_enviados'`, [c.a]);
    expect(i.rows).toEqual([{ tipo: "dados_enviados", canal: "whatsapp", usuario_id: finOperador }]);
  });

  it("reenvio: registrar de novo mantém o estágio e soma outra interação", async () => {
    const c = await nf();
    await forma(finOperador, [c.a], "transferencia");
    await dados(finOperador, [c.a]);
    await dados(finOperador, [c.a], "email", "Reenviado.");
    expect((await q(`select canal from interacoes where referencia_id = $1 and tipo = 'dados_enviados' order by criado_em`, [c.a])).rows.map((x) => x.canal)).toEqual(["whatsapp", "email"]);
  });

  it("cada função recusa a forma errada", async () => {
    const c = await nf();
    await expect(dados(finOperador, [c.a])).rejects.toThrow(/paga por boleto/); // boleto: não é dados de pagamento
    await anexar(c.b);
    await forma(finOperador, [c.b], "transferencia");
    await expect(boleto(finOperador, [c.b])).rejects.toThrow(/paga por transferência/); // transferência: não é boleto
  });

  it("transferência na NF não impede concluir 'Anexar boleto' quando as de boleto são enviadas", async () => {
    const c = await nf();
    await forma(finOperador, [c.b], "transferencia");
    await anexar(c.a);
    const r = await boleto(finOperador, [c.a]);
    expect(r.rows[0].r).toEqual({ parcelas: 1, pendencias_concluidas: 1 });
  });

  it("quem só consulta não registra o envio dos dados", async () => {
    const c = await nf();
    await forma(finOperador, [c.a], "transferencia");
    await expect(dados(finConsulta, [c.a])).rejects.toThrow();
    expect((await estado(c.a)).estagio).toBe("aguardando_boleto");
  });
});
