import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { notaDoDocumento } from "../../lib/modulos/financeiro/filial/arquivos";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let operador: string;
let consulta: string;
let empresa: string;
let cliente: string;
let nf = 2300;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.filial";
const novaNota = () => String(++nf).padStart(6, "0");

const registrar = (nota: string, quem = operador, aceita = true) =>
  como(db, quem, async () => (await q(`select rec_kit_registrar($1, 'QRTZ 39', $2, 'Obra X', null, null, null) as id`, [nota, aceita])).rows[0].id as string);
async function titulo(documento: string, extra: { cedido?: boolean; forma?: string } = {}) {
  return (await q(
    `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio, cedido, forma_pagamento)
     values ($1, $2, $3, '1', current_date + 20, 1500, 'aguardando_boleto', $4, $5) returning id`,
    [empresa, cliente, documento, extra.cedido ?? false, extra.forma ?? "boleto"],
  )).rows[0].id as string;
}
const anexar = (tabela: string, id: string, tipo: string, modulo = MOD) =>
  q(`insert into anexos (modulo, referencia_tabela, referencia_id, arquivo_path, nome_arquivo, tipo) values ($1, $2, $3, 'x/y.pdf', 'y.pdf', $4)`, [modulo, tabela, id, tipo]);
const kit = async (id: string) => (await q(`select * from rec_vw_kits where id = $1`, [id])).rows[0];
const pendencias = async (id: string) =>
  Object.fromEntries((await q(`select titulo, status from pendencias where referencia_id = $1 order by criado_em`, [id])).rows.map((r) => [r.titulo.split(":")[0], r.status]));

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  operador = await novoUsuario(db, "melina@neo.com", { financeiro: "operador" });
  consulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
  cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('QRTZ 39 LTDA', '{cliente}', 'q39') returning id`)).rows[0].id;
});

describe("rec_nota_filial", () => {
  it("SQL e TypeScript extraem a mesma NF do documento", async () => {
    for (const doc of ["4002323U", "4002351A", "1001266E", "453", "40023", "400", "4100001A", "Z00018E"]) {
      const r = (await q(`select rec_nota_filial($1) as n`, [doc])).rows[0].n;
      expect(r, doc).toBe(notaDoDocumento(doc));
    }
  });
});

describe("registro do kit", () => {
  it("cria o kit, normaliza a NF e abre a pendência de implantação", async () => {
    const id = await registrar("2351");
    const k = await kit(id);
    expect(k.nota_fiscal).toBe("002351");
    expect(k.estagio).toBe("recebida");
    expect(await pendencias(id)).toEqual({ "Implantar fatura da filial": "aberta" });
  });

  it("registrar a mesma NF de novo devolve o mesmo kit (completar documentos)", async () => {
    const nota = novaNota();
    const a = await registrar(nota);
    const b = await registrar(nota, operador, false);
    expect(b).toBe(a);
    expect((await kit(a)).aceita_boleto_factoring).toBe(false);
    expect((await q(`select count(*)::int as n from pendencias where referencia_id = $1`, [a])).rows[0].n).toBe(1);
  });

  it("consulta não registra; NF inválida é recusada", async () => {
    await expect(registrar(novaNota(), consulta)).rejects.toThrow(/operador/);
    await expect(registrar("abc")).rejects.toThrow(/NF inválido/);
    await expect(registrar("1234567")).rejects.toThrow(/NF inválido/);
  });

  it("o estágio não é gravado à mão", async () => {
    const id = await registrar(novaNota());
    await expect(como(db, operador, () => q(`update rec_kits set estagio = 'pronta' where id = $1`, [id]))).rejects.toThrow(/calculado/);
  });

  it("não há exclusão", async () => {
    const id = await registrar(novaNota());
    await expect(q(`delete from rec_kits where id = $1`, [id])).rejects.toThrow();
  });
});

describe("esteira do kit", () => {
  it("título que chega depois liga ao kit: implantada; boleto anexado: pronta; pendências acompanham", async () => {
    const nota = novaNota();
    const id = await registrar(nota);
    await anexar("rec_kits", id, "nota_fatura");
    const t = await como(db, "service", () => titulo(`4${nota}U`));
    expect((await kit(id)).estagio).toBe("implantada");
    expect(await pendencias(id)).toEqual({ "Implantar fatura da filial": "concluida" });

    await como(db, operador, () => anexar("rec_titulos", t, "boleto", "financeiro.recebiveis"));
    const k = await kit(id);
    expect(k.estagio).toBe("pronta");
    expect(k.parcelas).toBe(1);
    expect(k.boletos).toBe(1);
    expect(k.notas).toBe(1);
    expect(await pendencias(id)).toEqual({ "Implantar fatura da filial": "concluida", "Enviar kit ao cliente": "aberta" });
  });

  it("kit criado depois do título liga na hora", async () => {
    const nota = novaNota();
    await titulo(`4${nota}A`);
    await titulo(`4${nota}B`);
    const id = await registrar(nota);
    const k = await kit(id);
    expect(k.estagio).toBe("implantada");
    expect(k.parcelas).toBe(2);
    expect(await pendencias(id)).toEqual({}); // já implantada: nada a pedir para Cuiabá
  });

  it("várias parcelas: só fica pronta com boleto em todas (transferência dispensa)", async () => {
    const nota = novaNota();
    const id = await registrar(nota);
    const a = await titulo(`4${nota}A`);
    await titulo(`4${nota}B`, { forma: "transferencia" });
    expect((await kit(id)).estagio).toBe("implantada");
    await anexar("rec_titulos", a, "boleto", "financeiro.recebiveis");
    expect((await kit(id)).estagio).toBe("pronta");
  });

  it("parcela cedida não exige carta se o cliente não pede (ex.: cliente sem boleto de factoring)", async () => {
    const nota = novaNota();
    const id = await registrar(nota);
    const t = await titulo(`4${nota}U`, { cedido: true });
    await anexar("rec_titulos", t, "boleto", "financeiro.recebiveis");
    expect((await kit(id)).estagio).toBe("pronta");
    expect((await kit(id)).exige_carta).toBe(false);
  });

  it("cliente que pede a carta: parcela cedida só fica pronta com a carta; a marca recalcula os kits abertos", async () => {
    const nota = novaNota();
    const id = await registrar(nota);
    const t = await titulo(`4${nota}U`, { cedido: true });
    await anexar("rec_titulos", t, "boleto", "financeiro.recebiveis");
    expect((await kit(id)).estagio).toBe("pronta");

    const n = await como(db, operador, async () => (await q(`select rec_cliente_definir_carta_cessao($1, true) as n`, [cliente])).rows[0].n);
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await kit(id)).estagio).toBe("implantada");
    expect((await kit(id)).exige_carta).toBe(true);
    expect((await pendencias(id))["Enviar kit ao cliente"]).toBe("cancelada");

    await anexar("rec_kits", id, "carta_cessao");
    expect((await kit(id)).estagio).toBe("pronta");

    await expect(como(db, consulta, () => q(`select rec_cliente_definir_carta_cessao($1, false)`, [cliente]))).rejects.toThrow(/operador/);
    await como(db, operador, () => q(`select rec_cliente_definir_carta_cessao($1, false)`, [cliente]));
  });

  it("título não cedido nunca exige carta, mesmo para cliente que pede", async () => {
    await como(db, operador, () => q(`select rec_cliente_definir_carta_cessao($1, true)`, [cliente]));
    const nota = novaNota();
    const id = await registrar(nota);
    const t = await titulo(`4${nota}U`);
    await anexar("rec_titulos", t, "boleto", "financeiro.recebiveis");
    expect((await kit(id)).estagio).toBe("pronta");
    await como(db, operador, () => q(`select rec_cliente_definir_carta_cessao($1, false)`, [cliente]));
  });

  it("título da Matriz com o mesmo número não liga", async () => {
    const nota = novaNota();
    const id = await registrar(nota);
    await titulo(`1${nota}U`);
    expect((await kit(id)).parcelas).toBe(0);
  });
});

describe("cancelamento", () => {
  it("exige motivo, fecha as pendências e libera a NF para um novo kit", async () => {
    const nota = novaNota();
    const id = await registrar(nota);
    await expect(como(db, operador, () => q(`select rec_kit_cancelar($1, ' ')`, [id]))).rejects.toThrow(/motivo/);
    await como(db, operador, () => q(`select rec_kit_cancelar($1, 'NF substituída')`, [id]));
    expect((await kit(id)).estagio).toBe("cancelada");
    expect(await pendencias(id)).toEqual({ "Implantar fatura da filial": "cancelada" });
    const novo = await registrar(nota);
    expect(novo).not.toBe(id);
    await expect(como(db, operador, () => q(`update rec_kits set obra = 'y' where id = $1`, [id]))).rejects.toThrow(/cancelado/);
  });
});

describe("remessa (0148)", () => {
  const criarRemessa = () => como(db, operador, async () => (await q(`select rec_remessa_criar() as r`)).rows[0].r as { id: string; numero: number });
  const registrarNa = (remessa: string, nota: string, parcelas: unknown) =>
    como(db, operador, async () => (await q(`select rec_kit_registrar($1, 'HERMES', true, null, null, null, null, $2, $3::jsonb) as id`, [nota, remessa, JSON.stringify(parcelas)])).rows[0].id as string);
  const concluir = (remessa: string) => como(db, operador, async () => (await q(`select rec_remessa_concluir($1) as n`, [remessa])).rows[0].n as number);
  const pendRemessa = async (remessa: string) => (await q(`select titulo, status from pendencias where referencia_tabela = 'rec_remessas' and referencia_id = $1`, [remessa])).rows;

  it("numera, guarda as parcelas informadas (ordenadas) e abre uma pendência por remessa", async () => {
    const a = await criarRemessa();
    const b = await criarRemessa();
    expect(b.numero).toBe(a.numero + 1);
    const n1 = novaNota();
    const n2 = novaNota();
    const k1 = await registrarNa(a.id, n1, [{ vencimento: "2026-12-10", valor: 500 }, { vencimento: "2026-11-10", valor: "500.004" }]);
    await registrarNa(a.id, n2, []);
    expect((await q(`select parcelas_informadas from rec_kits where id = $1`, [k1])).rows[0].parcelas_informadas)
      .toEqual([{ vencimento: "2026-11-10", valor: 500.0 }, { vencimento: "2026-12-10", valor: 500 }]);
    expect((await q(`select count(*)::int n from pendencias where referencia_id = $1`, [k1])).rows[0].n).toBe(0); // sem pendência por NF
    expect(await concluir(a.id)).toBe(2);
    expect(await pendRemessa(a.id)).toEqual([{ titulo: `Implantar remessa nº ${a.numero} da filial (2 NFs)`, status: "aberta" }]);
    const v = (await q(`select kits, aguardando_implantacao from rec_vw_remessas where id = $1`, [a.id])).rows[0];
    expect(v).toEqual({ kits: 2, aguardando_implantacao: 2 });

    // a pendência só fecha quando TODAS as NFs estão no Consistem
    await titulo(`4${n1}U`);
    expect((await pendRemessa(a.id))[0].status).toBe("aberta");
    await titulo(`4${n2}U`);
    expect((await pendRemessa(a.id))[0].status).toBe("concluida");
  });

  it("remessa com NFs já implantadas não abre pendência; remessa vazia é recusada", async () => {
    const r = await criarRemessa();
    const nota = novaNota();
    await titulo(`4${nota}U`);
    await registrarNa(r.id, nota, []);
    expect(await concluir(r.id)).toBe(0);
    expect(await pendRemessa(r.id)).toEqual([]);
    const vazia = await criarRemessa();
    await expect(concluir(vazia.id)).rejects.toThrow(/não tem faturas/);
  });

  it("a mesma NF pode voltar noutra remessa (completar); parcelas vazias não apagam as informadas", async () => {
    const r1 = await criarRemessa();
    const r2 = await criarRemessa();
    const nota = novaNota();
    const k = await registrarNa(r1.id, nota, [{ vencimento: "2026-11-10", valor: 100 }]);
    expect(await registrarNa(r2.id, nota, [])).toBe(k);
    expect((await q(`select count(*)::int n from rec_remessa_kits where kit_id = $1`, [k])).rows[0].n).toBe(2);
    expect((await q(`select parcelas_informadas from rec_kits where id = $1`, [k])).rows[0].parcelas_informadas).toEqual([{ vencimento: "2026-11-10", valor: 100 }]);
  });

  it("parcela inválida é recusada", async () => {
    const r = await criarRemessa();
    await expect(registrarNa(r.id, novaNota(), [{ vencimento: "10/11/2026", valor: 1 }])).rejects.toThrow(/vencimento e valor/);
    await expect(registrarNa(r.id, novaNota(), [{ vencimento: "2026-11-10", valor: 0 }])).rejects.toThrow(/vencimento e valor/);
  });

  it("consulta não cria remessa; aviso aberto fica registrado", async () => {
    await expect(como(db, consulta, () => q(`select rec_remessa_criar()`))).rejects.toThrow(/operador/);
    const r = await criarRemessa();
    await como(db, operador, () => q(`select rec_remessa_marcar_aviso($1)`, [r.id]));
    const v = (await q(`select aviso_aberto_em, aviso_aberto_por from rec_remessas where id = $1`, [r.id])).rows[0];
    expect(v.aviso_aberto_em).not.toBeNull();
    expect(v.aviso_aberto_por).toBe(operador);
  });
});

describe("implantação (0149)", () => {
  const registrarCom = (nota: string, documento: string | null, emissao = "2026-10-08") =>
    como(db, operador, async () => (await q(
      `select rec_kit_registrar($1, 'QRTZ 39', true, null, null, null, null, null, null, $2::date, $3) as id`, [nota, emissao, documento],
    )).rows[0].id as string);
  const kitBruto = async (id: string) => (await q(`select data_emissao::text, cliente_documento, cliente_codigo_erp, cliente_conferido_em from rec_kits where id = $1`, [id])).rows[0];

  it("guarda emissão e CNPJ; preenche o código do cliente pelo CNPJ de quem já tem título", async () => {
    await q(`update contrapartes set documento = '54.228.381/0001-90' where id = $1`, [cliente]);
    const id = await registrarCom(novaNota(), "54.228.381/0001-90");
    const k = await kitBruto(id);
    expect(k.data_emissao).toBe("2026-10-08");
    expect(k.cliente_documento).toBe("54.228.381/0001-90");
    expect(k.cliente_codigo_erp).toBe("q39");
    expect(k.cliente_conferido_em).not.toBeNull();
  });

  it("cliente sem título fica sem código; a consulta grava o código (ou o 'não cadastrado')", async () => {
    const id = await registrarCom(novaNota(), "11.222.333/0001-81");
    expect((await kitBruto(id)).cliente_codigo_erp).toBeNull();
    expect((await kitBruto(id)).cliente_conferido_em).toBeNull();
    await como(db, operador, () => q(`select rec_kit_definir_cliente_erp($1, '777')`, [id]));
    expect((await kitBruto(id)).cliente_codigo_erp).toBe("777");
    await como(db, operador, () => q(`select rec_kit_definir_cliente_erp($1, null)`, [id]));
    const k = await kitBruto(id);
    expect(k.cliente_codigo_erp).toBeNull();
    expect(k.cliente_conferido_em).not.toBeNull();
    await expect(como(db, consulta, () => q(`select rec_kit_definir_cliente_erp($1, '1')`, [id]))).rejects.toThrow(/operador/);
  });

  it("a configuração da implantação traz os campos fixos do POP", async () => {
    const v = (await q(`select valor from configuracoes where chave = 'financeiro.filial.implantacao'`)).rows[0].valor;
    expect(v.tipo_nota).toBe("12 — FAT LOCAÇÃO");
    expect(v.classificacao_fiscal).toBe("11837 — OUTRAS");
    expect(v.produto).toBe("2.09.002.0024 — LOCAÇÃO DE BENS MÓVEIS");
  });
});
