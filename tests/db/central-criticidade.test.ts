// Central de Gestão, Fase 4 (migration 0095): impacto com fundamento, impacto sem prazo, limites aprovados pelo admin e
// áreas que precisam de atenção.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, gestor: string, operador: string, fiscal: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";
const data = async (dias: number) => (await q(`select ((now() at time zone 'America/Cuiaba')::date + $1::int)::text d`, [dias])).rows[0].d as string;
const criar = (quem: string, dados: object) =>
  como(db, quem, async () => (await q(`select pendencia_criar($1) as id`, [JSON.stringify(dados)])).rows[0].id as string);
const acao = (quem: string, id: string, nome: string, dados: object = {}) =>
  como(db, quem, () => q(`select pendencia_acao($1, $2, $3)`, [id, nome, JSON.stringify(dados)]));
const destaque = async (quem: string, id: string) =>
  (await como(db, quem, () => q(`select destaque, motivos from central_pendencias('gestao', $1)`, [JSON.stringify({ id })]))).rows[0];

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  gestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  operador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  fiscal = await novoUsuario(db, "fiscal@neo.com", { fiscal: "gestor" });
});

describe("impacto", () => {
  it("gestor registra impacto com fundamento; sem fundamento é recusado; operador não registra", async () => {
    const id = await criar(gestor, { modulo: MOD, titulo: "Guia vencendo", responsavel_id: operador, prazo: await data(1) });
    await expect(acao(gestor, id, "alterar", { impacto: "fiscal" })).rejects.toThrow(/fundamento do impacto/);
    await expect(acao(operador, id, "alterar", { impacto: "fiscal", impacto_fundamento: "Multa" })).rejects.toThrow(/gestor da área altera/);
    await acao(gestor, id, "alterar", { impacto: "fiscal", impacto_fundamento: "Multa de mora sobre a guia" });
    const d = await destaque(gestor, id);
    expect(d.destaque).toBe("intervir");
    expect(d.motivos.map((m: Linha) => m.codigo)).toContain("IMPACTO_REGISTRADO");
    // retirar o impacto limpa também o fundamento
    await acao(gestor, id, "alterar", { impacto: "" });
    expect((await q(`select impacto, impacto_fundamento from pendencias where id = $1`, [id])).rows[0]).toEqual({ impacto: null, impacto_fundamento: null });
  });

  it("impacto sem prazo pede avaliação, em vez de classificar por suposição", async () => {
    const id = await criar(gestor, { modulo: MOD, titulo: "Sem prazo", responsavel_id: operador });
    await acao(gestor, id, "alterar", { impacto: "financeiro", impacto_fundamento: "Juros sobre o título em aberto" });
    const d = await destaque(gestor, id);
    expect(d.destaque).toBe("avaliar");
    expect(d.motivos).toEqual([expect.objectContaining({ codigo: "IMPACTO_SEM_PRAZO", impacto: "financeiro" })]);
  });
});

describe("limites", () => {
  it("só o admin salva; faixas validadas; a aprovação registra quem e quando", async () => {
    await expect(como(db, gestor, () => q(`select central_salvar_parametros('{"dias_atraso_relevante": 10}')`))).rejects.toThrow(/administrador geral/);
    await como(db, admin, async () => {
      await expect(q(`select central_salvar_parametros('{"dias_atraso_relevante": 0}')`)).rejects.toThrow(/fora da faixa/);
      await expect(q(`select central_salvar_parametros('{"dias_atraso_relevante": "abc"}')`)).rejects.toThrow(/número inteiro/);
      await expect(q(`select central_salvar_parametros('{"outra_coisa": 1}')`)).rejects.toThrow(/desconhecido/);
      const r = (await q(`select central_salvar_parametros('{"dias_atraso_relevante": 7, "dias_prazo_proximo": 2}') p`)).rows[0].p;
      expect(r).toMatchObject({ dias_atraso_relevante: 7, dias_prazo_proximo: 2 });
    });
    const aprov = (await q(`select valor from configuracoes where chave = 'administrativo.gestao.limites_aprovados'`)).rows[0].valor;
    expect(aprov).toMatchObject({ por: "admin", valores: { dias_atraso_relevante: 7 } });
    expect((await q(`select count(*)::int n from auditoria where tabela = 'configuracoes' and depois ->> 'chave' = 'administrativo.gestao.dias_atraso_relevante'`)).rows[0].n).toBeGreaterThan(0);

    // o novo limite vale na classificação: 6 dias de atraso deixa de ser relevante
    const id = (await q(`insert into pendencias (modulo, titulo, responsavel_id, prazo) values ($1, 'Atraso de 6', $2, (now() at time zone 'America/Cuiaba')::date - 6) returning id`, [MOD, operador])).rows[0].id;
    expect((await destaque(gestor, id)).destaque).toBe("acompanhar");
    await como(db, admin, () => q(`select central_salvar_parametros('{"dias_atraso_relevante": 5, "dias_prazo_proximo": 3}')`));
    expect((await destaque(gestor, id)).destaque).toBe("intervir");
  });
});

describe("áreas que precisam de atenção", () => {
  it("conta por módulo só o que quem consulta pode ver, o mais urgente primeiro", async () => {
    await q(`insert into pendencias (modulo, titulo, prazo) values ('fiscal.creditos', 'Do fiscal', (now() at time zone 'America/Cuiaba')::date - 1)`);
    const doGestor = (await como(db, gestor, () => q(`select modulo, abertas, intervir, atrasadas from central_por_area('gestao', '{}')`))).rows;
    expect(doGestor.map((l) => l.modulo)).toEqual(["financeiro.recebiveis"]);
    expect(doGestor[0].intervir).toBeGreaterThanOrEqual(1);
    const doAdmin = (await como(db, admin, () => q(`select modulo from central_por_area('gestao', '{}')`))).rows.map((l) => l.modulo);
    expect(doAdmin).toEqual(expect.arrayContaining(["financeiro.recebiveis", "fiscal.creditos"]));
    const doFiscal = (await como(db, fiscal, () => q(`select modulo, atrasadas from central_por_area('gestao', '{}')`))).rows;
    expect(doFiscal).toEqual([{ modulo: "fiscal.creditos", atrasadas: 1 }]);
  });
});
