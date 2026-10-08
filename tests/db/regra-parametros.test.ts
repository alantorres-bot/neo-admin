import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, finConsulta: string, finOperador: string, finGestor: string, fiscalGestor: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const P = "financeiro.recebiveis.";
const salvar = (usuario: string, parametros: unknown) =>
  como(db, usuario, () => q(`select rec_salvar_regua($1::jsonb)`, [JSON.stringify(parametros)]));
const valor = async (chave: string) => (await q(`select valor from configuracoes where chave = $1`, [chave])).rows[0]?.valor;

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  fiscalGestor = await novoUsuario(db, "fiscal@neo.com", { fiscal: "gestor" });
});

describe("sementes", () => {
  it("as janelas e a trava nascem com os valores de sempre", async () => {
    expect(await valor(`${P}janela_anexar_boleto_dias`)).toBe(30);
    expect(await valor(`${P}janela_confirmacao_dias`)).toBe(7);
    expect(await valor(`${P}prazo_contato_antes_dias`)).toBe(4);
    expect(await valor(`${P}trava_pendencias_cobranca`)).toBe(40);
    expect(await valor(`${P}confirmacao_valor_minimo`)).toBe(25000);
  });
});

describe("rec_salvar_regua: quem pode", () => {
  it("consulta, operador e gestor de outra área não gravam", async () => {
    for (const u of [finConsulta, finOperador, fiscalGestor]) {
      await expect(salvar(u, { [`${P}janela_confirmacao_dias`]: 9 })).rejects.toThrow(/Somente gestor do Financeiro/);
    }
    expect(await valor(`${P}janela_confirmacao_dias`)).toBe(7);
  });

  it("gestor do Financeiro e admin geral gravam, e a última alteração registra quem fez", async () => {
    await salvar(finGestor, { [`${P}janela_confirmacao_dias`]: 9, [`${P}trava_pendencias_cobranca`]: 60 });
    expect(await valor(`${P}janela_confirmacao_dias`)).toBe(9);
    expect(await valor(`${P}trava_pendencias_cobranca`)).toBe(60);
    const ultima = await valor(`${P}regra_ultima_alteracao`);
    expect(typeof ultima.por).toBe("string");
    expect(ultima.por.length).toBeGreaterThan(0);
    expect(ultima.em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    await salvar(admin, { [`${P}janela_confirmacao_dias`]: 7, [`${P}trava_pendencias_cobranca`]: 40 });
    expect(await valor(`${P}janela_confirmacao_dias`)).toBe(7);
  });

  it("sem login não grava", async () => {
    await expect(como(db, "anon", () => q(`select rec_salvar_regua('{"x":1}'::jsonb)`))).rejects.toThrow();
  });
});

describe("rec_salvar_regua: validação", () => {
  it("recusa chave fora da lista permitida (a RLS de configuracoes não é contornada)", async () => {
    await expect(salvar(finGestor, { modo_rascunho: false })).rejects.toThrow(/Parâmetro não permitido/);
    await expect(salvar(finGestor, { [`${P}esteira_a_partir_de_x`]: "2026-01-01" })).rejects.toThrow(/Parâmetro não permitido/);
    expect(await valor("modo_rascunho")).toBe(true);
  });

  it("recusa valores fora da faixa, com mensagem em português", async () => {
    await expect(salvar(finGestor, { [`${P}janela_anexar_boleto_dias`]: 0 })).rejects.toThrow(/entre 1 e 365/);
    await expect(salvar(finGestor, { [`${P}janela_anexar_boleto_dias`]: 366 })).rejects.toThrow(/entre 1 e 365/);
    await expect(salvar(finGestor, { [`${P}janela_confirmacao_dias`]: 61 })).rejects.toThrow(/entre 1 e 60/);
    await expect(salvar(finGestor, { [`${P}prazo_contato_antes_dias`]: -1 })).rejects.toThrow(/entre 0 e 30/);
    await expect(salvar(finGestor, { [`${P}trava_pendencias_cobranca`]: 501 })).rejects.toThrow(/entre 1 e 500/);
    await expect(salvar(finGestor, { [`${P}confirmacao_valor_minimo`]: 0 })).rejects.toThrow(/maior que zero/);
    await expect(salvar(finGestor, { [`${P}confirmacao_valor_minimo`]: "muito" })).rejects.toThrow(/número em reais/);
  });

  it("recusa número quebrado e tipo errado", async () => {
    await expect(salvar(finGestor, { [`${P}janela_anexar_boleto_dias`]: 10.5 })).rejects.toThrow(/inteiro/);
    await expect(salvar(finGestor, { [`${P}janela_anexar_boleto_dias`]: "30" })).rejects.toThrow(/inteiro/);
  });

  it("datas: aceita aaaa-mm-dd e null (desliga); recusa o resto", async () => {
    await salvar(finGestor, { [`${P}regua_a_partir_de`]: "2026-11-01" });
    expect(await valor(`${P}regua_a_partir_de`)).toBe("2026-11-01");
    await salvar(finGestor, { [`${P}regua_a_partir_de`]: null });
    expect(await valor(`${P}regua_a_partir_de`)).toBeNull();
    await expect(salvar(finGestor, { [`${P}regua_a_partir_de`]: "01/11/2026" })).rejects.toThrow(/Data inválida/);
    await expect(salvar(finGestor, { [`${P}esteira_a_partir_de`]: "2026-02-31" })).rejects.toThrow(/Data inválida/);
    await salvar(finGestor, { [`${P}regua_a_partir_de`]: "2026-10-06" }); // restaura o padrão
    expect(await valor(`${P}regua_a_partir_de`)).toBe("2026-10-06");
  });

  it("nenhum parâmetro, ou vazio, é recusado", async () => {
    await expect(salvar(finGestor, {})).rejects.toThrow(/Nenhum parâmetro/);
    await expect(salvar(finGestor, [1])).rejects.toThrow(/Nenhum parâmetro/);
  });

  it("é atômica: um valor inválido no meio não grava nenhum dos outros", async () => {
    await expect(salvar(finGestor, { [`${P}janela_confirmacao_dias`]: 12, [`${P}trava_pendencias_cobranca`]: 9999 })).rejects.toThrow(/entre 1 e 500/);
    expect(await valor(`${P}janela_confirmacao_dias`)).toBe(7);
  });
});

describe("rec_salvar_regua: auditoria", () => {
  it("a alteração fica na auditoria com o usuário e o antes/depois", async () => {
    await salvar(finGestor, { [`${P}prazo_contato_antes_dias`]: 3 });
    const r = await q(
      `select usuario_id, antes->>'valor' as antes, depois->>'valor' as depois from auditoria
       where tabela = 'configuracoes' and depois->>'chave' = $1 order by id desc limit 1`, [`${P}prazo_contato_antes_dias`]);
    expect(r.rows[0].usuario_id).toBe(finGestor);
    expect(r.rows[0].antes).toBe("4");
    expect(r.rows[0].depois).toBe("3");
    await salvar(finGestor, { [`${P}prazo_contato_antes_dias`]: 4 });
  });
});

describe("leitura", () => {
  it("quem tem área financeira lê os parâmetros (a tela precisa deles para mostrar)", async () => {
    const r = await como(db, finConsulta, () => q(`select count(*)::int as n from configuracoes where chave like $1`, [`${P}%`]));
    expect(r.rows[0].n).toBeGreaterThanOrEqual(7);
  });
});
