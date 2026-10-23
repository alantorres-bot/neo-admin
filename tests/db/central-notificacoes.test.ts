// Central de Gestão, Fase 7 (migration 0098): fila de avisos (Slack) e marcação para o ClickUp. Nada é enviado aqui:
// os testes só conferem o que entra na fila, as travas e as permissões.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, gestor: string, karina: string, outro: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";
const hoje = `(now() at time zone 'America/Cuiaba')::date`;
const ligar = (eventos: Record<string, boolean>) =>
  q(`update configuracoes set valor = $1 where chave = 'administrativo.gestao.notificacoes_eventos'`, [JSON.stringify(eventos)]);
const fila = async (filtro = "true", p: unknown[] = []) =>
  (await q(`select evento, destinatario_id, pendencia_id, texto, status from notificacoes where ${filtro} order by id`, p)).rows;
const criar = (quem: string, dados: object) =>
  como(db, quem, async () => (await q(`select pendencia_criar($1) as id`, [JSON.stringify(dados)])).rows[0].id as string);
const acao = (quem: string, id: string, nome: string, dados: object = {}) =>
  como(db, quem, () => q(`select pendencia_acao($1, $2, $3)`, [id, nome, JSON.stringify(dados)]));

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  gestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor", administrativo: "gestor" });
  karina = await novoUsuario(db, "karina@neo.com", { financeiro: "operador" });
  outro = await novoUsuario(db, "outro@neo.com", { financeiro: "operador" });
});

describe("travas", () => {
  it("tudo começa desligado: nada entra na fila nem é enviado", async () => {
    const cfg = Object.fromEntries((await q(`select chave, valor from configuracoes where chave like 'administrativo.gestao.notific%'`)).rows.map((r) => [r.chave, r.valor]));
    expect(cfg["administrativo.gestao.notificacoes_ligadas"]).toBe(false);
    expect(Object.values(cfg["administrativo.gestao.notificacoes_eventos"]).every((v) => v === false)).toBe(true);
    await criar(gestor, { modulo: MOD, titulo: "Sem aviso", responsavel_id: karina });
    expect(await fila()).toEqual([]);
    expect((await q(`select central_notificacoes_ligadas() l`)).rows[0].l).toBe(false);
  });

  it("só o admin configura; valores validados", async () => {
    await expect(como(db, gestor, () => q(`select central_salvar_notificacoes('{"ligadas": true}')`))).rejects.toThrow(/administrador geral/);
    await como(db, admin, async () => {
      await expect(q(`select central_salvar_notificacoes('{"canal": "geral"}')`)).rejects.toThrow(/canal do Slack inválido/);
      await expect(q(`select central_salvar_notificacoes('{"horario": "25:00"}')`)).rejects.toThrow(/Horário inválido/);
      await expect(q(`select central_salvar_notificacoes('{"clickup_lista": "abc"}')`)).rejects.toThrow(/ClickUp inválido/);
      await q(`select central_salvar_notificacoes('{"canal": "C0123ABCD", "horario": "07:45", "eventos": {"atraso": true}}')`);
    });
    const v = Object.fromEntries((await q(`select chave, valor from configuracoes where chave in ('administrativo.gestao.slack_canal_gestao', 'administrativo.gestao.resumo_horario', 'administrativo.gestao.notificacoes_eventos')`)).rows.map((r) => [r.chave, r.valor]));
    expect(v["administrativo.gestao.slack_canal_gestao"]).toBe("C0123ABCD");
    expect(v["administrativo.gestao.resumo_horario"]).toBe("07:45");
    expect(v["administrativo.gestao.notificacoes_eventos"]).toMatchObject({ atraso: true, atribuicao: false });
  });

  it("ID do Slack da pessoa: só o admin preenche, no formato do Slack", async () => {
    await como(db, karina, async () => {
      expect((await q(`update perfis set slack_usuario_id = 'U0123ABCD' where id = $1`, [karina])).affectedRows).toBe(0);
    });
    await expect(q(`update perfis set slack_usuario_id = 'karina' where id = $1`, [karina])).rejects.toThrow(/check constraint/);
    await como(db, admin, () => q(`update perfis set slack_usuario_id = 'U0123ABCD' where id = $1`, [karina]));
  });
});

describe("eventos", () => {
  it("atribuição: quem recebe de outra pessoa é avisado; quem assume para si, não", async () => {
    await ligar({ atribuicao: true });
    const id = await criar(gestor, { modulo: MOD, titulo: "Conferir extrato", responsavel_id: karina });
    expect(await fila("pendencia_id = $1", [id])).toMatchObject([{ evento: "atribuicao", destinatario_id: karina, texto: 'Você recebeu a pendência "Conferir extrato".' }]);
    const semDono = await criar(gestor, { modulo: MOD, titulo: "Sem dono" });
    await acao(outro, semDono, "assumir");
    expect(await fila("pendencia_id = $1", [semDono])).toEqual([]);
  });

  it("pedido de decisão avisa o canal da gestão, uma vez por pedido", async () => {
    await ligar({ aguarda_gestor: true });
    const id = await criar(gestor, { modulo: MOD, titulo: "Desconto", responsavel_id: karina });
    await acao(karina, id, "pedir_decisao", { texto: "Posso dar 5%?" });
    await acao(karina, id, "comentar", { texto: "Aguardo" });
    expect(await fila("pendencia_id = $1 and evento = 'aguarda_gestor'", [id])).toMatchObject([{ destinatario_id: null, texto: 'Pedido de decisão em "Desconto": Posso dar 5%?' }]);
  });

  it("cobrança do gestor: cada clique vira um aviso ao responsável", async () => {
    await ligar({ cobranca_gestor: true });
    const id = await criar(gestor, { modulo: MOD, titulo: "Relatório", responsavel_id: karina });
    await acao(gestor, id, "cobrar", { texto: "Preciso hoje" });
    await acao(gestor, id, "cobrar", { texto: "Lembrando" });
    const avisos = await fila("pendencia_id = $1 and evento = 'cobranca_gestor'", [id]);
    expect(avisos.map((a) => a.texto)).toEqual(['gestor cobrou andamento de "Relatório": Preciso hoje', 'gestor cobrou andamento de "Relatório": Lembrando']);
    expect(avisos.every((a) => a.destinatario_id === karina)).toBe(true);
  });

  it("rotina: lembrete de prazo e de atraso uma vez por prazo; o resumo, uma vez por dia", async () => {
    await ligar({ prazo_proximo: true, atraso: true, resumo_diario: true });
    await q(`update configuracoes set valor = '"00:00"' where chave = 'administrativo.gestao.resumo_horario'`);
    const amanha = (await q(`select (${hoje} + 1)::text d`)).rows[0].d;
    const id = await criar(gestor, { modulo: MOD, titulo: "Guia", responsavel_id: karina, prazo: amanha });
    const atrasada = (await q(`insert into pendencias (modulo, titulo, responsavel_id, prazo) values ($1, 'Antiga', $2, ${hoje} - 3) returning id`, [MOD, karina])).rows[0].id;
    await q(`select central_avisos_rotina()`);
    await q(`select central_avisos_rotina()`);   // de novo: nada se repete
    expect((await fila("pendencia_id = $1 and evento = 'prazo_proximo'", [id])).length).toBe(1);
    expect((await fila("pendencia_id = $1 and evento = 'atraso'", [atrasada]))).toMatchObject([{ destinatario_id: karina }]);
    const resumo = await fila("evento = 'resumo_diario'");
    expect(resumo).toHaveLength(1);
    expect(resumo[0].texto).toMatch(/^Central de Gestão — \d{2}\/\d{2}\/\d{4}\n• Exigem intervenção: \d+/);
    // prazo alterado: novo lembrete para o novo prazo
    await acao(gestor, id, "alterar", { prazo: (await q(`select (${hoje} + 2)::text d`)).rows[0].d });
    await q(`select central_avisos_rotina()`);
    expect((await fila("pendencia_id = $1 and evento = 'prazo_proximo'", [id])).length).toBe(2);
  });

  it("resumo só depois do horário configurado", async () => {
    const banco = await criarBanco();
    await banco.query(`update configuracoes set valor = '{"resumo_diario": true}' where chave = 'administrativo.gestao.notificacoes_eventos'`);
    await banco.query(`update configuracoes set valor = '"23:59"' where chave = 'administrativo.gestao.resumo_horario'`);
    await banco.query(`select central_avisos_rotina()`);
    const n = (await banco.query<Linha>(`select count(*)::int n from notificacoes where evento = 'resumo_diario'`)).rows[0].n;
    const agora = (await banco.query<Linha>(`select to_char(now() at time zone 'America/Cuiaba', 'HH24:MI') h`)).rows[0].h;
    expect(n).toBe(agora >= "23:59" ? 1 : 0);
    await banco.close();
  });
});

describe("leitura da fila e ClickUp", () => {
  it("cada pessoa vê os avisos dirigidos a ela; o admin vê todos; ninguém grava nem apaga", async () => {
    const deKarina = (await como(db, karina, () => q(`select distinct destinatario_id from notificacoes`))).rows.map((r) => r.destinatario_id);
    expect(deKarina).toEqual([karina]);
    const doAdmin = (await como(db, admin, () => q(`select count(*)::int n from notificacoes`))).rows[0].n;
    expect(doAdmin).toBeGreaterThan(deKarina.length);
    await como(db, karina, async () => {
      await expect(q(`insert into notificacoes (evento, chave, texto) values ('atraso', 'x', 'x')`)).rejects.toThrow(/permission denied/);
    });
    await expect(q(`delete from notificacoes`)).rejects.toThrow(/não podem ser excluídos/);
  });

  it("'enviar ao ClickUp': só o gestor marca; tarefa de implementação de sugestão vai marcada", async () => {
    const id = await criar(gestor, { modulo: MOD, titulo: "Para o ClickUp", responsavel_id: karina });
    await expect(como(db, karina, () => q(`update pendencias set clickup_enviar = true where id = $1`, [id]))).rejects.toThrow(/Somente o gestor/);
    await como(db, gestor, () => q(`update pendencias set clickup_enviar = true where id = $1`, [id]));
    expect((await q(`select clickup_enviar from pendencias where id = $1`, [id])).rows[0].clickup_enviar).toBe(true);

    const s = (await como(db, karina, () => q(`insert into sugestoes (titulo, area, melhoria) values ('Ideia', 'financeiro', 'Fazer X') returning id`))).rows[0].id;
    await como(db, gestor, () => q(`update sugestoes set status = 'aprovada', justificativa = 'Boa' where id = $1`, [s]));
    const tarefa = (await como(db, gestor, () => q(`select sugestao_criar_tarefa($1) t`, [s]))).rows[0].t;
    expect((await q(`select clickup_enviar from pendencias where id = $1`, [tarefa])).rows[0].clickup_enviar).toBe(true);
  });
});
