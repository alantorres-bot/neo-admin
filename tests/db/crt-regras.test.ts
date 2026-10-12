import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finGestor: string, semAcesso: string;
const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  semAcesso = await novoUsuario(db, "sem@neo.com", { fiscal: "operador" });
});

describe("espelho das regras fornecedor → cartão (0136)", () => {
  it("só a service role grava; quem tem a área lê; chave única por fornecedor e início da vigência", async () => {
    await como(db, "service", () => q(`insert into crt_regras_fornecedor (cod_fornecedor, cartao, parcelas_padrao, vigencia_ini) values ('622', 'SICREDI PF', 1, '2026-10-01')`));
    await expect(como(db, "service", () => q(`insert into crt_regras_fornecedor (cod_fornecedor, cartao, vigencia_ini) values ('622', 'INTER PJ', '2026-10-01')`))).rejects.toThrow(/unique|duplicate/i);
    await expect(como(db, finGestor, () => q(`insert into crt_regras_fornecedor (cod_fornecedor, cartao, vigencia_ini) values ('1', 'X', '2026-01-01')`))).rejects.toThrow(/row-level security/);
    expect((await como(db, finConsulta, () => q(`select cartao from crt_regras_fornecedor`))).rows).toEqual([{ cartao: "SICREDI PF" }]);
    expect((await como(db, semAcesso, () => q(`select count(*)::int as n from crt_regras_fornecedor`))).rows[0].n).toBe(0);
  });
});
