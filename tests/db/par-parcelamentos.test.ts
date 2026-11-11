import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";
import { AMOSTRA_NOV26, type AmostraP } from "./par-amostra-nov26";

// Gestão de Parcelamentos (0189) com os lançamentos reais de nov/2026 (planilhas PARCELAMENTOS NOVEMBRO e ALUTEC) e os casos
// reais da revisão de pré-homologação (11/11/2026): resíduo de juros (12147), P excluído e relançado como C novo (9982-08/26),
// C pago com dataPagamento vazia no detalhe.
let db: PGlite;
let consulta: string, operador: string, gestor: string, semAcesso: string;
let neo: string, outra: string;

const FORNECEDORES_DAS_REGRAS = ["336", "475", "917", "986"];
const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const como_ = (u: string, sql: string, p: unknown[] = []) => como(db, u, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));

type Item = Omit<Partial<AmostraP>, "tipo"> & { tipo?: "P" | "C" };
// grupo/conta vão junto mas a lista ignora (só o detalhe traz a conta de fluxo)
const registrarLista = async (empresa: string, linhas: readonly Item[], fornecedores = FORNECEDORES_DAS_REGRAS) =>
  (await servico(`select par_registrar_lista($1, $2::jsonb, $3::text[]) as r`, [empresa, JSON.stringify(linhas), fornecedores])).rows[0].r as
    { novos: number; alterados: number; iguais: number; quitados: number; foraDaLista: string[] };
const registrarDetalhes = async (empresa: string, detalhes: unknown[]) =>
  (await servico(`select par_registrar_detalhes($1, $2::jsonb) as r`, [empresa, JSON.stringify(detalhes)])).rows[0].r as Record<string, number>;
const detalheDe = (l: Item, extra: Record<string, unknown> = {}) => ({ encontrado: true, ...l, ...extra });
const lanc = async (cod: string, empresa = neo) => (await q(`select * from par_lancamentos where empresa_id = $1 and cod_lancamento = $2`, [empresa, cod])).rows[0];
const total = async (sql: string) => Number((await q(sql)).rows[0].t);
const auditorias = () => total(`select count(*) as t from auditoria where tabela = 'par_lancamentos'`);
const amostra = (cod: string) => AMOSTRA_NOV26.find((l) => l.codLancamento === cod)!;

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  consulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  operador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  gestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  semAcesso = await novoUsuario(db, "rh@neo.com", { rh: "gestor" });
  neo = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Formas Ltda', 'Neo Formas', '1') returning id`)).rows[0].id;
  outra = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Outra Ltda', 'Outra', '9') returning id`)).rows[0].id;
});

describe("documento → chave e competência", () => {
  it("separa o número do parcelamento do -MM/AA; documento sem competência não gera chave", async () => {
    const r = (await q(`select par_chave('986', '8003-11/26') as a, par_competencia('8003-11/26') as b, par_chave('336', '11184077-1') as c,
      par_competencia('11184077-1') as d, par_chave('986', '533-11/26') as e, par_chave('986', '1533-11/26') as f`)).rows[0];
    expect(r).toEqual({ a: "986:8003", b: "2026-11", c: null, d: null, e: "986:533", f: "986:1533" });
  });
});

describe("importação e classificação (planilhas de nov/2026)", () => {
  it("importa os 34 P; o 917 já classifica sem conta de fluxo; quem depende de conta espera o detalhe; o resto fica sem regra", async () => {
    const r = await registrarLista(neo, AMOSTRA_NOV26);
    expect(r).toMatchObject({ novos: 34, alterados: 0, iguais: 0, foraDaLista: [] });
    const por = (await q(`select cod_fornecedor, classificacao, count(*)::int as n from par_lancamentos group by 1, 2 order by 1, 2`)).rows;
    expect(por).toEqual([
      { cod_fornecedor: "336", classificacao: "aguardando_detalhe", n: 4 },
      { cod_fornecedor: "475", classificacao: "aguardando_detalhe", n: 9 },
      { cod_fornecedor: "623", classificacao: "sem_regra", n: 1 },
      { cod_fornecedor: "917", classificacao: "classificado", n: 8 },
      { cod_fornecedor: "986", classificacao: "aguardando_detalhe", n: 12 },
    ]);
    // todos os nunca detalhados entram (conta de fluxo à vista até para os sem regra); os que esperam a conta vêm primeiro
    const paraDetalhar = (await servico(`select par_para_detalhar($1, '{}', 500) as r`, [neo])).rows[0].r as string[];
    expect(paraDetalhar).toHaveLength(34);
    const aguardando = (await q(`select cod_lancamento from par_lancamentos where classificacao = 'aguardando_detalhe'`)).rows.map((x) => x.cod_lancamento);
    expect(new Set(paraDetalhar.slice(0, 25))).toEqual(new Set(aguardando));
  });

  it("com a conta de fluxo: estaduais por 20/17, federal do 336 só em 20/18; INSS/IRRF do 336 fica sem regra (disponível para análise)", async () => {
    const r = await registrarDetalhes(neo, AMOSTRA_NOV26.map((l) => detalheDe(l)));
    expect(r).toMatchObject({ lidos: 34, alterados: 34 });
    expect(await total(`select sum(valor_documento) as t from par_lancamentos where natureza = 'estadual'`)).toBeCloseTo(139_037.13, 2);
    expect(await total(`select sum(valor_documento) as t from par_lancamentos where classificacao = 'classificado' and cod_fornecedor <> '917'`)).toBeCloseTo(139_611.83, 2);
    expect(await total(`select sum(valor_documento) as t from par_lancamentos where classificacao = 'classificado' and cod_fornecedor = '917'`)).toBeCloseTo(3_874.5, 2);
    const inss = (await q(`select classificacao, motivo, grupo, conta from par_lancamentos where complemento like 'INSS/IRRF%'`)).rows;
    expect(inss).toHaveLength(3);
    for (const l of inss) expect(l).toEqual({ classificacao: "sem_regra", motivo: "Nenhuma regra casa.", grupo: 27, conta: 6 });
    expect((await lanc("9453")).classificacao).toBe("sem_regra"); // telefone VIVO (623, 16/1)
  });

  it("fornecedor 1917 não é o 917 (código diferente não casa)", async () => {
    await registrarLista(neo, [{ codLancamento: "990001", tipo: "P", codFornecedor: "1917", numDocumento: "1-11/26", complemento: "PARC 917", emissao: "2026-11-01", vencimento: "2026-11-30", valorDocumentoCentavos: 100, saldoCentavos: 100 }]);
    expect((await lanc("990001")).classificacao).toBe("sem_regra");
  });

  it("a mesma lista e os mesmos detalhes de novo não gravam nada (idempotente, nenhuma auditoria nova)", async () => {
    const antes = await auditorias();
    const r = await registrarLista(neo, AMOSTRA_NOV26);
    expect(r).toMatchObject({ novos: 0, alterados: 0, iguais: 34 });
    expect(r.foraDaLista).toEqual(["990001"]); // era P e não veio
    expect(await registrarDetalhes(neo, AMOSTRA_NOV26.map((l) => detalheDe(l)))).toMatchObject({ lidos: 34, alterados: 0 });
    expect(await auditorias()).toBe(antes);
    expect(await total(`select count(*) as t from par_lancamentos`)).toBe(35);
  });

  it("só tipos P e C entram pela lista", async () => {
    await expect(registrarLista(neo, [{ codLancamento: "990002", tipo: "D" as never, codFornecedor: "917", numDocumento: "x", valorDocumentoCentavos: 1, saldoCentavos: 1 }]))
      .rejects.toThrow(/fora do módulo/);
  });
});

describe("regras: conflito, exceção, permissão", () => {
  it("duas regras de naturezas diferentes na mesma prioridade = pendente; exceção vence; só gestor edita", async () => {
    const regra = { nome: "Teste conflito 917", fornecedores: ["917"], natureza: "outros", prioridade: 20 };
    await expect(como_(operador, `select par_salvar_regra(null, $1::jsonb)`, [JSON.stringify(regra)])).rejects.toThrow(/Somente gestor/);
    const id = (await como_(gestor, `select par_salvar_regra(null, $1::jsonb) as id`, [JSON.stringify(regra)])).rows[0].id;
    expect((await lanc("19229")).classificacao).toBe("pendente");
    expect((await lanc("19229")).motivo).toMatch(/Regras em conflito/);
    await como_(gestor, `select par_salvar_regra($1, $2::jsonb)`, [id, JSON.stringify({ ...regra, excecao: true, natureza: null, complementoContem: "ITR" })]);
    const itr = (await q(`select classificacao, motivo from par_lancamentos where complemento like 'ITR%'`)).rows[0];
    expect(itr).toEqual({ classificacao: "ignorado", motivo: "Exceção: Teste conflito 917" });
    expect((await lanc("19229")).classificacao).toBe("classificado");
    await como_(gestor, `select par_salvar_regra($1, $2::jsonb)`, [id, JSON.stringify({ ...regra, ativa: false })]);
    expect((await q(`select classificacao from par_lancamentos where complemento like 'ITR%'`)).rows[0].classificacao).toBe("classificado");
  });

  it("texto do histórico é literal (% e _ não são curinga); listas nulas no JSON viram 'qualquer'", async () => {
    const id = (await como_(gestor, `select par_salvar_regra(null, $1::jsonb) as id`, [JSON.stringify({ nome: "Curinga", tipos: null, fornecedores: null, complementoContem: "%%", natureza: "outros", prioridade: 5 })])).rows[0].id;
    expect(await total(`select count(*) as t from par_lancamentos where regra_id = '${id}'`)).toBe(0);
    await como_(gestor, `select par_salvar_regra($1, $2::jsonb)`, [id, JSON.stringify({ nome: "Curinga", complementoContem: "%%", natureza: "outros", ativa: false })]);
  });

  it("regra sem fornecedor, conta ou texto é recusada (pegaria todo P do ERP)", async () => {
    await expect(como_(gestor, `select par_salvar_regra(null, $1::jsonb)`, [JSON.stringify({ nome: "Todo P", tipos: ["P"], natureza: "outros" })]))
      .rejects.toThrow(/par_regras_criterio/);
  });

  it("classificação manual vale sobre a regra e pode voltar às regras", async () => {
    const telefone = await lanc("9453");
    await expect(como_(consulta, `select par_classificar_manual($1, 'outros', 'teste')`, [telefone.id])).rejects.toThrow(/Somente operador/);
    await como_(operador, `select par_classificar_manual($1, 'outros', 'parcelamento da Vivo')`, [telefone.id]);
    expect((await lanc("9453")).classificacao).toBe("manual_parcelamento");
    await registrarLista(neo, AMOSTRA_NOV26.map((l) => (l.codLancamento === "9453" ? { ...l, complemento: "TELEFONE VIVO" } : l)));
    expect((await lanc("9453")).classificacao).toBe("manual_parcelamento");
    await como_(operador, `select par_devolver_as_regras($1)`, [telefone.id]);
    expect((await lanc("9453")).classificacao).toBe("sem_regra");
  });
});

describe("parcelamentos, parcelas e P → C", () => {
  it("sugestão por chave: 533 e 1533 (mesma CDA no histórico) ficam separados; criar o parcelamento liga a parcela", async () => {
    const sug = (await como_(consulta, `select chave_erp, lancamentos::int as n from par_vw_sugestoes order by chave_erp`)).rows;
    expect(sug.map((s) => s.chave_erp)).toEqual(expect.arrayContaining(["986:533", "986:1533", "986:8003", "917:5409"]));
    const p = { empresaId: neo, descricao: "PGE/MT CDA ICMS 2025658003", natureza: "estadual", chaveErp: "986:8003", cda: "2025658003", codFornecedor: "986" };
    await expect(como_(operador, `select par_salvar_parcelamento(null, $1::jsonb)`, [JSON.stringify(p)])).rejects.toThrow(/Somente gestor/);
    const id = (await como_(gestor, `select par_salvar_parcelamento(null, $1::jsonb) as id`, [JSON.stringify(p)])).rows[0].id;
    const parc = (await como_(consulta, `select competencia, valor_provisionado::numeric as v, cod_lancamento from par_vw_parcelas where parcelamento_id = $1`, [id])).rows;
    expect(parc).toEqual([{ competencia: "2026-11", v: "2061.18", cod_lancamento: "12482" }]);
  });

  it("parcela seguinte entra sozinha; P → C pelo MESMO código na lista do fornecedor; baixa sem data de pagamento (saldo 0)", async () => {
    const dez: AmostraP = { ...amostra("12482"), codLancamento: "12483", numDocumento: "8003-12/26", vencimento: "2026-12-28" };
    await registrarLista(neo, [...AMOSTRA_NOV26, dez]);
    await registrarDetalhes(neo, [detalheDe(dez)]);
    const idParc = (await q(`select id from par_parcelamentos where chave_erp = '986:8003'`)).rows[0].id;
    expect((await q(`select competencia from par_vw_parcelas where parcelamento_id = $1 order by 1`, [idParc])).rows.map((x) => x.competencia)).toEqual(["2026-11", "2026-12"]);

    // guia lançada: o 12482 vem como C (mesmo código) na lista do fornecedor 986, com o valor da guia e saldo em aberto
    const c = { ...amostra("12482"), tipo: "C" as const, valorDocumentoCentavos: 209_530, saldoCentavos: 209_530 };
    const outros = AMOSTRA_NOV26.filter((l) => l.codLancamento !== "12482");
    let r = await registrarLista(neo, [...outros, dez, c]);
    expect(r.foraDaLista).not.toContain("12482");
    let l = await lanc("12482");
    expect(l).toMatchObject({ tipo_lancamento: "C", valor_provisionado: "2061.18", valor_documento: "2095.30", valor_atualizado: "2095.30", quitado_em: null });
    expect(l.virou_c_em).not.toBeNull();
    expect((await servico(`select par_para_detalhar($1, '{}', 500) as r`, [neo])).rows[0].r).toContain("12482"); // acompanha a baixa

    // pago: saldo 0 na lista; o detalhe traz o valor pago e dataPagamento VAZIA (como no ERP real)
    r = await registrarLista(neo, [...outros, dez, { ...c, saldoCentavos: 0 }]);
    expect(r.quitados).toBe(1);
    await registrarDetalhes(neo, [detalheDe(c, { valorPagoCentavos: 209_530, dataPagamento: "" })]);
    l = await lanc("12482");
    expect(l).toMatchObject({ valor_atualizado: "0.00", valor_pago: "2095.30", data_pagamento: null });
    expect(l.quitado_em).not.toBeNull();
    expect((await servico(`select par_para_detalhar($1, '{}', 500) as r`, [neo])).rows[0].r).not.toContain("12482");
    const resumo = (await como_(consulta, `select parcelas_registradas::int as n, parcelas_pagas::int as pagas, total_pago::numeric as pago, total_em_aberto::numeric as aberto from par_vw_parcelamentos where id = $1`, [idParc])).rows[0];
    expect(resumo).toEqual({ n: 2, pagas: 1, pago: "2095.30", aberto: "2061.18" });
  });

  it("resíduo de juros (real: 12147, saldo 100,60 com o principal pago) conta como baixa pelo detalhe", async () => {
    const c = { codLancamento: "12147", tipo: "C" as const, codFornecedor: "986", numDocumento: "4527-09/26", complemento: "PARC. CDA - 2025664527 - ICMS",
      emissao: "2025-11-26", vencimento: "2026-10-23", valorDocumentoCentavos: 1_124_188, saldoCentavos: 10_060 };
    await registrarLista(neo, [...AMOSTRA_NOV26, c]);
    expect((await lanc("12147")).quitado_em).toBeNull();
    const d = await registrarDetalhes(neo, [detalheDe(c, { grupo: 20, conta: 17, valorPagoCentavos: 1_124_188, dataPagamento: "" })]);
    expect(d.quitados).toBe(1);
    expect((await lanc("12147")).quitado_em).not.toBeNull();
  });

  it("P excluído no ERP e guia lançada como C de código NOVO (real: 336 9982-08/26): não some, não duplica, a pessoa troca", async () => {
    const p = { codLancamento: "9242", tipo: "P" as const, codFornecedor: "336", numDocumento: "9982-08/26", complemento: "PARC. PESSOA FISICA A - 3429982",
      emissao: "2025-10-01", vencimento: "2026-08-31", valorDocumentoCentavos: 57_470, saldoCentavos: 57_470 };
    await registrarLista(neo, [...AMOSTRA_NOV26, p]);
    await registrarDetalhes(neo, [detalheDe(p, { grupo: 20, conta: 18 })]);
    const idParc = (await como_(gestor, `select par_salvar_parcelamento(null, $1::jsonb) as id`, [JSON.stringify({ empresaId: neo, descricao: "Receita — parcelamento 3429982", natureza: "federal", chaveErp: "336:9982" })])).rows[0].id;
    expect((await lanc("9242")).parcela_id).not.toBeNull();

    // o P some da lista; o detalhe responde "não cadastrado" (encontrado=false); vem o C novo 34746 com o mesmo documento
    const novo = { ...p, codLancamento: "34746", tipo: "C" as const, emissao: "2026-08-31", valorDocumentoCentavos: 62_629, saldoCentavos: 0 };
    const r = await registrarLista(neo, [...AMOSTRA_NOV26, novo]);
    expect(r.foraDaLista).toContain("9242");
    expect(await registrarDetalhes(neo, [{ codLancamento: "9242", encontrado: false }, detalheDe(novo, { grupo: 20, conta: 18, valorPagoCentavos: 62_629 })])).toMatchObject({ sumiram: 1 });
    expect((await lanc("9242")).sumiu_em).not.toBeNull();
    let n = await lanc("34746");
    expect(n.parcela_id).toBeNull(); // não troca sozinho
    expect(n.motivo).toMatch(/Pode substituir o lançamento 9242/);
    expect(n.quitado_em).not.toBeNull();
    await como_(operador, `select par_vincular_lancamento($1, $2)`, [n.id, idParc]);
    n = await lanc("34746");
    expect(n.parcela_id).not.toBeNull();
    const antigo = await lanc("9242");
    expect(antigo.parcela_id).toBeNull();
    expect(antigo.motivo).toMatch(/substituído pelo lançamento 34746/);
    expect(await total(`select count(*) as t from par_parcelas where parcelamento_id = '${idParc}' and competencia = '2026-08' and cancelada_em is null`)).toBe(1);
  });

  it("parcela manual + lançamento do ERP da mesma competência: não vira duas; a pessoa junta", async () => {
    const id = (await como_(gestor, `select par_salvar_parcelamento(null, $1::jsonb) as id`, [JSON.stringify({ empresaId: neo, descricao: "PGFN 015205406 eSocial", natureza: "federal", chaveErp: "917:5409" })])).rows[0].id;
    expect((await q(`select count(*)::int as n from par_parcelas where parcelamento_id = $1`, [id])).rows[0].n).toBe(1); // nov/26 do ERP
    await como_(gestor, `select par_adicionar_parcela($1, '2026-12', '2026-12-28', 394.62, null, 'cadastrada antes do ERP')`, [id]);
    const dez: AmostraP = { ...amostra("19229"), codLancamento: "19230", numDocumento: "5409-12/26" };
    await registrarLista(neo, [...AMOSTRA_NOV26, dez]);
    let l = await lanc("19230");
    expect(l.parcela_id).toBeNull();
    expect(l.motivo).toMatch(/já tem parcela em 2026-12/);
    await como_(operador, `select par_vincular_lancamento($1, $2)`, [l.id, id]);
    l = await lanc("19230");
    expect(l.parcela_id).not.toBeNull();
    const parcelas = (await q(`select v.competencia, v.origem, v.cod_lancamento from par_vw_parcelas v where parcelamento_id = $1 order by 1`, [id])).rows;
    expect(parcelas).toEqual([
      { competencia: "2026-11", origem: "CONTAS_PAGAR", cod_lancamento: "19229" },
      { competencia: "2026-12", origem: "MANUAL", cod_lancamento: "19230" },
    ]);
    await como_(operador, `select par_desvincular_lancamento($1, 'teste')`, [l.id]);
    expect((await lanc("19230")).classificacao).toBe("pendente");
    expect((await q(`select count(*)::int as n from par_parcelas where parcelamento_id = $1 and cancelada_em is null`, [id])).rows[0].n).toBe(2);
  });

  it("sumiu do ERP: marca e guarda (nada é apagado)", async () => {
    await registrarDetalhes(neo, [{ codLancamento: "990001", encontrado: false }]);
    expect((await lanc("990001")).sumiu_em).not.toBeNull();
    await expect(servico(`delete from par_lancamentos where cod_lancamento = '990001'`)).rejects.toThrow();
  });
});

describe("juntar sugestão a parcelamento existente", () => {
  it("todos os lançamentos sem parcela da chave entram; a sugestão some; repetir é recusado", async () => {
    const id = (await como_(gestor, `select par_salvar_parcelamento(null, $1::jsonb) as id`, [JSON.stringify({ empresaId: neo, descricao: "PGE CDA 20262271533 (manual)", natureza: "estadual" })])).rows[0].id;
    await expect(como_(consulta, `select par_vincular_chave($1, '986:533', $2)`, [neo, id])).rejects.toThrow(/Somente operador/);
    expect((await como_(operador, `select par_vincular_chave($1, '986:533', $2) as n`, [neo, id])).rows[0].n).toBe(1);
    expect((await q(`select count(*)::int as n from par_vw_sugestoes where chave_erp = '986:533'`)).rows[0].n).toBe(0);
    await expect(como_(operador, `select par_vincular_chave($1, '986:533', $2)`, [neo, id])).rejects.toThrow(/Nenhum lançamento/);
  });
});

describe("sincronização: rodadas e agendamento", () => {
  it("duas leituras ao mesmo tempo na mesma empresa: a segunda é recusada; rodada presa há mais de 10 min não segura", async () => {
    const a = (await servico(`select par_iniciar_sincronizacao($1, false, null) as id`, [neo])).rows[0].id;
    await expect(servico(`select par_iniciar_sincronizacao($1, true, null)`, [neo])).rejects.toThrow(/em andamento/);
    await q(`update par_sincronizacoes set iniciada_em = now() - interval '11 minutes' where id = $1`, [a]);
    const b = (await servico(`select par_iniciar_sincronizacao($1, true, null) as id`, [neo])).rows[0].id;
    expect((await q(`select situacao, erro from par_sincronizacoes where id = $1`, [a])).rows[0]).toEqual({ situacao: "erro", erro: "Interrompida (sem conclusão em 10 minutos)." });
    await servico(`select par_concluir_sincronizacao($1, null, '{"ok":1}'::jsonb)`, [b]);
    expect((await q(`select situacao from par_sincronizacoes where id = $1`, [b])).rows[0].situacao).toBe("ok");
  });

  it("agendamento começa desligado: a chamada agendada não faz nada", async () => {
    expect((await q(`select valor from configuracoes where chave = 'financeiro.parcelamentos.sincronizar_agendado'`)).rows[0].valor).toBe(false);
    expect((await q(`select par_chamar_sincronizacao() as r`)).rows[0].r).toBeNull();
  });
});

describe("acesso e empresas", () => {
  it("sem acesso ao Financeiro não lê nada; consulta lê; ninguém grava direto; só a service role sincroniza", async () => {
    expect((await como_(semAcesso, `select count(*)::int as n from par_vw_parcelas`)).rows[0].n).toBe(0);
    expect((await como_(semAcesso, `select count(*)::int as n from par_lancamentos`)).rows[0].n).toBe(0);
    expect((await como_(consulta, `select count(*)::int as n from par_lancamentos`)).rows[0].n).toBeGreaterThan(30);
    expect((await como_(gestor, `update par_lancamentos set natureza = 'outros'`)).affectedRows).toBe(0); // RLS: sem política de escrita
    for (const f of [`par_registrar_lista($1, '[]'::jsonb, '{}')`, `par_registrar_detalhes($1, '[]'::jsonb)`, `par_iniciar_sincronizacao($1, false, null)`]) {
      await expect(como_(gestor, `select ${f}`, [neo])).rejects.toThrow(/permission denied/);
    }
    await expect(como_(gestor, `select par_chamar_sincronizacao()`)).rejects.toThrow(/permission denied/);
    await expect(como_(gestor, `select par_processar_todos(null)`)).rejects.toThrow(/permission denied/);
  });

  it("lançamento de uma empresa não entra em parcelamento de outra", async () => {
    await registrarLista(outra, [{ codLancamento: "12482", tipo: "P", codFornecedor: "986", numDocumento: "8003-01/27", complemento: "x", emissao: "2026-11-01", vencimento: "2027-01-30", valorDocumentoCentavos: 100, saldoCentavos: 100 }]);
    const deOutra = await lanc("12482", outra);
    const idNeo = (await q(`select id from par_parcelamentos where chave_erp = '986:8003' and empresa_id = $1`, [neo])).rows[0].id;
    expect(deOutra.parcela_id).toBeNull();
    await expect(como_(operador, `select par_vincular_lancamento($1, $2)`, [deOutra.id, idNeo])).rejects.toThrow(/outra empresa/);
  });
});
