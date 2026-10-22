// Central de Gestão, Fase 3 (migration 0093): criar tarefa, ações sobre a pendência, comentários e histórico.
// As permissões valem no banco: aqui se chama a API (funções) diretamente, como faria alguém contornando a tela.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let rodrigo: string, finGestor: string, finOperador: string, finOperador2: string, finConsulta: string, fiscalOperador: string, inativo: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";
const hojeMais = (dias: number) => `(now() at time zone 'America/Cuiaba')::date + ${dias}`;

const criar = (quem: string, dados: object) =>
  como(db, quem, async () => (await q(`select pendencia_criar($1) as id`, [JSON.stringify(dados)])).rows[0].id as string);
const acao = (quem: string, id: string, nome: string, dados: object = {}) =>
  como(db, quem, () => q(`select pendencia_acao($1, $2, $3)`, [id, nome, JSON.stringify(dados)]));
const linha = async (id: string) => (await q(`select * from pendencias where id = $1`, [id])).rows[0];
const historico = (quem: string, id: string) => como(db, quem, async () => (await q(`select * from pendencia_historico($1)`, [id])).rows);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");   // o primeiro usuário vira admin_geral (migration 0003)
  rodrigo = await novoUsuario(db, "rodrigo@neo.com", { financeiro: "gestor", fiscal: "gestor", administrativo: "gestor", rh: "gestor" });
  finGestor = await novoUsuario(db, "fin.gestor@neo.com", { financeiro: "gestor" });
  finOperador = await novoUsuario(db, "fin.operador@neo.com", { financeiro: "operador" });
  finOperador2 = await novoUsuario(db, "fin.operador2@neo.com", { financeiro: "operador" });
  finConsulta = await novoUsuario(db, "fin.consulta@neo.com", { financeiro: "consulta" });
  fiscalOperador = await novoUsuario(db, "fiscal.operador@neo.com", { fiscal: "operador" });
  inativo = await novoUsuario(db, "inativo@neo.com", { financeiro: "operador" }, { ativo: false });
});

describe("criar tarefa manual", () => {
  it("operador cria para si; o banco grava origem, autor, link e a observação como comentário", async () => {
    const id = await criar(finOperador, { modulo: MOD, titulo: "  Conferir extrato  ", responsavel_id: finOperador, prioridade: "alta", observacoes: "Banco do Brasil" });
    const p = await linha(id);
    expect(p).toMatchObject({ titulo: "Conferir extrato", origem: "manual", criado_por: finOperador, responsavel_id: finOperador, criticidade: "alta", link: `/gestao/${id}` });
    const c = (await q(`select tipo, descricao, usuario_id from interacoes where referencia_tabela = 'pendencias' and referencia_id = $1`, [id])).rows;
    expect(c).toEqual([{ tipo: "observacao", descricao: "Banco do Brasil", usuario_id: finOperador }]);
  });

  it("operador não atribui a terceiros nem pela API; gestor sim", async () => {
    await expect(criar(finOperador, { modulo: MOD, titulo: "Para outro", responsavel_id: finOperador2 })).rejects.toThrow(/gestor da área atribui/);
    const id = await criar(finGestor, { modulo: MOD, titulo: "Distribuída", responsavel_id: finOperador2 });
    expect((await linha(id)).responsavel_id).toBe(finOperador2);
  });

  it("validações: título, módulo, área, responsável ativo e prazo", async () => {
    await expect(criar(finOperador, { modulo: MOD, titulo: "   " })).rejects.toThrow(/Informe o título/);
    await expect(criar(finOperador, { modulo: MOD, titulo: "x".repeat(201) })).rejects.toThrow(/até 200 caracteres/);
    await expect(criar(finOperador, { modulo: "nao.existe", titulo: "x" })).rejects.toThrow(/Escolha o módulo/);
    await expect(criar(finConsulta, { modulo: MOD, titulo: "x" })).rejects.toThrow(/não pode criar tarefas neste módulo/);
    await expect(criar(finOperador, { modulo: "fiscal.creditos", titulo: "x" })).rejects.toThrow(/não pode criar tarefas neste módulo/);
    await expect(criar(finGestor, { modulo: MOD, titulo: "x", responsavel_id: inativo })).rejects.toThrow(/inativo/);
    const ontem = (await q(`select (${hojeMais(-1)})::text d`)).rows[0].d;
    await expect(criar(finOperador, { modulo: MOD, titulo: "x", prazo: ontem })).rejects.toThrow(/anterior a hoje/);
  });

  it("título vazio em tarefa manual é barrado também por inserção direta", async () => {
    await expect(q(`insert into pendencias (modulo, titulo, origem) values ($1, ' ', 'manual')`, [MOD])).rejects.toThrow(/ck_pendencias_manual_titulo/);
  });

  it("'Tarefas gerais' atribuída a alguém de outra área: ele vê, inicia, bloqueia, comenta e conclui", async () => {
    const id = await criar(rodrigo, { modulo: "administrativo.gestao", titulo: "Levantar contratos", responsavel_id: fiscalOperador });
    await acao(fiscalOperador, id, "iniciar");
    expect((await linha(id)).status).toBe("em_andamento");
    await acao(fiscalOperador, id, "bloquear", { texto: "Aguardando cópia do jurídico" });
    expect((await linha(id)).bloqueada_por).toBe(fiscalOperador);
    await acao(fiscalOperador, id, "comentar", { texto: "Pedi por e-mail hoje" });
    await acao(fiscalOperador, id, "desbloquear");
    await acao(fiscalOperador, id, "concluir", { texto: "Planilha enviada" });
    const p = await linha(id);
    expect(p).toMatchObject({ status: "concluida", concluido_por: fiscalOperador, bloqueio_motivo: null });
    // mas não muda os dados nem passa adiante
    const outra = await criar(rodrigo, { modulo: "administrativo.gestao", titulo: "Outra", responsavel_id: fiscalOperador });
    await expect(acao(fiscalOperador, outra, "alterar", { prioridade: "critica" })).rejects.toThrow(/gestor da área altera/);
    await expect(acao(fiscalOperador, outra, "atribuir", { responsavel_id: finOperador })).rejects.toThrow(/permissão|reatribui/);
  });
});

describe("ações", () => {
  it("situação: iniciar, pausar, concluir; reabrir só o gestor", async () => {
    const id = await criar(finOperador, { modulo: MOD, titulo: "Fluxo", responsavel_id: finOperador });
    await acao(finOperador, id, "iniciar");
    await expect(acao(finOperador, id, "iniciar")).rejects.toThrow(/já está em andamento/);
    await acao(finOperador, id, "pausar");
    await acao(finOperador, id, "concluir");
    await expect(acao(finOperador, id, "iniciar")).rejects.toThrow(/reabra antes/);
    await expect(acao(finOperador, id, "reabrir")).rejects.toThrow(/reaberta pelo gestor/);
    await acao(finGestor, id, "reabrir", { texto: "Faltou o comprovante" });
    expect((await linha(id)).status).toBe("aberta");
  });

  it("cancelar tarefa manual exige motivo e é do gestor ou de quem criou", async () => {
    const id = await criar(finGestor, { modulo: MOD, titulo: "Cancelável", responsavel_id: finOperador });
    await expect(acao(finOperador, id, "cancelar", { texto: "Não preciso" })).rejects.toThrow(/quem criou cancela/);
    await expect(acao(finGestor, id, "cancelar")).rejects.toThrow(/motivo do cancelamento/);
    await acao(finGestor, id, "cancelar", { texto: "Duplicada" });
    expect((await linha(id)).status).toBe("cancelada");
    const c = (await q(`select tipo, descricao from interacoes where referencia_id = $1`, [id])).rows;
    expect(c).toContainEqual({ tipo: "cancelamento", descricao: "Duplicada" });
  });

  it("assumir pendência sem dono; atribuir só o gestor; responsável inativo é recusado", async () => {
    const id = await criar(finGestor, { modulo: MOD, titulo: "Sem dono" });
    await acao(finOperador, id, "assumir");
    expect((await linha(id)).responsavel_id).toBe(finOperador);
    await expect(acao(finOperador2, id, "assumir")).rejects.toThrow(/já tem responsável/);
    await expect(acao(finOperador, id, "atribuir", { responsavel_id: finOperador2 })).rejects.toThrow(/reatribui/);
    await expect(acao(finGestor, id, "atribuir", { responsavel_id: inativo })).rejects.toThrow(/inativo/);
    await acao(finGestor, id, "atribuir", { responsavel_id: finOperador2, texto: "Você conhece o cliente" });
    expect((await linha(id)).responsavel_id).toBe(finOperador2);
  });

  it("outro operador não bloqueia nem conclui a pendência alheia; consulta não comenta", async () => {
    const id = await criar(finGestor, { modulo: MOD, titulo: "Alheia", responsavel_id: finOperador });
    await expect(acao(finOperador2, id, "bloquear", { texto: "x" })).rejects.toThrow(/permissão|responsável ou o gestor/);
    await expect(acao(finOperador2, id, "concluir")).rejects.toThrow(/permissão/);
    await expect(acao(finConsulta, id, "comentar", { texto: "oi" })).rejects.toThrow(/Somente quem atua na área/);
    await expect(acao(fiscalOperador, id, "comentar", { texto: "oi" })).rejects.toThrow(/não encontrada/);
  });

  it("bloqueio com dependência: só pendência visível, aberta e diferente dela mesma", async () => {
    const a = await criar(finOperador, { modulo: MOD, titulo: "A", responsavel_id: finOperador });
    const b = await criar(finOperador, { modulo: MOD, titulo: "B", responsavel_id: finOperador });
    const fiscal = (await q(`insert into pendencias (modulo, titulo) values ('fiscal.creditos', 'F') returning id`)).rows[0].id;
    await expect(acao(finOperador, a, "bloquear", { texto: "x", dependencia_id: a })).rejects.toThrow(/dependência/);
    await expect(acao(finOperador, a, "bloquear", { texto: "x", dependencia_id: fiscal })).rejects.toThrow(/dependência/);
    await expect(acao(finOperador, a, "bloquear", {})).rejects.toThrow(/motivo do bloqueio/);
    await acao(finOperador, a, "bloquear", { texto: "Depende de B", dependencia_id: b });
    expect((await linha(a)).bloqueio_dependencia_id).toBe(b);
    const destaqueB = (await como(db, finGestor, () => q(`select motivos from central_pendencias('gestao', $1)`, [JSON.stringify({ id: b })]))).rows[0].motivos;
    expect(destaqueB.map((m: Linha) => m.codigo)).toContain("IMPEDE_OUTRA");
  });

  it("pedido de decisão: responsável pede; só o gestor responde, com a resposta registrada", async () => {
    const id = await criar(finOperador, { modulo: MOD, titulo: "Decidir", responsavel_id: finOperador });
    await expect(acao(finOperador, id, "pedir_decisao")).rejects.toThrow(/precisa ser decidido/);
    await acao(finOperador, id, "pedir_decisao", { texto: "Posso dar 5% de desconto?" });
    await expect(acao(finOperador, id, "responder_decisao", { texto: "Sim" })).rejects.toThrow(/gestor da área responde/);
    await expect(acao(finGestor, id, "responder_decisao")).rejects.toThrow(/resposta/);
    await acao(finGestor, id, "responder_decisao", { texto: "Pode, até 5%." });
    expect((await linha(id)).aguarda_gestor_em).toBeNull();
    const c = (await q(`select tipo, descricao, usuario_id from interacoes where referencia_id = $1`, [id])).rows;
    expect(c).toContainEqual({ tipo: "resposta_gestor", descricao: "Pode, até 5%.", usuario_id: finGestor });
  });

  it("alterar dados, ajustar destaque e cobrar andamento: só o gestor", async () => {
    const id = await criar(finOperador, { modulo: MOD, titulo: "Dados", responsavel_id: finOperador });
    await expect(acao(finOperador, id, "alterar", { prioridade: "critica" })).rejects.toThrow(/gestor da área altera/);
    await expect(acao(finOperador, id, "destacar", { nivel: "intervir", texto: "x" })).rejects.toThrow(/ajusta o destaque/);
    await expect(acao(finOperador, id, "cobrar", { texto: "E aí?" })).rejects.toThrow(/Somente o gestor/);
    await acao(finGestor, id, "alterar", { prioridade: "critica", prazo: (await q(`select (${hojeMais(2)})::text d`)).rows[0].d, precisa_distribuir: true });
    expect(await linha(id)).toMatchObject({ criticidade: "critica", precisa_distribuir: true });
    await expect(acao(finGestor, id, "destacar", { nivel: "intervir" })).rejects.toThrow(/motivo do ajuste/);
    await acao(finGestor, id, "destacar", { nivel: "intervir", texto: "Cliente estratégico" });
    await acao(finGestor, id, "cobrar", { texto: "Preciso disso até amanhã." });
    await acao(finGestor, id, "destacar", {});   // retira o ajuste
    expect((await linha(id)).destaque_manual).toBeNull();
  });

  it("ação desconhecida e pendência inexistente", async () => {
    const id = await criar(finOperador, { modulo: MOD, titulo: "X", responsavel_id: finOperador });
    await expect(acao(finOperador, id, "apagar")).rejects.toThrow(/Ação desconhecida/);
    await expect(acao(finOperador, "00000000-0000-4000-8000-000000000000", "iniciar")).rejects.toThrow(/não encontrada/);
  });
});

describe("histórico e comentários", () => {
  it("mostra criação, mudanças relevantes, quem fez e os comentários, em ordem; reescrita da sincronização fica fora", async () => {
    const id = await criar(finGestor, { modulo: MOD, titulo: "Histórico", responsavel_id: finOperador, observacoes: "Começar pelo banco" });
    await acao(finOperador, id, "iniciar");
    await acao(finOperador, id, "bloquear", { texto: "Sem extrato" });
    await acao(finGestor, id, "atribuir", { responsavel_id: finOperador2 });
    await q(`update pendencias set descricao = 'reescrita pela sincronização' where id = $1`, [id]);   // serviço
    await acao(finGestor, id, "cobrar", { texto: "Prioridade hoje" });
    const h = await historico(finGestor, id);
    const resumo = h.map((e) => [e.evento, e.quem, e.de, e.para]);
    expect(resumo).toEqual([
      ["comentario:observacao", "fin.gestor", null, "Começar pelo banco"],
      ["criada", "fin.gestor", null, "Histórico"],
      ["status", "fin.operador", "aberta", "em_andamento"],
      ["bloqueio_motivo", "fin.operador", null, "Sem extrato"],
      ["responsavel_id", "fin.gestor", "fin.operador", "fin.operador2"],
      ["comentario:cobranca_gestor", "fin.gestor", null, "Prioridade hoje"],
    ]);
  });

  it("quem não vê a pendência não lê o histórico nem comenta", async () => {
    const id = await criar(finOperador, { modulo: MOD, titulo: "Privada", responsavel_id: finOperador });
    await expect(historico(fiscalOperador, id)).rejects.toThrow(/não encontrada/);
    await expect(como(db, fiscalOperador, () => q(`select pendencia_comentar($1, 'oi')`, [id]))).rejects.toThrow(/não encontrada/);
    await expect(como(db, "anon", () => q(`select * from pendencia_historico($1)`, [id]))).rejects.toThrow(/permission denied/);
  });

  it("comentário conta como movimentação e não pode ser apagado", async () => {
    const id = await criar(finOperador, { modulo: MOD, titulo: "Mov", responsavel_id: finOperador });
    await q(`alter table pendencias disable trigger trg_pendencias_regras`);
    await q(`update pendencias set movimentado_em = now() - interval '10 days' where id = $1`, [id]);
    await q(`alter table pendencias enable trigger trg_pendencias_regras`);
    await acao(finOperador, id, "comentar", { texto: "Andando" });
    const m = new Date((await linha(id)).movimentado_em);
    expect(Date.now() - m.getTime()).toBeLessThan(60_000);
    await expect(q(`delete from interacoes where referencia_id = $1`, [id])).rejects.toThrow(/não podem ser excluídos/);
  });
});
