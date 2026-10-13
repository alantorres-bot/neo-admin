import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string;
let fatura: string;
const linha: Record<string, string> = {};

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const titulo = (parcela: number, vencimento: string, valor: number, extra: Record<string, unknown> = {}) => ({
  parcela, vencimento,
  payload: { codFornecedor: 1500, valorDocumento: valor, dataVencimento: vencimento, complementoHistorico: `CARTÃO SICREDI PF — X PARC ${parcela}`, ...extra },
});
const reservar = (u: string, l: string, titulos: unknown[]) =>
  rpc(u, `select crt_reservar_lancamento_compra($1, $2, $3::jsonb) as lote`, [fatura, l, JSON.stringify(titulos)]);
const daLote = (lote: string) => q(`select id, parcela, situacao, linhas from crt_lancamentos_erp where lote = $1 order by parcela`, [lote]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo', 'Neo', '1') returning id`)).rows[0].id;
  const linhas = JSON.stringify([
    { ordem: 1, descricao: "NUVIAGENS AEREO", valor: 461.92, descartada: false },
    { ordem: 2, descricao: "LATAM AIR", valor: 300, parcela_num: 2, parcela_total: 4, descartada: false },
    { ordem: 3, descricao: "ESTORNO LOJA", valor: -20, descartada: false },
    { ordem: 4, descricao: "IOF", valor: 5, descartada: false },
  ]);
  fatura = (await rpc(finOperador, `select crt_importar_fatura($1, 'SICREDI PF', '2026-10-10', 746.92, 'sicredi', 'f.pdf', $2::jsonb) as id`, [empresa, linhas])).rows[0].id;
  for (const l of (await q(`select id, ordem from crt_fatura_linhas where fatura_id = $1`, [fatura])).rows) linha[l.ordem] = l.id;
});

describe("chave geral e códigos (0138)", () => {
  it("a chave foi renomeada e continua desligada; códigos do estabelecimento são opcionais, mas inteiros e conhecidos", async () => {
    expect((await q(`select chave, valor from configuracoes where chave like 'financeiro.cartao.lancar%'`)).rows).toEqual([{ chave: "financeiro.cartao.lancar_no_erp", valor: false }]);
    await q(`update crt_estabelecimentos set lancamento_erp = '{"codFornecedor": 1500, "contaFluxoCaixa": 6}' where padrao = 'NUVIAGENS'`);
    await expect(q(`update crt_estabelecimentos set lancamento_erp = '{"outro": 1}' where padrao = 'NUVIAGENS'`)).rejects.toThrow(/lancamento_erp_ck/);
    await expect(q(`update crt_estabelecimentos set lancamento_erp = '{"codFornecedor": 0}' where padrao = 'NUVIAGENS'`)).rejects.toThrow(/lancamento_erp_ck/);
    await expect(q(`update crt_cartoes set lancamento_compras = '{"codPortador": 91}' where codigo = 'SICREDI PF'`)).rejects.toThrow(/lancamento_compras_ck/);
    await q(`update crt_cartoes set lancamento_compras = '{"codPortador": 91, "categoriaDoc": 17, "codHistorico": 2, "contaContabilCredito": 2004}' where codigo = 'SICREDI PF'`);
  });
});

describe("reservar compra", () => {
  it("desligado recusa; consulta não lança; estorno não vira título; parcelas conferidas", async () => {
    await expect(reservar(finOperador, linha[1], [titulo(1, "2026-10-10", 461.92)])).rejects.toThrow(/desligado/);
    await q(`update configuracoes set valor = 'true'::jsonb where chave = 'financeiro.cartao.lancar_no_erp'`);
    await expect(reservar(finConsulta, linha[1], [titulo(1, "2026-10-10", 461.92)])).rejects.toThrow(/Somente operador/);
    await expect(reservar(finOperador, linha[3], [titulo(1, "2026-10-10", -20)])).rejects.toThrow(/Estorno/);
    await expect(reservar(finOperador, linha[1], [titulo(1, "2026-10-10", 400)])).rejects.toThrow(/valor da linha/);
    await expect(reservar(finOperador, linha[2], [titulo(2, "2026-10-10", 300)])).rejects.toThrow(/da 2 até a 4/);
    await expect(reservar(finOperador, linha[2], [titulo(2, "2026-10-10", 300), titulo(4, "2026-11-10", 300), titulo(3, "2026-12-10", 300)])).rejects.toThrow(/em ordem/);
    await expect(reservar(finOperador, linha[1], [{ ...titulo(1, "2026-10-10", 461.92), payload: { valorDocumento: 461.92, dataVencimento: "2026-10-10", complementoHistorico: "C" } }])).rejects.toThrow(/fornecedor/);
  });
  it("à vista: lote de um título que casa a linha ao ser lançado; a mesma linha não entra de novo nem nos encargos", async () => {
    const lote = (await reservar(finOperador, linha[1], [titulo(1, "2026-10-10", 461.92)])).rows[0].lote;
    const [r] = (await daLote(lote)).rows;
    await servico(`select crt_iniciar_envio_erp($1)`, [r.id]);
    await servico(`select crt_concluir_lancamento_erp($1, '50001', null, null)`, [r.id]);
    const casar = (await q(`select linhas, titulos, motivo from crt_decisoes where fatura_id = $1 and tipo = 'casar'`, [fatura])).rows;
    expect(casar).toEqual([{ linhas: [linha[1]], titulos: ["50001"], motivo: "Compra lançada no Consistem pelo Neo Admin: lançamento 50001 (R$ 461,92)" }]);
    await expect(reservar(finOperador, linha[1], [titulo(1, "2026-10-10", 461.92)])).rejects.toThrow(/já tem decisão|já foi lançada/);
    const enc = JSON.stringify({ valorDocumento: 466.92, complementoHistorico: "C" });
    await expect(rpc(finOperador, `select crt_reservar_lancamento_encargos($1, array[$2, $3]::uuid[], 466.92, 'C', $4::jsonb)`, [fatura, linha[1], linha[4], enc])).rejects.toThrow(/já tem decisão|já foi lançada/);
  });
  it("parcela 2/4: três títulos; só o desta fatura casa a linha; envio interrompido e reenvio só do que faltou", async () => {
    const lote = (await reservar(finOperador, linha[2], [titulo(2, "2026-10-10", 300), titulo(3, "2026-11-10", 300), titulo(4, "2026-12-10", 300)])).rows[0].lote;
    const rs = (await daLote(lote)).rows;
    expect(rs.map((r) => [r.parcela, r.situacao, r.linhas.length])).toEqual([[2, "reservado", 1], [3, "reservado", 0], [4, "reservado", 0]]);
    await servico(`select crt_iniciar_envio_erp($1)`, [rs[0].id]);
    await servico(`select crt_concluir_lancamento_erp($1, '50002', null, null)`, [rs[0].id]);
    await servico(`select crt_iniciar_envio_erp($1)`, [rs[1].id]);
    await servico(`select crt_concluir_lancamento_erp($1, null, null, 'Consistem HTTP 400: conta inválida')`, [rs[1].id]);
    expect((await servico(`select crt_interromper_lote($1, 'Envio interrompido') as n`, [lote])).rows[0].n).toBe(1);
    expect((await daLote(lote)).rows.map((r) => r.situacao)).toEqual(["lancado", "erro", "erro"]);
    expect((await q(`select count(*)::int as n from crt_decisoes where tipo = 'casar' and $1 = any(linhas)`, [linha[2]])).rows[0].n).toBe(1);
    await expect(rpc(finConsulta, `select crt_reenviar_lancamentos($1)`, [lote])).rejects.toThrow(/Somente operador/);
    const novo = (await rpc(finOperador, `select crt_reenviar_lancamentos($1) as lote`, [lote])).rows[0].lote;
    expect((await daLote(novo)).rows.map((r) => [r.parcela, r.situacao])).toEqual([[3, "reservado"], [4, "reservado"]]);
    await expect(rpc(finOperador, `select crt_reenviar_lancamentos($1)`, [lote])).rejects.toThrow(/Nada a reenviar/);
  });
  it("prova: sem delete e imutável", async () => {
    const id = (await q(`select id from crt_lancamentos_erp where tipo = 'compra' limit 1`)).rows[0].id;
    await expect(servico(`update crt_lancamentos_erp set parcela = 9 where id = $1`, [id])).rejects.toThrow(/imutável/);
    await expect(servico(`delete from crt_lancamentos_erp where id = $1`, [id])).rejects.toThrow(/não podem ser excluídos/);
    expect((await rpc(finConsulta, `select linha_descricao from crt_vw_lancamentos_erp where id = $1`, [id])).rows[0].linha_descricao).toMatch(/NUVIAGENS|LATAM/);
  });
});
