import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// 0181: Intimações de cartório — leitura (duplicidade), etapas, aprovação, adiantamento MANUAL, NF e consignação.
let db: PGlite;
let consulta: string, operador: string, gestor: string;
let empresa: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const intimacao = async (id: string) => (await q(`select *, data_limite::text as data_limite, nova_data_vencimento::text as nova_data_vencimento from fin_intimacoes where id = $1`, [id])).rows[0];
const pendencias = async (id: string) =>
  (await q(`select titulo from pendencias where referencia_id = $1 and status in ('aberta', 'em_andamento') order by titulo`, [id])).rows.map((r) => r.titulo);

const apontamento = (protocolo: string, numero = "24827-2", valor = 12367) => ({
  chave: `protocolo:CUIABÁ 04:${protocolo}`, origem: "cenprot", cartorio: "CUIABÁ 04", localizador: null, link: null, protocolo,
  dataProtocolo: "2026-10-21", credorDocumento: "39.821.062/0001-08", credorNome: "MT CORTE E DOBRA LTDA",
  devedorDocumento: "17.209.767/0001-28", especie: "DV", numeroTitulo: numero, valorTitulo: valor, vencimentoTitulo: "2026-02-11",
  dataLimite: null, valorTotalCartorio: null, valorCustas: null,
});
// Como intimacoesDoPortal entrega um título "intimado" lido no link do 4º Ofício.
const doPortal = (protocolo: string, localizador: string) => ({
  ...apontamento(protocolo), origem: "cartorio", localizador, link: `https://app.protestocuiaba.com.br/#/directMail/items/${localizador}/payments`,
  credorDocumento: "39.***.***/****-08", especie: "DMI", valorTitulo: 10520.33, dataLimite: "2026-10-23", valorTotalCartorio: 12855.94, valorCustas: 488.94,
});
const doCartorio = (localizador: string) => ({
  chave: `localizador:${localizador}`, origem: "cartorio", cartorio: "CUIABÁ 04", localizador, link: `https://app.protestocuiaba.com.br/#/directMail/items/${localizador}/payments`,
  protocolo: null, dataProtocolo: null, credorDocumento: null, credorNome: null, devedorDocumento: null, especie: null, numeroTitulo: null,
  valorTitulo: null, vencimentoTitulo: null,
});
const ler = (emails: unknown[]) => servico(`select fin_int_registrar_leitura('admcuiaba@neoformas.com.br', $1::jsonb) as r`, [JSON.stringify(emails)]);
const email = (messageId: string, tipo: string, intimacoes: unknown[]) =>
  ({ messageId, threadId: messageId, tipo, remetente: "x", assunto: "y", recebidoEm: "2026-10-22T11:00:00Z", intimacoes });
const amanha = () => {
  const d = new Date(Date.now() + 3 * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const informar = (u: string, id: string, extra: { numero?: string; custas?: number | null; limite?: string | null } = {}) =>
  rpc(u, `select fin_int_informar_dados($1, $2, '39.821.062/0001-08', 'MT CORTE E DOBRA LTDA', $3, 12367, '2026-02-11', $4::date, $5)`,
    [id, empresa, extra.numero ?? "24827-2", extra.limite === undefined ? amanha() : extra.limite, extra.custas === undefined ? 45.9 : extra.custas]);
const escolher = (u: string, id: string, cod = "5001") =>
  rpc(u, `select fin_int_escolher_titulo($1, $2, $3::jsonb)`, [id, cod, JSON.stringify({ codLancamento: cod, numDocumento: "24827/2", valor: 12367 })]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  consulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  operador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  gestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, cnpj, codigo_erp) values ('Neo Formas', 'Neo', '17.209.767/0001-28', '1') returning id`)).rows[0].id;
});

describe("leitura e duplicidade", () => {
  it("chaves começam desligadas; módulo e cartório configurados", async () => {
    const chaves = (await q(`select chave, valor from configuracoes where chave like 'financeiro.intimacoes.%' order by chave`)).rows;
    expect(chaves.find((c) => c.chave.endsWith("ler_gmail"))?.valor).toBe(false);
    expect(chaves.find((c) => c.chave.endsWith("alterar_vencimento_no_erp"))?.valor).toBe(false);
    expect(chaves.find((c) => c.chave.endsWith("cartorios"))?.valor["CUIABÁ 04"].codFornecedor).toBeNull();
    expect((await q(`select ativo from modulos where codigo = 'financeiro.intimacoes'`)).rows[0].ativo).toBe(true);
  });

  it("só a service role registra leitura", async () => {
    await expect(rpc(operador, `select fin_int_registrar_leitura('x', '[]'::jsonb)`)).rejects.toThrow(/permission denied/);
  });

  it("o mesmo e-mail e a mesma intimação nunca entram duas vezes", async () => {
    const r1 = (await ler([email("m1", "cenprot", [apontamento("3090983"), apontamento("3090984", "24827-3", 12220)])])).rows[0].r;
    expect(r1).toMatchObject({ emails: 1, novas: 2, repetidas: 0 });
    // Mesmo e-mail de novo (outra rodada) e aviso do dia seguinte repetindo o protocolo.
    const r2 = (await ler([email("m1", "cenprot", [apontamento("3090983")]), email("m2", "cenprot", [apontamento("3090983")])])).rows[0].r;
    expect(r2).toMatchObject({ emails: 1, jaLidos: 1, novas: 0, repetidas: 1 });
    // Cópias da intimação do 4º Ofício (admcuiaba@, alantorres@) com o mesmo localizador = uma intimação.
    const loc = "bfdec11a-5ff7-4716-807a-13a6fd3ea893";
    const r3 = (await ler([email("c1", "cartorio", [doCartorio(loc)]), email("c2", "cartorio", [doCartorio(loc)])])).rows[0].r;
    expect(r3).toMatchObject({ emails: 2, novas: 1, repetidas: 1 });
    expect((await q(`select count(*)::int as n from fin_intimacoes`)).rows[0].n).toBe(3);
    const i = (await q(`select * from fin_int_vw_intimacoes where protocolo = '3090983'`)).rows[0];
    expect(i).toMatchObject({ status: "identificada", empresa_nome: "Neo", emails: 2 });
    expect(await pendencias(i.id)).toEqual(["Intimação de protesto: MT CORTE E DOBRA LTDA · título 24827-2"]);
  });

  it("intimação do 4º Ofício se junta ao apontamento; e-mails novos daquele localizador vão para o apontamento", async () => {
    const origem = (await q(`select id from fin_intimacoes where origem = 'cartorio'`)).rows[0].id;
    const destino = (await q(`select id from fin_intimacoes where protocolo = '3090984'`)).rows[0].id;
    await expect(rpc(consulta, `select fin_int_mesclar($1, $2)`, [origem, destino])).rejects.toThrow(/Somente operador/);
    await rpc(operador, `select fin_int_mesclar($1, $2)`, [origem, destino]);
    expect(await intimacao(origem)).toMatchObject({ status: "descartada", mesclada_com: destino });
    expect((await intimacao(destino)).localizador).toBe("bfdec11a-5ff7-4716-807a-13a6fd3ea893");
    await ler([email("c3", "cartorio", [doCartorio("bfdec11a-5ff7-4716-807a-13a6fd3ea893")])]);
    expect((await q(`select count(*)::int as n from fin_intimacao_origens where intimacao_id = $1`, [destino])).rows[0].n).toBe(4);
    expect(await pendencias(origem)).toEqual([]);
  });

  it("portal e CENPROT com o mesmo protocolo viram uma intimação: cada fonte completa o que falta", async () => {
    const loc = "aaaaaaaa-1171-4f37-a37b-810984416e05";
    // Portal primeiro (CNPJ do credor mascarado, prazo e custas) …
    const r1 = (await ler([email("p1", "cartorio", [doPortal("3099001", loc)])])).rows[0].r;
    expect(r1).toMatchObject({ novas: 1 });
    const id = (await q(`select id from fin_intimacoes where protocolo = '3099001'`)).rows[0].id;
    expect(await intimacao(id)).toMatchObject({ credor_documento: "39.***.***/****-08", data_limite: "2026-10-23", valor_custas: "488.94", valor_total_cartorio: "12855.94" });
    expect((await intimacao(id)).dados_portal_em).not.toBeNull();
    expect((await q(`select descricao from pendencias where referencia_id = $1 and status = 'aberta'`, [id])).rows[0].descricao).toMatch(/prazo 23\/10\/2026 \(lido do portal/);
    // … depois a CENPROT: troca a máscara pelo CNPJ completo e não mexe no prazo/custas.
    const r2 = (await ler([email("p2", "cenprot", [apontamento("3099001")])])).rows[0].r;
    expect(r2).toMatchObject({ novas: 0, repetidas: 1 });
    expect(await intimacao(id)).toMatchObject({ credor_documento: "39.821.062/0001-08", data_limite: "2026-10-23", valor_custas: "488.94", localizador: loc });
    // Ao contrário (CENPROT antes): o portal traz prazo, custas e localizador.
    await ler([email("p3", "cenprot", [apontamento("3099002")])]);
    await ler([email("p4", "cartorio", [doPortal("3099002", loc)])]);
    const outra = (await q(`select *, data_limite::text as data_limite from fin_intimacoes where protocolo = '3099002'`)).rows[0];
    expect(outra).toMatchObject({ credor_documento: "39.821.062/0001-08", data_limite: "2026-10-23", valor_custas: "488.94", localizador: loc });
    await rpc(operador, `select fin_int_descartar($1, 'teste de junção')`, [id]);
    await rpc(operador, `select fin_int_descartar($1, 'teste de junção')`, [outra.id]);
  });

  it("nada é apagado", async () => {
    await expect(q(`delete from fin_intimacoes`)).rejects.toThrow();
    await expect(q(`delete from fin_intimacao_emails`)).rejects.toThrow();
  });
});

describe("etapas até a aprovação", () => {
  let id: string;
  beforeAll(async () => { id = (await q(`select id from fin_intimacoes where protocolo = '3090983'`)).rows[0].id; });

  it("propor exige título, prazo e custas informados pela pessoa", async () => {
    await expect(rpc(operador, `select fin_int_propor_vencimento($1)`, [id])).rejects.toThrow(/"identificada"/);
    await informar(operador, id, { custas: null, limite: null });
    await escolher(operador, id);
    expect((await intimacao(id)).status).toBe("titulo_localizado");
    await expect(rpc(operador, `select fin_int_propor_vencimento($1)`, [id])).rejects.toThrow(/prazo para pagamento/);
    await informar(operador, id, { limite: amanha(), custas: null });
    await expect(rpc(operador, `select fin_int_propor_vencimento($1)`, [id])).rejects.toThrow(/custas/);
    await expect(informar(operador, id, { custas: 0 })).rejects.toThrow(/maiores que zero/);
    await expect(informar(operador, id, { limite: "2026-01-01" }).then(() => rpc(operador, `select fin_int_propor_vencimento($1)`, [id]))).rejects.toThrow(/já passou/);
    await informar(operador, id);
    expect((await intimacao(id)).status).toBe("titulo_localizado");
  });

  it("trocar o número do título desfaz a escolha", async () => {
    await informar(operador, id, { numero: "99999" });
    expect(await intimacao(id)).toMatchObject({ status: "identificada", cod_lancamento: null });
    await informar(operador, id);
    await escolher(operador, id);
  });

  it("o mesmo título não fica em duas intimações em andamento", async () => {
    const outra = (await q(`select id from fin_intimacoes where protocolo = '3090984'`)).rows[0].id;
    await informar(operador, outra);
    await expect(escolher(operador, outra, "5001")).rejects.toThrow(/já está em outra intimação/);
  });

  it("proposta vai ao gestor; operador não aprova; gestor devolve ou aprova; chave desligada recusa", async () => {
    await rpc(operador, `select fin_int_propor_vencimento($1)`, [id]);
    const i = await intimacao(id);
    expect(i).toMatchObject({ status: "aguardando_aprovacao", nova_data_vencimento: i.data_limite });
    expect((await pendencias(id))[0]).toMatch(/^Aprovar novo vencimento/);
    await expect(rpc(operador, `select fin_int_aprovar_vencimento($1)`, [id])).rejects.toThrow(/Somente gestor/);
    await expect(rpc(gestor, `select fin_int_aprovar_vencimento($1)`, [id])).rejects.toThrow(/desligada/);
    await expect(rpc(gestor, `select fin_int_devolver_proposta($1, '')`, [id])).rejects.toThrow(/motivo/);
    await rpc(gestor, `select fin_int_devolver_proposta($1, 'Conferir o prazo')`, [id]);
    expect(await intimacao(id)).toMatchObject({ status: "titulo_localizado", motivo: "Conferir o prazo", nova_data_vencimento: null });
    await rpc(operador, `select fin_int_propor_vencimento($1)`, [id]);
  });
});

describe("vencimento no Consistem, adiantamento manual, NF e consignação", () => {
  let id: string;
  let envio: string;
  beforeAll(async () => {
    id = (await q(`select id from fin_intimacoes where protocolo = '3090983'`)).rows[0].id;
    await q(`update configuracoes set valor = 'true'::jsonb where chave = 'financeiro.intimacoes.alterar_vencimento_no_erp'`);
  });

  it("aprovação reserva a alteração só da data; uma por vez", async () => {
    envio = (await rpc(gestor, `select fin_int_aprovar_vencimento($1) as id`, [id])).rows[0].id;
    const v = (await q(`select * from fin_intimacao_vencimentos where id = $1`, [envio])).rows[0];
    expect(v).toMatchObject({ situacao: "reservado", cod_lancamento: "5001", aprovado_por: gestor });
    expect(Object.keys(v.alteracao)).toEqual(["dataVencimento"]);
    expect((await intimacao(id)).aprovado_por).toBe(gestor);
    await expect(rpc(gestor, `select fin_int_aprovar_vencimento($1)`, [id])).rejects.toThrow(/em andamento/);
    await expect(q(`insert into fin_intimacao_vencimentos (intimacao_id, empresa_id, cod_lancamento, alteracao, aprovado_por) values ($1, $2, '1', '{"dataVencimento":"2026-11-01","valorDocumento":1}', $3)`, [id, empresa, gestor])).rejects.toThrow();
  });

  it("sem a leitura de depois não há sucesso; o envio é só da service role", async () => {
    await expect(rpc(operador, `select fin_int_iniciar_vencimento($1)`, [envio])).rejects.toThrow(/permission denied/);
    await servico(`select fin_int_iniciar_vencimento($1)`, [envio]);
    await expect(servico(`select fin_int_concluir_vencimento($1, true, false, '{}'::jsonb, null, null, null)`, [envio])).rejects.toThrow(/conferência/);
  });

  it("conferido no Consistem: vai para o adiantamento MANUAL, sem considerar lançado", async () => {
    await servico(`select fin_int_concluir_vencimento($1, true, false, '{"dataVencimento":"2026-02-11"}'::jsonb, '{"dataVencimento":"x"}'::jsonb, null, null)`, [envio]);
    const i = await intimacao(id);
    expect(i.status).toBe("adiantamento_pendente");
    expect(i.vencimento_alterado_em).not.toBeNull();
    expect(i.adiantamento_confirmado_em).toBeNull();
    const [p] = await pendencias(id);
    expect(p).toMatch(/^Lançar adiantamento ao cartório/);
    const desc = (await q(`select descricao from pendencias where referencia_id = $1 and status = 'aberta'`, [id])).rows[0].descricao;
    expect(desc).toContain("R$ 45,90");
    expect(desc).toContain("4º Ofício de Protesto de Títulos de Cuiabá/MT");
    await expect(q(`update fin_intimacao_vencimentos set situacao = 'erro' where id = $1`, [envio])).rejects.toThrow(/já foi concluída/);
  });

  it("o adiantamento só avança com a confirmação da pessoa; depois NF e consignação", async () => {
    await expect(rpc(consulta, `select fin_int_confirmar_adiantamento($1, null)`, [id])).rejects.toThrow(/Somente operador/);
    await expect(rpc(operador, `select fin_int_registrar_nf($1, '123')`, [id])).rejects.toThrow(/"adiantamento_pendente"/);
    await expect(rpc(operador, `select fin_int_confirmar_adiantamento($1, $2)`, [id, "X".repeat(51)])).rejects.toThrow();
    await rpc(operador, `select fin_int_confirmar_adiantamento($1, '34300')`, [id]);
    expect(await intimacao(id)).toMatchObject({ status: "nf_pendente", adiantamento_referencia: "34300", adiantamento_confirmado_por: operador });
    await expect(rpc(operador, `select fin_int_confirmar_adiantamento($1, null)`, [id])).rejects.toThrow(/"nf_pendente"/);
    await expect(rpc(operador, `select fin_int_registrar_nf($1, ' ')`, [id])).rejects.toThrow(/número da NF/);
    await rpc(operador, `select fin_int_registrar_nf($1, '1520')`, [id]);
    expect((await intimacao(id)).status).toBe("consignacao_pendente");
    await rpc(operador, `select fin_int_confirmar_consignacao($1, null)`, [id]);
    expect((await intimacao(id)).status).toBe("concluida");
    expect(await pendencias(id)).toEqual([]);
    // Concluída libera o título para outra intimação (ex.: novo protesto do mesmo título).
    const outra = (await q(`select id from fin_intimacoes where protocolo = '3090984'`)).rows[0].id;
    await escolher(operador, outra, "5001");
  });

  it("falha no Consistem vira revisão; retomar volta à conferência; descartar exige motivo", async () => {
    const outra = (await q(`select id from fin_intimacoes where protocolo = '3090984'`)).rows[0].id;
    await rpc(operador, `select fin_int_propor_vencimento($1)`, [outra]);
    const e = (await rpc(gestor, `select fin_int_aprovar_vencimento($1) as id`, [outra])).rows[0].id;
    await servico(`select fin_int_concluir_vencimento($1, false, false, '{}'::jsonb, null, null, 'O Consistem recusou (HTTP 400).')`, [e]);
    expect(await intimacao(outra)).toMatchObject({ status: "revisao", motivo: "O Consistem recusou (HTTP 400)." });
    expect((await pendencias(outra))[0]).toMatch(/^Revisar intimação/);
    await rpc(operador, `select fin_int_retomar($1)`, [outra]);
    expect(await intimacao(outra)).toMatchObject({ status: "titulo_localizado", aprovado_por: null });
    await expect(rpc(operador, `select fin_int_descartar($1, '')`, [outra])).rejects.toThrow(/motivo/);
    await rpc(operador, `select fin_int_descartar($1, 'Pago no cartório antes')`, [outra]);
    expect((await intimacao(outra)).status).toBe("descartada");
  });

  it("auditoria registra as mudanças", async () => {
    const n = (await q(`select count(*)::int as n from auditoria where tabela = 'fin_intimacoes' and registro_id = $1`, [id])).rows[0].n;
    expect(n).toBeGreaterThan(5);
  });
});

describe("fornecedor pelo documento (função pública do Contas a Pagar)", () => {
  it("acha pelo CNPJ com ou sem máscara e não responde a quem não tem o Financeiro", async () => {
    await q(`insert into cap_fornecedores (empresa_id, cod_fornecedor, nome, documento) values ($1, '1290', 'MT CORTE E DOBRA LTDA', '39.821.062/0001-08')`, [empresa]);
    const r = await rpc(operador, `select * from cap_fornecedores_por_documento($1, '39821062000108')`, [empresa]);
    expect(r.rows).toEqual([{ cod_fornecedor: "1290", nome: "MT CORTE E DOBRA LTDA", ativo: true }]);
    const semArea = await novoUsuario(db, "rh@neo.com", { rh: "gestor" });
    expect((await rpc(semArea, `select * from cap_fornecedores_por_documento($1, '39.821.062/0001-08')`, [empresa])).rows).toEqual([]);
  });

  it("CNPJ mascarado do portal: dígitos visíveis e nome têm de conferir", async () => {
    await q(`update cap_fornecedores set nome = 'MT CORTE E DOBRA LTDA EM RECUPERACAO JUDICIAL' where cod_fornecedor = '1290'`);
    await q(`insert into cap_fornecedores (empresa_id, cod_fornecedor, nome, documento) values ($1, '1300', 'MT OUTRA LTDA', '39.111.111/0001-08')`, [empresa]);
    const achar = (doc: string, nome: string | null) => rpc(operador, `select cod_fornecedor from cap_fornecedores_por_documento($1, $2, $3)`, [empresa, doc, nome]);
    expect((await achar("39.***.***/****-08", "MT CORTE E DOBRA LTDA")).rows).toEqual([{ cod_fornecedor: "1290" }]);
    expect((await achar("39.***.***/****-08", null)).rows).toEqual([]);
    expect((await achar("39.***.***/****-09", "MT CORTE E DOBRA LTDA")).rows).toEqual([]);
    expect((await achar("**", "MT CORTE E DOBRA LTDA")).rows).toEqual([]);
  });
});
