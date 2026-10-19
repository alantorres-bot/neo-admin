import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let empresa: string, empresa2: string;
let hoje: string, ontem: string;
let contaA: string, contaB: string, contaC: string, contaOutra: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));

async function titulo(valor: number, emp = empresa) {
  const n = ++contador;
  return (await como(db, "service", () => q(
    `insert into cap_lancamentos (empresa_id, cod_lancamento, tipo_lancamento, cod_fornecedor, num_documento, data_emissao, data_vencimento, valor_documento, valor_atualizado)
     values ($1, $2, 'C', '382', $2, '2026-10-01', '2099-01-20', $3::numeric, $3::numeric) returning id`,
    [emp, `T${n}`, valor],
  ))).rows[0].id as string;
}
const sincronizar = (emp: string, contas: object[]) =>
  como(db, "service", () => q(`select fin_sincronizar_contas($1, $2::jsonb) as r`, [emp, JSON.stringify(contas)]));
const registrar = (usuario: string, data: string, saldos: { conta_id: string; saldo: number }[], emp = empresa) =>
  rpc(usuario, `select fin_registrar_saldos($1, $2::date, $3::jsonb) as r`, [emp, data, JSON.stringify(saldos)]);
const idConta = async (emp: string, cod: string) =>
  (await q(`select id from fin_contas_bancarias where empresa_id = $1 and cod_conta_bancaria = $2`, [emp, cod])).rows[0].id as string;
const composicao = (contas: string[], adicionais: { descricao: string; valor: number }[] = []) => JSON.stringify({ contas, adicionais });

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
  empresa2 = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Outra Ltda', 'Outra', '2') returning id`)).rows[0].id;
  const d = (await q(`select (now() at time zone 'America/Cuiaba')::date::text as hoje, ((now() at time zone 'America/Cuiaba')::date - 1)::text as ontem`)).rows[0];
  hoje = d.hoje; ontem = d.ontem;
});

describe("contas bancárias (0169)", () => {
  it("sincronização cria, atualiza sem mexer na decisão local e marca as que sumiram; usuário não sincroniza", async () => {
    const c = (cod: string, extra: object = {}) => ({ cod_conta_bancaria: cod, cod_banco: "748", descricao: `Conta ${cod}`, agencia: "0802", conta: `${cod}-0`, tipo_conta: 1, considera_saldo: true, inativa: false, entra_no_caixa: true, ...extra });
    expect((await sincronizar(empresa, [c("1"), c("2"), c("3", { entra_no_caixa: false }), c("9")])).rows[0].r).toEqual({ novas: 4, atualizadas: 0, sumiram: 0 });
    [contaA, contaB, contaC] = [await idConta(empresa, "1"), await idConta(empresa, "2"), await idConta(empresa, "3")];
    await sincronizar(empresa2, [c("1")]);
    contaOutra = await idConta(empresa2, "1");

    // o gestor tira a conta 2 do caixa; a sincronização seguinte não volta a decisão
    await rpc(finGestor, `select fin_definir_conta_caixa($1, false)`, [contaB]);
    const r = (await sincronizar(empresa, [c("1", { descricao: "Sicredi CC" }), c("2"), c("3")])).rows[0].r;
    expect(r).toEqual({ novas: 0, atualizadas: 3, sumiram: 1 });
    const contas = (await rpc(finConsulta, `select cod_conta_bancaria, descricao, entra_no_caixa, sumiu_em is not null as sumiu from fin_contas_bancarias where empresa_id = $1 order by cod_conta_bancaria`, [empresa])).rows;
    expect(contas.map((x) => [x.cod_conta_bancaria, x.descricao, x.entra_no_caixa, x.sumiu])).toEqual([
      ["1", "Sicredi CC", true, false], ["2", "Conta 2", false, false], ["3", "Conta 3", false, false], ["9", "Conta 9", true, true],
    ]);
    // lista vazia (falha da API) não marca nada como sumido
    expect((await sincronizar(empresa, [])).rows[0].r.sumiram).toBe(0);
    await expect(rpc(finOperador, `select fin_sincronizar_contas($1, '[]'::jsonb)`, [empresa])).rejects.toThrow(/permission denied|Somente a sincronização/);
  });

  it("só gestor define se a conta entra no caixa", async () => {
    await expect(rpc(finOperador, `select fin_definir_conta_caixa($1, true)`, [contaC])).rejects.toThrow(/Somente gestor/);
    await rpc(finGestor, `select fin_definir_conta_caixa($1, true)`, [contaC]);
    expect((await q(`select entra_no_caixa from fin_contas_bancarias where id = $1`, [contaC])).rows[0].entra_no_caixa).toBe(true);
  });
});

describe("saldos bancários (0169)", () => {
  it("operador registra; correção substitui (não apaga); saldo igual é ignorado; consulta não registra", async () => {
    await expect(registrar(finConsulta, hoje, [{ conta_id: contaA, saldo: 1 }])).rejects.toThrow(/Somente operador/);
    expect((await registrar(finOperador, ontem, [{ conta_id: contaA, saldo: 900 }, { conta_id: contaB, saldo: 50 }])).rows[0].r).toEqual({ gravados: 2, iguais: 0 });
    expect((await registrar(finOperador, hoje, [{ conta_id: contaA, saldo: 1000 }])).rows[0].r).toEqual({ gravados: 1, iguais: 0 });
    expect((await registrar(finOperador, hoje, [{ conta_id: contaA, saldo: 1000.5 }])).rows[0].r).toEqual({ gravados: 1, iguais: 0 });
    expect((await registrar(finOperador, hoje, [{ conta_id: contaA, saldo: 1000.5 }])).rows[0].r).toEqual({ gravados: 0, iguais: 1 });
    const linhas = (await rpc(finConsulta, `select saldo, substituido_em is not null as subst from fin_saldos_bancarios where conta_id = $1 and data = $2 order by registrado_em, saldo`, [contaA, hoje])).rows;
    expect(linhas.map((l) => [Number(l.saldo), l.subst])).toEqual([[1000, true], [1000.5, false]]);
    await expect(rpc(finOperador, `delete from fin_saldos_bancarios where conta_id = $1`, [contaA])).resolves.toBeDefined(); // sem política: não apaga nada
    expect((await q(`select count(*)::int as n from fin_saldos_bancarios where conta_id = $1`, [contaA])).rows[0].n).toBe(3);
  });

  it("recusa data futura, conta de outra empresa e saldo inválido; aceita negativo", async () => {
    await expect(registrar(finOperador, "2999-01-01", [{ conta_id: contaA, saldo: 1 }])).rejects.toThrow(/data do saldo/);
    await expect(registrar(finOperador, hoje, [{ conta_id: contaOutra, saldo: 1 }])).rejects.toThrow(/não é desta empresa/);
    await expect(rpc(finOperador, `select fin_registrar_saldos($1, $2::date, '[{"conta_id":"x","saldo":"abc"}]'::jsonb)`, [empresa, hoje])).rejects.toThrow(/Saldo inválido/);
    expect((await registrar(finOperador, hoje, [{ conta_id: contaC, saldo: -200 }])).rows[0].r.gravados).toBe(1);
  });

  it("a view traz o último saldo até hoje, com a data", async () => {
    const v = (await rpc(finConsulta, `select id, saldo, data_saldo::text as data from fin_vw_saldo_atual where empresa_id = $1 and sumiu_em is null order by cod_conta_bancaria`, [empresa])).rows;
    expect(v.map((x) => [x.id, x.saldo === null ? null : Number(x.saldo), x.data])).toEqual([[contaA, 1000.5, hoje], [contaB, 50, ontem], [contaC, -200, hoje]]);
  });
});

describe("composição do caixa na autorização (0169)", () => {
  it("monta o rascunho com a composição: lê os saldos do banco, soma adicionais, grava a composição e o excedente", async () => {
    const t = await titulo(2000);
    const r = (await rpc(finOperador, `select cap_montar_rascunho($1, $2::uuid[], null, null, null, null, $3::jsonb) as r`,
      [empresa, [t], composicao([contaA, contaB, contaC], [{ descricao: "Depósito previsto cliente X", valor: 300 }])])).rows[0].r;
    expect(Number(r.caixa_disponivel)).toBe(1150.5); // 1000,50 + 50 + (−200) + 300
    const v = (await rpc(finConsulta, `select caixa_disponivel, excedente, caixa_composicao from cap_vw_autorizacoes where id = $1`, [r.id])).rows[0];
    expect(Number(v.excedente)).toBe(849.5);
    expect(v.caixa_composicao.map((l: Linha) => [l.tipo, Number(l.valor), l.data_saldo])).toEqual([
      ["saldo", 50, ontem], ["saldo", -200, hoje], ["saldo", 1000.5, hoje], ["adicional", 300, null], // contas pelo nome
    ]);
    expect(v.caixa_composicao[2].descricao).toBe("Sicredi CC · ag. 0802 · c/c 1-0");

    // recompor substitui a anterior (fica como prova) e recalcula; saldo novo registrado entra
    await registrar(finOperador, hoje, [{ conta_id: contaB, saldo: 80 }]);
    const c2 = (await rpc(finOperador, `select cap_definir_composicao_caixa($1, $2::jsonb) as r`, [r.id, composicao([contaA, contaB])])).rows[0].r;
    expect(Number(c2.caixa_disponivel)).toBe(1080.5);
    expect((await q(`select count(*) filter (where substituida_em is null)::int as ativas, count(*)::int as todas from cap_autorizacao_caixa where autorizacao_id = $1`, [r.id])).rows[0]).toEqual({ ativas: 2, todas: 6 });

    // composição vazia = sem caixa
    expect((await rpc(finOperador, `select cap_definir_composicao_caixa($1, $2::jsonb) as r`, [r.id, composicao([])])).rows[0].r.caixa_disponivel).toBeNull();

    // depois de autorizada, não muda mais
    await rpc(finOperador, `select cap_definir_composicao_caixa($1, $2::jsonb)`, [r.id, composicao([contaA])]);
    await rpc(finGestor, `select cap_autorizar($1)`, [r.id]);
    await expect(rpc(finOperador, `select cap_definir_composicao_caixa($1, $2::jsonb)`, [r.id, composicao([contaB])])).rejects.toThrow(/só pode ser alterado enquanto/);
    await expect(rpc(finOperador, `update cap_autorizacao_caixa set valor = 1 where autorizacao_id = $1`, [r.id])).resolves.toBeDefined(); // sem política
    expect(Number((await q(`select caixa_disponivel from cap_autorizacoes where id = $1`, [r.id])).rows[0].caixa_disponivel)).toBe(1000.5);
  });

  it("criar e autorizar na hora aplica a composição antes de autorizar", async () => {
    const t = await titulo(100);
    const r = (await rpc(finGestor, `select cap_criar_autorizacao($1, $2::uuid[], null, null, true, null, $3::jsonb) as r`, [empresa, [t], composicao([contaA])])).rows[0].r;
    expect(r.status).toBe("autorizada");
    expect(Number(r.caixa_disponivel)).toBe(1000.5);
  });

  it("recusa conta de outra empresa, adicional inválido e quem só consulta", async () => {
    const r = (await rpc(finOperador, `select cap_montar_rascunho($1, '{}'::uuid[], null, null, null, null, null) as r`, [empresa])).rows[0].r;
    await expect(rpc(finOperador, `select cap_definir_composicao_caixa($1, $2::jsonb)`, [r.id, composicao([contaOutra])])).rejects.toThrow(/não é da empresa/);
    await expect(rpc(finOperador, `select cap_definir_composicao_caixa($1, $2::jsonb)`, [r.id, composicao([], [{ descricao: "ab", valor: 1 }])])).rejects.toThrow(/Descreva/);
    await expect(rpc(finOperador, `select cap_definir_composicao_caixa($1, $2::jsonb)`, [r.id, composicao([], [{ descricao: "Depósito", valor: 0 }])])).rejects.toThrow(/Valor adicional inválido/);
    await expect(rpc(finConsulta, `select cap_definir_composicao_caixa($1, $2::jsonb)`, [r.id, composicao([contaA])])).rejects.toThrow(/Somente operador/);
    // caixa digitado (legado) invalida a composição
    await rpc(finOperador, `select cap_definir_composicao_caixa($1, $2::jsonb)`, [r.id, composicao([contaA])]);
    await rpc(finOperador, `select cap_definir_caixa($1, 10)`, [r.id]);
    expect((await rpc(finConsulta, `select caixa_disponivel, caixa_composicao from cap_vw_autorizacoes where id = $1`, [r.id])).rows[0]).toMatchObject({ caixa_composicao: null });
  });
});

describe("pendência diária dos saldos (0169)", () => {
  it("abre para empresa com conta no caixa sem saldo de hoje e conclui quando os saldos de hoje ficam completos", async () => {
    // Dia útil depois das 7h de Cuiabá? Fora disso a função não abre nada (testa só o que se aplica a agora).
    const agora = (await q(`select extract(isodow from now() at time zone 'America/Cuiaba')::int as dow, extract(hour from now() at time zone 'America/Cuiaba')::int as hora`)).rows[0];
    const abertas = (await como(db, "service", () => q(`select fin_abrir_pendencias_saldos() as n`))).rows[0].n;
    const util = agora.dow <= 5 && agora.hora >= 7;
    // empresa: conta B tem saldo de hoje (80), A e C também → nada a abrir; empresa2: conta sem saldo → abre
    expect(abertas).toBe(util ? 1 : 0);
    if (!util) return;
    const p = (await q(`select titulo, status, link from pendencias where referencia_id = $1 and titulo like 'Registrar saldos%'`, [empresa2])).rows[0];
    expect(p.status).toBe("aberta");
    expect(p.link).toBe(`/financeiro/contas-pagar/saldos?empresa=${empresa2}`);
    expect((await como(db, "service", () => q(`select fin_abrir_pendencias_saldos() as n`))).rows[0].n).toBe(0); // não duplica
    await registrar(finOperador, hoje, [{ conta_id: contaOutra, saldo: 10 }], empresa2);
    expect((await q(`select status from pendencias where referencia_id = $1 and titulo like 'Registrar saldos%'`, [empresa2])).rows[0].status).toBe("concluida");
    await expect(rpc(finOperador, `select fin_abrir_pendencias_saldos()`)).rejects.toThrow(/permission denied|Somente a sincronização/);
  });
});
