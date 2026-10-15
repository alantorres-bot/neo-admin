import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let rhConsulta: string, rhOperador: string, rhGestor: string;
let set: string;
const pessoa: Record<string, string> = {};

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const gravar = (usuario: string, o: { comp?: string; cod?: string; tipo?: string; linhas: unknown[]; substitui?: string | null; inicio?: string | null; fim?: string | null }) =>
  rpc(usuario, `select rh_fp_gravar_recibo($1::date, $2, $3, 3141.78, 20, 0, 'PINTOR', $4::date, $5::date, 'Férias', $6::jsonb, $7) as id`, [
    o.comp ?? "2026-09-01", pessoa[o.cod ?? "717"], o.tipo ?? "compra_ferias", o.inicio ?? null, o.fim ?? null, JSON.stringify(o.linhas), o.substitui ?? null,
  ]);
const avulso = async (comp: string, cod: string) =>
  (await q(`select i.avulso::text, i.avulso_motivo, i.valor::text from rh_fp_itens i join rh_fp_competencias c on c.id = i.competencia_id
            join rh_colaboradores k on k.id = i.colaborador_id where c.competencia = $1 and k.cod_fornecedor = $2`, [comp, cod])).rows[0];
const FERIAS = [
  { rubrica: "salario_ferias", referencia: 20, valor: 2094.52 }, { rubrica: "assiduidade", referencia: 20, valor: 123.33 },
  { rubrica: "insalubridade", descricao: "INSALUBRIDADE (20%)", referencia: 20, valor: 216.13 },
];

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  rhConsulta = await novoUsuario(db, "consulta@neo.com", { rh: "consulta" });
  rhOperador = await novoUsuario(db, "operador@neo.com", { rh: "operador" });
  rhGestor = await novoUsuario(db, "gestor@neo.com", { rh: "gestor" });
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Formas', 'NEO FORMAS', '1') returning id`)).rows[0].id;
  for (const cod of ["717", "703"]) {
    pessoa[cod] = (await q(`insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, forma_pagamento, recebe_vt)
                             values ($1, 'NEO SERVIÇOS', $2, 'PESSOA ' || $2::text, 'pix_neo_servicos', false) returning id`, [empresa, cod])).rows[0].id;
  }
  set = (await rpc(rhOperador, `select rh_fp_abrir_competencia('2026-09-01') as id`)).rows[0].id;
});

describe("folha: recibos avulsos (0514)", () => {
  it("parâmetros com vigência e catálogo de rubricas carregados", async () => {
    expect((await rpc(rhConsulta, `select chave, vigente_desde::text, valor::text from rh_parametros order by 1, 2`)).rows).toEqual([
      { chave: "assiduidade_mensal", vigente_desde: "2026-01-01", valor: "120.00" }, { chave: "assiduidade_mensal", vigente_desde: "2026-06-01", valor: "185.00" },
      { chave: "salario_minimo", vigente_desde: "2026-01-01", valor: "1621.00" },
    ]);
    expect((await rpc(rhConsulta, `select count(*)::int as n from rh_fp_rubricas`)).rows[0].n).toBe(18);
    await expect(rpc(rhOperador, `select rh_salvar_parametro('salario_minimo', '2027-01-01', 1700)`)).rejects.toThrow(/gestor/);
    await rpc(rhGestor, `select rh_salvar_parametro('salario_minimo', '2027-01-15', 1700)`);
    expect((await q(`select vigente_desde::text from rh_parametros where valor = 1700`)).rows[0].vigente_desde).toBe("2027-01-01");
  });

  it("recibo grava linhas, confere total e vira o avulso da folha (com motivo)", async () => {
    await expect(gravar(rhConsulta, { linhas: FERIAS })).rejects.toThrow(/operador/);
    const id = (await gravar(rhOperador, { linhas: FERIAS, inicio: "2026-09-01", fim: "2026-09-20" })).rows[0].id;
    expect((await rpc(rhConsulta, `select proventos::text, descontos::text, total::text, salario::text from rh_fp_recibos where id = $1`, [id])).rows[0])
      .toEqual({ proventos: "2433.98", descontos: "0.00", total: "2433.98", salario: "3141.78" });
    const linhas = (await rpc(rhConsulta, `select ordem, descricao, valor::text from rh_fp_recibo_linhas where recibo_id = $1 order by ordem`, [id])).rows;
    expect(linhas.map((l) => [l.ordem, l.descricao, l.valor])).toEqual([[1, "SALÁRIO - FÉRIAS", "2094.52"], [2, "ASSIDUIDADE CCT", "123.33"], [3, "INSALUBRIDADE (20%)", "216.13"]]);
    expect(await avulso("2026-09-01", "717")).toEqual({ avulso: "2433.98", avulso_motivo: "Recibo(s): compra de férias 01/09–20/09", valor: "2433.98" });
  });

  it("dois recibos somam; desconto diminui; negativo e rubrica desconhecida são recusados", async () => {
    await gravar(rhOperador, { tipo: "eventual", linhas: [{ rubrica: "reembolso_irrf", referencia: 1, valor: 100 }, { rubrica: "desconto_lote", referencia: 1, valor: 30 }] });
    expect((await avulso("2026-09-01", "717")).avulso).toBe("2503.98");
    await expect(gravar(rhOperador, { tipo: "eventual", linhas: [{ rubrica: "desconto_lote", referencia: 1, valor: 30 }] })).rejects.toThrow(/negativo/);
    await expect(gravar(rhOperador, { tipo: "eventual", linhas: [{ rubrica: "xpto", referencia: 1, valor: 1 }] })).rejects.toThrow(/desconhecida/);
  });

  it("substituir e cancelar tiram do avulso; nada se apaga", async () => {
    const ev = (await q(`select id from rh_fp_recibos where tipo = 'eventual'`)).rows[0].id;
    const novo = (await gravar(rhOperador, { tipo: "eventual", substitui: ev, linhas: [{ rubrica: "reembolso_irrf", referencia: 1, valor: 50 }] })).rows[0].id;
    expect((await avulso("2026-09-01", "717")).avulso).toBe("2483.98");
    await expect(rpc(rhOperador, `select rh_fp_cancelar_recibo($1, ' ')`, [novo])).rejects.toThrow(/motivo/);
    await rpc(rhOperador, `select rh_fp_cancelar_recibo($1, 'lançado errado')`, [novo]);
    expect((await avulso("2026-09-01", "717")).avulso).toBe("2433.98");
    expect((await q(`select count(*)::int as n, count(*) filter (where cancelado)::int as c from rh_fp_recibos`)).rows[0]).toEqual({ n: 3, c: 2 });
    await expect(q(`delete from rh_fp_recibos where id = $1`, [novo])).rejects.toThrow(/não podem ser excluídos/);
  });

  it("recibo de mês ainda não aberto entra ao abrir; folha conferida bloqueia recibo", async () => {
    await gravar(rhOperador, { comp: "2026-10-01", cod: "703", linhas: [{ rubrica: "salario_ferias", referencia: 8, valor: 1176 }] });
    expect(await avulso("2026-10-01", "703")).toBeUndefined();
    await rpc(rhOperador, `select rh_fp_abrir_competencia('2026-10-01')`);
    expect((await avulso("2026-10-01", "703")).avulso).toBe("1176.00");
    await rpc(rhOperador, `select rh_fp_conferir($1)`, [set]);
    await expect(gravar(rhOperador, { linhas: FERIAS })).rejects.toThrow(/não está aberta/);
    await rpc(rhGestor, `select rh_fp_reabrir($1, 'teste')`, [set]);
  });

  it("dados do recibo no cadastro e modelo recorrente", async () => {
    await rpc(rhOperador, `select rh_salvar_dados_recibo($1, 3141.78, 'pintor', 20, 0)`, [pessoa["717"]]);
    expect((await rpc(rhConsulta, `select salario::text, funcao, insalubridade_pct from rh_colaboradores where id = $1`, [pessoa["717"]])).rows[0])
      .toEqual({ salario: "3141.78", funcao: "PINTOR", insalubridade_pct: 20 });
    await expect(rpc(rhOperador, `select rh_salvar_dados_recibo($1, 3141.78, null, 15, 0)`, [pessoa["717"]])).rejects.toThrow(/check/i);
    await rpc(rhOperador, `select rh_fp_salvar_modelo($1, '[{"rubrica":"horas_normais","referencia":220},{"rubrica":"assiduidade","referencia":30}]'::jsonb, true)`, [pessoa["703"]]);
    await expect(rpc(rhOperador, `select rh_fp_salvar_modelo($1, '[{"rubrica":"x","referencia":1}]'::jsonb, true)`, [pessoa["703"]])).rejects.toThrow(/desconhecida/);
    expect((await rpc(rhConsulta, `select jsonb_array_length(linhas) as n, ativo from rh_fp_recibo_modelos`)).rows[0]).toEqual({ n: 2, ativo: true });
  });
});
