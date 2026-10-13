import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// Fase D do Faturamento Filial (migration 0152): usuário restrito à unidade contagem.
let db: PGlite;
let melina: string;
let cuiaba: string;
let empresa: string;
let clienteFilial: string;
let clienteMatriz: string;
let tituloFilial: string;
let tituloMatriz: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const comoMelina = <T>(fn: () => Promise<T>) => como(db, melina, fn, { oauth: true });

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  melina = await novoUsuario(db, "minas@neo.com", { financeiro: "operador" });
  cuiaba = await novoUsuario(db, "cuiaba@neo.com", { financeiro: "operador" });
  await q(`update perfis set unidade_restrita = 'contagem' where id = $1`, [melina]);
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
  clienteFilial = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('CLIENTE MG', '{cliente}', 'mg1') returning id`)).rows[0].id;
  clienteMatriz = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('CLIENTE MT', '{cliente}', 'mt1') returning id`)).rows[0].id;
  const titulo = async (cp: string, doc: string) => (await q(
    `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio) values ($1, $2, $3, '1', current_date + 10, 100, 'aguardando_boleto') returning id`,
    [empresa, cp, doc],
  )).rows[0].id as string;
  tituloFilial = await titulo(clienteFilial, "4002401U");
  tituloMatriz = await titulo(clienteMatriz, "1002401U");
  await q(`insert into anexos (modulo, referencia_tabela, referencia_id, arquivo_path, nome_arquivo, tipo) values
    ('financeiro.recebiveis', 'rec_titulos', $1, 'financeiro.recebiveis/rec_titulos/f/boleto.pdf', 'boleto.pdf', 'boleto'),
    ('financeiro.recebiveis', 'rec_titulos', $2, 'financeiro.recebiveis/rec_titulos/m/boleto.pdf', 'boleto.pdf', 'boleto')`, [tituloFilial, tituloMatriz]);
});

describe("usuário restrito à Filial Contagem", () => {
  it("não tem nível em área nenhuma; só o módulo Faturamento Filial", async () => {
    const r = await comoMelina(async () => (await q(`select nivel_area('financeiro') as area, tem_acesso_modulo('financeiro.filial', 'operador') as filial,
      tem_acesso_modulo('financeiro.recebiveis') as recebiveis, tem_acesso_modulo('financeiro.cartao') as cartao, unidade_restrita() as unidade`)).rows[0]);
    expect(r).toEqual({ area: "sem_acesso", filial: true, recebiveis: false, cartao: false, unidade: "contagem" });
  });

  it("quem não é restrito continua igual", async () => {
    const r = await como(db, cuiaba, async () => (await q(`select nivel_area('financeiro') as area, tem_acesso_modulo('financeiro.filial', 'operador') as filial,
      tem_acesso_modulo('financeiro.recebiveis', 'operador') as recebiveis`)).rows[0]);
    expect(r).toEqual({ area: "operador", filial: true, recebiveis: true });
  });

  it("lê só títulos e clientes da unidade", async () => {
    const titulos = await comoMelina(async () => (await q(`select documento from rec_titulos order by documento`)).rows.map((t) => t.documento));
    expect(titulos).toEqual(["4002401U"]);
    const clientes = await comoMelina(async () => (await q(`select nome from contrapartes order by nome`)).rows.map((c) => c.nome));
    expect(clientes).toEqual(["CLIENTE MG"]);
    const cuiabaVe = await como(db, cuiaba, async () => (await q(`select count(*)::int n from rec_titulos`)).rows[0].n);
    expect(cuiabaVe).toBe(2);
  });

  it("não lê contas a pagar, cartão nem AKF", async () => {
    for (const t of ["cap_autorizacoes", "crt_faturas", "akf_operacoes", "rec_clientes_config"]) {
      await q(`select 1`); // garante a conexão fora do papel
      const n = await comoMelina(async () => (await q(`select count(*)::int n from ${t}`)).rows[0].n);
      expect(n, t).toBe(0);
    }
  });

  it("não cadastra nem altera cliente", async () => {
    await expect(comoMelina(() => q(`insert into contrapartes (nome, tipos) values ('X', '{cliente}')`))).rejects.toThrow();
    const alterados = await comoMelina(async () => (await q(`update contrapartes set observacoes = 'x' where id = $1 returning id`, [clienteFilial])).rows.length);
    expect(alterados).toBe(0);
  });

  it("usa o Faturamento Filial: remessa, kit e pendência", async () => {
    const r = await comoMelina(async () => (await q(`select rec_remessa_criar() as r`)).rows[0].r as { id: string });
    const kit = await comoMelina(async () => (await q(
      `select rec_kit_registrar('2402', 'CLIENTE MG', true, null, null, null, null, $1, '[{"vencimento":"2026-11-10","valor":100}]'::jsonb) as id`, [r.id],
    )).rows[0].id as string);
    expect(await comoMelina(async () => (await q(`select rec_remessa_concluir($1) as n`, [r.id])).rows[0].n)).toBe(1);
    expect(await comoMelina(async () => (await q(`select count(*)::int n from rec_vw_kits where id = $1`, [kit])).rows[0].n)).toBe(1);
    const pend = await comoMelina(async () => (await q(`select titulo from pendencias where referencia_id = $1`, [r.id])).rows);
    expect(pend.length).toBe(1);
    await comoMelina(() => q(`insert into anexos (modulo, referencia_tabela, referencia_id, arquivo_path, nome_arquivo, tipo, enviado_por)
      values ('financeiro.filial', 'rec_kits', $1, 'financeiro.filial/rec_kits/x/nf.pdf', 'nf.pdf', 'nota_fatura', $2)`, [kit, melina]));
    await expect(comoMelina(() => q(`insert into anexos (modulo, referencia_tabela, referencia_id, arquivo_path, nome_arquivo, tipo, enviado_por)
      values ('financeiro.recebiveis', 'rec_titulos', $1, 'financeiro.recebiveis/x.pdf', 'x.pdf', 'boleto', $2)`, [tituloFilial, melina]))).rejects.toThrow();
  });

  it("vê o boleto das parcelas da unidade, não o da Matriz", async () => {
    const boletos = await comoMelina(async () => (await q(`select referencia_id from anexos where tipo = 'boleto'`)).rows.map((a) => a.referencia_id));
    expect(boletos).toEqual([tituloFilial]);
  });

  it("admin geral não pode ser restrito", async () => {
    await expect(q(`update perfis set admin_geral = true where id = $1`, [melina])).rejects.toThrow();
  });
});
