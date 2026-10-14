import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let rhConsulta: string, rhOperador: string, rhGestor: string, soFinanceiro: string;
let empresa: string, comp: string;
const itens: Record<string, string> = {};

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const item = async (cod: string) => (await rpc(rhConsulta, `select * from rh_vt_itens where id = $1`, [itens[cod]])).rows[0];
const salvar = (linhas: Record<string, unknown>[]) => rpc(rhOperador, `select rh_vt_salvar_itens($1, $2::jsonb) as n`, [comp, JSON.stringify(linhas)]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  rhConsulta = await novoUsuario(db, "consulta@neo.com", { rh: "consulta" });
  rhOperador = await novoUsuario(db, "operador@neo.com", { rh: "operador" });
  rhGestor = await novoUsuario(db, "gestor@neo.com", { rh: "gestor" });
  soFinanceiro = await novoUsuario(db, "fin@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Formas', 'NEO FORMAS', '1') returning id`)).rows[0].id;
  const cad = (cod: string, cpf: string | null, forma: string, tarifa: number | null, fixo: number | null, ativo = true) =>
    q(`insert into rh_vt_colaboradores (empresa_id, empregador, cod_fornecedor, nome, cpf, agencia, conta, forma_pagamento, tarifa, valor_fixo, ativo)
       values ($1, 'NEO SERVIÇOS', $2::text, 'PESSOA ' || $2::text, $3::text, case when $3::text is null then null else '2764-2' end, case when $3::text is null then null else '9999-9' end, $4, $5::numeric, $6::numeric, $7)`,
      [empresa, cod, cpf, forma, tarifa, fixo, ativo]);
  await cad("660", null, "pix_neo_formas", 4.95, null);
  await cad("658", "111.444.777-35", "fopag", 4.95, null);
  await cad("659", "222.333.444-05", "fopag", null, 800);
  await cad("700", "123.456.789-09", "fopag", 8, null);
  await cad("999", null, "fopag", 4.95, null, false);
});

describe("calendário em SQL (0502)", () => {
  it("bate com o calendário da tela", async () => {
    const r = (await q(`select rh_vt_dias_uteis_entre('2026-11-01', '2026-11-30') as nov, rh_vt_ultimo_dia_util('2026-10-01') as pag,
                               rh_vt_voltar_dias_uteis('2026-10-30', 2) as prazo, rh_vt_dias_periodo('2026-10-20', '2026-11-04', '2026-11-01') as per,
                               rh_vt_rotulo_mes('2026-03-01') as rot`)).rows[0];
    expect(r).toMatchObject({ nov: 21, prazo: new Date("2026-10-28T00:00:00Z"), per: 3, rot: "março/2026" });
    expect((r.pag as Date).toISOString().slice(0, 10)).toBe("2026-10-30");
  });
});

describe("mês do VT (0502)", () => {
  it("só operador do RH abre o mês; entram só os ativos, com a foto do cadastro", async () => {
    await expect(rpc(rhConsulta, `select rh_vt_abrir_competencia('2026-11-15', 21)`)).rejects.toThrow(/operador do RH/);
    await expect(rpc(soFinanceiro, `select rh_vt_abrir_competencia('2026-11-15', 21)`)).rejects.toThrow(/operador do RH/);
    comp = (await rpc(rhOperador, `select rh_vt_abrir_competencia('2026-11-15', 21) as id`)).rows[0].id;
    const c = (await rpc(rhConsulta, `select competencia::text, data_pagamento::text, prazo_fechamento::text, status from rh_vt_competencias where id = $1`, [comp])).rows[0];
    expect(c).toEqual({ competencia: "2026-11-01", data_pagamento: "2026-10-30", prazo_fechamento: "2026-10-28", status: "aberta" });
    const linhas = (await rpc(rhConsulta, `select id, cod_fornecedor, valor::text from rh_vt_itens where competencia_id = $1 order by cod_fornecedor`, [comp])).rows;
    for (const l of linhas) itens[l.cod_fornecedor as string] = l.id as string;
    expect(linhas.map((l) => [l.cod_fornecedor, l.valor])).toEqual([["658", "207.90"], ["659", "800.00"], ["660", "207.90"], ["700", "336.00"]]);
    await expect(rpc(rhOperador, `select rh_vt_abrir_competencia('2026-11-01', 21)`)).rejects.toThrow(/já foi aberto/);
    expect((await q(`select count(*)::int as n from pendencias where modulo = 'rh.vale_transporte' and titulo = 'Fechar VT de novembro/2026' and referencia_id = $1 and status = 'aberta'`, [comp])).rows[0].n).toBe(1);
    expect((await como(db, soFinanceiro, () => q(`select count(*)::int as n from rh_vt_itens`))).rows[0].n).toBe(0);
  });

  it("ocorrências: falta, atestado, extra, férias, afastamento, abatimento e valor fixo proporcional (cálculo no banco)", async () => {
    await salvar([
      { id: itens["658"], faltas: 1, atestados: 1 },
      { id: itens["660"], ferias_inicio: "2026-11-10", ferias_fim: "2026-11-20", abat_valor: 10, abat_motivo: "saldo no cartão" },
      { id: itens["659"], faltas: 2 },
      { id: itens["700"], extras: 1, afastamento_inicio: "2026-11-23", afastamento_fim: "2026-11-30", abat_dias: 1, abat_motivo: "devolução" },
    ]);
    expect(await item("658")).toMatchObject({ dias_pagos: 19, valor: "188.10" });
    expect(await item("660")).toMatchObject({ dias_ferias: 9, dias_pagos: 12, valor: "108.80" });
    expect(await item("659")).toMatchObject({ dias_pagos: 19, valor: "723.81" });
    expect(await item("700")).toMatchObject({ dias_afastamento: 6, dias_pagos: 15, valor: "240.00" });
    await expect(salvar([{ id: itens["658"], abat_dias: 1 }])).rejects.toThrow(/check/i);
    await expect(salvar([{ id: itens["658"], sem_vt: true }])).rejects.toThrow(/check/i);
    await expect(rpc(rhConsulta, `select rh_vt_salvar_itens($1, '[]'::jsonb)`, [comp])).rejects.toThrow(/operador/);
    await expect(rpc(rhOperador, `update rh_vt_itens set faltas = 5 where id = $1`, [itens["658"]])).resolves.toMatchObject({ affectedRows: 0 });
  });

  it("mudar os dias úteis do mês arrasta quem estava no padrão", async () => {
    await salvar([{ id: itens["700"], dias_uteis: 20, extras: 1, afastamento_inicio: "2026-11-23", afastamento_fim: "2026-11-30", abat_dias: 1, abat_motivo: "devolução" }]);
    await rpc(rhOperador, `select rh_vt_definir_dias_uteis($1, 20)`, [comp]);
    expect((await item("658")).dias_uteis).toBe(20);
    await rpc(rhOperador, `select rh_vt_definir_dias_uteis($1, 21)`, [comp]);
    expect((await item("658")).dias_uteis).toBe(21);
    expect((await item("700")).dias_uteis).toBe(21);   // estava em 20 = padrão do momento
  });

  it("atualizar do cadastro: dados novos, quem entrou e quem saiu (sem VT)", async () => {
    await q(`update rh_vt_colaboradores set tarifa = 5.95 where cod_fornecedor = '658'`);
    await q(`update rh_vt_colaboradores set ativo = true where cod_fornecedor = '999'`);
    const r = (await rpc(rhOperador, `select rh_vt_atualizar_do_cadastro($1) as r`, [comp])).rows[0].r;
    expect(r).toEqual({ atualizados: 1, incluidos: 1, desativados: 0 });
    expect(await item("658")).toMatchObject({ faltas: 1, valor: "226.10" });   // 19 × 2 × 5,95, ocorrências mantidas
    await q(`update rh_vt_colaboradores set ativo = false where cod_fornecedor = '999'`);
    expect((await rpc(rhOperador, `select rh_vt_atualizar_do_cadastro($1) as r`, [comp])).rows[0].r).toEqual({ atualizados: 0, incluidos: 0, desativados: 1 });
    const novo = (await rpc(rhConsulta, `select sem_vt, sem_vt_motivo, valor::text from rh_vt_itens where competencia_id = $1 and cod_fornecedor = '999'`, [comp])).rows[0];
    expect(novo).toEqual({ sem_vt: true, sem_vt_motivo: "Desativado no cadastro", valor: "0.00" });
  });

  it("enviar recusa FOPAG sem conta; com tudo certo, envia e troca a pendência", async () => {
    await salvar([{ id: (await rpc(rhConsulta, `select id from rh_vt_itens where competencia_id = $1 and cod_fornecedor = '999'`, [comp])).rows[0].id, sem_vt: false }]);
    await expect(rpc(rhOperador, `select rh_vt_enviar($1)`, [comp])).rejects.toThrow(/FOPAG sem CPF, agência ou conta.*999/);
    await q(`update rh_vt_colaboradores set ativo = false where cod_fornecedor = '999'`);
    await rpc(rhOperador, `select rh_vt_atualizar_do_cadastro($1)`, [comp]);
    await rpc(rhOperador, `select rh_vt_enviar($1)`, [comp]);
    const pend = (await q(`select titulo, status from pendencias where modulo = 'rh.vale_transporte' order by criado_em, titulo`)).rows;
    expect(pend).toEqual([{ titulo: "Fechar VT de novembro/2026", status: "concluida" }, { titulo: "Aprovar VT de novembro/2026", status: "aberta" }]);
    await expect(salvar([{ id: itens["658"], faltas: 3 }])).rejects.toThrow(/esta ação não vale/);
    await expect(q(`update rh_vt_itens set faltas = 3 where id = $1`, [itens["658"]])).rejects.toThrow(/não está aberto/);
  });

  it("operador não aprova; gestor aprova; PIX, arquivo do BB e paga", async () => {
    await expect(rpc(rhOperador, `select rh_vt_aprovar($1)`, [comp])).rejects.toThrow(/gestor do RH/);
    await rpc(rhGestor, `select rh_vt_aprovar($1)`, [comp]);
    await expect(rpc(rhOperador, `select rh_vt_marcar_paga($1)`, [comp])).rejects.toThrow(/arquivo do BB/);
    await expect(rpc(rhOperador, `select rh_vt_registrar_arquivo_bb($1)`, [comp])).rejects.toThrow(/gestor/);
    await rpc(rhGestor, `select rh_vt_registrar_arquivo_bb($1)`, [comp]);
    await expect(rpc(rhOperador, `select rh_vt_marcar_paga($1)`, [comp])).rejects.toThrow(/1 PIX/);
    expect((await rpc(rhOperador, `select rh_vt_marcar_pix($1, $2::uuid[], true) as n`, [comp, [itens["660"], itens["658"]]])).rows[0].n).toBe(1);
    expect((await item("660")).pix_pago_por).toBe(rhOperador);
    await rpc(rhOperador, `select rh_vt_marcar_paga($1)`, [comp]);
    expect((await rpc(rhConsulta, `select status from rh_vt_competencias where id = $1`, [comp])).rows[0].status).toBe("paga");
    expect((await q(`select status from pendencias where titulo = 'Pagar VT de novembro/2026'`)).rows[0].status).toBe("concluida");
  });

  it("reabrir: só gestor, com motivo; volta a aberta e reabre a pendência de fechar", async () => {
    await expect(rpc(rhOperador, `select rh_vt_reabrir($1, 'erro')`, [comp])).rejects.toThrow(/gestor/);
    await expect(rpc(rhGestor, `select rh_vt_reabrir($1, ' ')`, [comp])).rejects.toThrow(/motivo/);
    await rpc(rhGestor, `select rh_vt_reabrir($1, 'faltou lançar férias')`, [comp]);
    const c = (await rpc(rhConsulta, `select status, reaberta_motivo, arquivo_bb_gerado_em from rh_vt_competencias where id = $1`, [comp])).rows[0];
    expect(c).toEqual({ status: "aberta", reaberta_motivo: "faltou lançar férias", arquivo_bb_gerado_em: null });
    expect((await q(`select count(*)::int as n from pendencias where titulo = 'Fechar VT de novembro/2026' and status = 'aberta'`)).rows[0].n).toBe(1);
    await expect(q(`delete from rh_vt_competencias where id = $1`, [comp])).rejects.toThrow(/não podem ser excluídos/);
  });
});
