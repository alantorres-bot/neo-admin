import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let rhConsulta: string, rhOperador: string, rhGestor: string, soFinanceiro: string;
let comp: string;
const itens: Record<string, string> = {};

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const item = async (cod: string) => (await rpc(rhConsulta, `select * from rh_fp_itens where id = $1`, [itens[cod]])).rows[0];
const salvar = (linhas: Record<string, unknown>[]) => rpc(rhOperador, `select rh_fp_salvar_itens($1, $2::jsonb) as n`, [comp, JSON.stringify(linhas)]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  rhConsulta = await novoUsuario(db, "consulta@neo.com", { rh: "consulta" });
  rhOperador = await novoUsuario(db, "operador@neo.com", { rh: "operador" });
  rhGestor = await novoUsuario(db, "gestor@neo.com", { rh: "gestor" });
  soFinanceiro = await novoUsuario(db, "fin@neo.com", { financeiro: "gestor" });
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Formas', 'NEO FORMAS', '1') returning id`)).rows[0].id;
  const cad = (cod: string, cpf: string | null, forma: string, vt: boolean, ativo = true, empregador = "NEO SERVIÇOS") =>
    q(`insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, cpf, agencia, conta, forma_pagamento, recebe_vt, tarifa, ativo)
       values ($1, $7, $2::text, 'PESSOA ' || $2::text, $3::text, case when $3::text is null then null else '2764-2' end, case when $3::text is null then null else '9999-9' end, $4, $5, case when $5 then 4.95 end, $6)`,
      [empresa, cod, cpf, forma, vt, ativo, empregador]);
  await cad("660", null, "pix", true, true, "OESTE");
  await cad("658", "111.444.777-35", "fopag", true);
  await cad("662", "222.333.444-05", "fopag", false);
  await cad("999", null, "fopag", false, false);
});

describe("folha de pagamento: mês e pagamento (0511)", () => {
  it("módulo ativo; 5º dia útil do mês seguinte", async () => {
    expect((await q(`select nome, ativo from modulos where codigo = 'rh.folha'`)).rows[0]).toEqual({ nome: "Folha de pagamento", ativo: true });
    const r = (await q(`select rh_enesimo_dia_util('2026-10-01', 5)::text as out, rh_enesimo_dia_util('2026-11-01', 5)::text as nov`)).rows[0];
    expect(r).toEqual({ out: "2026-10-07", nov: "2026-11-06" });
  });

  it("só operador do RH abre o mês; entram todos os ativos (com ou sem VT), valores zerados", async () => {
    await expect(rpc(rhConsulta, `select rh_fp_abrir_competencia('2026-09-01')`)).rejects.toThrow(/operador do RH/);
    await expect(rpc(soFinanceiro, `select rh_fp_abrir_competencia('2026-09-01')`)).rejects.toThrow(/operador do RH/);
    comp = (await rpc(rhOperador, `select rh_fp_abrir_competencia('2026-09-20') as id`)).rows[0].id;
    expect((await rpc(rhConsulta, `select competencia::text, data_pagamento::text, status from rh_fp_competencias where id = $1`, [comp])).rows[0])
      .toEqual({ competencia: "2026-09-01", data_pagamento: "2026-10-07", status: "aberta" });
    const linhas = (await rpc(rhConsulta, `select id, cod_fornecedor, empregador, valor::text from rh_fp_itens where competencia_id = $1 order by cod_fornecedor`, [comp])).rows;
    for (const l of linhas) itens[l.cod_fornecedor as string] = l.id as string;
    expect(linhas.map((l) => [l.cod_fornecedor, l.empregador, l.valor])).toEqual([["658", "NEO SERVIÇOS", "0.00"], ["660", "OESTE", "0.00"], ["662", "NEO SERVIÇOS", "0.00"]]);
    await expect(rpc(rhOperador, `select rh_fp_abrir_competencia('2026-09-01')`)).rejects.toThrow(/já foi aberta/);
    expect((await q(`select count(*)::int as n from pendencias where modulo = 'rh.folha' and titulo = 'Fechar folha de setembro/2026' and status = 'aberta'`)).rows[0].n).toBe(1);
    expect((await como(db, soFinanceiro, () => q(`select count(*)::int as n from rh_fp_itens`))).rows[0].n).toBe(0);
  });

  it("valor a pagar = líquido + férias/acréscimos + 13º (+ avulso dos recibos)", async () => {
    await salvar([
      { id: itens["658"], liquido: 2398.59 },
      { id: itens["662"], liquido: 5112.46, ferias_acrescimos: 1000, decimo_terceiro: 500.005, avulso: 4749.27, avulso_motivo: "ignorado: vem dos recibos" },
      { id: itens["660"], liquido: 3775.57, forma_pagamento: "pix" },
    ]);
    expect(await item("662")).toMatchObject({ decimo_terceiro: "500.01", avulso: "0.00", valor: "6612.47" });   // avulso só pelos recibos (0514)
    await expect(salvar([{ id: itens["658"], liquido: -1 }])).rejects.toThrow(/check/i);
    await expect(rpc(rhOperador, `update rh_fp_itens set liquido = 5 where id = $1`, [itens["658"]])).resolves.toMatchObject({ affectedRows: 0 });
  });

  it("atualizar do cadastro traz dados novos e quem entrou; valores ficam", async () => {
    await q(`update rh_colaboradores set ativo = true where cod_fornecedor = '999'`);
    await q(`update rh_colaboradores set agencia = '1216-5' where cod_fornecedor = '658'`);
    expect((await rpc(rhOperador, `select rh_fp_atualizar_do_cadastro($1) as r`, [comp])).rows[0].r).toEqual({ atualizados: 1, incluidos: 1 });
    expect(await item("658")).toMatchObject({ agencia: "1216-5", liquido: "2398.59" });
  });

  it("conferir recusa mês vazio e FOPAG com valor sem conta; ok troca a pendência e trava a grade", async () => {
    const i999 = (await rpc(rhConsulta, `select id from rh_fp_itens where competencia_id = $1 and cod_fornecedor = '999'`, [comp])).rows[0].id;
    await salvar([{ id: i999, liquido: 100 }]);
    await expect(rpc(rhOperador, `select rh_fp_conferir($1)`, [comp])).rejects.toThrow(/FOPAG sem CPF.*999/);
    await salvar([{ id: i999, liquido: 0 }]);
    await rpc(rhOperador, `select rh_fp_conferir($1)`, [comp]);
    expect((await q(`select titulo, status from pendencias where modulo = 'rh.folha' order by criado_em, titulo`)).rows)
      .toEqual([{ titulo: "Fechar folha de setembro/2026", status: "concluida" }, { titulo: "Aprovar folha de setembro/2026", status: "aberta" }]);
    await expect(salvar([{ id: itens["658"], liquido: 1 }])).rejects.toThrow(/esta ação não vale/);
    await expect(q(`update rh_fp_itens set liquido = 1 where id = $1`, [itens["658"]])).rejects.toThrow(/não está aberta/);
  });

  it("operador não aprova; gestor aprova; arquivo do BB, PIX e paga", async () => {
    await expect(rpc(rhOperador, `select rh_fp_aprovar($1)`, [comp])).rejects.toThrow(/gestor do RH/);
    await rpc(rhGestor, `select rh_fp_aprovar($1)`, [comp]);
    await expect(rpc(rhOperador, `select rh_fp_marcar_paga($1)`, [comp])).rejects.toThrow(/arquivo do BB/);
    await expect(rpc(rhOperador, `select rh_fp_registrar_arquivo_bb($1)`, [comp])).rejects.toThrow(/gestor/);
    await rpc(rhGestor, `select rh_fp_registrar_arquivo_bb($1)`, [comp]);
    await expect(rpc(rhOperador, `select rh_fp_marcar_paga($1)`, [comp])).rejects.toThrow(/1 PIX/);
    expect((await rpc(rhOperador, `select rh_fp_marcar_pix($1, $2::uuid[], true) as n`, [comp, [itens["660"], itens["658"]]])).rows[0].n).toBe(1);
    expect(await item("660")).toMatchObject({ pix_pago_por: rhOperador, valor: "3775.57" });
    await rpc(rhOperador, `select rh_fp_marcar_paga($1)`, [comp]);
    expect((await rpc(rhConsulta, `select status from rh_fp_competencias where id = $1`, [comp])).rows[0].status).toBe("paga");
  });

  it("reabrir: só gestor, com motivo; volta a aberta; nada se apaga", async () => {
    await expect(rpc(rhOperador, `select rh_fp_reabrir($1, 'erro')`, [comp])).rejects.toThrow(/gestor/);
    await expect(rpc(rhGestor, `select rh_fp_reabrir($1, ' ')`, [comp])).rejects.toThrow(/motivo/);
    await rpc(rhGestor, `select rh_fp_reabrir($1, 'faltou um avulso')`, [comp]);
    expect((await rpc(rhConsulta, `select status, reaberta_motivo, arquivo_bb_gerado_em from rh_fp_competencias where id = $1`, [comp])).rows[0])
      .toEqual({ status: "aberta", reaberta_motivo: "faltou um avulso", arquivo_bb_gerado_em: null });
    await expect(q(`delete from rh_fp_itens where id = $1`, [itens["658"]])).rejects.toThrow(/não podem ser excluídos/);
  });
});
