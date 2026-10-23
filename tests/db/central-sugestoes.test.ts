// Central de Gestão, Fase 5 (migration 0096): sugestões de melhoria.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, rodrigo: string, karina: string, aelso: string, gestorFin: string, semArea: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

const sugerir = (quem: string, dados: Record<string, string | null> = {}) =>
  como(db, quem, async () => (await q(
    `insert into sugestoes (titulo, area, modulo, problema, como_hoje, melhoria, resultado_esperado)
     values ($1, $2, $3, $4, $5, $6, $7) returning id, numero`,
    [dados.titulo ?? "Importar extrato automaticamente", dados.area ?? "financeiro", dados.modulo ?? "financeiro.recebiveis",
      dados.problema ?? "Digito o extrato à mão", dados.como_hoje ?? "Planilha", dados.melhoria ?? "Ler o OFX do banco", dados.resultado ?? "Menos erro"],
  )).rows[0] as { id: string; numero: number });
const mudar = (quem: string, id: string, status: string, justificativa: string | null = null) =>
  como(db, quem, () => q(`update sugestoes set status = $2, justificativa = coalesce($3, justificativa) where id = $1`, [id, status, justificativa]));
const linha = async (id: string) => (await q(`select * from sugestoes where id = $1`, [id])).rows[0];

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  rodrigo = await novoUsuario(db, "rodrigo@neo.com", { administrativo: "gestor", financeiro: "gestor" });
  karina = await novoUsuario(db, "karina@neo.com", { financeiro: "operador" });
  aelso = await novoUsuario(db, "aelso@neo.com", { fiscal: "operador" });
  gestorFin = await novoUsuario(db, "gestor.fin@neo.com", { financeiro: "gestor" });
  semArea = await novoUsuario(db, "sem.area@neo.com");
});

describe("enviar", () => {
  it("qualquer pessoa com alguma área envia; o banco grava autor, número e situação 'nova'", async () => {
    const s = await sugerir(karina);
    expect(s.numero).toBeGreaterThan(0);
    expect(await linha(s.id)).toMatchObject({ autor_id: karina, status: "nova", avaliada_por: null });
    await expect(sugerir(semArea)).rejects.toThrow(/row-level security/);
  });

  it("não deixa forjar autor nem nascer aprovada; exige título e melhoria", async () => {
    const id = await como(db, karina, async () => (await q(
      `insert into sugestoes (titulo, area, melhoria, autor_id, status, justificativa) values ('X', 'financeiro', 'Y', $1, 'aprovada', 'z') returning id`, [karina])).rows[0].id);
    expect(await linha(id)).toMatchObject({ status: "nova", justificativa: null });
    // autor informado por outra pessoa é trocado por quem está logado
    const forjada = await como(db, karina, async () => (await q(`insert into sugestoes (titulo, area, melhoria, autor_id) values ('X', 'financeiro', 'Y', $1) returning id`, [aelso])).rows[0].id);
    expect((await linha(forjada)).autor_id).toBe(karina);
    await expect(sugerir(karina, { titulo: "  " })).rejects.toThrow(/check constraint/);
    await expect(sugerir(karina, { melhoria: "" })).rejects.toThrow(/check constraint/);
  });

  it("gera a pendência 'Avaliar sugestão' na Central, que se encerra com a decisão", async () => {
    const s = await sugerir(karina, { titulo: "Atalho para baixa" });
    const pend = async () => (await q(`select status, titulo, link from pendencias where chave_origem = $1`, [`sugestao:${s.id}`])).rows[0];
    expect(await pend()).toMatchObject({ status: "aberta", titulo: `Avaliar sugestão nº ${s.numero}: Atalho para baixa`, link: `/gestao/sugestoes/${s.id}` });
    await mudar(rodrigo, s.id, "em_avaliacao");
    expect((await pend()).status).toBe("em_andamento");
    await mudar(rodrigo, s.id, "aprovada", "Reduz o tempo da baixa");
    expect((await pend()).status).toBe("concluida");
    // Rodrigo (gestor do Administrativo) vê a pendência; o gestor do Financeiro não
    const ve = async (quem: string) => (await como(db, quem, () => q(`select 1 from pendencias where chave_origem = $1`, [`sugestao:${s.id}`]))).rows.length;
    expect(await ve(rodrigo)).toBe(1);
    expect(await ve(gestorFin)).toBe(0);
  });
});

describe("visibilidade", () => {
  it("todos veem título e situação; conteúdo completo só autor e avaliadores", async () => {
    const s = await sugerir(karina, { titulo: "Visível" });
    const lista = async (quem: string) => (await como(db, quem, () => q(`select id, titulo, status, minha from sugestoes_publicas()`))).rows;
    expect((await lista(aelso)).find((x) => x.id === s.id)).toMatchObject({ titulo: "Visível", status: "nova", minha: false });
    expect((await lista(karina)).find((x) => x.id === s.id)?.minha).toBe(true);
    const completa = async (quem: string) => (await como(db, quem, () => q(`select problema from sugestoes where id = $1`, [s.id]))).rows.length;
    expect(await completa(karina)).toBe(1);
    expect(await completa(rodrigo)).toBe(1);
    expect(await completa(admin)).toBe(1);
    expect(await completa(aelso)).toBe(0);
    expect(await completa(gestorFin)).toBe(0);     // gestor de outra área não é avaliador
    await expect(como(db, semArea, () => q(`select * from sugestoes_publicas()`))).resolves.toMatchObject({ rows: [] });
  });

  it("a justificativa só aparece na lista pública depois da decisão", async () => {
    const s = await sugerir(karina);
    await mudar(rodrigo, s.id, "nao_aprovada", "Já existe no Consistem");
    const r = (await como(db, aelso, () => q(`select justificativa from sugestoes_publicas() where id = $1`, [s.id]))).rows[0];
    expect(r.justificativa).toBe("Já existe no Consistem");
  });
});

describe("avaliar", () => {
  it("só avaliador muda a situação; justificativa obrigatória para decidir; transições validadas", async () => {
    const s = await sugerir(karina);
    await expect(mudar(karina, s.id, "aprovada", "eu mesma")).rejects.toThrow(/Somente um avaliador/);
    expect((await como(db, gestorFin, () => q(`update sugestoes set status = 'aprovada', justificativa = 'x' where id = $1`, [s.id]))).affectedRows).toBe(0);
    await expect(mudar(rodrigo, s.id, "concluida")).rejects.toThrow(/não permitida/);
    await expect(mudar(rodrigo, s.id, "aprovada")).rejects.toThrow(/justificativa/);
    await mudar(rodrigo, s.id, "aprovada", "Vale a pena");
    expect(await linha(s.id)).toMatchObject({ status: "aprovada", avaliada_por: rodrigo });
    await mudar(rodrigo, s.id, "em_desenvolvimento");
    await mudar(admin, s.id, "concluida");
    expect((await linha(s.id)).avaliada_por).toBe(rodrigo);
  });

  it("autor corrige o conteúdo só enquanto 'nova'", async () => {
    const s = await sugerir(karina);
    await como(db, karina, () => q(`update sugestoes set melhoria = 'Ler o OFX e o CNAB' where id = $1`, [s.id]));
    expect((await linha(s.id)).melhoria).toBe("Ler o OFX e o CNAB");
    await mudar(rodrigo, s.id, "em_avaliacao");
    await expect(como(db, karina, () => q(`update sugestoes set melhoria = 'outra' where id = $1`, [s.id]))).rejects.toThrow(/já está em avaliação/);
  });

  it("comentários: autor e avaliadores; ninguém altera nem apaga; nada de sugestão é apagado", async () => {
    const s = await sugerir(karina);
    await como(db, karina, () => q(`insert into sugestoes_comentarios (sugestao_id, texto) values ($1, 'Mais um detalhe')`, [s.id]));
    await como(db, rodrigo, () => q(`insert into sugestoes_comentarios (sugestao_id, texto) values ($1, 'Vamos avaliar')`, [s.id]));
    await expect(como(db, aelso, () => q(`insert into sugestoes_comentarios (sugestao_id, texto) values ($1, 'Intruso')`, [s.id]))).rejects.toThrow(/row-level security/);
    await expect(q(`update sugestoes_comentarios set texto = 'x' where sugestao_id = $1`, [s.id])).rejects.toThrow(/não podem ser alterados/);
    await expect(q(`delete from sugestoes where id = $1`, [s.id])).rejects.toThrow(/não podem ser excluídos/);
  });

  it("histórico: envio, mudanças de situação com a justificativa e comentários", async () => {
    const s = await sugerir(karina);
    await mudar(rodrigo, s.id, "em_avaliacao");
    await como(db, rodrigo, () => q(`insert into sugestoes_comentarios (sugestao_id, texto) values ($1, 'Pedi orçamento')`, [s.id]));
    await mudar(rodrigo, s.id, "aprovada", "Aprovada para o próximo mês");
    const h = (await como(db, karina, () => q(`select evento, quem, de, para, texto from sugestao_historico($1)`, [s.id]))).rows;
    expect(h.map((e) => [e.evento, e.quem, e.para, e.texto])).toEqual([
      ["enviada", "karina", "nova", null],
      ["situacao", "rodrigo", "em_avaliacao", null],
      ["comentario", "rodrigo", null, "Pedi orçamento"],
      ["situacao", "rodrigo", "aprovada", "Aprovada para o próximo mês"],
    ]);
    await expect(como(db, aelso, () => q(`select * from sugestao_historico($1)`, [s.id]))).rejects.toThrow(/não encontrada/);
  });

  it("tarefa de implementação: só avaliador, só aprovada, uma aberta por vez", async () => {
    const s = await sugerir(karina, { titulo: "Relatório de baixas" });
    await expect(como(db, rodrigo, () => q(`select sugestao_criar_tarefa($1)`, [s.id]))).rejects.toThrow(/aprovada/);
    await mudar(rodrigo, s.id, "aprovada", "Útil");
    await expect(como(db, karina, () => q(`select sugestao_criar_tarefa($1)`, [s.id]))).rejects.toThrow(/avaliador/);
    const tarefa = (await como(db, rodrigo, () => q(`select sugestao_criar_tarefa($1, $2) t`, [s.id, rodrigo]))).rows[0].t;
    expect((await linha(s.id)).pendencia_id).toBe(tarefa);
    expect((await q(`select titulo, origem, responsavel_id from pendencias where id = $1`, [tarefa])).rows[0])
      .toMatchObject({ titulo: `Implementar sugestão nº ${s.numero}: Relatório de baixas`, origem: "manual", responsavel_id: rodrigo });
    await expect(como(db, rodrigo, () => q(`select sugestao_criar_tarefa($1)`, [s.id]))).rejects.toThrow(/já tem uma tarefa/);
  });

  it("envio e decisão entram nas atividades da equipe", async () => {
    const s = await sugerir(karina, { titulo: "Atividade" });
    await mudar(rodrigo, s.id, "aprovada", "Ok");
    const a = (await q(`select codigo, usuario_id from atividades where referencia_id = $1 order by id`, [s.id])).rows;
    expect(a).toEqual([{ codigo: "nucleo.sugestao.enviou", usuario_id: karina }, { codigo: "nucleo.sugestao.aprovou", usuario_id: rodrigo }]);
  });
});
