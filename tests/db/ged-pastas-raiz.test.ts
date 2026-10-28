// GED A1a (migration 0804): cadastro persistente das pastas-raiz, trava da elaboração (5.11.1), ged_pode_ler_raiz (5.11.2),
// projeção ged_raizes (seção 9) e varredura das tabelas ged_* (11.5, itens 1, 2, 8, 9 e 10). Dados fictícios.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

const ELABORACAO = "1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR";
const DOSSIE = "1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak";
const COMPARTILHADO = "0ADGzgMWcDLTWUk9PVA";

let db: PGlite;
let admin: string, ctrOperador: string, ctrConsulta: string, comercial: string, financeiro: string, restrito: string;
let elab: string, dossie: string;
const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const cadastrar = (drive: string, area: string | null, leitura: string[] | null, operacao: string | null, perfil = admin) =>
  servico(`select ged_cadastrar_raiz($1, $2, 'Pasta ficticia', $3, $4, $5, $6) id`, [perfil, drive, COMPARTILHADO, area, leitura, operacao])
    .then((r) => r.rows[0].id as string);
const raizes = (quem: string) => como(db, quem, () => q(`select * from ged_raizes()`)).then((r) => r.rows);
const podeLer = (quem: string, id: string) => como(db, quem, () => q(`select ged_pode_ler_raiz($1) ok`, [id])).then((r) => r.rows[0].ok);
const negado = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied/);

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@exemplo.invalid"); // primeiro usuário = admin geral
  ctrOperador = await novoUsuario(db, "ctr.op@exemplo.invalid", { contratos: "operador" });
  ctrConsulta = await novoUsuario(db, "ctr.consulta@exemplo.invalid", { contratos: "consulta" });
  comercial = await novoUsuario(db, "comercial@exemplo.invalid", { comercial: "consulta" });
  financeiro = await novoUsuario(db, "fin@exemplo.invalid", { financeiro: "gestor" });
  restrito = await novoUsuario(db, "filial@exemplo.invalid", { contratos: "gestor", comercial: "gestor" });
  await q(`update perfis set unidade_restrita = 'contagem' where id = $1`, [restrito]);
  elab = await cadastrar(ELABORACAO, "contratos", [], "contratos");
  dossie = await cadastrar(DOSSIE, "contratos", ["comercial"], "contratos"); // áreas fictícias: o PENDENTE 2 segue em aberto
}, 120_000);

describe("cadastro (5.2)", () => {
  it("só as raízes confirmadas, com a finalidade do ID; nasce em_verificacao; auditado sem nome", async () => {
    const linhas = (await q(`select drive_id, finalidade, situacao, nome, drive_compartilhado_id from ged_pastas_raiz order by finalidade`)).rows;
    expect(linhas).toEqual([
      { drive_id
: DOSSIE, finalidade: "dossie_cliente", situacao: "em_verificacao", nome: "Pasta ficticia", drive_compartilhado_id: COMPARTILHADO },
      { drive_id: ELABORACAO, finalidade: "elaboracao", situacao: "em_verificacao", nome: "Pasta ficticia", drive_compartilhado_id: COMPARTILHADO },
    ]);
    const aud = (await q(`select depois from auditoria where tabela = 'ged_pastas_raiz' and acao = 'cadastrou'`)).rows;
    expect(aud).toHaveLength(2);
    expect(JSON.stringify(aud)).not.toMatch(/ficticia/);
  });

  it("recusa ALUTEC, a subpasta Contratos, ID livre, duplicada e quem não é admin", async () => {
    for (const id of ["1JOh-QFYw9uwNkxSAdPa6cLzOzIuOiT56", "pasta-alutec-ficticia", COMPARTILHADO]) {
      await expect(cadastrar(id, "contratos", [], "contratos")).rejects.toThrow(/ged:raiz_invalida/);
    }
    await expect(cadastrar(DOSSIE, "contratos", [], "contratos")).rejects.toThrow(/ged:raiz_existente/);
    await expect(cadastrar(DOSSIE, "contratos", [], "contratos", ctrOperador)).rejects.toThrow(/ged:sem_permissao/);
  });

  it("áreas inválidas: inexistente, repetida ou a própria dona em areas_leitura; dossiê sem área", async () => {
    // A raiz já existe: as áreas são conferidas antes da duplicidade.
    for (const [area, leitura, op] of [["nao_existe", [], "contratos"], ["contratos", ["contratos"], "contratos"],
      ["contratos", ["comercial", "comercial"], "contratos"], ["contratos", ["x"], "contratos"], [null, [], "contratos"],
      ["contratos", [], null]] as const) {
      await expect(cadastrar(DOSSIE, area, [...leitura], op)).rejects.toThrow(/ged:area_invalida/);
    }
  });

  it("ninguém acessa a tabela direto (só admin pelas funções); a migration não dá grant", async () => {
    for (const quem of [admin, ctrOperador, comercial]) {
      await negado(como(db, quem, () => q(`select * from ged_pastas_raiz`)));
      await negado(como(db, quem, () => q(`select page_token from ged_pastas_raiz`)));
      await negado(como(db, quem, () => q(`update ged_pastas_raiz set areas_leitura = '{financeiro}'`)));
    }
    await negado(como(db, "anon", () => q(`select * from ged_pastas_raiz`)));
    await negado(como(db, ctrOperador, () => q(`select ged_cadastrar_raiz($1, $2, 'x', null, 'contratos', '{}', 'contratos')`, [admin, DOSSIE])));
  });

  it("não se exclui; drive_id e finalidade não mudam", async () => {
    await expect(q(`delete from ged_pastas_raiz where id = $1`, [dossie])).rejects.toThrow(/não podem ser excluídos/);
    await expect(q(`update ged_pastas_raiz set finalidade = 'dossie_cliente' where id = $1`, [elab])).rejects.toThrow(/ged:raiz_imutavel/);
    await expect(q(`update ged_pastas_raiz set drive_id = $2 where id = $1`, [dossie, ELABORACAO])).rejects.toThrow(/ged:raiz_imutavel/);
  });
});

describe("trava da elaboração (5.11.1; 11.5, item 2)", () => {
  it("cadastro da elaboração com outra área, operação ou areas_leitura é recusado", async () => {
    // Raiz já existe: a trava é conferida antes da duplicidade.
    for (const [area, leitura, op] of [["comercial", [], "contratos"], ["contratos", ["comercial"], "contratos"], ["contratos", [], "financeiro"]] as const) {
      await expect(cadastrar(ELABORACAO, area, [...leitura], op)).rejects.toThrow(/ged:raiz_travada/);
    }
  });

  it("nem o admin geral pela função de configuração, nem um update direto (superusuário) mudam as áreas", async () => {
    await expect(como(db, admin, () => q(`select ged_definir_areas_raiz($1, 'contratos', '{comercial}', 'contratos')`, [elab])))
      .rejects.toThrow(/ged:raiz_travada/);
    await expect(q(`update ged_pastas_raiz set areas_leitura = '{comercial}' where id = $1`, [elab])).rejects.toThrow(/elaboracao_travada/);
    await expect(q(`update ged_pastas_raiz set area = 'comercial' where id = $1`, [elab])).rejects.toThrow(/elaboracao_travada/);
  });

  it("dossiê: o admin geral muda as áreas (auditado); os demais não", async () => {
    await como(db, admin, () => q(`select ged_definir_areas_raiz($1, 'contratos', '{comercial,financeiro}', 'contratos')`, [dossie]));
    expect((await q(`select areas_leitura from ged_pastas_raiz where id = $1`, [dossie])).rows[0].areas_leitura).toEqual(["comercial", "financeiro"]);
    expect((await q(`select antes, depois, usuario_id from auditoria where acao = 'definiu_areas' order by id desc limit 1`)).rows[0]).toMatchObject({
      antes: { areas_leitura: ["comercial"] }, depois: { areas_leitura: ["comercial", "financeiro"] }, usuario_id: admin,
    });
    await expect(como(db, ctrOperador, () => q(`select ged_definir_areas_raiz($1, 'contratos', '{}', 'contratos')`, [dossie])))
      .rejects.toThrow(/ged:sem_permissao/);
    await como(db, admin, () => q(`select ged_definir_areas_raiz($1, 'contratos', '{comercial}', 'contratos')`, [dossie]));
  });
});

describe("leitura: ged_pode_ler_raiz e a projeção ged_raizes (5.11.2, seção 9; 11.5, itens 8 a 10)", () => {
  it("0809: só o admin geral lê as duas raízes; nenhuma área dá leitura (os colaboradores usam o Drive direto)", async () => {
    for (const raiz of [elab, dossie]) {
      expect(await podeLer(admin, raiz)).toBe(true);
      for (const quem of [ctrOperador, ctrConsulta, comercial, financeiro]) expect(await podeLer(quem, raiz)).toBe(false);
    }
  });

  it("0809: as áreas cadastradas e a trava da elaboração continuam gravadas (só não dão leitura)", async () => {
    expect((await q(`select finalidade, area, areas_leitura from ged_pastas_raiz order by finalidade`)).rows).toEqual([
      { finalidade: "dossie_cliente", area: "contratos", areas_leitura: ["comercial"] },
      { finalidade: "elaboracao", area: "contratos", areas_leitura: [] },
    ]);
  });

  it("unidade_restrita não lê raiz nenhuma, mesmo com permissão nas áreas", async () => {
    expect(await podeLer(restrito, elab)).toBe(false);
    expect(await podeLer(restrito, dossie)).toBe(false);
    expect(await raizes(restrito)).toEqual([]);
  });

  it("projeção: só colunas autorizadas e só as linhas que a pessoa lê", async () => {
    const r = await q(`select pg_get_function_result('ged_raizes()'::regprocedure) t`);
    expect(r.rows[0].t).toBe("TABLE(id uuid, nome text, finalidade text, area text, areas_leitura text[], area_operacao text, situacao text)");
    expect((await raizes(admin)).map((x) => x.finalidade)).toEqual(["dossie_cliente", "elaboracao"]);
    for (const quem of [ctrOperador, ctrConsulta, comercial, financeiro]) expect(await raizes(quem)).toEqual([]);
    await negado(como(db, "anon", () => q(`select * from ged_raizes()`)));
  });
});

describe("situação (8.1)", () => {
  const mudar = (quem: string, id: string, s: string) => como(db, quem, () => q(`select ged_definir_situacao_raiz($1, $2)`, [id, s]));
  const situacao = async (id: string) => (await q(`select situacao, verificada_por from ged_pastas_raiz where id = $1`, [id])).rows[0];

  const verificou = (resultado: string, itens = 3) => servico(`select ged_registrar_verificacao_raiz($1, $2, $3, $4)`, [admin, DOSSIE, itens, resultado]);

  it("ativar exige que a última verificação da pasta seja completa (0805); depois ativa <-> inativa; só admin", async () => {
    await expect(mudar(admin, dossie, "ativa")).rejects.toThrow(/ged:sem_verificacao/);
    // Registro anterior à 0805 (ok sem a marca `completa`, como a leitura truncada de 24/10): não conta.
    await q(`insert into auditoria (tabela, acao, depois, usuario_id) values ('ged_conexao', 'verificou_raiz', $1, $2)`,
      [{ raiz: DOSSIE, itens: 1240, resultado: "ok" }, admin]);
    await expect(mudar(admin, dossie, "ativa")).rejects.toThrow(/ged:sem_verificacao/);
    await verificou("http");
    await expect(mudar(admin, dossie, "ativa")).rejects.toThrow(/ged:sem_verificacao/);
    // Completa e depois incompleta: vale a última.
    await verificou("ok");
    await verificou("incompleta", 1240);
    await expect(mudar(admin, dossie, "ativa")).rejects.toThrow(/ged:sem_verificacao/);
    await verificou("ok", 1478);
    await expect(mudar(ctrOperador, dossie, "ativa")).rejects.toThrow(/ged:sem_permissao/);
    await expect(mudar(admin, dossie, "em_verificacao")).rejects.toThrow(/ged:transicao_invalida/);
    await mudar(admin, dossie, "ativa");
    expect(await situacao(dossie)).toEqual({ situacao: "ativa", verificada_por: admin });
    await mudar(admin, dossie, "inativa");
    await mudar(admin, dossie, "ativa");
    expect((await q(`select count(*)::int n from auditoria where tabela = 'ged_pastas_raiz' and acao = 'mudou_situacao'`)).rows[0].n).toBe(3);
    await expect(mudar(admin, "00000000-0000-0000-0000-000000000000", "ativa")).rejects.toThrow(/ged:nao_encontrada/);
  });
});

describe("varredura das tabelas ged_* (11.5, item 1, com o mecanismo aprovado no PENDENTE 17)", () => {
  it("toda tabela ged_*: RLS ligada, sem política de delete, bloqueio de delete e sem acesso direto sem política de leitura", async () => {
    const tabelas = (await q(`select c.relname t, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
                               where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ged\\_%'`)).rows;
    expect(tabelas.map((t) => t.t).sort()).toEqual([
      "ged_analises", "ged_conexao", "ged_conexao_estados", "ged_documento_revisoes", "ged_documentos", "ged_indexacoes", "ged_pastas", "ged_pastas_raiz",
      "ged_tipos", "ged_trava",
    ]);
    for (const { t, rls } of tabelas) {
      expect(rls, t).toBe(true);
      const pol = (await q(`select cmd from pg_policies where schemaname = 'public' and tablename = $1`, [t])).rows.map((p) => p.cmd);
      expect(pol, t).not.toContain("DELETE");
      expect(pol, t).not.toContain("ALL");
      // Sem política de leitura, o acesso é só por funções: nenhuma coluna liberada a anon/authenticated.
      if (!pol.includes("SELECT")) {
        for (const papel of ["anon", "authenticated"]) {
          expect((await q(`select has_any_column_privilege($1, $2, 'SELECT') ok`, [papel, t])).rows[0].ok, `${papel} ${t}`).toBe(false);
        }
      }
    }
    // ged_conexao_estados não tem bloqueio de delete: o state é consumido e marcado, não apagado (0801); as demais têm.
    const comBloqueio = (await q(`select distinct c.relname t from pg_trigger g join pg_class c on c.oid = g.tgrelid
                                   join pg_proc p on p.oid = g.tgfoid where p.proname = 'fn_bloquear_delete' and c.relname like 'ged\\_%'`)).rows;
    expect(comBloqueio.map((x) => x.t).sort()).toEqual([
      "ged_analises", "ged_conexao", "ged_documento_revisoes", "ged_documentos", "ged_indexacoes", "ged_pastas", "ged_pastas_raiz", "ged_tipos", "ged_trava",
    ]);
  });

  it("modo de segurança das funções do cadastro (5.10) e execução por papel", async () => {
    const esperado: Record<string, string[]> = {
      "ged_pode_ler_raiz(uuid)": ["authenticated"],
      "ged_raizes()": ["authenticated"],
      "ged_cadastrar_raiz(uuid,text,text,text,text,text[],text)": ["service_role"],
      "ged_definir_areas_raiz(uuid,text,text[],text)": ["authenticated"],
      "ged_definir_situacao_raiz(uuid,text)": ["authenticated"],
      "ged_areas_validas(text,text[])": [],
    };
    for (const [fn, papeis] of Object.entries(esperado)) {
      expect((await q(`select prosecdef from pg_proc where oid = $1::regprocedure`, [fn])).rows[0].prosecdef, fn).toBe(true);
      for (const papel of ["anon", "authenticated", "service_role"]) {
        expect((await q(`select has_function_privilege($1, $2, 'execute') ok`, [papel, fn])).rows[0].ok, `${papel} → ${fn}`).toBe(papeis.includes(papel));
      }
    }
  });
});

describe("fluxo completo com a verificação real da A0 (0803 → 0804)", () => {
  it("verificação ok pela função da A0 libera a ativação; auditoria do fluxo sem nomes nem árvore", async () => {
    await expect(como(db, admin, () => q(`select ged_definir_situacao_raiz($1, 'ativa')`, [elab]))).rejects.toThrow(/ged:sem_verificacao/);
    await servico(`select ged_registrar_verificacao_raiz($1, $2, 815, 'ok')`, [admin, ELABORACAO]);
    await como(db, admin, () => q(`select ged_definir_situacao_raiz($1, 'ativa')`, [elab]));
    expect((await raizes(admin)).find((r) => r.id === elab)?.situacao).toBe("ativa");
    const aud = (await q(`select acao, antes, depois from auditoria where tabela = 'ged_pastas_raiz' or acao = 'verificou_raiz'`)).rows;
    expect(aud.length).toBeGreaterThan(0);
    expect(JSON.stringify(aud)).not.toMatch(/ficticia|nome|subpastas|porNivel/i);
  });
});
