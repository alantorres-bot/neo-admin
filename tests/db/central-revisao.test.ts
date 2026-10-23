// Central de Gestão, Fase 8 (migration 0099): correções da revisão de segurança. Cada teste reproduz o caminho que
// antes passava e agora é barrado (ou o dado que antes se perdia e agora fica).
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, finGestor: string, finOperador: string, fiscalGestor: string, admConsulta: string, admOperador: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";
const nova = async (dados: Record<string, unknown> = {}) =>
  (await q(`insert into pendencias (modulo, titulo, responsavel_id, criticidade) values ($1, $2, $3, 'normal') returning id`,
    [dados.modulo ?? MOD, dados.titulo ?? "Pendência", dados.responsavel_id ?? null])).rows[0].id as string;
const acao = (quem: string, id: string, nome: string, dados: object = {}) =>
  como(db, quem, () => q(`select pendencia_acao($1, $2, $3)`, [id, nome, JSON.stringify(dados)]));

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  finGestor = await novoUsuario(db, "fin.gestor@neo.com", { financeiro: "gestor" });
  finOperador = await novoUsuario(db, "fin.operador@neo.com", { financeiro: "operador" });
  fiscalGestor = await novoUsuario(db, "fiscal.gestor@neo.com", { fiscal: "gestor" });
  admConsulta = await novoUsuario(db, "adm.consulta@neo.com", { administrativo: "consulta" });
  admOperador = await novoUsuario(db, "adm.operador@neo.com", { administrativo: "operador" });
});

describe("troca de módulo", () => {
  it("responsável gestor de outra área não leva a pendência para o módulo dele", async () => {
    // estado possível: rotina de serviço atribuiu a quem não tem a área (ex.: líder no ponto)
    const id = await nova({ responsavel_id: fiscalGestor });
    await expect(como(db, fiscalGestor, () => q(`update pendencias set modulo = 'fiscal.creditos', status = 'cancelada' where id = $1`, [id])))
      .rejects.toThrow(/gestor nos dois módulos/);
    expect((await q(`select modulo, status from pendencias where id = $1`, [id])).rows[0]).toEqual({ modulo: MOD, status: "aberta" });
  });

  it("ClickUp: a permissão é a do módulo atual", async () => {
    const id = await nova({ responsavel_id: fiscalGestor });
    await expect(como(db, fiscalGestor, () => q(`update pendencias set modulo = 'fiscal.creditos', clickup_enviar = true where id = $1`, [id])))
      .rejects.toThrow(/gestor/);
  });
});

describe("inclusão por usuário", () => {
  it("chave de origem forjada é descartada e a publicação do módulo continua funcionando", async () => {
    const id = (await como(db, finOperador, () =>
      q(`insert into pendencias (modulo, titulo, origem, chave_origem) values ($1, 'Forjada', 'manual', 'teste:alvo') returning id`, [MOD]))).rows[0].id;
    expect((await q(`select chave_origem from pendencias where id = $1`, [id])).rows[0].chave_origem).toBeNull();
    const publicada = (await q(`select publicar_pendencia($1) id`, [JSON.stringify({ modulo: MOD, chave_origem: "teste:alvo", titulo: "Do módulo" })])).rows[0].id;
    expect(publicada).not.toBe(id);
  });

  it("operador não marca ClickUp nem põe a pendência em outra área", async () => {
    await como(db, finOperador, async () => {
      await expect(q(`insert into pendencias (modulo, titulo, clickup_enviar) values ($1, 'x', true)`, [MOD])).rejects.toThrow(/ClickUp/);
      await expect(q(`insert into pendencias (modulo, titulo, modulo_exibicao) values ($1, 'x', 'rh.folha')`, [MOD])).rejects.toThrow(/onde a pendência aparece/);
    });
    const id = await nova({ responsavel_id: finOperador });
    await expect(como(db, finOperador, () => q(`update pendencias set modulo_exibicao = 'rh.folha' where id = $1`, [id])))
      .rejects.toThrow(/onde a pendência aparece/);
  });

  it("a régua de cobrança continua aparecendo em Cobrança (mesma área)", async () => {
    const id = (await como(db, finOperador, () =>
      q(`insert into pendencias (modulo, titulo) values ($1, 'Cobrar D+5: Cliente X') returning id`, [MOD]))).rows[0].id;
    expect((await q(`select modulo_exibicao from pendencias where id = $1`, [id])).rows[0].modulo_exibicao).toBe("financeiro.cobranca");
  });
});

describe("responsável precisa ter a área", () => {
  it("gestor não atribui pendência do Financeiro a quem não tem o Financeiro, nem por chamada direta", async () => {
    const id = await nova();
    await expect(acao(finGestor, id, "atribuir", { responsavel_id: admOperador })).rejects.toThrow(/não tem acesso à área/);
    await expect(como(db, finGestor, () => q(`select pendencia_criar($1)`, [JSON.stringify({ modulo: MOD, titulo: "Para fora", responsavel_id: fiscalGestor })])))
      .rejects.toThrow(/não tem acesso à área/);
    await acao(finGestor, id, "atribuir", { responsavel_id: finOperador });
    expect((await q(`select responsavel_id from pendencias where id = $1`, [id])).rows[0].responsavel_id).toBe(finOperador);
  });

  it("Tarefas gerais continuam para qualquer pessoa ativa", async () => {
    const t = await como(db, admin, async () =>
      (await q(`select pendencia_criar($1) id`, [JSON.stringify({ modulo: "administrativo.gestao", titulo: "Geral", responsavel_id: fiscalGestor })])).rows[0].id);
    expect((await q(`select responsavel_id from pendencias where id = $1`, [t])).rows[0].responsavel_id).toBe(fiscalGestor);
  });
});

describe("sugestões", () => {
  let sugestao: string;

  it("'Avaliar sugestão' não copia o texto e só os avaliadores tratam a pendência", async () => {
    sugestao = (await como(db, finOperador, () =>
      q(`insert into sugestoes (titulo, area, melhoria) values ('Ideia', 'financeiro', 'Texto reservado') returning id`))).rows[0].id;
    const p = (await q(`select id, descricao, chave_origem from pendencias where referencia_id = $1`, [sugestao])).rows[0];
    expect(p).toMatchObject({ descricao: null, chave_origem: `sugestao:${sugestao}` });
    const visto = (await como(db, admConsulta, () => q(`select descricao from pendencias where id = $1`, [p.id]))).rows;
    expect(visto.every((r) => r.descricao === null)).toBe(true);
    await expect(acao(admOperador, p.id, "concluir")).rejects.toThrow(/avaliadores/);
  });

  it("o autor não forja quem avaliou", async () => {
    await como(db, finOperador, () => q(`update sugestoes set avaliada_por = $1, avaliada_em = now() where id = $2`, [admin, sugestao]));
    expect((await q(`select avaliada_por, avaliada_em from sugestoes where id = $1`, [sugestao])).rows[0]).toEqual({ avaliada_por: null, avaliada_em: null });
    await como(db, admin, () => q(`update sugestoes set status = 'em_avaliacao' where id = $1`, [sugestao]));
    expect((await q(`select avaliada_por from sugestoes where id = $1`, [sugestao])).rows[0].avaliada_por).toBeNull();
  });
});

describe("publicação e avisos", () => {
  it("publicar de novo mantém o impacto e a categoria registrados pelo gestor", async () => {
    const pub = (t: string) => q(`select publicar_pendencia($1) id`, [JSON.stringify({ modulo: MOD, chave_origem: "teste:impacto", titulo: t })]);
    const id = (await pub("Versão 1")).rows[0].id;
    await acao(finGestor, id, "alterar", { impacto: "financeiro", impacto_fundamento: "Multa contratual de 2%", categoria: "cobranca" });
    await pub("Versão 2");
    expect((await q(`select titulo, impacto, impacto_fundamento, categoria from pendencias where id = $1`, [id])).rows[0])
      .toEqual({ titulo: "Versão 2", impacto: "financeiro", impacto_fundamento: "Multa contratual de 2%", categoria: "cobranca" });
  });

  it("pedido de decisão do RH vai ao canal sem título nem motivo", async () => {
    const rh = await novoUsuario(db, "rh.operador@neo.com", { rh: "operador" });
    await q(`update configuracoes set valor = '{"aguarda_gestor": true}' where chave = 'administrativo.gestao.notificacoes_eventos'`);
    const id = await nova({ modulo: "rh.folha", titulo: "Rescisão de Fulano", responsavel_id: rh });
    await acao(rh, id, "pedir_decisao", { texto: "Pagar aviso indenizado?" });
    const t = (await q(`select texto from notificacoes where pendencia_id = $1`, [id])).rows[0].texto as string;
    expect(t).toBe("Pedido de decisão numa pendência de RH/SST (detalhes no Neo Admin).");
  });

  it("a reserva do envio não entrega o mesmo aviso a dois envios simultâneos", async () => {
    for (let i = 0; i < 3; i++) {
      await q(`insert into notificacoes (evento, chave, texto) values ('resumo_diario', $1, 'x')`, [`reserva:${i}`]);
    }
    const a = (await q(`select id from central_reservar_avisos(2)`)).rows.map((r) => r.id);
    const b = (await q(`select id from central_reservar_avisos(50)`)).rows.map((r) => r.id);
    expect(a).toHaveLength(2);
    expect(b.filter((x) => a.includes(x))).toEqual([]);
    expect((await q(`select count(*)::int n from notificacoes where status = 'enviando'`)).rows[0].n).toBe(a.length + b.length);
    await como(db, admin, async () => {
      await expect(q(`select central_reservar_avisos(1)`)).rejects.toThrow(/permission denied/);
    });
  });
});
