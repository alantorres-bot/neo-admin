import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let rhConsulta: string, rhOperador: string, soFinanceiro: string;
let empresa: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const salvar = (usuario: string, c: { id?: string | null; cod?: string; nome?: string; cpf?: string | null; agencia?: string | null; conta?: string | null; forma?: string; tarifa?: number; ativo?: boolean } = {}) =>
  rpc(usuario, `select rh_vt_salvar_colaborador($1, $2, 'Neo Serviços', $3, $4, $5, $6, $7, $8, $9::numeric, 2, $10, null) as id`, [
    c.id ?? null, empresa, c.cod ?? "660", c.nome ?? "Fulano de Tal", c.cpf === undefined ? "111.444.777-35" : c.cpf,
    c.agencia === undefined ? "2764-2" : c.agencia, c.conta === undefined ? "99149-x" : c.conta, c.forma ?? "fopag", c.tarifa ?? 4.95, c.ativo ?? true,
  ]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  rhConsulta = await novoUsuario(db, "consulta@neo.com", { rh: "consulta" });
  rhOperador = await novoUsuario(db, "operador@neo.com", { rh: "operador" });
  soFinanceiro = await novoUsuario(db, "fin@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
});

describe("vale-transporte: cadastro (0500, 0501)", () => {
  it("o módulo rh.vale_transporte está ativo na área RH", async () => {
    expect((await q(`select area, nome, ativo from modulos where codigo = 'rh.vale_transporte'`)).rows[0]).toEqual({ area: "rh", nome: "Vale-transporte", ativo: true });
  });

  it("operador cadastra (normaliza nome, código, agência e conta); consulta e quem não tem RH não", async () => {
    await expect(salvar(rhConsulta)).rejects.toThrow(/operador do RH/);
    await expect(salvar(soFinanceiro)).rejects.toThrow(/operador do RH/);
    const id = (await salvar(rhOperador, { cod: "0660" })).rows[0].id;
    const c = (await rpc(rhConsulta, `select cod_fornecedor, nome, empregador, agencia, conta, tarifa::text, passagens_dia, criado_por from rh_vt_colaboradores where id = $1`, [id])).rows[0];
    expect(c).toEqual({ cod_fornecedor: "660", nome: "FULANO DE TAL", empregador: "NEO SERVIÇOS", agencia: "2764-2", conta: "99149-X", tarifa: "4.95", passagens_dia: 2, criado_por: rhOperador });
    expect((await como(db, soFinanceiro, () => q(`select count(*)::int as n from rh_vt_colaboradores`))).rows[0].n).toBe(0);
  });

  it("recusa fornecedor ou CPF repetido, tarifa zerada e CPF sem máscara", async () => {
    await expect(salvar(rhOperador, { cpf: "222.333.444-05" })).rejects.toThrow(/fornecedor 660 já está/);
    await expect(salvar(rhOperador, { cod: "695" })).rejects.toThrow(/CPF 111.444.777-35 já está/);
    await expect(salvar(rhOperador, { cod: "695", cpf: null, tarifa: 0 })).rejects.toThrow(/tarifa/);
    await expect(salvar(rhOperador, { cod: "695", cpf: "22233344405" })).rejects.toThrow(/check/i);
  });

  it("altera e desativa (sem apagar); a auditoria guarda o antes e o depois", async () => {
    const id = (await rpc(rhConsulta, `select id from rh_vt_colaboradores where cod_fornecedor = '660'`)).rows[0].id;
    await salvar(rhOperador, { id, forma: "pix_neo_servicos", tarifa: 5.95, ativo: false, agencia: null, conta: null });
    const c = (await rpc(rhConsulta, `select forma_pagamento, tarifa::text, ativo, agencia, atualizado_por from rh_vt_colaboradores where id = $1`, [id])).rows[0];
    expect(c).toEqual({ forma_pagamento: "pix_neo_servicos", tarifa: "5.95", ativo: false, agencia: null, atualizado_por: rhOperador });
    await expect(rpc(rhOperador, `delete from rh_vt_colaboradores where id = $1`, [id])).resolves.toMatchObject({ affectedRows: 0 });
    await expect(q(`delete from rh_vt_colaboradores where id = $1`, [id])).rejects.toThrow(/não podem ser excluídos/);
    expect((await q(`select count(*)::int as n from auditoria where tabela = 'rh_vt_colaboradores' and registro_id = $1`, [id])).rows[0].n).toBe(2);
  });

  it("valor fixo mensal dispensa a tarifa; sem valor fixo a tarifa é obrigatória", async () => {
    const fixo = (tarifa: number | null, valor: number | null) =>
      rpc(rhOperador, `select rh_vt_salvar_colaborador(null, $1, 'Neo Serviços', '659', 'Ciclano', null, '2764-2', '1234-5', 'fopag', $2::numeric, 2, true, null, $3::numeric) as id`, [empresa, tarifa, valor]);
    await expect(fixo(null, null)).rejects.toThrow(/tarifa\) ou o valor fixo/);
    await expect(fixo(null, 0)).rejects.toThrow(/maior que zero/);
    const id = (await fixo(null, 800)).rows[0].id;
    expect((await rpc(rhConsulta, `select tarifa, valor_fixo::text from rh_vt_colaboradores where id = $1`, [id])).rows[0]).toEqual({ tarifa: null, valor_fixo: "800.00" });
    await expect(q(`update rh_vt_colaboradores set valor_fixo = null where id = $1`, [id])).rejects.toThrow(/rh_vt_colab_tarifa_ou_fixo/);
  });
});
