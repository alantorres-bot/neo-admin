import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let rhOperador: string, rhGestor: string;
let setor: string, lote: string, chave: string;
const p: Record<string, string> = {};

const q = (sql: string, a: unknown[] = []) => db.query<Linha>(sql, a);
const rpc = (quem: string, sql: string, a: unknown[] = []) => como(db, quem, () => q(sql, a));
const salvar = (itens: unknown[], nome = "Líder Fábrica") =>
  rpc("anon", `select rh_bo_link_salvar($1, $2::jsonb, $3, '10.0.0.1') as n`, [chave, JSON.stringify(itens), nome]);
const pendencias = async () => (await q(`select titulo, status::text from pendencias where modulo = 'rh.bonificacoes' order by criado_em, titulo`)).rows;

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  rhOperador = await novoUsuario(db, "operador@neo.com", { rh: "operador" });
  rhGestor = await novoUsuario(db, "gestor@neo.com", { rh: "gestor" });
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Formas', 'NEO FORMAS', '1') returning id`)).rows[0].id;
  for (const [cod, dep, salario, ativo] of [["1", "FÁBRICA", 2000, true], ["2", "Fabrica", null, true], ["3", "Fábrica", 3000, false], ["4", "Escritório", 4000, true]] as const) {
    p[cod] = (await q(`insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, forma_pagamento, recebe_vt, departamento, salario, ativo)
                       values ($1, 'NEO SERVIÇOS', $2, 'PESSOA ' || $2::text, 'pix', false, $3, $4, $5) returning id`, [empresa, cod, dep, salario, ativo])).rows[0].id;
  }
  setor = (await rpc(rhGestor, `select rh_pt_salvar_setor(null, 'Fábrica', 'Líder', 'lider@neo.com', null, true) as id`)).rows[0].id;
});

describe("RH > Bonificações (0525)", () => {
  it("abre um lote por setor × mês e o link mostra só os ativos do departamento, sem salário", async () => {
    lote = (await rpc(rhOperador, `select rh_bo_abrir_lote($1, '2026-11-15') as id`, [setor])).rows[0].id;
    await expect(rpc(rhOperador, `select rh_bo_abrir_lote($1, '2026-11-01')`, [setor])).rejects.toThrow(/Já existe/);
    chave = (await q(`select chave from rh_bo_lotes where id = $1`, [lote])).rows[0].chave;
    const link = (await rpc("anon", `select rh_bo_link_lote($1) as l`, [chave])).rows[0].l;
    expect(link.competencia).toBe("2026-11-01");
    expect(link.pessoas.map((x: Linha) => x.nome)).toEqual(["PESSOA 1", "PESSOA 2"]);
    expect(Object.keys(link.pessoas[0])).not.toContain("salario");
    expect((await rpc("anon", `select rh_bo_link_lote($1) as l`, ["0".repeat(64)])).rows[0].l).toBeNull();
  });

  it("o link recusa percentual fora da lista, pessoa de outro setor e repetida", async () => {
    await expect(salvar([{ colaborador_id: p["1"], pct: 12 }])).rejects.toThrow(/percentual/);
    await expect(salvar([{ colaborador_id: p["4"], pct: 10 }])).rejects.toThrow(/fora do setor/);
    await expect(salvar([{ colaborador_id: p["3"], pct: 10 }])).rejects.toThrow(/fora do setor/);   // inativo
    await expect(salvar([{ colaborador_id: p["1"], pct: 10 }, { colaborador_id: p["1"], pct: 5 }])).rejects.toThrow(/repetido/);
    await expect(salvar([], "AB")).rejects.toThrow(/nome/);
  });

  it("envio fecha o link; aprovar exige salário; devolver reabre", async () => {
    expect((await salvar([{ colaborador_id: p["1"], pct: 10 }, { colaborador_id: p["2"], pct: 20 }])).rows[0].n).toBe(2);
    await expect(salvar([])).rejects.toThrow(/já foi enviada/);
    expect((await rpc("anon", `select rh_bo_link_lote($1) as l`, [chave])).rows[0].l.pessoas).toEqual([]);
    await expect(rpc(rhOperador, `select rh_bo_aprovar($1)`, [lote])).rejects.toThrow(/Sem salário no cadastro: PESSOA 2/);
    await rpc(rhOperador, `select rh_bo_devolver($1, 'Pessoa 2 sem direito')`, [lote]);
    expect((await rpc("anon", `select rh_bo_link_lote($1) as l`, [chave])).rows[0].l.devolvido_motivo).toBe("Pessoa 2 sem direito");
    expect((await salvar([{ colaborador_id: p["1"], pct: 15 }])).rows[0].n).toBe(1);
    expect((await q(`select pct from rh_bo_itens where lote_id = $1`, [lote])).rows).toEqual([{ pct: 15 }]);
  });

  it("aprovado: o recibo Eventual se liga ao item uma vez só; nada se cancela depois", async () => {
    await rpc(rhOperador, `select rh_bo_aprovar($1)`, [lote]);
    const item = (await q(`select id from rh_bo_itens where lote_id = $1`, [lote])).rows[0].id;
    const linhas = JSON.stringify([{ rubrica: "bonificacao_producao", referencia: 0.15, valor: 300 }]);
    const recibo = (await rpc(rhOperador, `select rh_fp_gravar_recibo('2026-11-01', $1, 'eventual', 2000, 0, 0, null, null, null, 'Bonificação 15%', $2::jsonb) as id`, [p["1"], linhas])).rows[0].id;
    const outro = (await rpc(rhOperador, `select rh_fp_gravar_recibo('2026-11-01', $1, 'eventual', 4000, 0, 0, null, null, null, 'x', $2::jsonb) as id`, [p["4"], linhas])).rows[0].id;
    await expect(rpc(rhOperador, `select rh_bo_marcar_recibo($1, $2)`, [item, outro])).rejects.toThrow(/outra pessoa/);
    await rpc(rhOperador, `select rh_bo_marcar_recibo($1, $2)`, [item, recibo]);
    await expect(rpc(rhOperador, `select rh_bo_marcar_recibo($1, $2)`, [item, recibo])).rejects.toThrow(/já lançado/);
    await expect(rpc(rhGestor, `select rh_bo_cancelar($1, 'teste')`, [lote])).rejects.toThrow(/aprovado/);
    await expect(q(`delete from rh_bo_lotes where id = $1`, [lote])).rejects.toThrow(/não podem ser excluídos/);
    expect(await pendencias()).toEqual([
      { titulo: "Aguardando líder — Fábrica 11/2026", status: "concluida" },
      { titulo: "Aprovar bonificação — Fábrica 11/2026", status: "cancelada" },
      { titulo: "Aguardando líder — Fábrica 11/2026", status: "concluida" },
      { titulo: "Aprovar bonificação — Fábrica 11/2026", status: "concluida" },
    ]);
  });

  it("cancelar é do gestor, com motivo, e libera abrir de novo", async () => {
    const outro = (await rpc(rhOperador, `select rh_bo_abrir_lote($1, '2026-12-01') as id`, [setor])).rows[0].id;
    await expect(rpc(rhOperador, `select rh_bo_cancelar($1, 'x')`, [outro])).rejects.toThrow(/gestor/);
    await rpc(rhGestor, `select rh_bo_cancelar($1, 'aberto por engano')`, [outro]);
    await rpc(rhOperador, `select rh_bo_abrir_lote($1, '2026-12-01')`, [setor]);
  });
});
