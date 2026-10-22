import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let rhConsulta: string, rhOperador: string, soFinanceiro: string;
let empresa: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
type Dados = { id?: string | null; cod?: string; nome?: string; cpf?: string | null; agencia?: string | null; conta?: string | null; forma?: string;
  ativo?: boolean; vt?: boolean; tarifa?: number | null; fixo?: number | null; matricula?: string | null };
const salvar = (usuario: string, c: Dados = {}) =>
  rpc(usuario, `select rh_salvar_colaborador($1, $2, 'Neo Serviços', $3, $4, $5, $6, $7, $8, $9, null, $10, $11::numeric, $12::numeric, 2, $13) as id`, [
    c.id ?? null, empresa, c.cod ?? "660", c.nome ?? "Fulano de Tal", c.cpf === undefined ? "111.444.777-35" : c.cpf,
    c.agencia === undefined ? "2764-2" : c.agencia, c.conta === undefined ? "99149-x" : c.conta, c.forma ?? "fopag", c.ativo ?? true,
    c.vt ?? true, c.tarifa === undefined ? 4.95 : c.tarifa, c.fixo ?? null, c.matricula ?? null,
  ]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  rhConsulta = await novoUsuario(db, "consulta@neo.com", { rh: "consulta" });
  rhOperador = await novoUsuario(db, "operador@neo.com", { rh: "operador" });
  soFinanceiro = await novoUsuario(db, "fin@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
});

describe("cadastro único de colaboradores do RH (0500, 0501, 0510)", () => {
  it("os módulos rh.vale_transporte e rh.colaboradores estão ativos na área RH", async () => {
    const m = (await q(`select codigo, area, ativo from modulos where codigo in ('rh.vale_transporte', 'rh.colaboradores') order by codigo`)).rows;
    expect(m).toEqual([{ codigo: "rh.colaboradores", area: "rh", ativo: true }, { codigo: "rh.vale_transporte", area: "rh", ativo: true }]);
  });

  it("operador cadastra (normaliza nome, código, agência, conta e matrícula); consulta e quem não tem RH não", async () => {
    await expect(salvar(rhConsulta)).rejects.toThrow(/operador do RH/);
    await expect(salvar(soFinanceiro)).rejects.toThrow(/operador do RH/);
    const id = (await salvar(rhOperador, { cod: "0660", matricula: "0133" })).rows[0].id;
    const c = (await rpc(rhConsulta, `select cod_fornecedor, nome, empregador, agencia, conta, tarifa::text, passagens_dia, recebe_vt, matricula_escritorio, criado_por from rh_colaboradores where id = $1`, [id])).rows[0];
    expect(c).toEqual({ cod_fornecedor: "660", nome: "FULANO DE TAL", empregador: "NEO SERVIÇOS", agencia: "2764-2", conta: "99149-X", tarifa: "4.95", passagens_dia: 2, recebe_vt: true, matricula_escritorio: "133", criado_por: rhOperador });
    expect((await como(db, soFinanceiro, () => q(`select count(*)::int as n from rh_colaboradores`))).rows[0].n).toBe(0);
  });

  it("recusa fornecedor ou CPF repetido e CPF sem máscara", async () => {
    await expect(salvar(rhOperador, { cpf: "222.333.444-05" })).rejects.toThrow(/fornecedor 660 já está/);
    await expect(salvar(rhOperador, { cod: "695" })).rejects.toThrow(/CPF 111.444.777-35 já está/);
    await expect(salvar(rhOperador, { cod: "695", cpf: "22233344405" })).rejects.toThrow(/check/i);
  });

  it("quem recebe VT precisa de tarifa ou valor fixo; quem não recebe, não", async () => {
    await expect(salvar(rhOperador, { cod: "695", cpf: null, tarifa: null })).rejects.toThrow(/recebe VT precisa/);
    await expect(salvar(rhOperador, { cod: "695", cpf: null, tarifa: 0 })).rejects.toThrow(/maior que zero/);
    const fixo = (await salvar(rhOperador, { cod: "659", cpf: null, tarifa: null, fixo: 800 })).rows[0].id;
    expect((await rpc(rhConsulta, `select tarifa, valor_fixo::text from rh_colaboradores where id = $1`, [fixo])).rows[0]).toEqual({ tarifa: null, valor_fixo: "800.00" });
    await expect(q(`update rh_colaboradores set valor_fixo = null where id = $1`, [fixo])).rejects.toThrow(/rh_colab_vt_tarifa_ou_fixo/);
    const semVt = (await salvar(rhOperador, { cod: "700", cpf: null, vt: false, tarifa: null })).rows[0].id;
    expect((await rpc(rhConsulta, `select recebe_vt, tarifa from rh_colaboradores where id = $1`, [semVt])).rows[0]).toEqual({ recebe_vt: false, tarifa: null });
  });

  it("altera e desativa (sem apagar); a auditoria guarda o antes e o depois", async () => {
    const id = (await rpc(rhConsulta, `select id from rh_colaboradores where cod_fornecedor = '660'`)).rows[0].id;
    await salvar(rhOperador, { id, forma: "pix", tarifa: 5.95, ativo: false, agencia: null, conta: null });
    const c = (await rpc(rhConsulta, `select forma_pagamento, tarifa::text, ativo, agencia, atualizado_por from rh_colaboradores where id = $1`, [id])).rows[0];
    expect(c).toEqual({ forma_pagamento: "pix", tarifa: "5.95", ativo: false, agencia: null, atualizado_por: rhOperador });
    await expect(rpc(rhOperador, `delete from rh_colaboradores where id = $1`, [id])).resolves.toMatchObject({ affectedRows: 0 });
    await expect(q(`delete from rh_colaboradores where id = $1`, [id])).rejects.toThrow(/não podem ser excluídos/);
    expect((await q(`select count(*)::int as n from auditoria where tabela = 'rh_colaboradores' and registro_id = $1`, [id])).rows[0].n).toBe(2);
  });
});
