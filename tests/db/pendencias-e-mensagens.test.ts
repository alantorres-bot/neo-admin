import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, finConsulta: string, finOperador: string, finOperador2: string, finGestor: string, fiscalOperador: string, rhGestor: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "fin.consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "fin.operador@neo.com", { financeiro: "operador" });
  finOperador2 = await novoUsuario(db, "fin.operador2@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "fin.gestor@neo.com", { financeiro: "gestor" });
  fiscalOperador = await novoUsuario(db, "fiscal.operador@neo.com", { fiscal: "operador" });
  rhGestor = await novoUsuario(db, "rh.gestor@neo.com", { rh: "gestor" });
});

async function novaPendencia(responsavel: string | null, titulo: string): Promise<string> {
  const r = await q(
    `insert into pendencias (modulo, titulo, responsavel_id, prazo) values ($1, $2, $3, current_date) returning id`,
    [MOD, titulo, responsavel],
  );
  return r.rows[0].id;
}

describe("pendências", () => {
  it("lê pela área do módulo: financeiro vê, fiscal e rh não", async () => {
    const id = await novaPendencia(finOperador, "Enviar boleto Alfa");
    const ids = async (quem: string) => (await como(db, quem, () => q(`select id from pendencias`))).rows.map((x) => x.id);
    expect(await ids(finConsulta)).toContain(id);
    expect(await ids(finGestor)).toContain(id);
    expect(await ids(fiscalOperador)).not.toContain(id);
    expect(await ids(rhGestor)).not.toContain(id);
  });

  it("o responsável conclui a própria pendência e o gatilho carimba quem e quando", async () => {
    const id = await novaPendencia(finOperador, "Cobrar Beta");
    await como(db, finOperador, async () => {
      expect((await q(`update pendencias set status = 'concluida' where id = $1`, [id])).affectedRows).toBe(1);
    });
    const r = (await q(`select status, concluido_por, concluido_em from pendencias where id = $1`, [id])).rows[0];
    expect(r.status).toBe("concluida");
    expect(r.concluido_por).toBe(finOperador);
    expect(r.concluido_em).not.toBeNull();
  });

  it("não deixa o usuário forjar concluido_por", async () => {
    const id = await novaPendencia(finOperador, "Forjar");
    await como(db, finOperador, () => q(`update pendencias set status = 'concluida', concluido_por = $2 where id = $1`, [id, finGestor]));
    expect((await q(`select concluido_por from pendencias where id = $1`, [id])).rows[0].concluido_por).toBe(finOperador);
  });

  it("outro operador não mexe na pendência de terceiros; consulta não mexe em nenhuma", async () => {
    const id = await novaPendencia(finOperador, "Alheia");
    await como(db, finOperador2, async () => {
      expect((await q(`update pendencias set status = 'concluida' where id = $1`, [id])).affectedRows).toBe(0);
    });
    await como(db, finConsulta, async () => {
      expect((await q(`update pendencias set status = 'em_andamento' where id = $1`, [id])).affectedRows).toBe(0);
    });
  });

  it("operador não altera dados da pendência nem reatribui; gestor faz as duas coisas", async () => {
    const id = await novaPendencia(finOperador, "Dados protegidos");
    await como(db, finOperador, async () => {
      await expect(q(`update pendencias set titulo = 'outro' where id = $1`, [id])).rejects.toThrow(/gestor da área altera os dados/);
      await expect(q(`update pendencias set prazo = current_date + 30 where id = $1`, [id])).rejects.toThrow(/gestor da área altera os dados/);
      await expect(q(`update pendencias set responsavel_id = $2 where id = $1`, [id, finOperador2])).rejects.toThrow(/reatribui/);
      await expect(q(`update pendencias set responsavel_id = null where id = $1`, [id])).rejects.toThrow(/reatribui/);
    });
    await como(db, finGestor, async () => {
      await q(`update pendencias set responsavel_id = $2, titulo = 'Novo título' where id = $1`, [id, finOperador2]);
    });
    expect((await q(`select responsavel_id from pendencias where id = $1`, [id])).rows[0].responsavel_id).toBe(finOperador2);
  });

  it("gestor de outra área não reatribui", async () => {
    const id = await novaPendencia(finOperador, "Só financeiro");
    await como(db, rhGestor, async () => {
      expect((await q(`update pendencias set responsavel_id = $2 where id = $1`, [id, rhGestor])).affectedRows).toBe(0);
    });
  });

  it("operador assume pendência sem responsável (só para si)", async () => {
    const id = await novaPendencia(null, "Sem dono");
    await como(db, finOperador, async () => {
      await expect(q(`update pendencias set responsavel_id = $2 where id = $1`, [id, finOperador2])).rejects.toThrow(/reatribui/);
      expect((await q(`update pendencias set responsavel_id = $2 where id = $1`, [id, finOperador])).affectedRows).toBe(1);
    });
    expect((await q(`select responsavel_id from pendencias where id = $1`, [id])).rows[0].responsavel_id).toBe(finOperador);
  });

  it("pendência encerrada só é reaberta pelo gestor", async () => {
    const id = await novaPendencia(finOperador, "Reabrir");
    await como(db, finOperador, () => q(`update pendencias set status = 'concluida' where id = $1`, [id]));
    await como(db, finOperador, async () => {
      await expect(q(`update pendencias set status = 'aberta' where id = $1`, [id])).rejects.toThrow(/reaberta pelo gestor/);
    });
    await como(db, finGestor, () => q(`update pendencias set status = 'aberta' where id = $1`, [id]));
    const r = (await q(`select status, concluido_em, concluido_por from pendencias where id = $1`, [id])).rows[0];
    expect(r).toEqual({ status: "aberta", concluido_em: null, concluido_por: null });
  });

  it("criação: operador cria para si; só gestor atribui a outra pessoa; consulta não cria", async () => {
    await como(db, finOperador, async () => {
      await q(`insert into pendencias (modulo, titulo, responsavel_id) values ($1, 'Minha', $2)`, [MOD, finOperador]);
      await expect(q(`insert into pendencias (modulo, titulo, responsavel_id) values ($1, 'Do outro', $2)`, [MOD, finOperador2])).rejects.toThrow(/atribui pendência a outra pessoa/);
    });
    await como(db, finGestor, () => q(`insert into pendencias (modulo, titulo, responsavel_id) values ($1, 'Atribuída', $2)`, [MOD, finOperador]));
    await como(db, finConsulta, async () => {
      await expect(q(`insert into pendencias (modulo, titulo) values ($1, 'X')`, [MOD])).rejects.toThrow(/row-level security/);
    });
    await como(db, fiscalOperador, async () => {
      await expect(q(`insert into pendencias (modulo, titulo) values ($1, 'X')`, [MOD])).rejects.toThrow(/row-level security/);
    });
  });

  it("nunca apaga, nem a service role", async () => {
    const id = await novaPendencia(finOperador, "Permanente");
    await como(db, admin, async () => {
      expect((await q(`delete from pendencias where id = $1`, [id])).affectedRows).toBe(0);
    });
    await como(db, "service", async () => {
      await expect(q(`delete from pendencias where id = $1`, [id])).rejects.toThrow(/não podem ser excluídos/);
    });
  });

  it("a service role cria e conclui livremente (automações dos módulos)", async () => {
    await como(db, "service", async () => {
      const id = (await q(`insert into pendencias (modulo, titulo) values ($1, 'Gerada pela régua') returning id`, [MOD])).rows[0].id;
      await q(`update pendencias set responsavel_id = $2 where id = $1`, [id, finOperador]);
    });
  });
});

describe("mensagens", () => {
  const nova = (quem: string, status = "rascunho") =>
    como(db, quem, async () =>
      (await q(
        `insert into mensagens (modulo, canal, destinatario, assunto, corpo, status)
         values ($1, 'email', 'cliente@alfa.com', 'Boleto', 'Segue o boleto.', $2) returning id`,
        [MOD, status],
      )).rows[0].id as string,
    );

  it("operador cria como rascunho ou aguardando_aprovacao; nenhum outro status", async () => {
    await nova(finOperador, "rascunho");
    await nova(finOperador, "aguardando_aprovacao");
    for (const status of ["aprovada", "enviada", "falhou", "respondida"]) {
      await expect(nova(finOperador, status)).rejects.toThrow(/row-level security|rascunho/);
    }
    await como(db, finConsulta, async () => {
      await expect(q(`insert into mensagens (modulo, canal, destinatario, corpo) values ($1, 'email', 'x@x.com', 'x')`, [MOD])).rejects.toThrow(/row-level security/);
    });
  });

  it("operador edita rascunho mas não aprova; gestor aprova e o sistema carimba aprovador e hora", async () => {
    const id = await nova(finOperador);
    await como(db, finOperador, async () => {
      await q(`update mensagens set corpo = 'Texto novo', status = 'aguardando_aprovacao' where id = $1`, [id]);
      await expect(q(`update mensagens set status = 'aprovada' where id = $1`, [id])).rejects.toThrow(/gestor da área aprova/);
    });
    await como(db, finGestor, async () => {
      // tenta forjar o aprovador: o gatilho sobrescreve
      await q(`update mensagens set status = 'aprovada', aprovado_por = $2 where id = $1`, [id, admin]);
    });
    const r = (await q(`select status, aprovado_por, aprovado_em from mensagens where id = $1`, [id])).rows[0];
    expect(r.status).toBe("aprovada");
    expect(r.aprovado_por).toBe(finGestor);
    expect(r.aprovado_em).not.toBeNull();
  });

  it("operador não aprova nem em mensagem de outro; consulta não altera", async () => {
    const id = await nova(finOperador, "aguardando_aprovacao");
    await como(db, finConsulta, async () => {
      expect((await q(`update mensagens set corpo = 'x' where id = $1`, [id])).affectedRows).toBe(0);
    });
    await como(db, fiscalOperador, async () => {
      expect((await q(`update mensagens set status = 'aprovada' where id = $1`, [id])).affectedRows).toBe(0);
    });
  });

  it("depois de aprovada: operador não mexe; gestor não muda o conteúdo, só descarta", async () => {
    const id = await nova(finOperador, "aguardando_aprovacao");
    await como(db, finGestor, () => q(`update mensagens set status = 'aprovada' where id = $1`, [id]));
    await como(db, finOperador, async () => {
      expect((await q(`update mensagens set corpo = 'trocado' where id = $1`, [id])).affectedRows).toBe(0);
      expect((await q(`update mensagens set status = 'descartada' where id = $1`, [id])).affectedRows).toBe(0);
    });
    await como(db, finGestor, async () => {
      await expect(q(`update mensagens set corpo = 'trocado' where id = $1`, [id])).rejects.toThrow(/conteúdo/);
      await expect(q(`update mensagens set status = 'rascunho' where id = $1`, [id])).rejects.toThrow(/só pode ser descartada/);
      await q(`update mensagens set status = 'descartada' where id = $1`, [id]);
    });
    const r = (await q(`select status, aprovado_por from mensagens where id = $1`, [id])).rows[0];
    expect(r).toEqual({ status: "descartada", aprovado_por: finGestor }); // a prova da aprovação permanece
  });

  it("enviada, falhou e respondida só a service role grava; usuário nem com gestor/admin", async () => {
    const id = await nova(finOperador, "aguardando_aprovacao");
    await como(db, finGestor, () => q(`update mensagens set status = 'aprovada' where id = $1`, [id]));
    for (const quem of [finGestor, admin]) {
      await como(db, quem, async () => {
        for (const status of ["enviada", "falhou", "respondida"]) {
          await expect(q(`update mensagens set status = $2 where id = $1`, [id, status])).rejects.toThrow(/função de envio/);
        }
      });
    }
    await como(db, "service", async () => {
      await q(`update mensagens set status = 'enviada', enviado_em = now(), id_externo = 'gmail-123' where id = $1`, [id]);
    });
    await como(db, "service", async () => {
      await q(`update mensagens set status = 'respondida' where id = $1`, [id]);
    });
    expect((await q(`select status, id_externo from mensagens where id = $1`, [id])).rows[0]).toEqual({ status: "respondida", id_externo: "gmail-123" });
  });

  it("mensagem enviada é imutável para o usuário e o usuário não escreve campos de envio", async () => {
    const id = await nova(finOperador, "aguardando_aprovacao");
    await como(db, finOperador, () => q(`update mensagens set id_externo = 'forjado', erro = 'x', enviado_em = now() where id = $1`, [id]));
    expect((await q(`select id_externo, erro, enviado_em from mensagens where id = $1`, [id])).rows[0]).toEqual({ id_externo: null, erro: null, enviado_em: null });

    await como(db, finGestor, () => q(`update mensagens set status = 'aprovada' where id = $1`, [id]));
    await como(db, "service", () => q(`update mensagens set status = 'enviada', enviado_em = now() where id = $1`, [id]));
    await como(db, finGestor, async () => {
      expect((await q(`update mensagens set status = 'descartada' where id = $1`, [id])).affectedRows).toBe(0);
    });
  });

  it("mensagens nunca são apagadas", async () => {
    const id = await nova(finOperador);
    await como(db, finGestor, async () => {
      expect((await q(`delete from mensagens where id = $1`, [id])).affectedRows).toBe(0);
    });
    await como(db, "service", async () => {
      await expect(q(`delete from mensagens where id = $1`, [id])).rejects.toThrow(/não podem ser excluídos/);
    });
  });

  it("outra área não enxerga as mensagens do financeiro", async () => {
    await como(db, fiscalOperador, async () => {
      expect((await q(`select id from mensagens`)).rows).toHaveLength(0);
    });
  });
});
