import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let rhConsulta: string, rhOperador: string, rhGestor: string;
let comp: string;
const itens: Record<string, string> = {};

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const importar = (usuario: string, o: { empregador?: string; natureza?: string; total?: number; linhas: unknown[]; ligacoes?: unknown[]; sem?: unknown[] }) =>
  rpc(usuario, `select rh_fp_importar_relacao($1, $2, '45513941000167', 'Folha Mensal', $3, 'NEO SERV - Relatório de Líquidos.xls', $4, $5::numeric, $6::jsonb, $7::jsonb, $8::jsonb) as n`, [
    comp, o.empregador ?? "NEO SERVIÇOS", o.natureza ?? "liquido", (o.linhas.length + (o.sem?.length ?? 0)), o.total ?? 0,
    JSON.stringify(o.linhas), JSON.stringify(o.ligacoes ?? []), JSON.stringify(o.sem ?? []),
  ]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  rhConsulta = await novoUsuario(db, "consulta@neo.com", { rh: "consulta" });
  rhOperador = await novoUsuario(db, "operador@neo.com", { rh: "operador" });
  rhGestor = await novoUsuario(db, "gestor@neo.com", { rh: "gestor" });
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Formas', 'NEO FORMAS', '1') returning id`)).rows[0].id;
  for (const [cod, emp, mat] of [["658", "NEO SERVIÇOS", "133"], ["662", "NEO SERVIÇOS", null], ["660", "OESTE", "16"]] as const) {
    await q(`insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, forma_pagamento, recebe_vt, matricula_escritorio) values ($1, $2, $3, 'PESSOA ' || $3, 'pix', false, $4)`, [empresa, emp, cod, mat]);
  }
  comp = (await rpc(rhOperador, `select rh_fp_abrir_competencia('2026-09-01') as id`)).rows[0].id;
  for (const l of (await q(`select id, cod_fornecedor from rh_fp_itens where competencia_id = $1`, [comp])).rows) itens[l.cod_fornecedor as string] = l.id as string;
});

describe("folha: importação da Relação Geral dos Líquidos (0512)", () => {
  it("grava a natureza, liga código à mão (cadastro e foto do mês) e registra a importação", async () => {
    await expect(importar(rhConsulta, { total: 1, linhas: [{ item_id: itens["658"], valor: 1 }] })).rejects.toThrow(/operador do RH/);
    const n = (await importar(rhOperador, {
      total: 2398.59 + 5112.46 + 99.9,
      linhas: [{ item_id: itens["658"], valor: 2398.59 }, { item_id: itens["662"], valor: 5112.46 }],
      ligacoes: [{ item_id: itens["662"], codigo: "18" }],
      sem: [{ codigo: "999", nome: "FULANO", valor: 99.9 }],
    })).rows[0].n;
    expect(n).toBe(2);
    expect((await rpc(rhConsulta, `select cod_fornecedor, liquido::text, matricula_escritorio from rh_fp_itens where competencia_id = $1 and empregador = 'NEO SERVIÇOS' order by 1`, [comp])).rows)
      .toEqual([{ cod_fornecedor: "658", liquido: "2398.59", matricula_escritorio: "133" }, { cod_fornecedor: "662", liquido: "5112.46", matricula_escritorio: "18" }]);
    expect((await rpc(rhConsulta, `select matricula_escritorio from rh_colaboradores where cod_fornecedor = '662'`)).rows[0].matricula_escritorio).toBe("18");
    expect((await rpc(rhConsulta, `select aplicadas, ligadas, total::text, jsonb_array_length(sem_cadastro) as sem, importado_por from rh_fp_importacoes`)).rows)
      .toEqual([{ aplicadas: 2, ligadas: 1, total: "7610.95", sem: 1, importado_por: rhOperador }]);
  });

  it("13º vai para a coluna do 13º; o líquido fica", async () => {
    await importar(rhOperador, { natureza: "decimo_terceiro", total: 1672.76, linhas: [{ item_id: itens["658"], valor: 1672.76 }] });
    expect((await rpc(rhConsulta, `select liquido::text, decimo_terceiro::text, valor::text from rh_fp_itens where id = $1`, [itens["658"]])).rows[0])
      .toEqual({ liquido: "2398.59", decimo_terceiro: "1672.76", valor: "4071.35" });
  });

  it("recusa soma diferente do total, linha de outra empresa e mês fechado", async () => {
    await expect(importar(rhOperador, { total: 10, linhas: [{ item_id: itens["658"], valor: 9 }] })).rejects.toThrow(/não bate com o total/);
    await expect(importar(rhOperador, { total: 1, linhas: [{ item_id: itens["660"], valor: 1 }] })).rejects.toThrow(/não são desta folha ou desta empresa/);
    await rpc(rhOperador, `select rh_fp_conferir($1)`, [comp]);
    await expect(importar(rhOperador, { total: 1, linhas: [{ item_id: itens["658"], valor: 1 }] })).rejects.toThrow(/esta ação não vale/);
    await rpc(rhGestor, `select rh_fp_reabrir($1, 'teste')`, [comp]);
  });

  it("código do escritório não se repete entre ativos da mesma empresa (0513); em empresas diferentes pode", async () => {
    await expect(q(`update rh_colaboradores set matricula_escritorio = '133' where cod_fornecedor = '662'`)).rejects.toThrow(/código do escritório 133 já está com 658/);
    await q(`update rh_colaboradores set matricula_escritorio = '133' where cod_fornecedor = '660'`);   // OESTE: pode
    await q(`update rh_colaboradores set ativo = false where cod_fornecedor = '658'`);
    await q(`update rh_colaboradores set matricula_escritorio = '133' where cod_fornecedor = '662'`);   // o outro está inativo: pode
  });
});
