import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, forcado: string, finOperador: string, finGestor: string, finGestor2: string, finConsulta: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  forcado = await novoUsuario(db, "novo@neo.com", { financeiro: "gestor" }, { deveTrocarSenha: true });
  finOperador = await novoUsuario(db, "fin.operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "fin.gestor@neo.com", { financeiro: "gestor" });
  finGestor2 = await novoUsuario(db, "fin.gestor2@neo.com", { financeiro: "gestor" });
  finConsulta = await novoUsuario(db, "fin.consulta@neo.com", { financeiro: "consulta" });
  await q(`insert into empresas (razao_social, nome_curto) values ('Neo Formas Ltda', 'Neo Formas')`);
});

describe("troca obrigatória de senha", () => {
  it("o primeiro usuário (criado no painel) não é forçado; o criado pelo admin é", async () => {
    const r = await q(`select id, deve_trocar_senha from perfis`);
    const por = Object.fromEntries(r.rows.map((x) => [x.id, x.deve_trocar_senha]));
    expect(por[admin]).toBe(false);
    expect(por[forcado]).toBe(true);
    expect(por[finOperador]).toBe(false);
  });

  it("enquanto não troca, não acessa dado nenhum, mas ainda lê o próprio perfil e as próprias permissões", async () => {
    await como(db, forcado, async () => {
      expect((await q(`select deve_trocar_senha from perfis where id = $1`, [forcado])).rows[0].deve_trocar_senha).toBe(true);
      expect((await q(`select area from permissoes`)).rows).toEqual([{ area: "financeiro" }]);
      expect((await q(`select * from areas`)).rows).toHaveLength(0);
      expect((await q(`select * from empresas`)).rows).toHaveLength(0);
      expect((await q(`select id from perfis`)).rows).toHaveLength(1);
      await expect(q(`insert into pendencias (modulo, titulo) values ($1, 'x')`, [MOD])).rejects.toThrow(/row-level security/);
    });
  });

  it("um admin_geral forçado também perde os poderes até trocar", async () => {
    const adminForcado = await novoUsuario(db, "admin2@neo.com", {}, { deveTrocarSenha: true });
    await q(`update perfis set admin_geral = true where id = $1`, [adminForcado]);
    await como(db, adminForcado, async () => {
      expect((await q(`select eh_admin_geral() as v`)).rows[0].v).toBe(false);
      await expect(q(`insert into empresas (razao_social, nome_curto) values ('X', 'X')`)).rejects.toThrow(/row-level security/);
    });
  });

  it("o usuário não consegue se liberar sozinho", async () => {
    await como(db, forcado, async () => {
      expect((await q(`update perfis set deve_trocar_senha = false where id = $1`, [forcado])).affectedRows).toBe(0);
    });
    expect((await q(`select deve_trocar_senha from perfis where id = $1`, [forcado])).rows[0].deve_trocar_senha).toBe(true);
  });

  it("trocar a senha no Auth libera o acesso", async () => {
    await q(`update auth.users set encrypted_password = 'hash-novo' where id = $1`, [forcado]);
    expect((await q(`select deve_trocar_senha from perfis where id = $1`, [forcado])).rows[0].deve_trocar_senha).toBe(false);
    await como(db, forcado, async () => {
      expect((await q(`select * from areas`)).rows).toHaveLength(6);
      expect((await q(`select * from empresas`)).rows).toHaveLength(1);
    });
  });

  it("mexer em outra coluna do Auth não libera", async () => {
    const outro = await novoUsuario(db, "outro@neo.com", { financeiro: "operador" }, { deveTrocarSenha: true });
    await q(`update auth.users set email = 'outro2@neo.com' where id = $1`, [outro]);
    expect((await q(`select deve_trocar_senha from perfis where id = $1`, [outro])).rows[0].deve_trocar_senha).toBe(true);
  });

  it("redefinição pelo admin: a senha muda (libera) e a função do admin volta a forçar a troca", async () => {
    const alvo = await novoUsuario(db, "alvo@neo.com", { financeiro: "operador" });
    await q(`update auth.users set encrypted_password = 'hash-do-admin' where id = $1`, [alvo]);
    await q(`update perfis set deve_trocar_senha = true where id = $1`, [alvo]); // o que a Edge Function faz em seguida
    await como(db, alvo, async () => expect((await q(`select * from empresas`)).rows).toHaveLength(0));
    await q(`update auth.users set encrypted_password = 'hash-escolhido-pelo-usuario' where id = $1`, [alvo]);
    await como(db, alvo, async () => expect((await q(`select * from empresas`)).rows).toHaveLength(1));
  });
});

describe("segregação na aprovação de mensagens", () => {
  const criar = (quem: string) =>
    como(db, quem, async () =>
      (await q(`insert into mensagens (modulo, canal, destinatario, assunto, corpo, status)
                values ($1, 'email', 'c@c.com', 'Boleto', 'Segue.', 'aguardando_aprovacao') returning id`, [MOD])).rows[0].id as string,
    );
  const aprovar = (quem: string, id: string) => como(db, quem, () => q(`update mensagens set status = 'aprovada' where id = $1`, [id]));

  it("grava o autor e não deixa o usuário forjar nem trocar o autor", async () => {
    const id = await criar(finOperador);
    expect((await q(`select criado_por from mensagens where id = $1`, [id])).rows[0].criado_por).toBe(finOperador);

    const forjada = await como(db, finOperador, async () =>
      (await q(`insert into mensagens (modulo, canal, destinatario, corpo, criado_por) values ($1, 'email', 'a@a.com', 'x', $2) returning id`, [MOD, finGestor])).rows[0].id as string);
    expect((await q(`select criado_por from mensagens where id = $1`, [forjada])).rows[0].criado_por).toBe(finOperador);

    await como(db, finOperador, () => q(`update mensagens set criado_por = $2, corpo = 'editada' where id = $1`, [id, finGestor]));
    expect((await q(`select criado_por from mensagens where id = $1`, [id])).rows[0].criado_por).toBe(finOperador);
  });

  it("gestor não aprova a própria mensagem; outro gestor aprova", async () => {
    const id = await criar(finGestor);
    await expect(aprovar(finGestor, id)).rejects.toThrow(/Quem criou a mensagem não pode aprovar a própria/);
    expect((await q(`select status from mensagens where id = $1`, [id])).rows[0].status).toBe("aguardando_aprovacao");

    await aprovar(finGestor2, id);
    const r = (await q(`select status, aprovado_por from mensagens where id = $1`, [id])).rows[0];
    expect(r).toEqual({ status: "aprovada", aprovado_por: finGestor2 });
  });

  it("mensagem de operador continua sendo aprovada por gestor", async () => {
    const id = await criar(finOperador);
    await aprovar(finGestor, id);
    expect((await q(`select aprovado_por from mensagens where id = $1`, [id])).rows[0].aprovado_por).toBe(finGestor);
  });

  it("mensagem sem autor humano (régua, service role) não entra na regra", async () => {
    const id = (await como(db, "service", async () =>
      (await q(`insert into mensagens (modulo, canal, destinatario, corpo, status) values ($1, 'email', 'c@c.com', 'D+1', 'aguardando_aprovacao') returning id`, [MOD])).rows[0].id as string));
    expect((await q(`select criado_por from mensagens where id = $1`, [id])).rows[0].criado_por).toBeNull();
    await aprovar(finGestor, id);
    expect((await q(`select status from mensagens where id = $1`, [id])).rows[0].status).toBe("aprovada");
  });

  it("admin_geral pode aprovar a própria, e isso fica registrado na auditoria", async () => {
    const id = await como(db, admin, async () =>
      (await q(`insert into mensagens (modulo, canal, destinatario, corpo, status) values ($1, 'email', 'c@c.com', 'Admin', 'aguardando_aprovacao') returning id`, [MOD])).rows[0].id as string);
    await aprovar(admin, id);
    expect((await q(`select status, aprovado_por from mensagens where id = $1`, [id])).rows[0]).toEqual({ status: "aprovada", aprovado_por: admin });

    const aud = await q(`select usuario_id, depois from auditoria where acao = 'APROVACAO_PROPRIA_ISENTA' and registro_id = $1`, [id]);
    expect(aud.rows).toHaveLength(1);
    expect(aud.rows[0].usuario_id).toBe(admin);
    expect(aud.rows[0].depois).toMatchObject({ criado_por: admin, aprovado_por: admin, modulo: MOD });
  });

  it("admin_geral aprovando mensagem de outro NÃO gera registro de exceção", async () => {
    const id = await criar(finOperador);
    await aprovar(admin, id);
    const aud = await q(`select 1 from auditoria where acao = 'APROVACAO_PROPRIA_ISENTA' and registro_id = $1`, [id]);
    expect(aud.rows).toHaveLength(0);
  });

  it("a exceção do admin não vale para gestor comum que também é o autor, mesmo sem outro gestor", async () => {
    const id = await criar(finGestor);
    await expect(aprovar(finGestor, id)).rejects.toThrow(/Peça a outro gestor/);
  });
});

describe("modelos de mensagem: escrita só para gestor", () => {
  const inserir = () => q(`insert into modelos_mensagem (modulo, nome, canal, corpo) values ($1, 'D+1', 'email', 'Olá {contraparte}')`, [MOD]);

  it("operador e consulta só leem; gestor e admin escrevem", async () => {
    await como(db, finOperador, async () => {
      await expect(inserir()).rejects.toThrow(/row-level security/);
    });
    await como(db, finConsulta, async () => {
      await expect(inserir()).rejects.toThrow(/row-level security/);
    });
    await como(db, finGestor, () => inserir());
    await como(db, admin, () => inserir());

    for (const quem of [finOperador, finConsulta]) {
      await como(db, quem, async () => {
        // só os criados aqui (as migrations semeiam outros modelos, como os do envio de boleto)
        expect((await q(`select id from modelos_mensagem where nome = 'D+1'`)).rows).toHaveLength(2);
        expect((await q(`update modelos_mensagem set corpo = 'trocado'`)).affectedRows).toBe(0);
      });
    }
    await como(db, finGestor, async () => {
      expect((await q(`update modelos_mensagem set ativo = false where nome = 'D+1'`)).affectedRows).toBe(2);
    });
  });

  it("gestor de outra área não escreve modelo do financeiro", async () => {
    const fiscalGestor = await novoUsuario(db, "fiscal.gestor@neo.com", { fiscal: "gestor" });
    await como(db, fiscalGestor, async () => {
      await expect(inserir()).rejects.toThrow(/row-level security/);
    });
  });
});
