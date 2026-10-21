import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// 0175: encargos um título por linha; exclusão no Consistem desfaz o "casar" do lançamento.
let db: PGlite;
let finOperador: string, finGestor: string;
let fatura: string;
const linha: Record<string, string> = {};

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const titulo = (l: string, valor: number, complemento = "CARTÃO NUBANK PF 1x — MULTA DE ATRASO") =>
  ({ linha: l, payload: { codFornecedor: 360, valorDocumento: valor, complementoHistorico: complemento, dataVencimento: "2026-10-27" } });
const reservar = (u: string, titulos: unknown[]) => rpc(u, `select crt_reservar_lancamentos_encargos($1, $2::jsonb) as lote`, [fatura, JSON.stringify(titulos)]);
const doLote = async (lote: string) => (await q(`select id, linha_origem, parcela, parcelas, situacao from crt_lancamentos_erp where lote = $1 order by parcela`, [lote])).rows;
const lancar = async (id: string, cod: string) => {
  await servico(`select crt_iniciar_envio_erp($1)`, [id]);
  await servico(`select crt_concluir_lancamento_erp($1, $2, null, null)`, [id, cod]);
};

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo', 'Neo', '1') returning id`)).rows[0].id;
  const linhas = JSON.stringify([
    { ordem: 1, descricao: "Multa de atraso", valor: 270.88, descartada: false },
    { ordem: 2, descricao: "IOF de atraso", valor: 60.35, descartada: false },
    { ordem: 3, descricao: "Juros de atraso", valor: 506.15, descartada: false },
    { ordem: 4, descricao: "Pagamento", valor: -837.38, descartada: true },
  ]);
  fatura = (await rpc(finOperador, `select crt_importar_fatura($1, 'NUBANK PF', '2026-10-27', 837.38, 'nubank', 'f.pdf', $2::jsonb) as id`, [empresa, linhas])).rows[0].id;
  for (const l of (await q(`select id, ordem from crt_fatura_linhas where fatura_id = $1`, [fatura])).rows) linha[l.ordem] = l.id;
  await q(`update configuracoes set valor = 'true'::jsonb where chave = 'financeiro.cartao.lancar_no_erp'`);
});

describe("encargos: um título por linha", () => {
  it("confere linha, valor, complemento e repetição", async () => {
    await expect(reservar(finOperador, [])).rejects.toThrow(/Nenhuma linha/);
    await expect(reservar(finOperador, [titulo(linha[1], 270.88), titulo(linha[1], 270.88)])).rejects.toThrow(/duas vezes/);
    await expect(reservar(finOperador, [titulo(linha[1], 270)])).rejects.toThrow(/não tem o valor dela/);
    await expect(reservar(finOperador, [titulo(linha[4], -837.38)])).rejects.toThrow(/descartada/);
    await expect(reservar(finOperador, [titulo(linha[1], 270.88, "X".repeat(71))])).rejects.toThrow(/70 caracteres/);
  });

  it("lote com um título por linha, em ordem; cada um casa a sua linha; a linha não entra de novo", async () => {
    const lote = (await reservar(finOperador, [titulo(linha[1], 270.88), titulo(linha[2], 60.35, "CARTÃO NUBANK PF 1x — IOF DE ATRASO")])).rows[0].lote;
    const itens = await doLote(lote);
    expect(itens.map((i) => [i.linha_origem, i.parcela, i.parcelas])).toEqual([[linha[1], 1, 2], [linha[2], 2, 2]]);
    await expect(reservar(finGestor, [titulo(linha[1], 270.88)])).rejects.toThrow(/já foi lançad/);
    await lancar(itens[0].id, "50001");
    await servico(`select crt_iniciar_envio_erp($1)`, [itens[1].id]);
    await servico(`select crt_concluir_lancamento_erp($1, null, null, 'Consistem HTTP 400: trava')`, [itens[1].id]);
    const casar = (await q(`select linhas, titulos from crt_decisoes where fatura_id = $1 and tipo = 'casar' and desfeito_em is null`, [fatura])).rows;
    expect(casar).toEqual([{ linhas: [linha[1]], titulos: ["50001"] }]);

    // Reenviar o que faltou: só a linha 2 (a 1 já está lançada).
    const novo = (await rpc(finOperador, `select crt_reenviar_lancamentos($1) as lote`, [lote])).rows[0].lote;
    expect((await doLote(novo)).map((i) => i.linha_origem)).toEqual([linha[2]]);

    // A linha 3 entra noutro lote, no mesmo mês (não há mais "um encargo por mês").
    const outro = (await reservar(finOperador, [titulo(linha[3], 506.15, "CARTÃO NUBANK PF 1x — JUROS DE ATRASO")])).rows[0].lote;
    expect(await doLote(outro)).toHaveLength(1);
  });
});

describe("exclusão no Consistem desfaz o casar", () => {
  it("o gestor registra a exclusão; a decisão do lançamento é desfeita e a linha pode ser lançada de novo", async () => {
    const id = (await q(`select id from crt_lancamentos_erp where cod_lancamento_erp = '50001'`)).rows[0].id;
    await rpc(finGestor, `select crt_registrar_exclusao_erp($1, 'relançar um título por linha')`, [id]);
    const d = (await q(`select desfeito_em, motivo_desfazer from crt_decisoes where fatura_id = $1 and tipo = 'casar' and titulos = array['50001']`, [fatura])).rows[0];
    expect(!!d.desfeito_em).toBe(true);
    expect(d.motivo_desfazer).toBe("Título 50001 excluído no Consistem: relançar um título por linha");
    const lote = (await reservar(finOperador, [titulo(linha[1], 270.88)])).rows[0].lote;
    expect(await doLote(lote)).toHaveLength(1);
  });
});
