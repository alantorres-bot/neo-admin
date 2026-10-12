import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let empresa: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const LINHAS = JSON.stringify([
  { ordem: 1, data_compra: "2026-09-18", descricao: "Loja Azul", valor: 100, descartada: false },
  { ordem: 2, data_compra: "2026-09-10", descricao: "Pagamento 1", valor: -500, descartada: true },
]);
const importar = (usuario: string, cartao: string, vencimento: string, ciclo: string | null = null) =>
  rpc(usuario, `select crt_importar_fatura($1, $2, $3::date, 100, 'sicredi', 'f.pdf', $4::jsonb, null, $5::uuid) as id`, [empresa, cartao, vencimento, LINHAS, ciclo]);
const ciclo = async (cartao: string, competencia: string) =>
  (await q(`select * from crt_ciclos where empresa_id = $1 and cartao = $2 and competencia = $3::date`, [empresa, cartao, competencia])).rows[0];
const pendencias = async (cicloId: string) =>
  (await q(`select titulo, status from pendencias where referencia_tabela = 'crt_ciclos' and referencia_id = $1 order by criado_em, titulo`, [cicloId])).rows.map((p) => `${p.titulo}|${p.status}`);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
});

describe("calendário do ciclo", () => {
  it("vencimento no mês da competência; fechamento é o último antes dele; meses curtos", async () => {
    const cal = async (f: number, v: number, comp: string) => (await q(`select * from crt_calendario($1, $2, $3::date)`, [f, v, comp])).rows[0];
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const sicrediPf = await cal(26, 10, "2026-10-01");
    expect([fmt(sicrediPf.vencimento), fmt(sicrediPf.fechamento)]).toEqual(["2026-10-10", "2026-09-26"]);
    const interPj = await cal(3, 10, "2026-10-01");
    expect([fmt(interPj.vencimento), fmt(interPj.fechamento)]).toEqual(["2026-10-10", "2026-10-03"]);
    const fev = await cal(31, 28, "2027-03-01");
    expect([fmt(fev.vencimento), fmt(fev.fechamento)]).toEqual(["2027-03-28", "2027-02-28"]);
    const viraAno = await cal(26, 10, "2027-01-01");
    expect(fmt(viraAno.fechamento)).toBe("2026-12-26");
  });
  it("competência do vencimento efetivo deslocado para o dia útil", async () => {
    const comp = async (v: number, d: string) => ((await q(`select crt_competencia_do_vencimento($1, $2::date) as c`, [v, d])).rows[0].c as Date).toISOString().slice(0, 10);
    expect(await comp(10, "2026-10-13")).toBe("2026-10-01");   // sábado 10/10 → segunda 13/10
    expect(await comp(30, "2026-11-02")).toBe("2026-10-01");   // 30/10 deslocado para 02/11 continua sendo outubro
    expect(await comp(1, "2026-11-01")).toBe("2026-11-01");
  });
});

describe("gerar ciclos", () => {
  it("cria os ciclos que já fecharam desde a competência inicial, com a pendência Importar; é idempotente; consulta pode chamar", async () => {
    await q(`update configuracoes set valor = '"2026-01-01"' where chave = 'financeiro.cartao.ciclos_a_partir_de'`);
    const criados = (await rpc(finConsulta, `select crt_gerar_ciclos() as n`)).rows[0].n;
    expect(criados).toBeGreaterThan(8);
    expect((await rpc(finConsulta, `select crt_gerar_ciclos() as n`)).rows[0].n).toBe(0);
    const c = await ciclo("SICREDI PF", "2026-01-01");
    expect(c.situacao).toBe("aguardando_fatura");
    expect(await pendencias(c.id)).toEqual(["Importar fatura SICREDI PF 01/2026|aberta"]);
    // nenhum ciclo cujo fechamento ainda não passou
    const futuros = (await q(`select count(*)::int as n from crt_ciclos where fechamento >= (now() at time zone 'America/Cuiaba')::date`)).rows[0].n;
    expect(futuros).toBe(0);
    await expect(como(db, "service", () => q(`delete from crt_ciclos where id = $1`, [c.id]))).rejects.toThrow(/não podem ser excluídos/);
  });
});

describe("importar, apurar, fechar, reabrir e pagar", () => {
  let cicloId: string;
  let faturaId: string;
  it("importar leva o ciclo a em_conciliacao e conclui Importar; sem ciclo informado, acha pelo vencimento", async () => {
    const c = await ciclo("SICREDI PF", "2026-02-01");
    cicloId = c.id;
    faturaId = (await importar(finOperador, "SICREDI PF", "2026-02-10", cicloId)).rows[0].id;
    const depois = await ciclo("SICREDI PF", "2026-02-01");
    expect(depois).toMatchObject({ situacao: "em_conciliacao", fatura_id: faturaId });
    expect(await pendencias(cicloId)).toEqual(["Importar fatura SICREDI PF 02/2026|concluida"]);
    const outra = (await importar(finOperador, "SICREDI PF", "2026-03-11")).rows[0].id;   // vencimento deslocado, sem ciclo
    expect((await ciclo("SICREDI PF", "2026-03-01")).fatura_id).toBe(outra);
    await expect(importar(finOperador, "SICREDI PF", "2026-02-10", cicloId)).rejects.toThrow(/já foi importada/);
    await expect(importar(finOperador, "INTER PJ", "2026-02-10", cicloId)).rejects.toThrow(/não é deste mês/);
  });
  it("apuração com pendência abre Conciliar; zerada conclui Conciliar e abre Fechar", async () => {
    await rpc(finConsulta, `select crt_registrar_apuracao($1, 3, 4936.77, 4936.74, '131026')`, [cicloId]);
    expect((await ciclo("SICREDI PF", "2026-02-01"))).toMatchObject({ itens_a_lancar: 3, provisorio_cod_lancamento: "131026" });
    await rpc(finConsulta, `select crt_registrar_apuracao($1, 3, 4936.77, 4936.74, '131026')`, [cicloId]);   // não duplica
    expect(await pendencias(cicloId)).toEqual(["Importar fatura SICREDI PF 02/2026|concluida", "Conciliar fatura SICREDI PF 02/2026|aberta"]);
    await rpc(finConsulta, `select crt_registrar_apuracao($1, 0, 0, 0, '131026')`, [cicloId]);
    expect(await pendencias(cicloId)).toEqual([
      "Importar fatura SICREDI PF 02/2026|concluida", "Conciliar fatura SICREDI PF 02/2026|concluida", "Fechar a fatura SICREDI PF 02/2026|aberta",
    ]);
  });
  it("fechar: só gestor, só zerado; grava o fechamento; reabrir só gestor com motivo", async () => {
    const fechar = (u: string, itens: number, residuo: number) =>
      rpc(u, `select crt_fechar_ciclo($1, '{"quadro":[]}'::jsonb, $2, $3, 100, 100, '131026') as id`, [cicloId, itens, residuo]);
    await expect(fechar(finOperador, 0, 0)).rejects.toThrow(/Somente gestor/);
    await expect(fechar(finGestor, 2, 0)).rejects.toThrow(/sem título no Consistem/);
    await expect(fechar(finGestor, 0, 0.03)).rejects.toThrow(/precisa ser zero/);
    const fechamento = (await fechar(finGestor, 0, 0)).rows[0].id;
    expect(await ciclo("SICREDI PF", "2026-02-01")).toMatchObject({ situacao: "fechada", fechada_por: finGestor });
    expect((await q(`select versao, fechado_por from crt_fechamentos where id = $1`, [fechamento])).rows[0]).toEqual({ versao: 1, fechado_por: finGestor });
    expect((await pendencias(cicloId)).filter((p) => p.endsWith("|aberta"))).toEqual([]);
    // fechado: não importa nem cancela fatura; apuração é ignorada
    await expect(rpc(finOperador, `select crt_cancelar_fatura($1, 'teste')`, [faturaId])).rejects.toThrow(/reabra o mês/);
    await rpc(finConsulta, `select crt_registrar_apuracao($1, 5, 1, 1, null)`, [cicloId]);
    expect((await ciclo("SICREDI PF", "2026-02-01")).itens_a_lancar).toBe(0);
    expect((await rpc(finGestor, `update crt_fechamentos set total_fatura = 1 where id = $1`, [fechamento])).affectedRows).toBe(0); // sem política de update
    await expect(como(db, "service", () => q(`update crt_fechamentos set total_fatura = 1 where id = $1`, [fechamento]))).rejects.toThrow(/imutável/);
    await expect(rpc(finOperador, `select crt_reabrir_ciclo($1, 'erro')`, [cicloId])).rejects.toThrow(/Somente gestor/);
    await expect(rpc(finGestor, `select crt_reabrir_ciclo($1, ' ')`, [cicloId])).rejects.toThrow(/motivo/);
    await rpc(finGestor, `select crt_reabrir_ciclo($1, 'título lançado errado')`, [cicloId]);
    expect((await ciclo("SICREDI PF", "2026-02-01")).situacao).toBe("em_conciliacao");
    expect((await q(`select motivo_reabertura, reaberto_por from crt_fechamentos where id = $1`, [fechamento])).rows[0]).toEqual({ motivo_reabertura: "título lançado errado", reaberto_por: finGestor });
    const segundo = (await fechar(finGestor, 0, 0)).rows[0].id;
    expect((await q(`select versao from crt_fechamentos where id = $1`, [segundo])).rows[0].versao).toBe(2);
  });
  it("paga: quando o provisório recebe baixado_em na sincronização, o ciclo fechado vira paga", async () => {
    await como(db, "service", () => q(
      `insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, data_vencimento, valor_documento, valor_atualizado)
       values ($1, '131026', 'C', '80', '131026', '2026-02-13', 100, 100)`, [empresa]));
    expect((await ciclo("SICREDI PF", "2026-02-01")).situacao).toBe("fechada");
    await como(db, "service", () => q(`update cap_lancamentos set baixado_em = '2026-02-13' where cod_lancamento = '131026'`));
    const c = await ciclo("SICREDI PF", "2026-02-01");
    expect(c.situacao).toBe("paga");
    expect((c.paga_em as Date).toISOString().slice(0, 10)).toBe("2026-02-13");
    await expect(rpc(finGestor, `select crt_reabrir_ciclo($1, 'x')`, [cicloId])).rejects.toThrow(/ainda não pago/);
  });
  it("cancelar a fatura volta o ciclo para aguardando e reabre Importar", async () => {
    const c = await ciclo("SICREDI PF", "2026-03-01");
    await rpc(finConsulta, `select crt_registrar_apuracao($1, 1, 1, 1, null)`, [c.id]);
    await rpc(finOperador, `select crt_cancelar_fatura($1, 'total errado')`, [c.fatura_id]);
    const depois = await ciclo("SICREDI PF", "2026-03-01");
    expect(depois).toMatchObject({ situacao: "aguardando_fatura", fatura_id: null, itens_a_lancar: null });
    const ps = await pendencias(c.id);
    expect(ps.filter((p) => p.endsWith("|aberta"))).toEqual(["Importar fatura SICREDI PF 03/2026|aberta"]);
    expect(ps).toContain("Conciliar fatura SICREDI PF 03/2026|cancelada");
  });
});

describe("backfill da 0134 com fatura já importada (como em produção)", () => {
  it("a fatura importada antes da 0134 ganha o seu ciclo em conciliação", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const b = await criarBanco({ ate: "0133_zz" });
    await novoUsuario(b, "admin@neo.com");
    const op = await novoUsuario(b, "op@neo.com", { financeiro: "operador" });
    const emp = (await b.query<Linha>(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo', 'Neo', '1') returning id`)).rows[0].id;
    await como(b, op, () => b.query(`select crt_importar_fatura($1, 'SICREDI PF', '2026-10-10', 100, 'sicredi', 'f.pdf', $2::jsonb)`, [emp, LINHAS]));
    await b.exec(readFileSync(join(process.cwd(), "supabase", "migrations", "0134_crt_ciclos.sql"), "utf8"));
    const c = (await b.query<Linha>(`select c.situacao, to_char(c.competencia, 'YYYY-MM') as comp, f.ciclo_id = c.id as ligado from crt_ciclos c join crt_faturas f on f.id = c.fatura_id`)).rows;
    expect(c).toEqual([{ situacao: "em_conciliacao", comp: "2026-10", ligado: true }]);
  });
});
