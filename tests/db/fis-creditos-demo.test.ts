// Fiscal Control: a carga de demonstração (supabase/demo/fiscal_creditos_demo.sql) roda sobre as migrations reais, é coerente
// (saldos contínuos em 12+ competências) e recusa bases com dados reais ou já carregadas.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

const DEMO = readFileSync(join(process.cwd(), "supabase", "demo", "fiscal_creditos_demo.sql"), "utf8");
let db: PGlite;
let admin: string;
let emp: string;
const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  await db.exec(DEMO);
  emp = (await q(`select id from empresas where cnpj = '99.999.999/0001-91'`)).rows[0].id;
});

describe("carga de demonstração", () => {
  it("tudo marcado como fictício", async () => {
    const n = (await q(`select (select count(*) from fis_creditos where not ficticio)::int c, (select count(*) from fis_estabelecimentos where not ficticio)::int e,
                               (select count(*) from fis_documentos where not ficticio)::int d, (select count(*) from fis_obrigacoes where not ficticio)::int o`)).rows[0];
    expect(n).toEqual({ c: 0, e: 0, d: 0, o: 0 });
    expect((await q(`select count(*)::int n from fis_creditos where descricao not like '[FICTÍCIO]%'`)).rows[0].n).toBe(0);
  });

  it("exercício 2025 com 12 competências e saldo inicial = saldo final do mês anterior (inclusive na virada para 2026)", async () => {
    const icms = (await q(`select c.id from fis_creditos c join fis_tributos t on t.id = c.tributo_id where t.codigo = 'ICMS' and c.empresa_id = $1`, [emp])).rows[0].id;
    const ap = (await q(`select competencia::text c, saldo_inicial::float8 si, saldo_final::float8 sf from fis_apuracao('2025-01-01', '2026-09-01') where credito_id = $1 order by competencia`, [icms])).rows;
    expect(ap).toHaveLength(21);
    expect(ap[0]).toMatchObject({ c: "2025-01-01", si: 48250 });
    for (let i = 1; i < ap.length; i++) expect(ap[i].si).toBeCloseTo(ap[i - 1].sf, 2);
    expect(ap.filter((x) => x.c.startsWith("2025"))).toHaveLength(12);
  });

  it("competências fechadas sem reconciliação pendente; 09/2026 em revisão", async () => {
    const p = (await q(`select t.codigo, count(*) filter (where p.status = 'fechado')::int f, count(*) filter (where p.requer_reconciliacao)::int r
                          from fis_periodos p join fis_tributos t on t.id = p.tributo_id where p.empresa_id = $1 group by t.codigo order by t.codigo`, [emp])).rows;
    expect(p.find((x) => x.codigo === "ICMS")).toMatchObject({ f: 20, r: 0 });
    expect(p.find((x) => x.codigo === "IPI")).toMatchObject({ f: 12, r: 0 });
    expect((await q(`select status from fis_periodos p join fis_tributos t on t.id = p.tributo_id where p.empresa_id = $1 and t.codigo = 'ICMS' and competencia = '2026-09-01'`, [emp])).rows[0].status).toBe("em_revisao");
  });

  it("exemplos exigidos: estorno, utilização parcial, compensação, pendente de validação, documento faltante, divergência, obrigações", async () => {
    const tipos = (await q(`select tipo, count(*)::int n from fis_movimentos where empresa_id = $1 group by tipo`, [emp])).rows;
    const n = (t: string) => tipos.find((x) => x.tipo === t)?.n ?? 0;
    expect(n("estorno")).toBe(1);
    expect(n("compensacao")).toBe(2);
    expect(n("saldo_inicial")).toBe(1);
    expect((await q(`select validacao::text v from fis_creditos where empresa_id = $1 and descricao like '%IRPJ%'`, [emp])).rows[0].v).toBe("pendente");
    const regras = (await como(db, admin, () => q(`select distinct regra from fis_verificar($1)`, [emp]))).rows.map((r) => r.regra);
    expect(regras).toEqual(expect.arrayContaining(["R03_SEM_DOCUMENTO", "R06_COMPENSACAO_SEM_PROTOCOLO", "R08_FECHADO_COM_DIVERGENCIA", "R09_SALDO_OFICIAL", "R12_OBRIGACAO_ATRASADA"]));
    expect(regras).not.toContain("R04_SALDO_NEGATIVO");
    expect(regras).not.toContain("R01_TRANSPORTE");
    const st = (await q(`select status::text, count(*)::int n from fis_obrigacoes where empresa_id = $1 group by status`, [emp])).rows;
    expect(st.find((s) => s.status === "entregue_conferida")?.n).toBe(24);
    expect(st.find((s) => s.status === "transmitida")?.n).toBe(1);
    expect((await q(`select count(*)::int n from fis_divergencias where empresa_id = $1 and status = 'aberta'`, [emp])).rows[0].n).toBe(1);
  });

  it("painel lê a demonstração (valores calculados, não fixos)", async () => {
    const p = (await como(db, admin, () => q(`select fis_painel($1::jsonb) r`, [JSON.stringify({ ano: 2025, empresa_id: emp })]))).rows[0].r;
    expect(Number(p.creditos.registrado)).toBeGreaterThan(0);
    expect(Number(p.exercicio.saldo_inicial)).toBeGreaterThan(0);
    expect(p.mensal.every((m: { saldo: number }) => Number(m.saldo) > 0)).toBe(true);
    expect(p.anual).toHaveLength(5);
  });

  it("não carrega duas vezes nem em base com créditos reais ou marcada como produção", async () => {
    await expect(db.exec(DEMO)).rejects.toThrow(/já foi carregada/);
    const outro = await criarBanco();
    await outro.exec(`insert into configuracoes (chave, valor) values ('fiscal.creditos.bloquear_demonstracao', 'true')`);
    await expect(outro.exec(DEMO)).rejects.toThrow(/produção/);
  });
});
