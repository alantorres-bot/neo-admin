import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// Folhas próprias do 13º (0529): tipo, pagamento sugerido, só 13º nos valores, recibos fora, pendências e Consistem pelo tipo.
let db: PGlite;
let rhOperador: string, rhGestor: string;
let nov: string, d1: string;
const itens: Record<string, string> = {};

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const salvar = (comp: string, linhas: Record<string, unknown>[]) => rpc(rhOperador, `select rh_fp_salvar_itens($1, $2::jsonb) as n`, [comp, JSON.stringify(linhas)]);
const idDe = async (comp: string, cod: string) => (await q(`select id from rh_fp_itens where competencia_id = $1 and cod_fornecedor = $2`, [comp, cod])).rows[0].id as string;

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  rhOperador = await novoUsuario(db, "operador@neo.com", { rh: "operador" });
  rhGestor = await novoUsuario(db, "gestor@neo.com", { rh: "gestor" });
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Formas', 'NEO FORMAS', '1') returning id`)).rows[0].id;
  await q(`insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, forma_pagamento, recebe_vt) values ($1, 'OESTE', '660', 'PESSOA 660', 'pix', false)`, [empresa]);
  await q(`insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, forma_pagamento, recebe_vt, ativo) values ($1, 'OESTE', '700', 'PESSOA 700', 'pix', false, false)`, [empresa]);
});

describe("folha do 13º (0529)", () => {
  it("abre mensal e 13º 1ª parcela no mesmo mês; pagamento até 30/11 e 20/12 (último dia útil)", async () => {
    nov = (await rpc(rhOperador, `select rh_fp_abrir_competencia('2026-11-01') as id`)).rows[0].id as string;
    d1 = (await rpc(rhOperador, `select rh_fp_abrir_competencia('2026-03-15', 'decimo_1') as id`)).rows[0].id as string;
    await rpc(rhOperador, `select rh_fp_abrir_competencia('2026-01-01', 'decimo_2')`);
    expect((await q(`select tipo, competencia::text, data_pagamento::text from rh_fp_competencias order by competencia, tipo`)).rows).toEqual([
      { tipo: "decimo_1", competencia: "2026-11-01", data_pagamento: "2026-11-30" },
      { tipo: "mensal", competencia: "2026-11-01", data_pagamento: "2026-12-07" },
      { tipo: "decimo_2", competencia: "2026-12-01", data_pagamento: "2026-12-18" },   // 20/12/2026 é domingo
    ]);
    await expect(rpc(rhOperador, `select rh_fp_abrir_competencia('2026-11-01', 'decimo_1')`)).rejects.toThrow(/13º 1ª parcela\/2026 já foi aberta/);
    await expect(rpc(rhOperador, `select rh_fp_abrir_competencia('2026-11-01', 'outro')`)).rejects.toThrow(/Tipo de folha inválido/);
    await expect(q(`insert into rh_fp_competencias (competencia, tipo, data_pagamento) values ('2026-10-01', 'decimo_1', '2026-10-30')`)).rejects.toThrow(/check/i);
    expect((await q(`select titulo from pendencias where modulo = 'rh.folha' order by titulo`)).rows.map((r) => r.titulo))
      .toEqual(["Fechar folha de 13º 1ª parcela/2026", "Fechar folha de 13º 2ª parcela/2026", "Fechar folha de novembro/2026"]);
  });

  it("folha do 13º só tem 13º; a mensal não recebe 13º novo", async () => {
    itens.d1 = await idDe(d1, "660");
    itens.nov = await idDe(nov, "660");
    expect((await q(`select count(*)::int as n from rh_fp_itens where competencia_id = $1`, [d1])).rows[0].n).toBe(1);   // inativo fica de fora
    await expect(salvar(d1, [{ id: itens.d1, liquido: 100 }])).rejects.toThrow(/só tem o 13º/);
    await salvar(d1, [{ id: itens.d1, decimo_terceiro: 1672.76 }]);
    await expect(salvar(nov, [{ id: itens.nov, decimo_terceiro: 10 }])).rejects.toThrow(/13º tem folha própria/);
    await salvar(nov, [{ id: itens.nov, liquido: 1954.26 }]);
    expect((await q(`select valor::text from rh_fp_itens where id = $1`, [itens.d1])).rows[0].valor).toBe("1672.76");
  });

  it("recibo avulso de novembro vai só para a folha mensal", async () => {
    const colab = (await q(`select id from rh_colaboradores where cod_fornecedor = '660'`)).rows[0].id;
    const rubrica = (await q(`select codigo from rh_fp_rubricas where natureza = 'provento' order by ordem limit 1`)).rows[0].codigo;
    await rpc(rhOperador, `select rh_fp_gravar_recibo('2026-11-01', $1, 'eventual', 2000, 0, 0, null, null, null, null, $2::jsonb)`,
      [colab, JSON.stringify([{ rubrica, referencia: 0, valor: 300 }])]);
    expect((await q(`select c.tipo, i.avulso::text from rh_fp_itens i join rh_fp_competencias c on c.id = i.competencia_id where i.cod_fornecedor = '660' and c.competencia = '2026-11-01' order by c.tipo`)).rows)
      .toEqual([{ tipo: "decimo_1", avulso: "0.00" }, { tipo: "mensal", avulso: "300.00" }]);
  });

  it("13º por fora (0531): recibo decimo_recorrente entra no avulso da folha do 13º, um por pessoa; mensal não se mistura", async () => {
    const colab = (await q(`select id from rh_colaboradores where cod_fornecedor = '660'`)).rows[0].id;
    const linhas = JSON.stringify([{ rubrica: "decimo_por_fora", referencia: 12, valor: 450 }]);
    const gravar = (tipo: string, folha: string) => rpc(rhOperador,
      `select rh_fp_gravar_recibo('2026-11-01', $1, $2, 2000, 0, 0, null, null, null, null, $3::jsonb, null, $4) as id`, [colab, tipo, linhas, folha]);
    await expect(gravar("decimo_recorrente", "mensal")).rejects.toThrow(/só vai na folha do 13º/);
    await expect(gravar("eventual", "decimo_1")).rejects.toThrow(/só vai na folha do 13º/);
    await expect(gravar("decimo_recorrente", "decimo_2")).rejects.toThrow(/Abra a folha de 13º 2ª parcela\/2026/);   // competência 11 ≠ dezembro
    const id = (await gravar("decimo_recorrente", "decimo_1")).rows[0].id as string;
    await expect(gravar("decimo_recorrente", "decimo_1")).rejects.toThrow(/já tem o recibo do 13º por fora/);
    const avulsos = async () => (await q(`select c.tipo, i.avulso::text, i.avulso_motivo, i.valor::text from rh_fp_itens i join rh_fp_competencias c on c.id = i.competencia_id
      where i.cod_fornecedor = '660' and c.competencia = '2026-11-01' order by c.tipo`)).rows;
    expect(await avulsos()).toEqual([
      { tipo: "decimo_1", avulso: "450.00", avulso_motivo: "Recibo(s): 13º por fora", valor: "2122.76" },
      { tipo: "mensal", avulso: "300.00", avulso_motivo: "Recibo(s): eventual", valor: "2254.26" },
    ]);
    await rpc(rhOperador, `select rh_fp_cancelar_recibo($1, 'teste')`, [id]);
    expect((await avulsos())[0].avulso).toBe("0.00");
    await gravar("decimo_recorrente", "decimo_1");   // cancelado libera gerar de novo
    expect((await avulsos()).map((r) => r.avulso)).toEqual(["450.00", "300.00"]);
    await expect(salvar(d1, [{ id: itens.d1, decimo_terceiro: 1672.76, liquido: 1 }])).rejects.toThrow(/só tem o 13º/);
  });

  it("fluxo com o rótulo do 13º; Consistem: na folha do 13º 1ª parcela só decimo_1", async () => {
    await rpc(rhOperador, `select rh_fp_conferir($1)`, [d1]);
    await rpc(rhGestor, `select rh_fp_aprovar($1)`, [d1]);
    expect((await q(`select titulo, status from pendencias where titulo like '%13º 1ª%' order by criado_em, titulo`)).rows).toEqual([
      { titulo: "Fechar folha de 13º 1ª parcela/2026", status: "concluida" },
      { titulo: "Aprovar folha de 13º 1ª parcela/2026", status: "concluida" },
      { titulo: "Pagar folha de 13º 1ª parcela/2026", status: "aberta" },
    ]);
    await rpc(rhGestor, `select rh_salvar_parametros_lancamento($1::jsonb, false, true)`, [JSON.stringify({
      categoriaDoc: 6, tipos: { salario: { codHistorico: 5, grupoContaFluxoCaixa: 12, contaFluxoCaixa: 3, contaContabilDebito: 3101, contaContabilCredito: 2101 } },
      portadores: [{ empregador: "OESTE", forma: "pix", codPortador: 40, conta: "Conta Oeste" }],
    })]);
    const reservar = (tipo: string) => rpc(rhOperador, `select rh_fp_reservar_lancamentos($1, $2::jsonb)`,
      [d1, JSON.stringify([{ item_id: itens.d1, tipo, payload: { codFornecedor: "660", valorDocumento: 1672.76, dataVencimento: "2026-11-30" } }])]);
    await expect(reservar("decimo_2")).rejects.toThrow(/Tipo de título inválido/);
    await expect(reservar("decimo_1")).rejects.toThrow(/Faltam nos Parâmetros/);   // passou pela regra do tipo; só faltam os códigos
    await expect(rpc(rhOperador, `select rh_fp_conferir($1)`, [d1])).rejects.toThrow(/13º 1ª parcela\/2026 está "aprovada"/);
  });
});
