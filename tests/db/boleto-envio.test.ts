import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string, outroOperador: string;
let empresa: string, cliente: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";

type Cenario = { nota: string; a: string; b: string; avulso: string };

/** Cada teste ganha a sua NF (duas parcelas) e um título avulso, cada um com a sua pendência "Anexar boleto". */
async function preparar(): Promise<Cenario> {
  const n = ++contador;
  const nota = (await q(`insert into rec_notas_saida (empresa_id, nota, serie, pedidos) values ($1, $2, '1', '{199}') returning id`, [empresa, String(1000 + n)])).rows[0].id as string;
  const novo = async (doc: string, notaId: string | null) =>
    (await q(
      `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio, nota_saida_id, entrou_esteira_em)
       values ($1, $2, $3, '1', '2999-01-01', 1000, 'aguardando_boleto', $4, now()) returning id`,
      [empresa, cliente, doc, notaId],
    )).rows[0].id as string;
  const a = await novo(`A${n}`, nota);
  const b = await novo(`B${n}`, nota);
  const avulso = await novo(`Z${n}`, null);
  await q(`insert into pendencias (modulo, titulo, prazo, referencia_tabela, referencia_id) values ($1, 'Anexar boleto(s): NF (2 parcelas)', current_date, 'rec_notas_saida', $2)`, [MOD, nota]);
  await q(`insert into pendencias (modulo, titulo, prazo, referencia_tabela, referencia_id) values ($1, 'Anexar boleto: avulso', current_date, 'rec_titulos', $2)`, [MOD, avulso]);
  return { nota, a, b, avulso };
}

const anexar = (id: string, tipo = "boleto") =>
  q(`insert into anexos (modulo, referencia_tabela, referencia_id, arquivo_path, nome_arquivo, tipo) values ($1, 'rec_titulos', $2, 'x/y.pdf', 'y.pdf', $3)`, [MOD, id, tipo]);

const marcar = (usuario: string, ids: string[], canal = "email", descricao: string | null = "teste") =>
  como(db, usuario, () => q(`select rec_marcar_boleto_enviado($1::uuid[], $2::canal, $3) as r`, [ids, canal, descricao]));

const statusPendencia = async (refId: string) => (await q(`select status, concluido_por from pendencias where referencia_id = $1`, [refId])).rows[0];

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003): não pode ser um dos de teste
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  outroOperador = await novoUsuario(db, "operador2@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });

  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
  cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('Cliente Teste', '{cliente}', '156') returning id`)).rows[0].id;
});

describe("rec_marcar_boleto_enviado", () => {
  it("operador marca as parcelas, registra a interação e conclui a pendência quando acabam as parcelas da NF", async () => {
    const c = await preparar();
    await anexar(c.a);
    await anexar(c.b);
    const r = await marcar(finOperador, [c.a, c.b]);
    expect(r.rows[0].r).toEqual({ parcelas: 2, pendencias_concluidas: 1 });

    const t = await q(`select estagio, boleto_enviado_em is not null as enviado from rec_titulos where id = any($1::uuid[])`, [[c.a, c.b]]);
    expect(t.rows).toEqual([{ estagio: "boleto_enviado", enviado: true }, { estagio: "boleto_enviado", enviado: true }]);

    const i = await q(`select tipo, canal, usuario_id, contraparte_id from interacoes where referencia_id = any($1::uuid[])`, [[c.a, c.b]]);
    expect(i.rows).toHaveLength(2);
    expect(i.rows.every((x) => x.tipo === "boleto_enviado" && x.canal === "email" && x.usuario_id === finOperador && x.contraparte_id === cliente)).toBe(true);

    expect(await statusPendencia(c.nota)).toEqual({ status: "concluida", concluido_por: finOperador });
    expect((await statusPendencia(c.avulso)).status).toBe("aberta"); // outra pendência, intocada
  });

  it("com parcela da NF ainda aguardando, a pendência continua aberta", async () => {
    const c = await preparar();
    await anexar(c.a);
    const r = await marcar(finOperador, [c.a]);
    expect(r.rows[0].r).toEqual({ parcelas: 1, pendencias_concluidas: 0 });
    expect((await statusPendencia(c.nota)).status).toBe("aberta");
    // enviando a segunda parcela depois, conclui
    await anexar(c.b);
    expect((await marcar(finOperador, [c.b])).rows[0].r).toEqual({ parcelas: 1, pendencias_concluidas: 1 });
    expect((await statusPendencia(c.nota)).status).toBe("concluida");
  });

  it("título avulso (sem NF) conclui a própria pendência", async () => {
    const c = await preparar();
    await anexar(c.avulso);
    const r = await marcar(finOperador, [c.avulso]);
    expect(r.rows[0].r).toEqual({ parcelas: 1, pendencias_concluidas: 1 });
    expect((await statusPendencia(c.avulso)).status).toBe("concluida");
    expect((await statusPendencia(c.nota)).status).toBe("aberta");
  });

  it("sem boleto anexado não marca nada (e nada muda)", async () => {
    const c = await preparar();
    await anexar(c.a);
    await expect(marcar(finOperador, [c.a, c.b])).rejects.toThrow(/Anexe o boleto/);
    const t = await q(`select estagio from rec_titulos where id = any($1::uuid[])`, [[c.a, c.b]]);
    expect(t.rows.every((x) => x.estagio === "aguardando_boleto")).toBe(true);
    expect((await q(`select 1 from interacoes where referencia_id = any($1::uuid[])`, [[c.a, c.b]])).rows).toHaveLength(0);
  });

  it("anexo de outro tipo (comprovante) não vale como boleto", async () => {
    const c = await preparar();
    await anexar(c.a, "comprovante");
    await expect(marcar(finOperador, [c.a])).rejects.toThrow(/Anexe o boleto/);
  });

  it("não marca duas vezes, nem lista vazia", async () => {
    const c = await preparar();
    await anexar(c.a);
    await marcar(finOperador, [c.a]);
    await expect(marcar(finOperador, [c.a])).rejects.toThrow(/já não está aguardando/);
    await expect(marcar(finOperador, [])).rejects.toThrow(/pelo menos uma parcela/);
  });

  it("repetir o mesmo id na lista conta uma vez só", async () => {
    const c = await preparar();
    await anexar(c.a);
    expect((await marcar(finOperador, [c.a, c.a])).rows[0].r.parcelas).toBe(1);
  });

  it("quem só consulta não consegue", async () => {
    const c = await preparar();
    await anexar(c.a);
    await expect(marcar(finConsulta, [c.a])).rejects.toThrow(/permissão/);
    expect((await q(`select estagio from rec_titulos where id = $1`, [c.a])).rows[0].estagio).toBe("aguardando_boleto");
    expect((await q(`select 1 from interacoes where referencia_id = $1`, [c.a])).rows).toHaveLength(0);
  });

  it("pendência que é de outra pessoa não é concluída por operador (o envio fica registrado); o gestor conclui", async () => {
    const c = await preparar();
    await anexar(c.a);
    await anexar(c.b);
    await q(`update pendencias set responsavel_id = $1 where referencia_id = $2`, [outroOperador, c.nota]);
    const r = await marcar(finOperador, [c.a, c.b]);
    expect(r.rows[0].r).toEqual({ parcelas: 2, pendencias_concluidas: 0 });
    expect((await statusPendencia(c.nota)).status).toBe("aberta");
    expect((await q(`select estagio from rec_titulos where id = $1`, [c.a])).rows[0].estagio).toBe("boleto_enviado");

    // o gestor da área consegue concluir (envio de outra NF, com pendência de outra pessoa)
    const g = await preparar();
    await anexar(g.a);
    await anexar(g.b);
    await q(`update pendencias set responsavel_id = $1 where referencia_id = $2`, [outroOperador, g.nota]);
    expect((await marcar(finGestor, [g.a, g.b])).rows[0].r).toEqual({ parcelas: 2, pendencias_concluidas: 1 });
  });

  it("os modelos de mensagem do boleto vêm semeados, e o de e-mail termina em Atenciosamente,", async () => {
    const r = await q(`select nome, canal, assunto, corpo from modelos_mensagem where modulo = $1 and nome like 'Envio de boleto%' order by canal`, [MOD]);
    expect(r.rows.map((x) => x.nome)).toEqual(["Envio de boleto — e-mail", "Envio de boleto — WhatsApp"]);
    const email = r.rows.find((x) => x.canal === "email")!;
    expect(email.assunto).toContain("{referencia}");
    expect(email.corpo.trimEnd().endsWith("Atenciosamente,")).toBe(true);
    for (const m of r.rows) expect(m.corpo).toContain("{parcelas}");
  });
});
