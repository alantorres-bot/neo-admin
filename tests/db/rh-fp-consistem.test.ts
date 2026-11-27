import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";
import { codigosDoTitulo, lerParametrosLancamento, montarTitulo, type TipoTitulo } from "@/lib/modulos/rh/lancamento";

let db: PGlite;
let rhOperador: string, rhGestor: string;
let empresa: string, comp: string;
const itens: Record<string, Linha> = {};

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const base = { grupoContaFluxoCaixa: 12, contaFluxoCaixa: 3, contaContabilDebito: 3101, contaContabilCredito: 2101 };
const parametros = {
  categoriaDoc: 6,
  tipos: { salario: { codHistorico: 5, ...base }, decimo_2: { codHistorico: 7, ...base, contaContabilDebito: 3102 } },
  portadores: [{ empregador: "OESTE", forma: "pix", codPortador: 40, conta: "Conta Oeste" }, { empregador: "NEO SERVIÇOS", forma: "fopag", codPortador: 91 }],
};
const salvarParametros = (p: unknown, folha: boolean) => rpc(rhGestor, `select rh_salvar_parametros_lancamento($1::jsonb, false, $2)`, [JSON.stringify(p), folha]);
const titulo = (cod: string, tipo: TipoTitulo, valor: number, mudar: Record<string, unknown> = {}) => {
  const i = itens[cod];
  const codigos = codigosDoTitulo(lerParametrosLancamento(parametros), tipo, i.empregador as string, i.forma_pagamento as string)
    ?? { codHistorico: 1, codPortador: 1, categoriaDoc: 6, ...base };
  return { item_id: i.id, tipo, payload: { ...montarTitulo({ tipo, codFornecedor: cod, valor, competencia: "2026-12-01", dataPagamento: "2027-01-07", hoje: "2027-01-05", codigos }), ...mudar } };
};
const reservar = (titulos: unknown[]) => rpc(rhOperador, `select rh_fp_reservar_lancamentos($1, $2::jsonb) as lote`, [comp, JSON.stringify(titulos)]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  rhOperador = await novoUsuario(db, "operador@neo.com", { rh: "operador" });
  rhGestor = await novoUsuario(db, "gestor@neo.com", { rh: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Formas', 'NEO FORMAS', '1') returning id`)).rows[0].id as string;
  await q(`insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, forma_pagamento, recebe_vt) values ($1, 'OESTE', '660', 'PESSOA 660', 'pix', false)`, [empresa]);
  await q(`insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, cpf, agencia, conta, forma_pagamento, recebe_vt)
           values ($1, 'NEO SERVIÇOS', '658', 'PESSOA 658', '111.444.777-35', '2764-2', '9999-9', 'fopag', false)`, [empresa]);
  comp = (await rpc(rhOperador, `select rh_fp_abrir_competencia('2026-12-01') as id`)).rows[0].id as string;
  for (const l of (await q(`select id, cod_fornecedor, empregador, forma_pagamento from rh_fp_itens where competencia_id = $1`, [comp])).rows) itens[l.cod_fornecedor as string] = l;
  // folha mensal antiga com 13º dentro (antes da 0529): a trava de tipo fica desligada só para montar o caso
  await q(`alter table rh_fp_itens disable trigger trg_rh_fp_itens_tipo`);
  await rpc(rhOperador, `select rh_fp_salvar_itens($1, $2::jsonb)`, [comp, JSON.stringify([
    { id: itens["660"].id, liquido: 1954.26, decimo_terceiro: 1672.76 }, { id: itens["658"].id, liquido: 2398.59 },
  ])]);
  await q(`alter table rh_fp_itens enable trigger trg_rh_fp_itens_tipo`);
});

describe("folha: contas a pagar no Consistem (0521)", () => {
  it("forma de pagamento do cadastro é só FOPAG ou PIX", async () => {
    await expect(q(`insert into rh_colaboradores (empresa_id, empregador, cod_fornecedor, nome, forma_pagamento, recebe_vt) values ($1, 'OESTE', '1', 'X', 'pix_neo_formas', false)`, [empresa]))
      .rejects.toThrow(/forma_pagamento_ck/);
  });

  it("reservar: só com a chave ligada e a folha aprovada", async () => {
    await salvarParametros(parametros, false);
    await expect(reservar([titulo("658", "salario", 2398.59)])).rejects.toThrow(/desligado/);
    await salvarParametros(parametros, true);
    await expect(reservar([titulo("658", "salario", 2398.59)])).rejects.toThrow(/esta ação não vale/);
    await rpc(rhOperador, `select rh_fp_conferir($1)`, [comp]);
    await rpc(rhGestor, `select rh_fp_aprovar($1)`, [comp]);
  });

  it("confere tipo (13º de dezembro = 2ª parcela), valor do tipo, portador e códigos", async () => {
    await expect(reservar([titulo("660", "decimo_1", 1672.76)])).rejects.toThrow(/Tipo de título inválido/);
    await expect(reservar([titulo("660", "ferias", 10)])).rejects.toThrow(/zero/);
    await expect(reservar([titulo("660", "salario", 1954.27)])).rejects.toThrow(/não confere/);
    await expect(reservar([titulo("660", "salario", 1954.26, { codPortador: 91 })])).rejects.toThrow(/mudaram nos Parâmetros/);
    await salvarParametros({ ...parametros, portadores: parametros.portadores.slice(0, 1) }, true);
    await expect(reservar([titulo("658", "salario", 2398.59)])).rejects.toThrow(/portador de NEO SERVIÇOS \(FOPAG\)/);
    await salvarParametros(parametros, true);
    const lote = (await reservar([titulo("660", "salario", 1954.26), titulo("660", "decimo_2", 1672.76), titulo("658", "salario", 2398.59)])).rows[0].lote;
    const r = (await q(`select tipo, valor::text, payload ->> 'codPortador' as portador, payload ->> 'complementoHistorico' as compl from rh_fp_lancamentos_erp where lote = $1 order by ordem`, [lote])).rows;
    expect(r).toEqual([
      { tipo: "salario", valor: "1954.26", portador: "40", compl: "SALÁRIO - 12/2026" },
      { tipo: "decimo_2", valor: "1672.76", portador: "40", compl: "13º SALÁRIO 2ª PARCELA - 12/2026" },
      { tipo: "salario", valor: "2398.59", portador: "91", compl: "SALÁRIO - 12/2026" },
    ]);
    await expect(reservar([titulo("660", "salario", 1954.26)])).rejects.toThrow(/já foi lançado/);
  });

  it("envio, imutável, reabrir recusa com título, resolver à mão", async () => {
    const [a, b, c] = (await q(`select id from rh_fp_lancamentos_erp order by ordem`)).rows.map((l) => l.id as string);
    await q(`select rh_fp_iniciar_envio_erp($1)`, [a]);
    await q(`select rh_fp_concluir_lancamento_erp($1, '50001', '{}'::jsonb, null)`, [a]);
    await q(`select rh_fp_iniciar_envio_erp($1)`, [b]);
    await q(`select rh_fp_concluir_lancamento_erp($1, null, '{}'::jsonb, 'Fornecedor inativo')`, [b]);
    await expect(q(`update rh_fp_lancamentos_erp set payload = '{}' where id = $1`, [a])).rejects.toThrow(/imutável/);
    await expect(rpc(rhGestor, `select rh_fp_reabrir($1, 'erro')`, [comp])).rejects.toThrow(/1 título\(s\) em envio ou sem resposta/);
    await rpc(rhOperador, `select rh_fp_resolver_lancamento($1, '50003', 'achei no Consistem')`, [c]);
    expect((await q(`select situacao::text, cod_lancamento_erp from rh_fp_lancamentos_erp order by ordem`)).rows).toEqual([
      { situacao: "lancado", cod_lancamento_erp: "50001" }, { situacao: "erro", cod_lancamento_erp: null }, { situacao: "lancado", cod_lancamento_erp: "50003" },
    ]);
    // o 13º com erro pode ser reservado de novo
    expect((await reservar([titulo("660", "decimo_2", 1672.76)])).rows[0].lote).toBeTruthy();
  });
});

describe("folha: cancelar um título e reabrir preservando os outros (0533)", () => {
  const evidencia = JSON.stringify({ status: 400, mensagem: "Lançamento não cadastrado!" });
  const idDe = async (cod: string, tipo: string) =>
    (await q(`select l.id from rh_fp_lancamentos_erp l join rh_fp_itens i on i.id = l.item_id where i.cod_fornecedor = $1 and l.tipo = $2 order by l.criado_em desc limit 1`, [cod, tipo])).rows[0].id as string;
  const cancelar = (id: string, motivo = "valor errado; excluído no Consistem", ev: string | null = evidencia) =>
    como(db, "service", () => q(`select rh_fp_cancelar_lancamento_conferido($1, $2, $3, $4::jsonb)`, [id, rhGestor, motivo, ev]));
  const salvar = (cod: string, campos: Record<string, unknown>) => rpc(rhOperador, `select rh_fp_salvar_itens($1, $2::jsonb)`, [comp, JSON.stringify([{
    id: itens[cod].id, forma_pagamento: itens[cod].forma_pagamento, liquido: cod === "660" ? 1954.26 : 2398.59, decimo_terceiro: cod === "660" ? 1672.76 : 0, ...campos,
  }])]);

  it("reabrir recusa com título reservado (em envio)", async () => {
    await expect(rpc(rhGestor, `select rh_fp_reabrir($1, 'erro')`, [comp])).rejects.toThrow(/1 título\(s\) em envio/);
    await rpc(rhOperador, `select rh_fp_resolver_lancamento($1, '', 'não foi criado: conferi no Consistem')`, [await idDe("660", "decimo_2")]);
  });

  it("cancelar: só pela Edge (service role), com motivo e conferência; só título lançado; uma vez", async () => {
    const a = await idDe("660", "salario");
    await expect(rpc(rhGestor, `select rh_fp_cancelar_lancamento_conferido($1, $2, 'x motivo', '{}'::jsonb)`, [a, rhGestor])).rejects.toThrow(/permission denied/);
    await expect(q(`update rh_fp_lancamentos_erp set situacao = 'cancelado', cancelado_em = now(), motivo_cancelamento = 'sem conferir' where id = $1`, [a]))
      .rejects.toThrow(/conferência no Consistem/);
    await expect(cancelar(a, "x")).rejects.toThrow(/motivo/);
    await expect(cancelar(a, "valor errado", null)).rejects.toThrow(/conferência/);
    await expect(cancelar(await idDe("660", "decimo_2"))).rejects.toThrow(/Só um título lançado/);
    await cancelar(a);
    await expect(cancelar(a)).rejects.toThrow(/Só um título lançado/);
    const l = (await q(`select situacao::text, cancelado_por, motivo_cancelamento, evidencia_cancelamento ->> 'mensagem' as ev from rh_fp_lancamentos_erp where id = $1`, [a])).rows[0];
    expect(l).toEqual({ situacao: "cancelado", cancelado_por: rhGestor, motivo_cancelamento: "valor errado; excluído no Consistem", ev: "Lançamento não cadastrado!" });
    expect((await q(`select count(*)::int as n from auditoria where tabela = 'rh_fp_lancamentos_erp' and registro_id = $1 and acao = 'UPDATE'`, [a])).rows[0].n).toBeGreaterThan(0);
    await expect(q(`update rh_fp_lancamentos_erp set situacao = 'lancado' where id = $1`, [a])).rejects.toThrow(/inválida|concluído/);
  });

  it("reabre com título lançado preservado; trava só o que tem título", async () => {
    await rpc(rhGestor, `select rh_fp_reabrir($1, 'avulso do 660 errado')`, [comp]);
    expect((await q(`select status from rh_fp_competencias where id = $1`, [comp])).rows[0].status).toBe("aberta");
    // 658 tem salário lançado (50003): líquido, forma e fornecedor travados; férias (sem título) livre
    await expect(salvar("658", { liquido: 2400 })).rejects.toThrow(/salario \(cód\. 50003\) de PESSOA 658 já está no Consistem/);
    await expect(salvar("658", { forma_pagamento: "pix" })).rejects.toThrow(/já está no Consistem/);
    await salvar("658", { ferias_acrescimos: 10 });
    await salvar("658", { ferias_acrescimos: 0 });
    // 660: salário cancelado → livre
    await salvar("660", { liquido: 2000 });
  });

  it("atualizar do cadastro não muda fornecedor/empregador de quem tem título; o resto atualiza", async () => {
    await q(`update rh_colaboradores set empregador = 'NEO FORMAS', nome = 'PESSOA 658 NOVA' where cod_fornecedor = '658'`);
    const r = (await rpc(rhOperador, `select rh_fp_atualizar_do_cadastro($1) as r`, [comp])).rows[0].r;
    expect(r.travados).toBe(1);
    expect((await q(`select empregador, nome from rh_fp_itens where id = $1`, [itens["658"].id])).rows[0]).toEqual({ empregador: "NEO SERVIÇOS", nome: "PESSOA 658 NOVA" });
    await q(`update rh_colaboradores set empregador = 'NEO SERVIÇOS' where cod_fornecedor = '658'`);
  });

  it("depois de aprovar de novo, lança só o que foi liberado (sem duplicar)", async () => {
    await rpc(rhOperador, `select rh_fp_conferir($1)`, [comp]);
    await rpc(rhGestor, `select rh_fp_aprovar($1)`, [comp]);
    await expect(reservar([titulo("658", "salario", 2398.59)])).rejects.toThrow(/já foi lançado/);
    const lote = (await reservar([titulo("660", "salario", 2000)])).rows[0].lote;
    expect((await q(`select valor::text from rh_fp_lancamentos_erp where lote = $1`, [lote])).rows).toEqual([{ valor: "2000.00" }]);
    expect((await q(`select count(*)::int as n from rh_fp_lancamentos_erp l join rh_fp_itens i on i.id = l.item_id
                     where i.cod_fornecedor = '660' and l.tipo = 'salario' and l.situacao in ('reservado', 'enviando', 'lancado')`)).rows[0].n).toBe(1);
  });

  it("folha paga com título no Consistem não reabre (o arquivo do BB seria regerado com todos)", async () => {
    await q(`update rh_fp_competencias set status = 'paga' where id = $1`, [comp]);
    await expect(rpc(rhGestor, `select rh_fp_reabrir($1, 'erro')`, [comp])).rejects.toThrow(/em envio/);   // o 660 reservado acima
    await q(`select rh_fp_interromper_lote(lote, 'teste') from rh_fp_lancamentos_erp where situacao = 'reservado' limit 1`);
    await expect(rpc(rhGestor, `select rh_fp_reabrir($1, 'erro')`, [comp])).rejects.toThrow(/já foi paga e tem 1 título/);
  });
});
