import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// Dados da ficha de registro no cadastro (0532): só gravados com p_dados_ficha; chamada antiga não apaga nada.
let db: PGlite;
let rhOperador: string;
let empresa: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (sql: string, p: unknown[] = []) => como(db, rhOperador, () => q(sql, p));
const BASE = `$1::uuid, $2::uuid, 'Neo Serviços', '700', 'Fulano de Tal', '529.982.247-25', null, null, 'fopag', true, null, false, null, null, 2, '222'`;
const comFicha = (id: string | null, ficha: Record<string, unknown>) => rpc(
  `select rh_salvar_colaborador(${BASE}, p_dados_ficha => true, p_funcao => $3, p_data_admissao => $4::date, p_salario => $5::numeric,
     p_data_nascimento => $6::date, p_telefone => $7, p_endereco => $8, p_pis => $9, p_rg => $10, p_rg_orgao => $11, p_rg_emissao => $12::date,
     p_ctps => $13, p_ctps_serie => $14, p_ctps_uf => $15, p_nome_pai => $16, p_nome_mae => $17) as id`,
  [id, empresa, ficha.funcao ?? null, ficha.admissao ?? null, ficha.salario ?? null, ficha.nascimento ?? null, ficha.telefone ?? null, ficha.endereco ?? null,
    ficha.pis ?? null, ficha.rg ?? null, ficha.rgOrgao ?? null, ficha.rgEmissao ?? null, ficha.ctps ?? null, ficha.serie ?? null, ficha.uf ?? null,
    ficha.pai ?? null, ficha.mae ?? null]);
const ler = (id: string) => q(`select funcao, data_admissao::text, salario::text, data_nascimento::text, telefone, endereco, pis, rg, rg_orgao, rg_emissao::text,
  ctps, ctps_serie, ctps_uf, nome_pai, nome_mae, matricula_escritorio from rh_colaboradores where id = $1`, [id]).then((r) => r.rows[0]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  rhOperador = await novoUsuario(db, "operador@neo.com", { rh: "operador" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id as string;
});

describe("colaborador pela ficha de registro (0532)", () => {
  let id: string;
  it("novo com os dados da ficha (normaliza PIS, CTPS, maiúsculas)", async () => {
    id = (await comFicha(null, {
      funcao: "auxiliar de logistica", admissao: "2026-11-17", salario: 2145.87, nascimento: "1990-03-15", telefone: "65999990000",
      endereco: "Rua das Flores, 100 - CEP: 78110-000", pis: "123.45678.90-1", rg: "1234 5678", rgOrgao: "ssp/mt", rgEmissao: "2015-01-10",
      ctps: "654321", serie: "0012", uf: "mt", pai: "Pai de Teste", mae: "Mae de Teste",
    })).rows[0].id as string;
    expect(await ler(id)).toEqual({
      funcao: "AUXILIAR DE LOGISTICA", data_admissao: "2026-11-17", salario: "2145.87", data_nascimento: "1990-03-15", telefone: "65999990000",
      endereco: "Rua das Flores, 100 - CEP: 78110-000", pis: "12345678901", rg: "12345678", rg_orgao: "SSP/MT", rg_emissao: "2015-01-10",
      ctps: "654321", ctps_serie: "0012", ctps_uf: "MT", nome_pai: "PAI DE TESTE", nome_mae: "MAE DE TESTE", matricula_escritorio: "222",
    });
  });

  it("chamada antiga (sem p_dados_ficha) não apaga os dados da ficha", async () => {
    await rpc(`select rh_salvar_colaborador(${BASE})`, [id, empresa]);
    expect(await ler(id)).toMatchObject({ funcao: "AUXILIAR DE LOGISTICA", salario: "2145.87", pis: "12345678901", nome_mae: "MAE DE TESTE" });
  });

  it("formulário novo grava o que veio (campo vazio limpa); salário e PIS inválidos recusados", async () => {
    await comFicha(id, { funcao: "Supervisor", admissao: "2026-11-17", salario: 3000 });
    expect(await ler(id)).toMatchObject({ funcao: "SUPERVISOR", salario: "3000.00", pis: null, nome_mae: null, telefone: null });
    await expect(comFicha(id, { salario: 0 })).rejects.toThrow(/salário tem de ser maior que zero/);
    await expect(comFicha(id, { pis: "123" })).rejects.toThrow(/PIS: 11 dígitos/);
    await expect(comFicha(id, { uf: "Mato" })).rejects.toThrow(/check/i);
  });
});
