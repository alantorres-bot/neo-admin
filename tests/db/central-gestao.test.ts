// Central de Gestão (migration 0092): colunas novas de `pendencias`, regras do gatilho, leitura pelo responsável,
// destaque gerencial e funções de leitura da Central. Especificação: docs/modulos/administrativo-gestao.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let rodrigo: string, finOperador: string, finOperador2: string, finGestor: string, fiscalOperador: string, rhGestor: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const MOD = "financeiro.recebiveis";
const TODAS_AS_AREAS = ["financeiro", "fiscal", "contratos", "juridico", "rh", "administrativo", "comercial", "estoques"];

type Nova = {
  modulo?: string; titulo?: string; responsavel?: string | null; prazoDias?: number | null; criticidade?: string;
  origem?: string; precisaDistribuir?: boolean;
};

/** Pendência criada como serviço (como os publicadores); prazo relativo a hoje em Cuiabá. */
async function nova(o: Nova = {}): Promise<string> {
  const r = await q(
    `insert into pendencias (modulo, titulo, responsavel_id, prazo, criticidade, origem, precisa_distribuir)
     values ($1, $2, $3, case when $4::int is null then null else (now() at time zone 'America/Cuiaba')::date + $4::int end,
             $5::criticidade, $6, $7) returning id`,
    [o.modulo ?? MOD, o.titulo ?? `P ${Math.random()}`, o.responsavel ?? null, o.prazoDias ?? null, o.criticidade ?? "normal",
      o.origem ?? "modulo", o.precisaDistribuir ?? false],
  );
  return r.rows[0].id;
}

/** Destaque de uma pendência com "hoje" = hoje em Cuiabá e os parâmetros vigentes. */
async function destaque(id: string, impede = 0): Promise<{ nivel: string; precisa_distribuir: boolean; motivos: Linha[] }> {
  const r = await q(
    `select pendencia_destaque(p, (now() at time zone 'America/Cuiaba')::date, central_parametros(), $2) as d
       from pendencias p where id = $1`,
    [id, impede],
  );
  return r.rows[0].d;
}
const codigos = (d: { motivos: Linha[] }) => d.motivos.map((m) => m.codigo);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");   // o primeiro usuário vira admin_geral (migration 0003)
  rodrigo = await novoUsuario(db, "rodrigo@neo.com", Object.fromEntries(TODAS_AS_AREAS.map((a) => [a, "gestor"])));
  finOperador = await novoUsuario(db, "fin.operador@neo.com", { financeiro: "operador" });
  finOperador2 = await novoUsuario(db, "fin.operador2@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "fin.gestor@neo.com", { financeiro: "gestor" });
  fiscalOperador = await novoUsuario(db, "fiscal.operador@neo.com", { fiscal: "operador" });
  rhGestor = await novoUsuario(db, "rh.gestor@neo.com", { rh: "gestor" });
});

describe("migration 0092: preenchimento das linhas existentes", () => {
  it("movimentado_em recebe a conclusão ou a criação, sem gerar auditoria", async () => {
    const antigo = await criarBanco({ ate: "0091_nucleo_area_comercial.sql" });
    await antigo.exec(`
      insert into pendencias (modulo, titulo, criado_em) values ('financeiro.recebiveis', 'Aberta antiga', '2026-01-10 12:00Z');
      insert into pendencias (modulo, titulo, criado_em, status, concluido_em)
        values ('financeiro.recebiveis', 'Concluída antiga', '2026-01-10 12:00Z', 'concluida', '2026-02-01 12:00Z');`);
    const auditoria = `select count(*)::int n from auditoria where tabela = 'pendencias'`;
    const auditoriaAntes = (await antigo.query<Linha>(auditoria)).rows[0].n;
    await antigo.exec(readFileSync(join(process.cwd(), "supabase/migrations/0092_nucleo_central_gestao.sql"), "utf8"));
    const linhas = (await antigo.query<Linha>(`select titulo, movimentado_em, origem from pendencias order by titulo`)).rows;
    expect(new Date(linhas[0].movimentado_em).toISOString()).toBe("2026-01-10T12:00:00.000Z");
    expect(new Date(linhas[1].movimentado_em).toISOString()).toBe("2026-02-01T12:00:00.000Z");
    expect(linhas.every((l) => l.origem === "modulo")).toBe(true);
    expect((await antigo.query<Linha>(auditoria)).rows[0].n).toBe(auditoriaAntes);
    await antigo.close();
  });
});

describe("gatilho: campos novos", () => {
  it("criado_por e origem são carimbados e não mudam depois", async () => {
    const id = await como(db, finOperador, async () =>
      (await q(`insert into pendencias (modulo, titulo, origem, criado_por) values ($1, 'Manual', 'manual', $2) returning id`,
        [MOD, finGestor])).rows[0].id);
    const r = (await q(`select criado_por, origem from pendencias where id = $1`, [id])).rows[0];
    expect(r.criado_por).toBe(finOperador);
    expect(r.origem).toBe("manual");
    await como(db, finGestor, () => q(`update pendencias set origem = 'modulo', criado_por = $2, chave_origem = 'x' where id = $1`, [id, finGestor]));
    const depois = (await q(`select criado_por, origem, chave_origem from pendencias where id = $1`, [id])).rows[0];
    expect(depois).toEqual({ criado_por: finOperador, origem: "manual", chave_origem: null });
  });

  it("bloqueio: o responsável bloqueia e o banco carimba; outro operador não; desbloquear limpa a marca", async () => {
    const id = await nova({ responsavel: finOperador });
    await como(db, finOperador, () => q(`update pendencias set bloqueio_motivo = '  Aguardando o extrato do banco ' where id = $1`, [id]));
    let r = (await q(`select status, bloqueio_motivo, bloqueada_por, bloqueada_em from pendencias where id = $1`, [id])).rows[0];
    expect(r.status).toBe("aberta");                       // a marca não muda o status
    expect(r.bloqueio_motivo).toBe("Aguardando o extrato do banco");
    expect(r.bloqueada_por).toBe(finOperador);
    expect(r.bloqueada_em).not.toBeNull();

    const semDono = await nova();
    await como(db, finOperador2, async () => {
      await expect(q(`update pendencias set bloqueio_motivo = 'x' where id = $1`, [semDono])).rejects.toThrow(/responsável ou o gestor/);
    });

    await como(db, finOperador, () => q(`update pendencias set bloqueio_motivo = null where id = $1`, [id]));
    r = (await q(`select bloqueada_por, bloqueada_em from pendencias where id = $1`, [id])).rows[0];
    expect(r).toEqual({ bloqueada_por: null, bloqueada_em: null });
  });

  it("pedido de decisão: o responsável liga; só o gestor desliga", async () => {
    const id = await nova({ responsavel: finOperador });
    await como(db, finOperador, () => q(`update pendencias set aguarda_gestor_motivo = 'Aprovar desconto de 5%' where id = $1`, [id]));
    expect((await q(`select aguarda_gestor_por from pendencias where id = $1`, [id])).rows[0].aguarda_gestor_por).toBe(finOperador);
    await como(db, finOperador, async () => {
      await expect(q(`update pendencias set aguarda_gestor_motivo = null where id = $1`, [id])).rejects.toThrow(/gestor da área responde/);
    });
    await como(db, finGestor, () => q(`update pendencias set aguarda_gestor_motivo = null where id = $1`, [id]));
    expect((await q(`select aguarda_gestor_em from pendencias where id = $1`, [id])).rows[0].aguarda_gestor_em).toBeNull();
  });

  it("categoria, 'precisa distribuir', impacto e ajuste do destaque: só o gestor", async () => {
    const id = await nova({ responsavel: finOperador });
    await como(db, finOperador, async () => {
      await expect(q(`update pendencias set precisa_distribuir = true where id = $1`, [id])).rejects.toThrow(/gestor da área altera/);
      await expect(q(`update pendencias set categoria = 'cobranca' where id = $1`, [id])).rejects.toThrow(/gestor da área altera/);
      await expect(q(`update pendencias set impacto = 'fiscal', impacto_fundamento = 'x' where id = $1`, [id])).rejects.toThrow(/gestor da área altera/);
      await expect(q(`update pendencias set destaque_manual = 'intervir', destaque_motivo = 'x' where id = $1`, [id])).rejects.toThrow(/ajusta o destaque/);
      await expect(q(`insert into pendencias (modulo, titulo, precisa_distribuir) values ($1, 'x', true)`, [MOD])).rejects.toThrow(/Somente o gestor/);
    });
    await como(db, finGestor, () => q(`update pendencias set destaque_manual = 'intervir', destaque_motivo = 'Cliente estratégico' where id = $1`, [id]));
    const r = (await q(`select destaque_por, destaque_em from pendencias where id = $1`, [id])).rows[0];
    expect(r.destaque_por).toBe(finGestor);
    expect(r.destaque_em).not.toBeNull();
  });

  it("impacto e ajuste do destaque exigem justificativa escrita", async () => {
    const id = await nova();
    await expect(q(`update pendencias set impacto = 'fiscal' where id = $1`, [id])).rejects.toThrow(/ck_pendencias_impacto/);
    await como(db, finGestor, async () => {
      await expect(q(`update pendencias set destaque_manual = 'normal', destaque_motivo = '  ' where id = $1`, [id])).rejects.toThrow(/ck_pendencias_destaque/);
    });
  });

  it("tarefa manual: só o gestor ou quem criou cancela; pendência de módulo segue a regra de antes", async () => {
    const manual = await como(db, finOperador, async () =>
      (await q(`insert into pendencias (modulo, titulo, origem) values ($1, 'Minha tarefa', 'manual') returning id`, [MOD])).rows[0].id);
    await como(db, finGestor, () => q(`update pendencias set responsavel_id = $2 where id = $1`, [manual, finOperador2]));
    await como(db, finOperador2, async () => {
      await expect(q(`update pendencias set status = 'cancelada' where id = $1`, [manual])).rejects.toThrow(/quem criou cancela/);
    });
    const doModulo = await nova({ responsavel: finOperador2 });
    await como(db, finOperador2, () => q(`update pendencias set status = 'cancelada' where id = $1`, [doModulo]));
    expect((await q(`select status from pendencias where id = $1`, [doModulo])).rows[0].status).toBe("cancelada");
  });

  it("movimentado_em: ação humana atualiza; reescrita da sincronização e o valor informado pelo usuário não", async () => {
    const id = await nova({ responsavel: finOperador });
    await q(`update pendencias set movimentado_em = '2026-01-01 12:00Z' where id = $1`, [id]);   // serviço: preservado
    expect(new Date((await q(`select movimentado_em m from pendencias where id = $1`, [id])).rows[0].m).getUTCFullYear()).toBeGreaterThan(2025);
    await q(`alter table pendencias disable trigger trg_pendencias_regras`);
    await q(`update pendencias set movimentado_em = '2026-01-01 12:00Z' where id = $1`, [id]);
    await q(`alter table pendencias enable trigger trg_pendencias_regras`);

    await q(`update pendencias set titulo = 'Título reescrito pela sincronização', descricao = 'nova' where id = $1`, [id]);
    expect(new Date((await q(`select movimentado_em m from pendencias where id = $1`, [id])).rows[0].m).toISOString()).toBe("2026-01-01T12:00:00.000Z");

    await como(db, finOperador, () => q(`update pendencias set status = 'em_andamento', movimentado_em = '2020-01-01' where id = $1`, [id]));
    const m = new Date((await q(`select movimentado_em m from pendencias where id = $1`, [id])).rows[0].m);
    expect(Date.now() - m.getTime()).toBeLessThan(60_000);
  });

  it("as regras de antes continuam: operador não reatribui nem edita; gestor sim", async () => {
    const id = await nova({ responsavel: finOperador });
    await como(db, finOperador, async () => {
      await expect(q(`update pendencias set titulo = 'outro' where id = $1`, [id])).rejects.toThrow(/gestor da área altera os dados/);
      await expect(q(`update pendencias set responsavel_id = $2 where id = $1`, [id, finOperador2])).rejects.toThrow(/reatribui/);
    });
    await como(db, finGestor, () => q(`update pendencias set responsavel_id = $2 where id = $1`, [id, finOperador2]));
    expect((await q(`select responsavel_id from pendencias where id = $1`, [id])).rows[0].responsavel_id).toBe(finOperador2);
    await expect(q(`delete from pendencias where id = $1`, [id])).rejects.toThrow(/não podem ser excluídos/);
  });
});

describe("leitura pelo responsável e por quem criou", () => {
  it("quem recebe uma tarefa de outra área a enxerga; os demais da área dele, não", async () => {
    const id = await como(db, rodrigo, async () =>
      (await q(`insert into pendencias (modulo, titulo, origem, responsavel_id) values ('administrativo.gestao', 'Levantar contratos', 'manual', $1) returning id`,
        [fiscalOperador])).rows[0].id);
    const ve = async (quem: string) => (await como(db, quem, () => q(`select id from pendencias where id = $1`, [id]))).rows.length;
    expect(await ve(fiscalOperador)).toBe(1);
    expect(await ve(rodrigo)).toBe(1);
    expect(await ve(finGestor)).toBe(0);
    expect(await ve(rhGestor)).toBe(0);
  });

  it("gestor de outra área não reatribui; Rodrigo (gestor em todas) sim", async () => {
    const id = await nova({ modulo: "fiscal.creditos", responsavel: fiscalOperador });
    await como(db, finGestor, async () => {
      expect((await q(`update pendencias set responsavel_id = $2 where id = $1`, [id, finOperador])).affectedRows).toBe(0);
    });
    await como(db, rodrigo, () => q(`update pendencias set responsavel_id = $2 where id = $1`, [id, rodrigo]));
    expect((await q(`select responsavel_id from pendencias where id = $1`, [id])).rows[0].responsavel_id).toBe(rodrigo);
  });
});

describe("destaque gerencial", () => {
  it("prazo: próximo, hoje, atraso simples e atraso relevante (acima de 5 dias ou prioridade crítica)", async () => {
    const proximo = await destaque(await nova({ responsavel: finOperador, prazoDias: 3 }));
    expect(proximo.nivel).toBe("acompanhar");
    expect(proximo.motivos[0]).toMatchObject({ codigo: "PRAZO_PROXIMO", dias: 3 });

    expect(codigos(await destaque(await nova({ responsavel: finOperador, prazoDias: 4 })))).toEqual([]);
    expect(codigos(await destaque(await nova({ responsavel: finOperador, prazoDias: 0 })))).toEqual(["VENCE_HOJE"]);

    const simples = await destaque(await nova({ responsavel: finOperador, prazoDias: -5 }));
    expect(simples.nivel).toBe("acompanhar");
    expect(simples.motivos[0]).toMatchObject({ codigo: "ATRASO_SIMPLES", dias: 5 });

    const relevante = await destaque(await nova({ responsavel: finOperador, prazoDias: -6 }));
    expect(relevante.nivel).toBe("intervir");
    expect(relevante.motivos[0]).toMatchObject({ codigo: "ATRASO_RELEVANTE", dias: 6, limite: 5 });

    const critica = await destaque(await nova({ responsavel: finOperador, prazoDias: -1, criticidade: "critica" }));
    expect(critica.motivos[0]).toMatchObject({ codigo: "ATRASO_RELEVANTE", prioridade_critica: true });
  });

  it("prioridade alta ou crítica, sozinha, não vira intervenção", async () => {
    expect((await destaque(await nova({ responsavel: finOperador, prazoDias: 10, criticidade: "critica" }))).nivel).toBe("normal");
    // sem prazo, pede avaliação (desde a 0097 também nas de módulo) — mas nunca intervenção
    expect((await destaque(await nova({ responsavel: finOperador, criticidade: "alta" }))).nivel).toBe("avaliar");
  });

  it("precisa distribuir: tarefa manual sem dono ou marcada; automática sem dono é fila da área", async () => {
    const automatica = await destaque(await nova({ prazoDias: 1 }));
    expect(automatica.precisa_distribuir).toBe(false);
    expect(codigos(automatica)).toEqual(["PRAZO_PROXIMO"]);

    const manualFolgada = await destaque(await nova({ origem: "manual", prazoDias: 20 }));
    expect(manualFolgada).toMatchObject({ nivel: "acompanhar", precisa_distribuir: true });

    const manualUrgente = await destaque(await nova({ origem: "manual", prazoDias: 2 }));
    expect(manualUrgente.nivel).toBe("intervir");
    expect(codigos(manualUrgente)).toContain("PRECISA_DISTRIBUIR");

    const marcada = await destaque(await nova({ precisaDistribuir: true, criticidade: "alta" }));
    expect(marcada.nivel).toBe("intervir");
  });

  it("aguardando gestor e bloqueio relevante exigem intervenção; bloqueio recente é acompanhamento", async () => {
    const decisao = await nova({ responsavel: finOperador });
    await como(db, finOperador, () => q(`update pendencias set aguarda_gestor_motivo = 'Autorizar' where id = $1`, [decisao]));
    expect((await destaque(decisao)).motivos[0]).toMatchObject({ codigo: "AGUARDA_GESTOR", nivel: "intervir", motivo: "Autorizar" });

    const recente = await nova({ responsavel: finOperador });
    await q(`update pendencias set bloqueio_motivo = 'Sem retorno do contador' where id = $1`, [recente]);
    expect((await destaque(recente))).toMatchObject({ nivel: "acompanhar" });

    const antigo = await nova({ responsavel: finOperador });
    await q(`update pendencias set bloqueio_motivo = 'Sem retorno do contador', bloqueada_em = now() - interval '3 days' where id = $1`, [antigo]);
    expect((await destaque(antigo)).motivos[0]).toMatchObject({ codigo: "BLOQUEIO_RELEVANTE", dias: 3, limite: 2 });

    expect((await destaque(await nova({ responsavel: finOperador }), 2)).motivos[0]).toMatchObject({ codigo: "IMPEDE_OUTRA", quantidade: 2 });
  });

  it("impacto registrado com fundamento e prazo próximo exige intervenção; sem prazo próximo, não", async () => {
    const id = await nova({ responsavel: finOperador, prazoDias: 1 });
    await q(`update pendencias set impacto = 'fiscal', impacto_fundamento = 'Multa por atraso na entrega da obrigação X' where id = $1`, [id]);
    expect(codigos(await destaque(id))).toContain("IMPACTO_REGISTRADO");

    const longe = await nova({ responsavel: finOperador, prazoDias: 30 });
    await q(`update pendencias set impacto = 'financeiro', impacto_fundamento = 'Juros' where id = $1`, [longe]);
    expect((await destaque(longe)).nivel).toBe("normal");
  });

  it("sem movimentação além do limite e tarefa importante sem prazo (avaliar)", async () => {
    const parada = await nova({ responsavel: finOperador });
    await q(`alter table pendencias disable trigger trg_pendencias_regras`);
    await q(`update pendencias set movimentado_em = now() - interval '6 days' where id = $1`, [parada]);
    await q(`alter table pendencias enable trigger trg_pendencias_regras`);
    expect((await destaque(parada)).motivos[0]).toMatchObject({ codigo: "SEM_MOVIMENTACAO", dias: 6, limite: 5 });

    const semPrazo = await destaque(await nova({ responsavel: finOperador, origem: "manual", criticidade: "alta" }));
    expect(semPrazo.nivel).toBe("avaliar");
    expect(codigos(semPrazo)).toEqual(["SEM_PRAZO_IMPORTANTE"]);
  });

  it("ajuste manual prevalece e os motivos calculados continuam visíveis", async () => {
    const id = await nova({ responsavel: finOperador, prazoDias: -10 });
    await como(db, finGestor, () => q(`update pendencias set destaque_manual = 'acompanhar', destaque_motivo = 'Cliente já pagou, aguardando baixa' where id = $1`, [id]));
    const d = await destaque(id);
    expect(d.nivel).toBe("acompanhar");
    expect(codigos(d)).toEqual(["ATRASO_RELEVANTE", "AJUSTE_MANUAL"]);
  });

  it("os limites vêm de configuracoes", async () => {
    const id = await nova({ responsavel: finOperador, prazoDias: -3 });
    expect((await destaque(id)).nivel).toBe("acompanhar");
    await q(`update configuracoes set valor = '2' where chave = 'administrativo.gestao.dias_atraso_relevante'`);
    expect((await destaque(id)).nivel).toBe("intervir");
    await q(`update configuracoes set valor = '5' where chave = 'administrativo.gestao.dias_atraso_relevante'`);
  });

  it("pendência encerrada não tem destaque", async () => {
    const id = await nova({ responsavel: finOperador, prazoDias: -30, status: undefined } as Nova);
    await q(`update pendencias set status = 'concluida' where id = $1`, [id]);
    expect(await destaque(id)).toMatchObject({ nivel: "normal", motivos: [] });
  });
});

describe("funções da Central", () => {
  let base: PGlite;
  let gestor: string, operador: string, outro: string;
  const qb = (sql: string, p: unknown[] = []) => base.query<Linha>(sql, p);
  const inserir = (titulo: string, extra: string) =>
    qb(`insert into pendencias (modulo, titulo, responsavel_id, prazo, criticidade, origem)
        select 'financeiro.recebiveis', $1, r, p, c::criticidade, o from (select ${extra}) v(r, p, c, o) returning id`, [titulo]);

  beforeAll(async () => {
    base = await criarBanco();
    await novoUsuario(base, "admin@neo.com");   // o primeiro usuário vira admin_geral (migration 0003)
    gestor = await novoUsuario(base, "gestor@neo.com", { financeiro: "gestor" });
    operador = await novoUsuario(base, "operador@neo.com", { financeiro: "operador" });
    outro = await novoUsuario(base, "outro@neo.com", { financeiro: "operador", fiscal: "operador" });
    const hoje = `(now() at time zone 'America/Cuiaba')::date`;
    await inserir("Atrasada e bloqueada", `'${operador}'::uuid, ${hoje} - 7, 'normal', 'modulo'`);
    await inserir("Vence hoje", `'${operador}'::uuid, ${hoje}, 'normal', 'modulo'`);
    await inserir("Manual sem dono", `null::uuid, ${hoje} + 1, 'alta', 'manual'`);
    await inserir("Automática sem dono", `null::uuid, ${hoje} + 10, 'normal', 'modulo'`);
    await inserir("Do outro", `'${outro}'::uuid, ${hoje} - 1, 'normal', 'modulo'`);
    await qb(`insert into pendencias (modulo, titulo, responsavel_id, prazo) values ('fiscal.creditos', 'Fiscal do outro', $1, (now() at time zone 'America/Cuiaba')::date)`, [outro]);
    await qb(`insert into pendencias (modulo, titulo, responsavel_id, status) values ('financeiro.recebiveis', 'Concluída', $1, 'concluida')`, [operador]);
    await qb(`update pendencias set bloqueio_motivo = 'Aguardando extrato' where titulo = 'Atrasada e bloqueada'`);
  });

  const resumo = async (quem: string, visao: string, filtros: object = {}) =>
    (await como(base, quem, () => qb(`select * from central_resumo($1, $2)`, [visao, JSON.stringify(filtros)]))).rows[0];
  const titulos = async (quem: string, visao: string, filtros: object = {}) =>
    (await como(base, quem, () => qb(`select titulo from central_pendencias($1, $2) order by titulo`, [visao, JSON.stringify(filtros)])))
      .rows.map((r) => r.titulo);

  it("visão do gestor: todas as abertas das áreas que gerencia; os recortes não somam com o total", async () => {
    const r = await resumo(gestor, "gestao");
    expect(r).toEqual({ em_aberto: 5, atrasadas: 2, vencem_hoje: 1, intervir: 2, aguarda_gestor: 0, bloqueadas: 1, distribuir: 1 });
    // "Atrasada e bloqueada" conta em atrasadas, bloqueadas e intervir: os recortes se sobrepõem.
    expect(r.atrasadas + r.vencem_hoje + r.intervir + r.bloqueadas + r.distribuir).toBeGreaterThan(r.em_aberto);
  });

  it("visão 'minhas': as do usuário e as sem dono dos módulos em que é operador", async () => {
    expect(await titulos(operador, "minhas")).toEqual(["Atrasada e bloqueada", "Automática sem dono", "Manual sem dono", "Vence hoje"]);
    expect(await titulos(outro, "minhas")).toEqual(["Automática sem dono", "Do outro", "Fiscal do outro", "Manual sem dono"]);
  });

  it("operador que pede a visão de gestão não vê pendências alheias", async () => {
    expect(await titulos(operador, "gestao")).toEqual(["Atrasada e bloqueada", "Vence hoje"]);
  });

  it("filtros e recortes", async () => {
    expect(await titulos(gestor, "gestao", { recorte: "atrasadas" })).toEqual(["Atrasada e bloqueada", "Do outro"]);
    expect(await titulos(gestor, "gestao", { recorte: "distribuir" })).toEqual(["Manual sem dono"]);
    expect(await titulos(gestor, "gestao", { responsavel: "sem" })).toEqual(["Automática sem dono", "Manual sem dono"]);
    expect(await titulos(gestor, "gestao", { responsavel: outro })).toEqual(["Do outro"]);
    expect(await titulos(gestor, "gestao", { origem: "manual" })).toEqual(["Manual sem dono"]);
    expect(await titulos(gestor, "gestao", { situacao: "bloqueada" })).toEqual(["Atrasada e bloqueada"]);
    expect(await titulos(gestor, "gestao", { situacao: "concluida" })).toEqual(["Concluída"]);
    expect(await titulos(gestor, "gestao", { busca: "HOJE" })).toEqual(["Vence hoje"]);
    expect(await titulos(gestor, "gestao", { destaque: "intervir" })).toEqual(["Atrasada e bloqueada", "Manual sem dono"]);
    expect(await titulos(gestor, "gestao", { area: "fiscal" })).toEqual([]);
    // os indicadores ignoram o recorte escolhido (mostram sempre o quadro completo dos filtros do cabeçalho)
    expect((await resumo(gestor, "gestao", { recorte: "atrasadas" })).em_aberto).toBe(5);
  });

  it("motivos e momento do cálculo acompanham cada linha", async () => {
    const r = (await como(base, gestor, () => qb(`select destaque, motivos, calculado_em from central_pendencias('gestao', '{"busca":"bloqueada"}')`))).rows[0];
    expect(r.destaque).toBe("intervir");
    expect(r.motivos.map((m: Linha) => m.codigo)).toEqual(["ATRASO_RELEVANTE", "BLOQUEADA"]);
    expect(r.calculado_em).not.toBeNull();
  });

  it("equipe: contagem por pessoa só com o que o gestor enxerga", async () => {
    const linhas = (await como(base, gestor, () => qb(`select nome, abertas, atrasadas, vencem_hoje, bloqueadas from central_equipe('{}')`))).rows;
    expect(linhas).toEqual([
      { nome: "operador", abertas: 2, atrasadas: 1, vencem_hoje: 1, bloqueadas: 1 },
      { nome: "outro", abertas: 1, atrasadas: 1, vencem_hoje: 0, bloqueadas: 0 },   // a do Fiscal não entra: o gestor não é do Fiscal
    ]);
  });

  it("detalhe por id: qualquer pendência visível, inclusive encerrada; invisível não volta", async () => {
    const concluida = (await qb(`select id from pendencias where titulo = 'Concluída'`)).rows[0].id;
    const fiscal = (await qb(`select id from pendencias where titulo = 'Fiscal do outro'`)).rows[0].id;
    expect(await titulos(gestor, "gestao", { id: concluida })).toEqual(["Concluída"]);
    expect(await titulos(gestor, "gestao", { id: fiscal })).toEqual([]);
  });

  it("anon não executa as funções da Central", async () => {
    await como(base, "anon", async () => {
      await expect(qb(`select * from central_resumo('gestao', '{}')`)).rejects.toThrow(/permission denied/);
    });
  });
});
