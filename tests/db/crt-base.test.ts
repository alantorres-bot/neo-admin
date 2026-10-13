import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string, semAcesso: string;
let empresa: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));

const LINHAS = [
  { ordem: 1, pagina: 2, data_compra: "2026-09-18", descricao: "Loja Azul", valor: 5919.84, parcela_num: 1, parcela_total: 3, descartada: false },
  { ordem: 2, pagina: 2, data_compra: "2026-09-10", descricao: "Pagamento 029571246", valor: -91374.55, descartada: true, motivo_descarte: "Pagamento da fatura anterior" },
  { ordem: 3, pagina: 2, data_compra: "2026-09-03", descricao: "Credito Anuidade Cartao", valor: -50, descartada: false },
  { ordem: 4, pagina: 2, data_compra: "2026-09-27", descricao: "Anuidade Diferenc 07/12", valor: 50, descartada: false },
];
const importar = (usuario: string, total: number, extra: { vencimento?: string; cartao?: string; linhas?: unknown[] } = {}) =>
  rpc(usuario, `select crt_importar_fatura($1, $2, $3::date, $4::numeric, 'sicredi', 'fatura.pdf', $5::jsonb) as id`,
    [empresa, extra.cartao ?? "SICREDI PF", extra.vencimento ?? "2026-10-10", total, JSON.stringify(extra.linhas ?? LINHAS)]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  semAcesso = await novoUsuario(db, "sem@neo.com", { fiscal: "operador" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
});

describe("módulo e cadastros (0131)", () => {
  it("o módulo financeiro.cartao está ativo; os 8 cartões e o dicionário foram carregados", async () => {
    expect((await q(`select area, nome, ativo from modulos where codigo = 'financeiro.cartao'`)).rows[0]).toEqual({ area: "financeiro", nome: "Cartão de crédito", ativo: true });
    const cartoes = await rpc(finConsulta, `select codigo, dia_fechamento, dia_vencimento, tipo_titulo, leitor from crt_cartoes order by codigo`);
    expect(cartoes.rows.map((c) => [c.codigo, c.dia_fechamento, c.dia_vencimento, c.tipo_titulo, c.leitor])).toEqual([
      ["INTER PF", 20, 28, 8, "inter"], ["INTER PJ", 3, 10, 8, "inter"], ["ITAU PJ", 10, 28, 10, "generico"], ["NUBANK PF", 20, 27, 7, "generico"],
      ["PICPAY PF", 15, 25, 75, "picpay"], ["SICREDI PF", 26, 10, 9, "sicredi"], ["SICREDI PJ", 10, 23, 9, "sicredi"], ["UNICRED PF", 10, 20, 73, "unicred"],
    ]);
    expect((await rpc(finConsulta, `select count(*)::int as n from crt_estabelecimentos`)).rows[0].n).toBe(46);   // 43 da carga inicial + DROGARIA e FARMACIA (0144) + 99 (0150)
    expect((await rpc(finConsulta, `select conta_fluxo from crt_estabelecimentos where padrao = 'MERCADOLIVRE'`)).rows[0].conta_fluxo).toBeNull();
    expect((await como(db, semAcesso, () => q(`select count(*)::int as n from crt_cartoes`))).rows[0].n).toBe(0);
  });
  it("gestor altera o cartão (crt_salvar_cartao); consulta e operador não", async () => {
    await expect(rpc(finOperador, `select crt_salvar_cartao('NUBANK PF', 'NUBANK PF', 'Nubank', 'PF', 20, 27, 7, 'generico', null, true, null)`)).rejects.toThrow(/gestor/);
    await rpc(finGestor, `select crt_salvar_cartao('nubank pf', 'NUBANK PF', 'Nubank', 'PF', 21, 27, 7, 'generico', 'NUBANK PF', true, 'teste')`);
    const c = (await rpc(finConsulta, `select dia_fechamento, observacao, atualizado_por from crt_cartoes where codigo = 'NUBANK PF'`)).rows[0];
    expect(c).toMatchObject({ dia_fechamento: 21, observacao: "teste", atualizado_por: finGestor });
    expect((await rpc(finGestor, `select crt_salvar_cartao('Caixa PJ', 'CAIXA PJ', 'Caixa', 'PJ', 5, 15, null, 'generico', null, true, null) as c`)).rows[0].c).toBe("CAIXA PJ");
    await expect(rpc(finGestor, `select crt_salvar_cartao('X', 'X', 'X', 'PF', 40, 1, null, 'generico', null, true, null)`)).rejects.toThrow(/dia_fechamento|check/i);
  });
  it("operador inclui/altera estabelecimento pelo padrão normalizado; consulta não", async () => {
    await expect(rpc(finConsulta, `select crt_salvar_estabelecimento('Posto Ipiranga', 'Combustível', 'Combustivel')`)).rejects.toThrow(/operador/);
    const id = (await rpc(finOperador, `select crt_salvar_estabelecimento('Padaria São José', 'Alimentação', null) as id`)).rows[0].id;
    expect((await rpc(finConsulta, `select padrao from crt_estabelecimentos where id = $1`, [id])).rows[0].padrao).toBe("PADARIA SAO JOSE");
    const mesmo = (await rpc(finOperador, `select crt_salvar_estabelecimento('padaria sao jose', 'Alimentação', 'Refeições') as id`)).rows[0].id;
    expect(mesmo).toBe(id);
    expect((await rpc(finConsulta, `select conta_fluxo from crt_estabelecimentos where id = $1`, [id])).rows[0].conta_fluxo).toBe("Refeições");
    expect((await q(`select count(*)::int as n from auditoria where tabela = 'crt_estabelecimentos' and registro_id = $1`, [id])).rows[0].n).toBeGreaterThanOrEqual(2);
  });
});

describe("importação da fatura", () => {
  it("operador importa; a soma das linhas não descartadas tem de bater com o total; linhas gravadas na ordem", async () => {
    await expect(importar(finConsulta, 5919.84)).rejects.toThrow(/operador/);
    await expect(importar(finOperador, 5000)).rejects.toThrow(/não bate com o total/);
    const id = (await importar(finOperador, 5919.84)).rows[0].id as string;
    const f = (await rpc(finConsulta, `select status, total_informado, soma_linhas, linhas_lidas, linhas_descartadas, importado_por, cartao_nome, empresa_nome from crt_vw_faturas where id = $1`, [id])).rows[0];
    expect(f).toMatchObject({ status: "importada", linhas_lidas: 4, linhas_descartadas: 1, importado_por: finOperador, cartao_nome: "SICREDI PF", empresa_nome: "Neo" });
    expect(Number(f.total_informado)).toBe(5919.84);
    expect(Number(f.soma_linhas)).toBe(5919.84);
    const linhas = (await rpc(finConsulta, `select ordem, descricao, valor, parcela_total, descartada from crt_fatura_linhas where fatura_id = $1 order by ordem`, [id])).rows;
    expect(linhas.map((l) => [l.ordem, l.descricao, Number(l.valor), l.parcela_total, l.descartada])).toEqual([
      [1, "Loja Azul", 5919.84, 3, false], [2, "Pagamento 029571246", -91374.55, null, true], [3, "Credito Anuidade Cartao", -50, null, false], [4, "Anuidade Diferenc 07/12", 50, null, false],
    ]);
    expect((await como(db, semAcesso, () => q(`select count(*)::int as n from crt_fatura_linhas`))).rows[0].n).toBe(0);
  });
  it("mesmo ciclo não importa duas vezes; depois de cancelada (com motivo), pode", async () => {
    await expect(importar(finOperador, 5919.84)).rejects.toThrow(/já foi importada/);
    const id = (await rpc(finConsulta, `select id from crt_faturas where cartao = 'SICREDI PF' and vencimento = '2026-10-10' and status = 'importada'`)).rows[0].id;
    await expect(rpc(finConsulta, `select crt_cancelar_fatura($1, 'teste')`, [id])).rejects.toThrow(/não encontrada|row-level|acesso|operador/i);
    await expect(rpc(finOperador, `select crt_cancelar_fatura($1, '  ')`, [id])).rejects.toThrow(/motivo/);
    await rpc(finOperador, `select crt_cancelar_fatura($1, 'leitura errada')`, [id]); // quem importou pode
    const f = (await rpc(finConsulta, `select status, cancelado_por, motivo_cancelamento from crt_faturas where id = $1`, [id])).rows[0];
    expect(f).toMatchObject({ status: "cancelada", cancelado_por: finOperador, motivo_cancelamento: "leitura errada" });
    await expect(rpc(finGestor, `select crt_cancelar_fatura($1, 'de novo')`, [id])).rejects.toThrow(/já cancelada/);
    const nova = (await importar(finOperador, 5919.84)).rows[0].id;
    expect(nova).not.toBe(id);
  });
  it("fatura e linhas são imutáveis e nunca apagadas; outro operador não cancela, gestor cancela", async () => {
    const id = (await rpc(finConsulta, `select id from crt_faturas where status = 'importada' limit 1`)).rows[0].id;
    await expect(rpc(finOperador, `update crt_faturas set total_informado = 1 where id = $1`, [id])).rejects.toThrow(/imutável/);
    expect((await rpc(finOperador, `update crt_fatura_linhas set valor = 1 where fatura_id = $1`, [id])).affectedRows).toBe(0); // sem política de update
    await expect(como(db, "service", () => q(`update crt_fatura_linhas set valor = 1 where fatura_id = $1`, [id]))).rejects.toThrow(/imutáveis/);
    await expect(como(db, "service", () => q(`delete from crt_fatura_linhas where fatura_id = $1`, [id]))).rejects.toThrow(/não podem ser excluídos/);
    await expect(como(db, "service", () => q(`delete from crt_faturas where id = $1`, [id]))).rejects.toThrow(/não podem ser excluídos/);
    const outro = await novoUsuario(db, "operador2@neo.com", { financeiro: "operador" });
    await expect(rpc(outro, `select crt_cancelar_fatura($1, 'não é minha')`, [id])).rejects.toThrow(/gestor/);
    await rpc(finGestor, `select crt_cancelar_fatura($1, 'cancelada pelo gestor')`, [id]);
    expect((await q(`select count(*)::int as n from auditoria where tabela = 'crt_faturas' and registro_id = $1`, [id])).rows[0].n).toBeGreaterThanOrEqual(2);
  });
  it("recusa cartão inativo/inexistente e lista vazia", async () => {
    await expect(importar(finOperador, 10, { cartao: "VISA XPTO" })).rejects.toThrow(/não existe/);
    await expect(importar(finOperador, 0, { linhas: [] })).rejects.toThrow(/não tem linhas/);
  });
});
