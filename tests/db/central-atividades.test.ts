// Central de Gestão, Fase 3B (migration 0094): atividades (o que cada pessoa fez) e acessos (o que viu).
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, rodrigo: string, karina: string, aelso: string, gestorFin: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";

const criar = (quem: string, dados: object) =>
  como(db, quem, async () => (await q(`select pendencia_criar($1) as id`, [JSON.stringify(dados)])).rows[0].id as string);
const acao = (quem: string, id: string, nome: string, dados: object = {}) =>
  como(db, quem, () => q(`select pendencia_acao($1, $2, $3)`, [id, nome, JSON.stringify(dados)]));
const atividades = async (filtro = "true", p: unknown[] = []) =>
  (await q(`select usuario_id, codigo, descricao, origem, modulo, area, referencia_id from atividades where ${filtro} order by id`, p)).rows;
const visiveis = async (quem: string) =>
  (await como(db, quem, () => q(`select distinct usuario_id from atividades`))).rows.map((r) => r.usuario_id).sort();
const ligarAcessos = (ligado: boolean) =>
  q(`update configuracoes set valor = $1 where chave = 'administrativo.gestao.registrar_acessos'`, [JSON.stringify(ligado)]);
const acessar = (quem: string, rota: string) => como(db, quem, () => q(`select registrar_acesso($1)`, [rota]));

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  rodrigo = await novoUsuario(db, "rodrigo@neo.com", { financeiro: "gestor", fiscal: "gestor", rh: "gestor", administrativo: "gestor" });
  karina = await novoUsuario(db, "karina@neo.com", { financeiro: "operador" });
  aelso = await novoUsuario(db, "aelso@neo.com", { fiscal: "operador" });
  gestorFin = await novoUsuario(db, "gestor.fin@neo.com", { financeiro: "gestor" });
  await q(`update perfis set acompanha_equipe = true where id = $1`, [rodrigo]);
});

describe("atividades a partir do que o sistema já grava", () => {
  it("criar, concluir e comentar uma tarefa viram atividades de quem fez", async () => {
    const id = await criar(gestorFin, { modulo: MOD, titulo: "Conferir extrato", responsavel_id: karina });
    await acao(karina, id, "comentar", { texto: "Começando" });
    await acao(karina, id, "concluir");
    const a = await atividades("referencia_id = $1", [id]);
    expect(a.map((x) => [x.codigo, x.usuario_id, x.origem])).toEqual([
      ["nucleo.tarefa.criou", gestorFin, "direto"],
      ["nucleo.pendencia.comentou", karina, "direto"],
      ["nucleo.pendencia.concluiu", karina, "direto"],
    ]);
    expect(a[0]).toMatchObject({ descricao: 'Criou a tarefa "Conferir extrato"', modulo: MOD, area: "financeiro" });
    expect(a[2].descricao).toBe('Concluiu "Conferir extrato"');
  });

  it("sincronização (serviço, sem pessoa) não gera atividade; rotina a pedido de alguém vira 'servico_a_pedido'", async () => {
    const semDono = (await q(`insert into pendencias (modulo, titulo) values ($1, 'Da sincronização') returning id`, [MOD])).rows[0].id;
    await q(`update pendencias set status = 'concluida' where id = $1`, [semDono]);
    expect(await atividades("referencia_id = $1", [semDono])).toEqual([]);

    const aPedido = (await q(`insert into pendencias (modulo, titulo) values ($1, 'A pedido') returning id`, [MOD])).rows[0].id;
    await q(`update pendencias set status = 'concluida', concluido_por = $2 where id = $1`, [aPedido, karina]);
    expect(await atividades("referencia_id = $1", [aPedido])).toMatchObject([{ codigo: "nucleo.pendencia.concluiu", usuario_id: karina, origem: "servico_a_pedido" }]);
  });

  it("bloqueio e pedido de decisão; cobrança e resposta do gestor", async () => {
    const id = await criar(gestorFin, { modulo: MOD, titulo: "Desconto", responsavel_id: karina });
    await acao(karina, id, "bloquear", { texto: "Sem extrato" });
    await acao(karina, id, "pedir_decisao", { texto: "Posso dar 5%?" });
    await acao(gestorFin, id, "responder_decisao", { texto: "Pode" });
    await acao(gestorFin, id, "cobrar", { texto: "Para hoje" });
    const codigos = (await atividades("referencia_id = $1", [id])).map((x) => x.codigo);
    expect(codigos).toEqual(expect.arrayContaining(["nucleo.pendencia.bloqueou", "nucleo.pendencia.pediu_decisao", "nucleo.pendencia.decidiu", "nucleo.pendencia.cobrou"]));
  });

  it("uma regra com defeito não derruba a gravação do módulo", async () => {
    await q(`insert into atividade_regras (codigo, nome, fonte, tabela, gatilho, descricao) values ('teste.defeito', 'Defeito', 'auditoria', 'pendencias', 'insert', '{titulo|data}')`);
    const id = await criar(karina, { modulo: MOD, titulo: "não é data", responsavel_id: karina });
    expect(id).toBeTruthy();
    // e as outras regras da mesma gravação continuam registrando
    expect((await atividades("referencia_id = $1", [id])).map((x) => x.codigo)).toEqual(["nucleo.tarefa.criou"]);
    await q(`update atividade_regras set ativa = false where codigo = 'teste.defeito'`);
  });

  it("ninguém altera nem apaga atividade; usuário não insere", async () => {
    await expect(q(`update atividades set descricao = 'x'`)).rejects.toThrow(/não podem ser alteradas/);
    await expect(q(`delete from atividades`)).rejects.toThrow(/não podem ser excluídos/);
    await como(db, karina, async () => {
      await expect(q(`insert into atividades (usuario_id, em, area, modulo, codigo, descricao, referencia_tabela, origem, fonte, fonte_id)
        values ($1, now(), 'financeiro', $2, 'nucleo.tarefa.criou', 'x', 'x', 'direto', 'auditoria', 'x')`, [karina, MOD])).rejects.toThrow(/permission denied/);
    });
  });

  it("reprocessar o histórico é idempotente e classifica o que veio antes de uma regra nova", async () => {
    const antes = (await q(`select count(*)::int n from atividades`)).rows[0].n;
    expect((await q(`select atividades_reprocessar() n`)).rows[0].n).toBe(0);
    expect((await q(`select count(*)::int n from atividades`)).rows[0].n).toBe(antes);

    await q(`insert into atividade_regras (codigo, nome, fonte, tabela, gatilho, campo, valor, descricao)
             values ('teste.iniciou', 'Iniciou', 'auditoria', 'pendencias', 'muda_para', 'status', 'em_andamento', 'Iniciou "{titulo}"')`);
    const id = (await q(`select id from pendencias where titulo = 'Desconto'`)).rows[0].id;
    await q(`alter table auditoria disable trigger trg_atividades_auditoria`);
    await acao(karina, id, "iniciar");
    await q(`alter table auditoria enable trigger trg_atividades_auditoria`);
    expect(await atividades("codigo = 'teste.iniciou'")).toEqual([]);
    await q(`select atividades_reprocessar()`);
    expect(await atividades("codigo = 'teste.iniciou'")).toMatchObject([{ usuario_id: karina, origem: "historico", descricao: 'Iniciou "Desconto"' }]);
    await q(`select atividades_reprocessar()`);
    expect(await atividades("codigo = 'teste.iniciou'")).toHaveLength(1);
    await expect(como(db, karina, () => q(`select atividades_reprocessar()`))).rejects.toThrow(/administrador geral/);
  });
});

describe("quem vê", () => {
  it("cada um vê as próprias; quem acompanha a equipe e o admin veem todas", async () => {
    await criar(aelso, { modulo: "fiscal.creditos", titulo: "Conferir EFD", responsavel_id: aelso });
    expect(await visiveis(karina)).toEqual([karina]);
    expect(await visiveis(aelso)).toEqual([aelso]);
    expect(await visiveis(gestorFin)).toEqual([gestorFin]);           // gestor de área sem a marca: só as dele
    const todos = [gestorFin, karina, aelso].sort();
    expect(await visiveis(rodrigo)).toEqual(expect.arrayContaining(todos));
    expect(await visiveis(admin)).toEqual(expect.arrayContaining(todos));
  });

  it("só o admin liga 'acompanha a equipe'", async () => {
    await como(db, rodrigo, async () => {
      expect((await q(`update perfis set acompanha_equipe = true where id = $1`, [karina])).affectedRows).toBe(0);
    });
    await como(db, karina, async () => {
      expect((await q(`update perfis set acompanha_equipe = true where id = $1`, [karina])).affectedRows).toBe(0);
    });
    expect((await q(`select acompanha_equipe from perfis where id = $1`, [karina])).rows[0].acompanha_equipe).toBe(false);
  });

  it("resumo por pessoa: só quem pode ver; conta ações e pendências concluídas no prazo", async () => {
    const hoje = `(now() at time zone 'America/Cuiaba')::date`;
    const r = (await como(db, rodrigo, () => q(`select * from atividades_resumo(${hoje} - 1, ${hoje})`))).rows;
    const k = r.find((x) => x.usuario_id === karina)!;
    expect(k.acoes).toBeGreaterThanOrEqual(3);
    expect(k.por_tipo["nucleo.pendencia.concluiu"]).toBeGreaterThanOrEqual(1);
    expect(k.concluidas).toBeGreaterThanOrEqual(1);
    const proprio = (await como(db, karina, () => q(`select usuario_id from atividades_resumo(${hoje} - 1, ${hoje})`))).rows;
    expect(proprio.map((x) => x.usuario_id)).toEqual([karina]);
  });
});

describe("acessos", () => {
  it("desligado por padrão: nada é gravado", async () => {
    await acessar(karina, "/financeiro/recebiveis");
    expect((await q(`select count(*)::int n from acessos`)).rows[0].n).toBe(0);
  });

  it("ligado: grava a tela, o módulo, o registro e agrupa na janela de 30 minutos", async () => {
    await ligarAcessos(true);
    const id = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
    await acessar(karina, `/financeiro/recebiveis/${id}`);
    await acessar(karina, `/financeiro/recebiveis/${id}`);
    await acessar(karina, "/gestao?visao=minhas");
    const linhas = (await q(`select rota, area, modulo, referencia_id, vezes from acessos where usuario_id = $1 order by id`, [karina])).rows;
    expect(linhas).toEqual([
      { rota: `/financeiro/recebiveis/${id}`, area: "financeiro", modulo: MOD, referencia_id: id, vezes: 2 },
      { rota: "/gestao?visao=minhas", area: "administrativo", modulo: "administrativo.gestao", referencia_id: null, vezes: 1 },
    ]);
    await q(`update acessos set ultimo_em = now() - interval '31 minutes' where usuario_id = $1`, [karina]);
    await acessar(karina, "/gestao?visao=minhas");
    expect((await q(`select count(*)::int n from acessos where usuario_id = $1`, [karina])).rows[0].n).toBe(3);
  });

  it("visibilidade igual à das atividades; anon não registra nem lê", async () => {
    await acessar(aelso, "/fiscal/creditos");
    const deKarina = (await como(db, karina, () => q(`select distinct usuario_id from acessos`))).rows.map((r) => r.usuario_id);
    expect(deKarina).toEqual([karina]);
    const deRodrigo = (await como(db, rodrigo, () => q(`select distinct usuario_id from acessos`))).rows.map((r) => r.usuario_id);
    expect(deRodrigo).toEqual(expect.arrayContaining([karina, aelso]));
    await como(db, "anon", async () => {
      await expect(q(`select registrar_acesso('/inicio')`)).rejects.toThrow(/permission denied/);
    });
  });

  it("retenção: apaga só o que passou de 12 meses; só serviço ou admin", async () => {
    await q(`update acessos set ultimo_em = now() - interval '13 months' where usuario_id = $1`, [aelso]);
    await expect(como(db, karina, () => q(`select acessos_limpar()`))).rejects.toThrow(/administrador geral/);
    expect((await q(`select acessos_limpar() n`)).rows[0].n).toBe(1);
    expect((await q(`select count(*)::int n from acessos where usuario_id = $1`, [karina])).rows[0].n).toBe(3);
  });

  it("linha do tempo junta atividades e acessos de uma pessoa", async () => {
    const t = (await como(db, rodrigo, () => q(`select tipo, acao from atividades_linha_do_tempo($1) order by em desc`, [karina]))).rows;
    expect(t.some((x) => x.tipo === "acesso")).toBe(true);
    expect(t.some((x) => x.tipo === "atividade" && x.acao === "Concluiu pendência")).toBe(true);
    const sem = (await como(db, rodrigo, () => q(`select tipo from atividades_linha_do_tempo($1, null, null, false)`, [karina]))).rows;
    expect(sem.every((x) => x.tipo === "atividade")).toBe(true);
    await ligarAcessos(false);
  });
});

describe("catálogo dos módulos", () => {
  it("toda regra aponta para tabela, campo, autor e colunas do texto que existem", async () => {
    const regras = (await q(`select codigo, tabela, campo, autor_coluna, descricao, link, modulo, condicao from atividade_regras where codigo not like 'teste.%'`)).rows;
    expect(regras.length).toBeGreaterThan(60);
    const colunas = async (tabela: string) =>
      new Set((await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [tabela])).rows.map((r) => r.column_name));
    const problemas: string[] = [];
    for (const r of regras) {
      const cols = await colunas(r.tabela);
      if (cols.size === 0) { problemas.push(`${r.codigo}: tabela ${r.tabela} não existe`); continue; }
      for (const c of [r.campo, r.autor_coluna].filter(Boolean)) if (!cols.has(c)) problemas.push(`${r.codigo}: coluna ${c}`);
      for (const texto of [r.descricao, r.link].filter(Boolean)) {
        for (const m of (texto as string).matchAll(/\{([a-z0-9_]+)(\|[a-z]+)?\}/g)) if (!cols.has(m[1])) problemas.push(`${r.codigo}: {${m[1]}}`);
      }
      for (const chave of Object.keys(r.condicao ?? {})) if (!cols.has(chave)) problemas.push(`${r.codigo}: condição ${chave}`);
      if (r.modulo && !(await q(`select 1 from modulos where codigo = $1`, [r.modulo])).rows.length) problemas.push(`${r.codigo}: módulo ${r.modulo}`);
    }
    expect(problemas).toEqual([]);
  });

  it("confirmação de pagamento e boleto anexado no Recebíveis viram atividades da pessoa", async () => {
    const titulo = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
    await como(db, karina, async () => {
      await q(`insert into interacoes (modulo, referencia_tabela, referencia_id, canal, tipo, descricao) values ('financeiro.recebiveis', 'rec_titulos', $1, 'telefone', 'confirmacao', 'Cliente confirmou para 25/10')`, [titulo]);
      await q(`insert into anexos (modulo, referencia_tabela, referencia_id, arquivo_path, nome_arquivo, tipo) values ('financeiro.recebiveis', 'rec_titulos', $1, 'financeiro.recebiveis/x.pdf', 'boleto-123.pdf', 'boleto')`, [titulo]);
    });
    const a = await atividades("referencia_id = $1", [titulo]);
    expect(a.map((x) => [x.codigo, x.usuario_id, x.modulo, x.descricao])).toEqual([
      ["fin.cob.confirmou_pagamento", karina, "financeiro.cobranca", "Confirmou pagamento: Cliente confirmou para 25/10"],
      ["fin.rec.anexou_boleto", karina, "financeiro.recebiveis", "Anexou o boleto boleto-123.pdf"],
    ]);
  });

  it("texto com data, mês e moeda no formato brasileiro", async () => {
    const r = (await q(`select atividade_texto('{a|data} {b|mes} {c|moeda} {d}', '{"a":"2026-10-22","b":"2026-09-01","c":"1234.5"}'::jsonb) t`)).rows[0].t;
    expect(r).toBe("22/10/2026 09/2026 R$ 1.234,50 ?");
  });
});
