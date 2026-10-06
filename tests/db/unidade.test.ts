import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { sufixoUnidade, unidadeDaPendencia, unidadeDoDocumento } from "../../supabase/functions/_shared/cobranca";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finOperador: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";

async function cliente() {
  const n = ++contador;
  return (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ($1, '{cliente}', $2) returning id`, [`CLIENTE U${n}`, `u${n}`])).rows[0].id as string;
}
async function titulo(cp: string, documento: string, estagio = "vencido") {
  return (await q(
    `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio) values ($1, $2, $3, '1', current_date - 3, 1000, $4) returning id`,
    [empresa, cp, documento, estagio],
  )).rows[0].id as string;
}
const pendencia = (cp: string, titulo: string) =>
  q(`insert into pendencias (modulo, titulo, prazo, referencia_tabela, referencia_id) values ($1, $2, current_date, 'contrapartes', $3)`, [MOD, titulo, cp]);
const status = async (cp: string) => Object.fromEntries((await q(`select titulo, status from pendencias where referencia_id = $1`, [cp])).rows.map((r) => [r.titulo, r.status]));

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
});

describe("unidade do título", () => {
  it("documento que começa com 4 é da Filial Contagem; os demais, da Matriz (SQL e TypeScript iguais)", async () => {
    const cp = await cliente();
    for (const doc of ["4002323U", "4", "40", "004471U", "1001266E", "Z00018E", "TESTE-1", "34000", " 4001"]) {
      const id = await titulo(cp, doc);
      const r = (await q(`select unidade from rec_vw_titulos where id = $1`, [id])).rows[0].unidade;
      expect(r, doc).toBe(unidadeDoDocumento(doc) === "contagem" ? "contagem" : "matriz");
    }
    expect(unidadeDoDocumento("4002323U")).toBe("contagem");
    expect(unidadeDoDocumento("004471U")).toBe("matriz");
  });

  it("a unidade acompanha o documento e não pode ser gravada à mão", async () => {
    const cp = await cliente();
    const id = await titulo(cp, "4009999X");
    await expect(q(`update rec_titulos set unidade = 'matriz' where id = $1`, [id])).rejects.toThrow();
  });

  it("título e sufixo da pendência identificam a unidade", () => {
    expect(sufixoUnidade("contagem")).toBe(" (Filial Contagem)");
    expect(sufixoUnidade("matriz")).toBe("");
    expect(unidadeDaPendencia("Cobrar D+1: Fulano (Filial Contagem) — venc. 05/10")).toBe("contagem");
    expect(unidadeDaPendencia("Cobrar D+1: Fulano — venc. 05/10")).toBe("matriz");
  });
});

describe("registro por unidade", () => {
  const cobrar = (ids: string[], marco = 1) =>
    como(db, finOperador, () => q(`select rec_registrar_cobranca($1::uuid[], $2, 'enviada', 'whatsapp'::canal, null, null) as r`, [ids, marco]));
  const confirmar = (ids: string[], resultado = "confirmou") =>
    como(db, finOperador, () => q(`select rec_registrar_confirmacao($1::uuid[], $2, 'whatsapp'::canal, 'teste') as r`, [ids, resultado]));

  it("cobrança: parcelas da Matriz e da Filial juntas são recusadas", async () => {
    const cp = await cliente();
    const a = await titulo(cp, "1000001A");
    const b = await titulo(cp, "4000001A");
    await expect(cobrar([a, b])).rejects.toThrow(/mesma unidade/);
  });

  it("cobrança: conclui só a pendência da unidade registrada", async () => {
    const cp = await cliente();
    const matriz = await titulo(cp, "1000002A");
    const filial = await titulo(cp, "4000002A");
    await pendencia(cp, "Cobrar D+1: CLIENTE — venc. 03/10");
    await pendencia(cp, "Cobrar D+1: CLIENTE (Filial Contagem) — venc. 03/10");

    const r = await cobrar([filial]);
    expect(r.rows[0].r).toMatchObject({ pendencias_concluidas: 1 });
    expect(await status(cp)).toEqual({ "Cobrar D+1: CLIENTE — venc. 03/10": "aberta", "Cobrar D+1: CLIENTE (Filial Contagem) — venc. 03/10": "concluida" });

    await cobrar([matriz]);
    expect(Object.values(await status(cp))).toEqual(["concluida", "concluida"]);
  });

  it("confirmação: recusa unidades misturadas e conclui só a da unidade", async () => {
    const cp = await cliente();
    const matriz = await titulo(cp, "1000003A", "boleto_enviado");
    const filial = await titulo(cp, "4000003A", "boleto_enviado");
    await expect(confirmar([matriz, filial])).rejects.toThrow(/mesma unidade/);

    await pendencia(cp, "Confirmar pagamento: CLIENTE — vence 09/10");
    await pendencia(cp, "Confirmar pagamento: CLIENTE (Filial Contagem) — vence 09/10");
    await confirmar([filial]);
    expect(await status(cp)).toEqual({ "Confirmar pagamento: CLIENTE — vence 09/10": "aberta", "Confirmar pagamento: CLIENTE (Filial Contagem) — vence 09/10": "concluida" });
  });

  it("confirmação sem resposta abre a ligação da própria unidade, com o link da unidade", async () => {
    const cp = await cliente();
    const filial = await titulo(cp, "4000004A", "importado");
    await confirmar([filial], "sem_resposta");
    const p = (await q(`select titulo, link from pendencias where referencia_id = $1 and titulo like 'Ligar%'`, [cp])).rows;
    expect(p).toHaveLength(1);
    expect(p[0].titulo).toMatch(/^Ligar para confirmar pagamento: CLIENTE U\d+ \(Filial Contagem\) — vence \d\d\/\d\d$/);
    expect(p[0].link).toMatch(/\?unidade=contagem$/);
  });
});
