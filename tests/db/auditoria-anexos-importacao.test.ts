import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, semAcesso: string, finConsulta: string, finOperador: string, fiscalOperador: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  semAcesso = await novoUsuario(db, "sem@neo.com");
  finConsulta = await novoUsuario(db, "fin.consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "fin.operador@neo.com", { financeiro: "operador" });
  fiscalOperador = await novoUsuario(db, "fiscal.operador@neo.com", { fiscal: "operador" });
});

describe("auditoria", () => {
  it("alterações de cadastro geram registro com antes e depois e o usuário responsável", async () => {
    await como(db, admin, async () => {
      await q(`insert into empresas (razao_social, nome_curto) values ('Oeste Formas Ltda', 'Oeste')`);
      await q(`update empresas set nome_curto = 'Oeste Formas' where nome_curto = 'Oeste'`);
    });
    const r = await q(`select acao, antes->>'nome_curto' as antes, depois->>'nome_curto' as depois, usuario_id, registro_id
                         from auditoria where tabela = 'empresas' order by id`);
    expect(r.rows.map((x) => x.acao)).toEqual(["INSERT", "UPDATE"]);
    expect(r.rows[1]).toMatchObject({ antes: "Oeste", depois: "Oeste Formas", usuario_id: admin });
    expect(r.rows[1].registro_id).not.toBeNull();
  });

  it("permissões também são auditadas (tabela sem coluna id)", async () => {
    await como(db, admin, () => q(`insert into permissoes (perfil_id, area, nivel) values ($1, 'contratos', 'consulta')`, [semAcesso]));
    const r = await q(`select acao, depois->>'area' as area, registro_id from auditoria where tabela = 'permissoes' and depois->>'perfil_id' = $1`, [semAcesso]);
    expect(r.rows).toEqual([{ acao: "INSERT", area: "contratos", registro_id: null }]);
    await q(`delete from permissoes where perfil_id = $1`, [semAcesso]);
  });

  it("só o admin_geral lê a auditoria", async () => {
    await como(db, admin, async () => expect((await q(`select id from auditoria`)).rows.length).toBeGreaterThan(0));
    for (const quem of [finOperador, finConsulta, semAcesso]) {
      await como(db, quem, async () => expect((await q(`select id from auditoria`)).rows).toHaveLength(0));
    }
  });

  it("ninguém grava, altera ou apaga direto: nem usuário, nem admin, nem service role", async () => {
    for (const quem of [admin, finOperador]) {
      await como(db, quem, async () => {
        await expect(q(`insert into auditoria (tabela, acao) values ('x', 'INSERT')`)).rejects.toThrow(/permission denied/);
        await expect(q(`update auditoria set acao = 'x'`)).rejects.toThrow(/permission denied/);
        await expect(q(`delete from auditoria`)).rejects.toThrow(/permission denied/);
      });
    }
    await como(db, "service", async () => {
      await expect(q(`update auditoria set acao = 'x'`)).rejects.toThrow(/imutáveis/);
      await expect(q(`delete from auditoria`)).rejects.toThrow(/imutáveis/);
    });
  });
});

describe("anexos", () => {
  const caminho = `${MOD}/rec_titulos/00000000-0000-0000-0000-000000000001/boleto.pdf`;
  const inserir = (modulo: string, enviadoPor: string) =>
    q(`insert into anexos (modulo, referencia_tabela, referencia_id, arquivo_path, nome_arquivo, tipo, enviado_por)
       values ($1, 'rec_titulos', '00000000-0000-0000-0000-000000000001', $2, 'boleto.pdf', 'boleto', $3)`, [modulo, caminho, enviadoPor]);

  it("operador da área anexa em seu nome; consulta e outras áreas não", async () => {
    await como(db, finOperador, () => inserir(MOD, finOperador));
    await como(db, finOperador, async () => {
      await expect(inserir(MOD, admin)).rejects.toThrow(/row-level security/); // não anexa em nome de outro
    });
    await como(db, finConsulta, async () => {
      await expect(inserir(MOD, finConsulta)).rejects.toThrow(/row-level security/);
    });
    await como(db, fiscalOperador, async () => {
      await expect(inserir(MOD, fiscalOperador)).rejects.toThrow(/row-level security/);
    });
  });

  it("leitura pela área do módulo", async () => {
    await como(db, finConsulta, async () => expect((await q(`select id from anexos`)).rows).toHaveLength(1));
    await como(db, fiscalOperador, async () => expect((await q(`select id from anexos`)).rows).toHaveLength(0));
  });

  it("anexo é prova: sem update e sem delete", async () => {
    await como(db, finOperador, async () => {
      expect((await q(`update anexos set nome_arquivo = 'x'`)).affectedRows).toBe(0);
      expect((await q(`delete from anexos`)).affectedRows).toBe(0);
    });
    await como(db, "service", async () => {
      await expect(q(`delete from anexos`)).rejects.toThrow(/não podem ser excluídos/);
    });
  });
});

describe("storage (bucket anexos)", () => {
  const objeto = (nome: string) => q(`insert into storage.objects (bucket_id, name) values ('anexos', $1)`, [nome]);

  it("o bucket é privado e tem limite de tamanho", async () => {
    const r = (await q(`select public, file_size_limit from storage.buckets where id = 'anexos'`)).rows[0];
    expect(r.public).toBe(false);
    expect(Number(r.file_size_limit)).toBe(26214400);
  });

  it("envio: operador da área do módulo, no caminho do módulo", async () => {
    await como(db, finOperador, () => objeto(`${MOD}/rec_titulos/abc/1-boleto.pdf`));
    await como(db, finOperador, async () => {
      await expect(objeto(`juridico.processos/x/abc/1-peca.pdf`)).rejects.toThrow(/row-level security/);
      await expect(objeto(`arquivo-solto.pdf`)).rejects.toThrow(/row-level security/);
    });
    await como(db, finConsulta, async () => {
      await expect(objeto(`${MOD}/rec_titulos/abc/2-boleto.pdf`)).rejects.toThrow(/row-level security/);
    });
    await como(db, fiscalOperador, async () => {
      await expect(objeto(`${MOD}/rec_titulos/abc/3-boleto.pdf`)).rejects.toThrow(/row-level security/);
    });
  });

  it("leitura: consulta da área sim; outras áreas e sem acesso não", async () => {
    await como(db, finConsulta, async () => expect((await q(`select name from storage.objects`)).rows).toHaveLength(1));
    await como(db, fiscalOperador, async () => expect((await q(`select name from storage.objects`)).rows).toHaveLength(0));
    await como(db, semAcesso, async () => expect((await q(`select name from storage.objects`)).rows).toHaveLength(0));
  });

  it("sem update e sem delete para usuários", async () => {
    await como(db, finOperador, async () => {
      expect((await q(`update storage.objects set name = 'x'`)).affectedRows).toBe(0);
      expect((await q(`delete from storage.objects`)).affectedRows).toBe(0);
    });
  });
});

describe("importação genérica", () => {
  const mapa = JSON.stringify({ "Cód. Cliente": "codigo_erp", Nome: "nome", Vencimento: "vencimento" });

  it("operador salva e atualiza o modelo de mapeamento; o sistema carimba autor e data", async () => {
    await como(db, finOperador, async () => {
      await q(`insert into importacao_modelos (modulo, tipo, nome, mapeamento) values ($1, 'titulos_abertos', 'Consistem padrão', $2)`, [MOD, mapa]);
      await q(`update importacao_modelos set mapeamento = '{"Nome":"nome"}', atualizado_por = $1 where nome = 'Consistem padrão'`, [admin]);
    });
    const r = (await q(`select mapeamento, atualizado_por from importacao_modelos`)).rows[0];
    expect(r.mapeamento).toEqual({ Nome: "nome" });
    expect(r.atualizado_por).toBe(finOperador);
  });

  it("não repete (módulo, tipo, nome)", async () => {
    await como(db, finOperador, async () => {
      await expect(q(`insert into importacao_modelos (modulo, tipo, nome, mapeamento) values ($1, 'titulos_abertos', 'Consistem padrão', '{}')`, [MOD])).rejects.toThrow(/duplicate key|unique/);
    });
  });

  it("consulta lê mas não escreve; outra área não enxerga", async () => {
    await como(db, finConsulta, async () => {
      expect((await q(`select id from importacao_modelos`)).rows).toHaveLength(1);
      await expect(q(`insert into importacao_modelos (modulo, tipo, nome, mapeamento) values ($1, 't', 'n', '{}')`, [MOD])).rejects.toThrow(/row-level security/);
      expect((await q(`update importacao_modelos set nome = 'x'`)).affectedRows).toBe(0);
      expect((await q(`delete from importacao_modelos`)).affectedRows).toBe(0);
    });
    await como(db, fiscalOperador, async () => expect((await q(`select id from importacao_modelos`)).rows).toHaveLength(0));
  });

  it("registra cada importação com a cópia do mapeamento usado; não apaga", async () => {
    await como(db, finOperador, async () => {
      await q(`insert into importacoes (modulo, tipo, arquivo, mapeamento, usuario_id) values ($1, 'titulos_abertos', 'abertos.xlsx', $2, $3)`, [MOD, mapa, finOperador]);
      await expect(q(`insert into importacoes (modulo, tipo, usuario_id) values ($1, 'x', $2)`, [MOD, admin])).rejects.toThrow(/row-level security/);
      expect((await q(`delete from importacoes`)).affectedRows).toBe(0);
    });
    await como(db, finConsulta, async () => {
      expect((await q(`select id from importacoes`)).rows).toHaveLength(1);
      await expect(q(`insert into importacoes (modulo, tipo, usuario_id) values ($1, 'x', $2)`, [MOD, finConsulta])).rejects.toThrow(/row-level security/);
    });
  });

  it("o módulo precisa existir", async () => {
    await como(db, admin, async () => {
      await expect(q(`insert into importacao_modelos (modulo, tipo, nome, mapeamento) values ('nao.existe', 't', 'n', '{}')`)).rejects.toThrow(/foreign key/);
    });
  });
});
