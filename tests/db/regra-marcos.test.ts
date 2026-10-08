import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { marcosDeLinhas, MARCOS_PADRAO, validarMarcos, VARIAVEIS_TEXTO_COBRANCA, type LinhaMarcoBanco } from "../../supabase/functions/_shared/cobranca";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, finConsulta: string, finOperador: string, finGestor: string;
let empresa: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";

type MarcoJson = { dias: number; canais: string[]; descricao: string; texto_whatsapp?: string | null; assunto_email?: string | null; corpo_email?: string | null };
const marco = (dias: number, extra: Partial<MarcoJson> = {}): MarcoJson => ({
  dias, canais: ["whatsapp"], descricao: `Marco de ${dias} dias`, texto_whatsapp: "{saudacao} Há {pl:uma parcela|várias parcelas} em aberto:\n\n{parcelas}", ...extra,
});
const salvarMarcos = (usuario: string, marcos: unknown) =>
  como(db, usuario, () => q(`select rec_salvar_regua(null, $1::jsonb) as r`, [JSON.stringify(marcos)]));
const ativos = async () => (await q(
  `select m.dia_relativo as dias from rec_regua_marcos m join rec_reguas r on r.id = m.regua_id where r.nome = 'Padrao' and m.acao = 'cobranca' and m.ativo order by 1`)).rows.map((r) => r.dias as number);
const pendencias = async (cliente: string) => (await q(`select titulo, status from pendencias where referencia_id = $1 order by titulo`, [cliente])).rows;

async function cliente(): Promise<{ id: string; titulo: string }> {
  const n = ++contador;
  const id = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ($1, '{cliente}', $2) returning id`, [`CLIENTE M${n}`, `m${n}`])).rows[0].id as string;
  const titulo = (await q(`insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio) values ($1, $2, $3, '1', current_date - 3, 20000, 'vencido') returning id`, [empresa, id, `M${n}`])).rows[0].id as string;
  return { id, titulo };
}
const abrirPendencia = (cliente: string, dias: number) =>
  q(`insert into pendencias (modulo, titulo, prazo, referencia_tabela, referencia_id) values ($1, $2, current_date, 'contrapartes', $3)`, [MOD, `Cobrar D+${dias}: CLIENTE — venc. 10/10`, cliente]);

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
});

describe("sementes", () => {
  it("a régua nasce igual ao padrão do código (dias, canais, descrições e textos)", async () => {
    const linhas = (await q(
      `select m.dia_relativo, m.canais::text[] as canais, m.descricao, m.texto_whatsapp, m.assunto_email, m.corpo_email
         from rec_regua_marcos m join rec_reguas r on r.id = m.regua_id where r.nome = 'Padrao' and m.acao = 'cobranca' and m.ativo order by 1`)).rows;
    expect(marcosDeLinhas(linhas as unknown as LinhaMarcoBanco[])).toEqual(MARCOS_PADRAO);
  });

  it("o padrão do código passa na própria validação", () => {
    expect(validarMarcos(MARCOS_PADRAO)).toBeNull();
  });
});

describe("leitura e permissão", () => {
  it("quem tem área financeira lê os marcos; sem área não lê", async () => {
    const r = await como(db, finConsulta, () => q(`select count(*)::int as n from rec_regua_marcos`));
    expect(r.rows[0].n).toBe(3);
    const semArea = await novoUsuario(db, "rh@neo.com", { rh: "gestor" });
    expect((await como(db, semArea, () => q(`select count(*)::int as n from rec_regua_marcos`))).rows[0].n).toBe(0);
  });

  it("ninguém grava direto na tabela (só pela função)", async () => {
    const r = await como(db, finGestor, () => q(`update rec_regua_marcos set descricao = 'x'`));
    expect(r.affectedRows).toBe(0);
    await expect(como(db, finGestor, () => q(`delete from rec_regua_marcos`))).resolves.toMatchObject({ affectedRows: 0 });
  });

  it("consulta e operador não salvam marcos; gestor e admin salvam", async () => {
    for (const u of [finConsulta, finOperador]) await expect(salvarMarcos(u, [marco(2)])).rejects.toThrow(/Somente gestor do Financeiro/);
    expect(await ativos()).toEqual([1, 5, 10]);
  });
});

describe("rec_salvar_regua: validação dos marcos", () => {
  it("recusa dias repetidos, fora da faixa e quebrados", async () => {
    await expect(salvarMarcos(finGestor, [marco(3), marco(3)])).rejects.toThrow(/Dois marcos com 3 dias/);
    await expect(salvarMarcos(finGestor, [marco(1), marco(1)])).rejects.toThrow(/Dois marcos com 1 dia de atraso/);
    await expect(salvarMarcos(finGestor, [marco(0)])).rejects.toThrow(/entre 1 e 365/);
    await expect(salvarMarcos(finGestor, [marco(366)])).rejects.toThrow(/entre 1 e 365/);
    await expect(salvarMarcos(finGestor, [{ ...marco(2), dias: 2.5 }])).rejects.toThrow(/entre 1 e 365/);
  });

  it("recusa mais de 6 marcos e lista que não é lista", async () => {
    await expect(salvarMarcos(finGestor, [1, 2, 3, 4, 5, 6, 7].map((d) => marco(d)))).rejects.toThrow(/No máximo 6/);
    await expect(salvarMarcos(finGestor, { dias: 2 })).rejects.toThrow(/lista de marcos é inválida/);
  });

  it("exige canal, descrição e o texto de cada canal escolhido", async () => {
    await expect(salvarMarcos(finGestor, [marco(2, { canais: [] })])).rejects.toThrow(/escolha pelo menos um canal/);
    await expect(salvarMarcos(finGestor, [marco(2, { canais: ["sms"] })])).rejects.toThrow(/canal inválido/);
    await expect(salvarMarcos(finGestor, [marco(2, { descricao: "ab" })])).rejects.toThrow(/descreva o marco/);
    await expect(salvarMarcos(finGestor, [marco(2, { texto_whatsapp: "  " })])).rejects.toThrow(/texto do WhatsApp/);
    await expect(salvarMarcos(finGestor, [marco(2, { canais: ["email"], assunto_email: "Assunto", corpo_email: "" })])).rejects.toThrow(/assunto e o texto do e-mail/);
    await expect(salvarMarcos(finGestor, [marco(2, { texto_whatsapp: "x".repeat(4001) })])).rejects.toThrow(/texto longo demais/);
  });

  it("recusa variável desconhecida; aceita todas as conhecidas e {pl:...}", async () => {
    await expect(salvarMarcos(finGestor, [marco(2, { texto_whatsapp: "Oi {nome}" })])).rejects.toThrow(/variável desconhecida \{nome\}/);
    await expect(salvarMarcos(finGestor, [marco(2, { texto_whatsapp: "Oi {pl:a|b} {x_y}" })])).rejects.toThrow(/variável desconhecida \{x_y\}/);
    const todas = Object.keys(VARIAVEIS_TEXTO_COBRANCA).map((v) => `{${v}}`).join(" ");
    await salvarMarcos(finGestor, [marco(1), marco(5), marco(10, { texto_whatsapp: `${todas} {pl:uma|várias}` })]);
    expect(await ativos()).toEqual([1, 5, 10]);
  });

  it("a validação do banco e a do código concordam", async () => {
    const casos: MarcoJson[] = [marco(2), marco(2, { texto_whatsapp: "Oi {nome}" }), marco(2, { canais: [] }), marco(2, { descricao: "ab" }), marco(2, { texto_whatsapp: "" })];
    for (const c of casos) {
      const codigo = validarMarcos([{ dias: c.dias, canais: c.canais as ("email" | "whatsapp")[], descricao: c.descricao, textoWhatsapp: c.texto_whatsapp ?? null, assuntoEmail: c.assunto_email ?? null, corpoEmail: c.corpo_email ?? null }]);
      let banco: string | null = null;
      try { await salvarMarcos(finGestor, [c]); } catch (e) { banco = (e as Error).message; }
      expect(banco === null, JSON.stringify(c)).toBe(codigo === null);
    }
    await salvarMarcos(admin, MARCOS_PADRAO.map((m) => ({ dias: m.dias, canais: m.canais, descricao: m.descricao, texto_whatsapp: m.textoWhatsapp, assunto_email: m.assuntoEmail, corpo_email: m.corpoEmail })));
  });

  it("é atômica: marco inválido no fim não grava os anteriores nem muda os parâmetros", async () => {
    await expect(como(db, finGestor, () => q(`select rec_salvar_regua($1::jsonb, $2::jsonb)`, [JSON.stringify({ "financeiro.recebiveis.janela_confirmacao_dias": 11 }), JSON.stringify([marco(2), marco(2)])]))).rejects.toThrow(/Dois marcos/);
    expect(await ativos()).toEqual([1, 5, 10]);
    expect((await q(`select valor from configuracoes where chave = 'financeiro.recebiveis.janela_confirmacao_dias'`)).rows[0].valor).toBe(7);
  });
});

describe("rec_salvar_regua: gravação dos marcos", () => {
  it("troca a lista, mantém o histórico inativo e registra quem alterou", async () => {
    await salvarMarcos(finGestor, [marco(2), marco(7, { canais: ["email", "whatsapp"], assunto_email: "Assunto {cliente}", corpo_email: "{saudacao}\n\n{parcelas}\n\nAtenciosamente," })]);
    expect(await ativos()).toEqual([2, 7]);
    const todos = (await q(`select dia_relativo, ativo from rec_regua_marcos where acao = 'cobranca' order by 1`)).rows;
    expect(todos.map((r) => `${r.dia_relativo}:${r.ativo}`)).toEqual(["1:false", "2:true", "5:false", "7:true", "10:false"]);
    const u = (await q(`select atualizado_por from rec_regua_marcos where dia_relativo = 7`)).rows[0];
    expect(u.atualizado_por).toBe(finGestor);
    // volta ao padrão: os dias 1, 5 e 10 reativam, os textos são os enviados
    await salvarMarcos(finGestor, MARCOS_PADRAO.map((m) => ({ dias: m.dias, canais: m.canais, descricao: m.descricao, texto_whatsapp: m.textoWhatsapp, assunto_email: m.assuntoEmail, corpo_email: m.corpoEmail })));
    expect(await ativos()).toEqual([1, 5, 10]);
  });

  it("texto de canal não escolhido não é guardado", async () => {
    await salvarMarcos(finGestor, [marco(3, { canais: ["whatsapp"], assunto_email: "sobra", corpo_email: "sobra" })]);
    const r = (await q(`select assunto_email, corpo_email from rec_regua_marcos where dia_relativo = 3`)).rows[0];
    expect(r.assunto_email).toBeNull();
    expect(r.corpo_email).toBeNull();
    await salvarMarcos(finGestor, MARCOS_PADRAO.map((m) => ({ dias: m.dias, canais: m.canais, descricao: m.descricao, texto_whatsapp: m.textoWhatsapp, assunto_email: m.assuntoEmail, corpo_email: m.corpoEmail })));
  });

  it("lista vazia desliga a régua (nenhum marco ativo)", async () => {
    await salvarMarcos(finGestor, []);
    expect(await ativos()).toEqual([]);
    await salvarMarcos(finGestor, MARCOS_PADRAO.map((m) => ({ dias: m.dias, canais: m.canais, descricao: m.descricao, texto_whatsapp: m.textoWhatsapp, assunto_email: m.assuntoEmail, corpo_email: m.corpoEmail })));
  });

  it("auditoria: a mudança de um marco fica registrada com o usuário", async () => {
    await salvarMarcos(finGestor, [marco(1, { descricao: "Primeiro lembrete" }), marco(5), marco(10)]);
    const r = (await q(`select usuario_id, antes->>'descricao' as antes, depois->>'descricao' as depois from auditoria where tabela = 'rec_regua_marcos' and depois->>'dia_relativo' = '1' order by id desc limit 1`)).rows[0];
    expect(r.usuario_id).toBe(finGestor);
    expect(r.depois).toBe("Primeiro lembrete");
    await salvarMarcos(finGestor, MARCOS_PADRAO.map((m) => ({ dias: m.dias, canais: m.canais, descricao: m.descricao, texto_whatsapp: m.textoWhatsapp, assunto_email: m.assuntoEmail, corpo_email: m.corpoEmail })));
  });
});

describe("pendências ao remover ou trocar um marco", () => {
  it("cancela as abertas do marco que saiu e deixa as dos marcos que ficaram", async () => {
    const c = await cliente();
    await abrirPendencia(c.id, 1);
    await abrirPendencia(c.id, 5);
    await abrirPendencia(c.id, 10);
    await q(`update pendencias set status = 'concluida' where referencia_id = $1 and titulo like 'Cobrar D+10:%'`, [c.id]); // já feita: não mexe
    const r = await salvarMarcos(finGestor, [marco(1), marco(10)]); // sai o D+5
    expect(r.rows[0].r).toEqual({ pendencias_canceladas: 1 });
    const porMarco = Object.fromEntries((await pendencias(c.id)).map((p) => [String(p.titulo).split(":")[0], p.status]));
    expect(porMarco).toEqual({ "Cobrar D+1": "aberta", "Cobrar D+10": "concluida", "Cobrar D+5": "cancelada" });
    await salvarMarcos(finGestor, MARCOS_PADRAO.map((m) => ({ dias: m.dias, canais: m.canais, descricao: m.descricao, texto_whatsapp: m.textoWhatsapp, assunto_email: m.assuntoEmail, corpo_email: m.corpoEmail })));
  });

  it("trocar os dias (D+5 vira D+6) cancela as do D+5", async () => {
    const c = await cliente();
    await abrirPendencia(c.id, 5);
    const r = await salvarMarcos(finGestor, [marco(1), marco(6), marco(10)]);
    expect(r.rows[0].r.pendencias_canceladas).toBeGreaterThanOrEqual(1);
    expect((await pendencias(c.id))[0].status).toBe("cancelada");
    await salvarMarcos(finGestor, MARCOS_PADRAO.map((m) => ({ dias: m.dias, canais: m.canais, descricao: m.descricao, texto_whatsapp: m.textoWhatsapp, assunto_email: m.assuntoEmail, corpo_email: m.corpoEmail })));
  });
});

describe("rec_registrar_cobranca com marcos editáveis", () => {
  const registrar = (usuario: string, ids: string[], dias: number) =>
    como(db, usuario, () => q(`select rec_registrar_cobranca($1::uuid[], $2, 'enviada', 'whatsapp'::canal, null, null) as r`, [ids, dias]));

  it("aceita um marco novo e conclui a pendência dele", async () => {
    await salvarMarcos(finGestor, [marco(1), marco(3), marco(10)]);
    const c = await cliente();
    await abrirPendencia(c.id, 3);
    const r = await registrar(finOperador, [c.titulo], 3);
    expect(r.rows[0].r).toEqual({ parcelas: 1, pendencias_concluidas: 1 });
    const i = (await q(`select descricao from interacoes where referencia_id = $1`, [c.titulo])).rows[0];
    expect(i.descricao).toBe("Cobrança D+3 enviada por WhatsApp.");
  });

  it("recusa um marco que não existe na régua", async () => {
    const c = await cliente();
    await expect(registrar(finOperador, [c.titulo], 5)).rejects.toThrow(/Marco da régua inválido/); // o D+5 saiu no teste anterior
    await expect(registrar(finOperador, [c.titulo], 99)).rejects.toThrow(/Marco da régua inválido/);
    await salvarMarcos(finGestor, MARCOS_PADRAO.map((m) => ({ dias: m.dias, canais: m.canais, descricao: m.descricao, texto_whatsapp: m.textoWhatsapp, assunto_email: m.assuntoEmail, corpo_email: m.corpoEmail })));
    await expect(registrar(finOperador, [c.titulo], 5)).resolves.toBeDefined();
  });
});

describe("variáveis", () => {
  it("rec_variaveis_invalidas: lista só o que não é conhecido", async () => {
    const r = await q(`select rec_variaveis_invalidas($1) as v`, ["{saudacao} {nome} {pl:a|b} {x} {marco_dias} {nome}"]);
    expect([...(r.rows[0].v as string[])].sort()).toEqual(["{nome}", "{x}"]);
    expect((await q(`select rec_variaveis_invalidas(null) as v`)).rows[0].v).toEqual([]);
  });
});
