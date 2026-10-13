import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finOperador: string, finGestor: string;
let empresa: string, fatura: string, ciclo: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const corpo = (valor: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ codFornecedor: 80, valorDocumento: valor, dataVencimento: "2026-10-23", complementoHistorico: "FATURA CARTÃO SICREDI PJ 10/2026", ...extra });
const reservar = (u: string, valor: number, extra: Record<string, unknown> = {}) =>
  rpc(u, `select crt_reservar_provisorio($1, $2::jsonb) as lote`, [ciclo, corpo(valor, extra)]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo', 'Neo', '1') returning id`)).rows[0].id;
  const linhas = JSON.stringify([{ ordem: 1, descricao: "LOJA", valor: 3576.92, descartada: false }]);
  fatura = (await rpc(finOperador, `select crt_importar_fatura($1, 'SICREDI PJ', '2026-10-23', 3576.92, 'sicredi', 'f.pdf', $2::jsonb) as id`, [empresa, linhas])).rows[0].id;
  ciclo = (await q(`select ciclo_id from crt_faturas where id = $1`, [fatura])).rows[0].ciclo_id;
  await q(`update configuracoes set valor = 'true'::jsonb where chave = 'financeiro.cartao.lancar_no_erp'`);
});

describe("provisório no fechamento (0154)", () => {
  it("configuração nasce sem conta de fluxo e contas contábeis (a informar)", async () => {
    expect((await q(`select valor from configuracoes where chave = 'financeiro.cartao.provisorio'`)).rows[0].valor).toEqual({ codHistorico: 1, categoriaDoc: 17, codPortador: 91, grupoContaFluxoCaixa: 22, contaFluxoCaixa: 24 });
  });
  it("só com o mês fechado e para gestor; valor = total da fatura", async () => {
    await expect(reservar(finGestor, 3576.92)).rejects.toThrow(/mês fechado/);
    await rpc(finGestor, `select crt_fechar_ciclo($1, '{}'::jsonb, 0, 0, 3576.92, 3576.92, null)`, [ciclo]);
    await expect(reservar(finOperador, 3576.92)).rejects.toThrow(/Somente gestor/);
    await expect(reservar(finGestor, 100)).rejects.toThrow(/total da fatura \(R\$ 3\.576,92\)/);
    await expect(reservar(finGestor, 3576.92, { codFornecedor: null })).rejects.toThrow(/banco emissor/);
  });
  it("pendência 'Criar o provisório' aberta e concluída ao lançar; o código vira o vigiado do mês e a Paga funciona", async () => {
    await rpc(finGestor, `select crt_pendencia_provisorio($1, 'Consistem HTTP 400: conta inválida')`, [ciclo]);
    await rpc(finGestor, `select crt_pendencia_provisorio($1, 'de novo')`, [ciclo]);   // não duplica
    expect((await q(`select count(*)::int as n from pendencias where referencia_id = $1 and titulo like 'Criar o provisório%' and status = 'aberta'`, [ciclo])).rows[0].n).toBe(1);
    const lote = (await reservar(finGestor, 3576.92)).rows[0].lote;
    await expect(reservar(finGestor, 3576.92)).rejects.toThrow(/já foi enviado/);
    const id = (await q(`select id from crt_lancamentos_erp where lote = $1`, [lote])).rows[0].id;
    await servico(`select crt_iniciar_envio_erp($1)`, [id]);
    await servico(`select crt_concluir_lancamento_erp($1, '70001', null, null)`, [id]);
    expect((await q(`select provisorio_cod_lancamento from crt_ciclos where id = $1`, [ciclo])).rows[0].provisorio_cod_lancamento).toBe("70001");
    expect((await q(`select status from pendencias where referencia_id = $1 and titulo like 'Criar o provisório%'`, [ciclo])).rows[0].status).toBe("concluida");
    expect((await q(`select count(*)::int as n from crt_decisoes where fatura_id = $1`, [fatura])).rows[0].n).toBe(0);
    await expect(reservar(finGestor, 3576.92)).rejects.toThrow(/já tem provisório no Consistem \(70001\)/);
    // A sincronização traz o provisório e, depois, marca a baixa: o mês vira Paga.
    await q(`insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, valor_documento, valor_atualizado) values ($1, '70001', 'C', 3576.92, 3576.92)`, [empresa]);
    await q(`update cap_lancamentos set baixado_em = '2026-10-23' where cod_lancamento = '70001'`);
    expect((await q(`select situacao from crt_ciclos where id = $1`, [ciclo])).rows[0].situacao).toBe("paga");
  });
});
