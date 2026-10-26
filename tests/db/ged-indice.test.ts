// GED A1a (migration 0806): tabelas do índice, gravação idempotente pela camada pura (aplicarPaginaNoIndice + loteParaGravar) e
// autorização por raiz (11.5, itens 3, 4, 8, 9 e 10). Dados fictícios; nenhum Drive: as mudanças são montadas no teste.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";
import {
  aplicarPaginaNoIndice,
  loteParaGravar,
  MIME_PASTA,
  type ArquivoDrive,
  type DocumentoIndice,
  type PastaIndice,
} from "../../supabase/functions/_shared/ged";

const ELABORACAO = "1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR";
const DOSSIE = "1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak";

let db: PGlite;
let admin: string, ctrOperador: string, ctrConsulta: string, comercial: string, financeiro: string, restrito: string;
let elab: string, dossie: string;
const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const um = async (sql: string, p: unknown[] = []) => (await servico(sql, p)).rows[0];
const negado = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied/);

const pasta = (id: string, mae: string): ArquivoDrive => ({ id, name: `Pasta ficticia ${id}`, mimeType: MIME_PASTA, parents: [mae] });
const arq = (id: string, mae: string, rev = "r1"): ArquivoDrive => ({
  id, name: `Contrato ficticio ${id}.pdf`, mimeType: "application/pdf", parents: [mae], headRevisionId: rev, size: "10",
});

/** Índice em memória com a raiz (profundidade 0), como a Edge Function montaria a partir do banco. */
function indice(raizDrive: string) {
  const raiz: PastaIndice = { driveId: raizDrive, maeDriveId: null, nome: "Raiz", profundidade: 0, situacao: "ativa" };
  return { pastas: new Map([[raizDrive, raiz]]), documentos: new Map<string, DocumentoIndice>(), profundidadeMax: 4 };
}

const iniciar = (raiz: string, tipo = "inicial") => um(`select ged_iniciar_indexacao($1, $2, false, $3) id`, [raiz, tipo, admin]).then((r) => r.id as string);
const gravar = (rodada: string, lote: { pastas: unknown[]; documentos: unknown[] }) =>
  um(`select ged_gravar_indice($1, $2, $3) r`, [rodada, JSON.stringify(lote.pastas), JSON.stringify(lote.documentos)]).then((r) => r.r);
const concluir = (rodada: string, token: string | null, erro: string | null = null) =>
  servico(`select ged_concluir_indexacao($1, $2, $3, $4)`, [rodada, JSON.stringify({ novos: 1 }), token, erro]);

/** Uma rodada inteira: raiz no índice + mudanças aplicadas pela camada pura + gravação + conclusão. */
async function rodada(raizId: string, raizDrive: string, mudancas: ArquivoDrive[], token = "tok-1") {
  const id = await iniciar(raizId);
  const raizNoIndice = { drive_id: raizDrive, nome: "Raiz", mae_drive_id: null, profundidade: 0, situacao: "ativa" };
  const lote = loteParaGravar(aplicarPaginaNoIndice(mudancas.map((f) => ({ fileId: f.id, file: f })), indice(raizDrive)));
  const r = await gravar(id, { pastas: [raizNoIndice, ...lote.pastas], documentos: lote.documentos });
  await concluir(id, token);
  return { id, r };
}
const ver = (quem: string, tabela: string) => como(db, quem, () => q(`select drive_id from ${tabela} order by drive_id`)).then((r) => r.rows.map((x) => x.drive_id));

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@exemplo.invalid");
  ctrOperador = await novoUsuario(db, "ctr.op@exemplo.invalid", { contratos: "operador" });
  ctrConsulta = await novoUsuario(db, "ctr.consulta@exemplo.invalid", { contratos: "consulta" });
  comercial = await novoUsuario(db, "comercial@exemplo.invalid", { comercial: "consulta" });
  financeiro = await novoUsuario(db, "fin@exemplo.invalid", { financeiro: "gestor" });
  restrito = await novoUsuario(db, "filial@exemplo.invalid", { contratos: "gestor", comercial: "gestor" });
  await q(`update perfis set unidade_restrita = 'contagem' where id = $1`, [restrito]);
  const cadastrar = (drive: string, leitura: string[]) =>
    um(`select ged_cadastrar_raiz($1, $2, 'Raiz ficticia', null, 'contratos', $3, 'contratos') id`, [admin, drive, leitura]).then((r) => r.id as string);
  elab = await cadastrar(ELABORACAO, []);
  dossie = await cadastrar(DOSSIE, ["comercial"]);
  for (const [id, drive] of [[elab, ELABORACAO], [dossie, DOSSIE]]) {
    await servico(`select ged_registrar_verificacao_raiz($1, $2, 3, 'ok')`, [admin, drive]);
    await como(db, admin, () => q(`select ged_definir_situacao_raiz($1, 'ativa')`, [id]));
  }
}, 120_000);

describe("interruptor e pré-condições (5.3.0, 5.3.5, 5.3.7)", () => {
  it("desligada por padrão: nenhuma rodada começa", async () => {
    expect((await q(`select valor from configuracoes where chave = 'administrativo.ged.indexar'`)).rows[0].valor).toBe(false);
    await expect(iniciar(elab)).rejects.toThrow(/ged:indexacao_desligada/);
    // 0807: o agendamento nem chama a função com o interruptor desligado (sem net.http_post).
    expect((await q(`select ged_chamar_indexacao() r`)).rows[0].r).toBeNull();
    for (const papel of ["anon", "authenticated", "service_role"]) {
      expect((await q(`select has_function_privilege($1, 'ged_chamar_indexacao()', 'execute') ok`, [papel])).rows[0].ok, papel).toBe(false);
    }
    expect((await q(`select count(*)::int n from ged_indexacoes`)).rows[0].n).toBe(0);
    await q(`update configuracoes set valor = 'true' where chave = 'administrativo.ged.indexar'`);
  });

  it("só raiz ativa; tipo da lista; uma rodada por vez; só a rodada com a trava grava", async () => {
    await como(db, admin, () => q(`select ged_definir_situacao_raiz($1, 'inativa')`, [dossie]));
    await expect(iniciar(dossie)).rejects.toThrow(/ged:raiz_inativa/);
    await como(db, admin, () => q(`select ged_definir_situacao_raiz($1, 'ativa')`, [dossie]));
    await expect(iniciar(elab, "tudo")).rejects.toThrow(/ged:tipo_invalido/);
    const r1 = await iniciar(elab);
    await expect(iniciar(dossie)).rejects.toThrow(/ged:em_andamento/);
    expect((await q(`select count(*)::int n from ged_indexacoes`)).rows[0].n).toBe(1); // a recusada não deixa linha
    await concluir(r1, null, "teste_interrompido");
    await expect(gravar(r1, { pastas: [], documentos: [] })).rejects.toThrow(/ged:rodada_invalida/);
    await expect(concluir(r1, "x")).rejects.toThrow(/ged:rodada_invalida/);
    expect((await q(`select page_token from ged_pastas_raiz where id = $1`, [elab])).rows[0].page_token).toBeNull(); // erro: token não avança
  });
});

describe("gravação pela camada pura (5.3.1–5.3.3)", () => {
  const ARVORE_ELAB = [pasta("E1", ELABORACAO), arq("ed1", "E1"), arq("ed2", ELABORACAO), { ...arq("ew", "E1"), name: "~WRL0001.tmp" }];
  const ARVORE_DOSSIE = [pasta("C1", DOSSIE), arq("cd1", "C1")];

  it("carga grava pastas, documentos e revisões; temporário fica `ignorado`; token e data só na conclusão sem erro", async () => {
    const { r } = await rodada(elab, ELABORACAO, ARVORE_ELAB);
    expect(r).toEqual({ pastas: 2, documentos: 3, revisoes: 3 });
    expect((await q(`select drive_id, situacao from ged_documentos order by drive_id`)).rows).toEqual([
      { drive_id: "ed1", situacao: "vigente" }, { drive_id: "ed2", situacao: "vigente" }, { drive_id: "ew", situacao: "ignorado" },
    ]);
    const raiz = (await q(`select page_token, indexada_em is not null indexada from ged_pastas_raiz where id = $1`, [elab])).rows[0];
    expect(raiz).toEqual({ page_token: "tok-1", indexada: true });
    expect((await q(`select resumo, erro from ged_indexacoes order by iniciada_em desc limit 1`)).rows[0]).toEqual({ resumo: { novos: 1 }, erro: null });
    await rodada(dossie, DOSSIE, ARVORE_DOSSIE);
  });

  it("idempotente: a mesma rodada de novo não duplica nada; revisão nova só quando muda", async () => {
    const antes = (await q(`select (select count(*) from ged_pastas)::int p, (select count(*) from ged_documentos)::int d, (select count(*) from ged_documento_revisoes)::int r`)).rows[0];
    await rodada(elab, ELABORACAO, ARVORE_ELAB, "tok-2");
    expect((await q(`select (select count(*) from ged_pastas)::int p, (select count(*) from ged_documentos)::int d, (select count(*) from ged_documento_revisoes)::int r`)).rows[0]).toEqual(antes);
    await rodada(elab, ELABORACAO, [pasta("E1", ELABORACAO), arq("ed1", "E1", "r2")], "tok-3");
    expect((await q(`select r.drive_revisao from ged_documento_revisoes r join ged_documentos d on d.id = r.documento_id where d.drive_id = 'ed1' order by 1`)).rows
      .map((x) => x.drive_revisao)).toEqual(["r1", "r2"]);
    expect((await q(`select page_token from ged_pastas_raiz where id = $1`, [elab])).rows[0].page_token).toBe("tok-3");
  });

  it("`substituido` (decisão de pessoa) não é sobrescrito; nunca há delete", async () => {
    await q(`update ged_documentos set situacao = 'substituido' where drive_id = 'ed2'`);
    await rodada(elab, ELABORACAO, ARVORE_ELAB, "tok-4");
    expect((await q(`select situacao from ged_documentos where drive_id = 'ed2'`)).rows[0].situacao).toBe("substituido");
    for (const t of ["ged_pastas", "ged_documentos", "ged_documento_revisoes", "ged_indexacoes"]) {
      await expect(q(`delete from ${t}`)).rejects.toThrow(/não podem ser excluídos/);
    }
  });

  it("um item, uma raiz; documento sem pasta no índice é recusado (sem órfão)", async () => {
    const id = await iniciar(dossie);
    await expect(gravar(id, { pastas: [], documentos: [{ drive_id: "ed1", pasta_drive_id: "C1", nome: "x", nome_normalizado: "x", mime: "a", situacao: "vigente" }] }))
      .rejects.toThrow(/ged:raiz_divergente/);
    await expect(gravar(id, { pastas: [], documentos: [{ drive_id: "novo", pasta_drive_id: "E1", nome: "x", nome_normalizado: "x", mime: "a", situacao: "vigente" }] }))
      .rejects.toThrow(/ged:pasta_ausente/);
    await expect(concluir(id, null, "Contrato ficticio.pdf")).rejects.toThrow(/ged:codigo_invalido/); // erro só como código (5.11.11)
    await concluir(id, null, "teste");
  });
});

describe("autorização por raiz (11.5)", () => {
  it("item 3 (0809): só o admin geral lê pastas, documentos e revisões; nenhuma área, nem pela API direta", async () => {
    expect(await ver(admin, "ged_documentos")).toEqual(["cd1", "ed1", "ed2", "ew"]);
    for (const quem of [ctrOperador, ctrConsulta, comercial, financeiro]) {
      for (const t of ["ged_pastas", "ged_documentos"]) expect(await ver(quem, t), `${t}`).toEqual([]);
      expect((await como(db, quem, () => q(`select count(*)::int n from ged_documento_revisoes`))).rows[0].n).toBe(0);
    }
  });

  it("item 4: por id, a elaboração some igual a um id inexistente", async () => {
    const id = (await q(`select id from ged_documentos where drive_id = 'ed1'`)).rows[0].id;
    const porId = (x: string) => como(db, comercial, () => q(`select id from ged_documentos where id = $1`, [x])).then((r) => r.rows);
    expect(await porId(id)).toEqual(await porId("00000000-0000-0000-0000-000000000000"));
  });

  it("item 8: unidade_restrita não lê nenhuma raiz", async () => {
    for (const t of ["ged_pastas", "ged_documentos"]) expect(await ver(restrito, t)).toEqual([]);
    expect((await como(db, restrito, () => q(`select * from ged_indexacoes_visiveis()`))).rows).toEqual([]);
  });

  it("itens 9 e 10: ged_indexacoes sem leitura direta; projeção sem erro e resumo, só das raízes que lê", async () => {
    for (const quem of [admin, ctrOperador, comercial]) await negado(como(db, quem, () => q(`select erro from ged_indexacoes`)));
    await negado(como(db, "anon", () => q(`select * from ged_documentos`)));
    const r = await q(`select pg_get_function_result('ged_indexacoes_visiveis()'::regprocedure) t`);
    expect(r.rows[0].t).toBe("TABLE(id uuid, raiz_id uuid, tipo text, agendada boolean, iniciada_em timestamp with time zone, concluida_em timestamp with time zone, com_erro boolean)");
    const raizes = async (quem: string) => [...new Set((await como(db, quem, () => q(`select raiz_id from ged_indexacoes_visiveis()`))).rows.map((x) => x.raiz_id))].sort();
    expect(await raizes(admin)).toEqual([elab, dossie].sort());
    for (const quem of [ctrOperador, comercial, financeiro]) expect(await raizes(quem)).toEqual([]); // 0809
  });

  it("ninguém grava direto; as funções da indexação são só da service role", async () => {
    for (const quem of [admin, ctrOperador]) {
      await negado(como(db, quem, () => q(`update ged_documentos set nome = 'x'`)));
      await negado(como(db, quem, () => q(`insert into ged_pastas (raiz_id, drive_id, nome, profundidade) values ($1, 'x', 'x', 1)`, [elab])));
      await negado(como(db, quem, () => q(`select * from ged_trava`)));
    }
    const esperado: Record<string, string[]> = {
      "ged_iniciar_indexacao(uuid,text,boolean,uuid)": ["service_role"],
      "ged_gravar_indice(uuid,jsonb,jsonb)": ["service_role"],
      "ged_concluir_indexacao(uuid,jsonb,text,text)": ["service_role"],
      "ged_indexacoes_visiveis()": ["authenticated"],
    };
    for (const [fn, papeis] of Object.entries(esperado)) {
      expect((await q(`select prosecdef from pg_proc where oid = $1::regprocedure`, [fn])).rows[0].prosecdef, fn).toBe(true);
      for (const papel of ["anon", "authenticated", "service_role"]) {
        expect((await q(`select has_function_privilege($1, $2, 'execute') ok`, [papel, fn])).rows[0].ok, `${papel} → ${fn}`).toBe(papeis.includes(papel));
      }
    }
  });
});

describe("rodada interrompida (0810)", () => {
  const abertas = async () => (await q(`select id from ged_indexacoes where concluida_em is null`)).rows.map((r) => r.id);
  const estado = async () => (await q(`select (select page_token from ged_pastas_raiz where id = $1) token, (select count(*)::int from ged_documentos) docs,
                                              (select count(*)::int from ged_documento_revisoes) revisoes`, [elab])).rows[0];

  it("trava ainda válida: a segunda chamada recebe em_andamento e a rodada em curso não é encerrada", async () => {
    const r1 = await iniciar(elab, "incremental");
    await expect(iniciar(dossie, "incremental")).rejects.toThrow(/ged:em_andamento/);
    expect(await abertas()).toEqual([r1]);
    await concluir(r1, null, "teste");
  });

  it("trava esquecida (> 15 min): a rodada dona é encerrada como `interrompida` e a nova começa; checkpoint e documentos intactos", async () => {
    const morta = await iniciar(elab, "incremental");
    const antes = await estado();
    await q(`update ged_trava set tomada_em = now() - interval '16 minutes'`); // a função morreu no meio
    const nova = await iniciar(elab, "incremental");
    expect((await q(`select erro, resumo, concluida_em is not null concluida from ged_indexacoes where id = $1`, [morta])).rows[0])
      .toEqual({ erro: "interrompida", resumo: null, concluida: true });
    expect(await abertas()).toEqual([nova]);
    expect((await q(`select por from ged_trava`)).rows[0].por).toBe(nova);
    expect(await estado()).toEqual(antes);
    // A rodada encerrada não grava nem conclui mais (não é dona da trava e já está concluída).
    await expect(gravar(morta, { pastas: [], documentos: [] })).rejects.toThrow(/ged:rodada_invalida/);
    await expect(concluir(morta, "tok-velho")).rejects.toThrow(/ged:rodada_invalida/);
    // Recuperação bem-sucedida: a nova conclui, o token avança e a trava fica livre.
    await concluir(nova, "tok-depois-da-interrupcao");
    expect((await estado()).token).toBe("tok-depois-da-interrupcao");
    expect((await q(`select tomada_em, por from ged_trava`)).rows[0]).toEqual({ tomada_em: null, por: null });
    expect(await abertas()).toEqual([]);
  });

  it("trava livre (rodada anterior concluída normalmente): nada é encerrado como interrompida", async () => {
    const r = await iniciar(dossie, "incremental");
    await concluir(r, null, null);
    const n = (await q(`select count(*)::int n from ged_indexacoes where erro = 'interrompida'`)).rows[0].n;
    const r2 = await iniciar(dossie, "incremental");
    expect((await q(`select count(*)::int n from ged_indexacoes where erro = 'interrompida'`)).rows[0].n).toBe(n);
    await concluir(r2, null, null);
  });

  it("concorrência: as três funções travam a linha da trava antes da rodada (a disputa real: scripts/local-sem-docker/ged-concorrencia.sh)", async () => {
    // O PGlite tem uma conexão só: aqui se confere o bloqueio na definição em vigor; a disputa de verdade roda no roteiro isolado.
    const def = async (f: string) => (await q(`select pg_get_functiondef($1::regprocedure) d`, [f])).rows[0].d as string;
    expect(await def("ged_iniciar_indexacao(uuid,text,boolean,uuid)")).toMatch(/from ged_trava where id = 1 for update/);
    expect(await def("ged_gravar_indice(uuid,jsonb,jsonb)")).toMatch(/from ged_trava where id = 1 and por = p_indexacao for share/);
    expect(await def("ged_concluir_indexacao(uuid,jsonb,text,text)")).toMatch(/from ged_trava where id = 1 and por = p_indexacao for update/);
  });

  it("rodada aberta que não é a dona da trava não conclui nem avança o token (nem grava)", async () => {
    const dona = await iniciar(elab, "incremental");
    const orfa = (await q(`insert into ged_indexacoes (raiz_id, tipo) values ($1, 'incremental') returning id`, [elab])).rows[0].id;
    const token = (await q(`select page_token from ged_pastas_raiz where id = $1`, [elab])).rows[0].page_token;
    await expect(concluir(orfa, "tok-da-orfa")).rejects.toThrow(/ged:rodada_invalida/);
    await expect(gravar(orfa, { pastas: [], documentos: [] })).rejects.toThrow(/ged:rodada_invalida/);
    expect((await q(`select page_token from ged_pastas_raiz where id = $1`, [elab])).rows[0].page_token).toBe(token);
    await concluir(dona, null, "teste");
    await q(`update ged_indexacoes set concluida_em = now(), erro = 'teste' where id = $1`, [orfa]);
  });

  it("pasta repetida no mesmo lote não derruba a gravação (vale a última) e nada duplica", async () => {
    const r = await iniciar(elab, "incremental");
    const p = (nome: string) => ({ drive_id: "E1", nome, mae_drive_id: ELABORACAO, profundidade: 1, situacao: "ativa" });
    await gravar(r, { pastas: [p("Primeira"), p("Segunda")], documentos: [] });
    expect((await q(`select nome from ged_pastas where drive_id = 'E1'`)).rows).toEqual([{ nome: "Segunda" }]);
    await gravar(r, { pastas: [p("Pasta ficticia E1")], documentos: [] });
    await concluir(r, null, "teste");
  });

  it("falha no meio da recuperação desfaz tudo: a rodada antiga continua aberta e a trava continua dela", async () => {
    const morta = await iniciar(elab, "incremental");
    await q(`update ged_trava set tomada_em = now() - interval '16 minutes'`);
    await db.exec(`create function lab_falhar() returns trigger language plpgsql as $$ begin raise exception 'falha simulada'; end $$;
                   create trigger lab_falhar before insert on ged_indexacoes for each row execute function lab_falhar();`);
    try {
      await expect(iniciar(elab, "incremental")).rejects.toThrow(/falha simulada/);
    } finally {
      await db.exec(`drop trigger lab_falhar on ged_indexacoes; drop function lab_falhar();`);
    }
    expect((await q(`select concluida_em, erro from ged_indexacoes where id = $1`, [morta])).rows[0]).toEqual({ concluida_em: null, erro: null });
    expect((await q(`select por from ged_trava`)).rows[0].por).toBe(morta);
    const nova = await iniciar(elab, "incremental");                    // sem a falha, a recuperação acontece
    expect((await q(`select erro from ged_indexacoes where id = $1`, [morta])).rows[0].erro).toBe("interrompida");
    await concluir(nova, null, "teste");
  });

  it("uma interrupção entre rodadas boas não bloqueia a raiz (regressão: bool_and ignorava erro nulo)", async () => {
    await q(`insert into ged_indexacoes (raiz_id, tipo, iniciada_em, concluida_em, erro) values
               ($1, 'incremental', now() - interval '3 hours', now() - interval '3 hours', 'interrompida'),
               ($1, 'incremental', now() - interval '2 hours', now() - interval '2 hours', null),
               ($1, 'incremental', now() - interval '1 hour', now() - interval '1 hour', null)`, [dossie]);
    const r = await iniciar(dossie, "incremental");
    await concluir(r, null, null);
  });

  it("3 interrupções seguidas da raiz em 24 h: ela para de abrir rodada; a outra raiz segue; uma rodada que termina zera a sequência", async () => {
    for (let i = 0; i < 3; i++) {
      await iniciar(dossie, "incremental");
      await q(`update ged_trava set tomada_em = now() - interval '16 minutes'`);
      if (i < 2) continue;
      const outra = await iniciar(elab, "incremental");                 // encerra a 3ª como interrompida
      await concluir(outra, null, "teste");
    }
    // As duas primeiras foram encerradas pela chamada seguinte do próprio laço; a terceira, pela da outra raiz.
    expect((await q(`select count(*)::int n from ged_indexacoes where raiz_id = $1 and erro = 'interrompida' and iniciada_em > now() - interval '1 hour'`, [dossie])).rows[0].n).toBe(3);
    await expect(iniciar(dossie, "incremental")).rejects.toThrow(/ged:interrupcoes_seguidas/);
    // Regressão: rodadas boas (erro nulo) entre as interrompidas não podem contar como interrompidas (bool_and ignora nulos).
    const elabOk = await iniciar(elab, "incremental");
    await concluir(elabOk, null, null);
    // Uma rodada do dossiê que termine (aqui, inserida como se fosse de antes do bloqueio) quebra a sequência.
    await q(`insert into ged_indexacoes (raiz_id, tipo, concluida_em, resumo) values ($1, 'incremental', now(), '{}')`, [dossie]);
    const volta = await iniciar(dossie, "incremental");
    await concluir(volta, null, null);
  });

  it("0810 não muda a regra de acesso da 0809 nem os privilégios", async () => {
    const def = (await q(`select pg_get_functiondef('ged_pode_ler_raiz(uuid)'::regprocedure) d`)).rows[0].d;
    expect(def).toMatch(/select eh_admin_geral\(\)/);
    for (const papel of ["anon", "authenticated"]) {
      expect((await q(`select has_function_privilege($1, 'ged_iniciar_indexacao(uuid,text,boolean,uuid)', 'execute') ok`, [papel])).rows[0].ok).toBe(false);
    }
  });
});
