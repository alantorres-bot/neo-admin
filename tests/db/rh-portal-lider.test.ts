import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let rhOperador: string, rhGestor: string, liderA: string, liderB: string, curioso: string;
let setorA: string, setorB: string, pedido: string;
const p: Record<string, string> = {};

const q = (sql: string, a: unknown[] = []) => db.query<Linha>(sql, a);
const rpc = (quem: string, sql: string, a: unknown[] = []) => como(db, quem, () => q(sql, a));
const solicitar = (quem: string, setor: string, colab: string | null, tipo: string, dados: object) =>
  rpc(quem, `select rh_ld_solicitar($1, $2, $3, $4::jsonb) as id`, [setor, colab, tipo, JSON.stringify(dados)]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  rhOperador = await novoUsuario(db, "operador@neo.com", { rh: "operador" });
  rhGestor = await novoUsuario(db, "gestor@neo.com", { rh: "gestor" });
  liderA = await novoUsuario(db, "lider.a@neo.com");
  liderB = await novoUsuario(db, "lider.b@neo.com");
  curioso = await novoUsuario(db, "curioso@neo.com");
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Formas', 'NEO FORMAS', '1') returning id`)).rows[0].id;
  for (const [cod, dep, ativo] of [["1", "FÁBRICA", true], ["2", "Fabrica", false], ["3", "Engenharia", true]] as const) {
    p[cod] = (await q(`insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, forma_pagamento, recebe_vt, departamento, salario, funcao, data_admissao, ativo)
                       values ($1, 'NEO SERVIÇOS', $2, 'PESSOA ' || $2::text, 'pix', false, $3, 3000, 'SOLDADOR I', '2025-03-10', $4) returning id`, [empresa, cod, dep, ativo])).rows[0].id;
  }
  setorA = (await rpc(rhGestor, `select rh_pt_salvar_setor(null, 'Fábrica', 'Líder', 'a@neo.com', null, true) as id`)).rows[0].id;
  setorB = (await rpc(rhGestor, `select rh_pt_salvar_setor(null, 'Engenharia', 'Líder', 'b@neo.com', null, true) as id`)).rows[0].id;
});

describe("RH > Portal do Líder (0526)", () => {
  it("só o gestor do RH define líderes; quem não é líder não vê nada", async () => {
    await expect(rpc(rhOperador, `select rh_ld_definir_lideres($1, $2::uuid[])`, [setorA, [liderA]])).rejects.toThrow();
    await rpc(rhGestor, `select rh_ld_definir_lideres($1, $2::uuid[])`, [setorA, [liderA]]);
    await rpc(rhGestor, `select rh_ld_definir_lideres($1, $2::uuid[])`, [setorB, [liderB]]);
    expect((await rpc(liderA, `select nome from rh_ld_meus_setores()`)).rows).toEqual([{ nome: "Fábrica" }]);
    expect((await rpc(curioso, `select * from rh_ld_meus_setores()`)).rows).toEqual([]);
    await expect(rpc(curioso, `select * from rh_ld_equipe($1)`, [setorA])).rejects.toThrow(/não é líder/);
    await expect(rpc("anon", `select * from rh_ld_meus_setores()`)).rejects.toThrow();
  });

  it("a equipe traz só os ativos do setor, sem salário", async () => {
    const r = await rpc(liderA, `select * from rh_ld_equipe($1)`, [setorA]);
    expect(r.rows.map((x) => x.nome)).toEqual(["PESSOA 1"]);
    expect(Object.keys(r.rows[0])).not.toContain("salario");
    expect(r.rows[0].funcao).toBe("SOLDADOR I");
    await expect(rpc(liderA, `select * from rh_ld_equipe($1)`, [setorB])).rejects.toThrow(/não é líder/);
    // o líder sem área RH não lê o cadastro direto
    expect((await rpc(liderA, `select * from rh_colaboradores`)).rows).toEqual([]);
  });

  it("lista os lotes do Ponto e da Bonificação que estão com o líder", async () => {
    await rpc(rhOperador, `select rh_bo_abrir_lote($1, '2026-11-01')`, [setorA]);
    const r = await rpc(liderA, `select tipo, rotulo, length(chave) n from rh_ld_lotes_abertos($1)`, [setorA]);
    expect(r.rows).toEqual([{ tipo: "bonificacao", rotulo: "Bonificação 11/2026", n: 64 }]);
  });

  it("o pedido confere setor e campos, abre a pendência e só o líder do setor o vê", async () => {
    await expect(solicitar(liderA, setorA, p["3"], "ferias", { inicio: "2026-12-01", dias: 30 })).rejects.toThrow(/não é do seu setor/);
    await expect(solicitar(liderA, setorA, p["2"], "ferias", { inicio: "2026-12-01", dias: 30 })).rejects.toThrow(/não é do seu setor/);
    await expect(solicitar(liderA, setorA, p["1"], "ferias", { inicio: "2026-12-01" })).rejects.toThrow(/Preencha: dias/);
    await expect(solicitar(liderA, setorA, p["1"], "xpto", {})).rejects.toThrow(/Tipo/);
    await expect(solicitar(liderB, setorA, p["1"], "ferias", { inicio: "2026-12-01", dias: 30 })).rejects.toThrow(/não é líder/);
    await expect(solicitar(liderA, setorA, p["1"], "contratacao", { nome: "X", cargo: "Y", salario: "1", data_prevista: "2026-12-01" })).rejects.toThrow(/Contratação/);
    pedido = (await solicitar(liderA, setorA, p["1"], "ferias", { inicio: "2026-12-01", dias: 30, abono: false })).rows[0].id;
    await solicitar(liderA, setorA, null, "contratacao", { nome: "NOVO", cargo: "AUX. PRODUÇÃO I", salario: "1800", data_prevista: "2026-12-01" });
    expect((await q(`select titulo, link from pendencias where modulo = 'rh.portal_lider' and referencia_id = $1`, [pedido])).rows)
      .toEqual([{ titulo: "Pedido do líder: Férias — PESSOA 1 (Fábrica)", link: `/rh/portal_lider/${pedido}` }]);
    expect((await rpc(liderA, `select count(*)::int n from rh_ld_solicitacoes`)).rows[0].n).toBe(2);
    expect((await rpc(liderB, `select count(*)::int n from rh_ld_solicitacoes`)).rows[0].n).toBe(0);
    expect((await rpc(rhOperador, `select count(*)::int n from rh_ld_solicitacoes`)).rows[0].n).toBe(2);
    // pendências: o líder vê só as que ele criou (regra da Central, 0092); o outro líder, nenhuma
    expect((await rpc(liderA, `select count(*)::int n from pendencias`)).rows[0].n).toBe(2);
    expect((await rpc(liderB, `select count(*)::int n from pendencias`)).rows[0].n).toBe(0);
  });

  it("anexo só no caminho de um pedido do setor do líder", async () => {
    const ok = `rh.portal_lider/rh_ld_solicitacoes/${pedido}/x-atestado.pdf`;
    await rpc(liderA, `insert into storage.objects (bucket_id, name) values ('anexos', $1)`, [ok]);
    await rpc(liderA, `insert into anexos (modulo, referencia_tabela, referencia_id, arquivo_path, nome_arquivo, enviado_por) values ('rh.portal_lider', 'rh_ld_solicitacoes', $1, $2, 'atestado.pdf', $3)`, [pedido, ok, liderA]);
    await expect(rpc(liderB, `insert into storage.objects (bucket_id, name) values ('anexos', $1)`, [`rh.portal_lider/rh_ld_solicitacoes/${pedido}/y.pdf`])).rejects.toThrow(/row-level security/);
    await expect(rpc(liderA, `insert into storage.objects (bucket_id, name) values ('anexos', $1)`, [`rh.ponto/rh_pt_lotes/${pedido}/y.pdf`])).rejects.toThrow(/row-level security/);
    expect((await rpc(liderA, `select count(*)::int n from anexos`)).rows[0].n).toBe(1);
    expect((await rpc(liderA, `select pessoa, anexos from rh_ld_pedidos($1) order by pessoa`, [setorA])).rows)
      .toEqual([{ pessoa: "NOVO", anexos: 0 }, { pessoa: "PESSOA 1", anexos: 1 }]);
    await expect(rpc(liderB, `select * from rh_ld_pedidos($1)`, [setorA])).rejects.toThrow(/não é líder/);
    expect((await rpc(liderB, `select count(*)::int n from anexos`)).rows[0].n).toBe(0);
    expect((await rpc(rhOperador, `select count(*)::int n from storage.objects`)).rows[0].n).toBe(1);
  });

  it("o RH atende; o líder só cancela pedido ainda não começado; nada se apaga", async () => {
    await expect(rpc(liderA, `select rh_ld_atender($1, 'concluida', 'ok')`, [pedido])).rejects.toThrow();
    await expect(rpc(rhOperador, `select rh_ld_atender($1, 'recusada', ' ')`, [pedido])).rejects.toThrow(/motivo da recusa/);
    await rpc(rhOperador, `select rh_ld_atender($1, 'em_andamento', null)`, [pedido]);
    await expect(rpc(liderA, `select rh_ld_cancelar($1)`, [pedido])).rejects.toThrow(/já começou/);
    await rpc(rhOperador, `select rh_ld_atender($1, 'concluida', 'Programado de 01/12 a 30/12.')`, [pedido]);
    await expect(rpc(rhOperador, `select rh_ld_atender($1, 'recusada', 'x')`, [pedido])).rejects.toThrow(/concluida/);
    expect((await rpc(liderA, `select status, resposta from rh_ld_solicitacoes where id = $1`, [pedido])).rows)
      .toEqual([{ status: "concluida", resposta: "Programado de 01/12 a 30/12." }]);
    expect((await q(`select status::text from pendencias where referencia_id = $1`, [pedido])).rows).toEqual([{ status: "concluida" }]);

    const outro = (await solicitar(liderA, setorA, p["1"], "atestado", { inicio: "2026-11-03", fim: "2026-11-04" })).rows[0].id;
    await expect(rpc(liderB, `select rh_ld_cancelar($1)`, [outro])).rejects.toThrow(/não encontrado/);
    await rpc(liderA, `select rh_ld_cancelar($1)`, [outro]);
    expect((await q(`select status::text from pendencias where referencia_id = $1`, [outro])).rows).toEqual([{ status: "cancelada" }]);
    await expect(q(`delete from rh_ld_solicitacoes where id = $1`, [outro])).rejects.toThrow(/não podem ser excluídos/);
    await expect(rpc(liderA, `update rh_ld_solicitacoes set status = 'concluida' where id = $1`, [outro])).resolves.toMatchObject({ affectedRows: 0 });
  });

  it("líder removido perde o acesso", async () => {
    await rpc(rhGestor, `select rh_ld_definir_lideres($1, '{}'::uuid[])`, [setorA]);
    expect((await rpc(liderA, `select * from rh_ld_meus_setores()`)).rows).toEqual([]);
    expect((await rpc(liderA, `select count(*)::int n from rh_ld_solicitacoes`)).rows[0].n).toBe(0);
  });
});
