// Conferência prévia da indexação (scripts/ged-primeira-indexacao.sql) contra o banco das migrations, com Vault e pg_cron mínimos.
// Cenários: tudo certo, rodada em andamento, rodada esquecida (não bloqueia: a próxima a encerra), rodada órfã, job ligado, conexão
// com erro e interruptor ligado (fora do `pronto`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let elab: string;
const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const SQL = readFileSync(join(process.cwd(), "scripts", "ged-primeira-indexacao.sql"), "utf8");
const conferir = async () => (await q(SQL)).rows[0];

beforeAll(async () => {
  db = await criarBanco();
  await db.exec(`
    create schema if not exists vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text, name text unique);
    create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
    insert into vault.secrets (name, secret) values ('rec_sincronizar_url', 'https://x.invalid/functions/v1/rec-sincronizar-consistem'),
                                                    ('rec_sincronizar_segredo', 'segredo-ficticio');
    create schema if not exists cron;
    create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text, active boolean default true);
  `);
  const admin = await novoUsuario(db, "admin@exemplo.invalid");
  await q(`insert into ged_conexao (email, google_sub, segredo_id, escopos, conectado_por) values ('c@exemplo.invalid', 's', gen_random_uuid(), '{}', $1)`, [admin]);
  for (const drive of ["1JMzjxdPkXTtGXtop0CFx-R47Ql_08alR", "1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak"]) {
    const id = (await como(db, "service", () => q(`select ged_cadastrar_raiz($1, $2, 'R', null, 'contratos', '{}', 'contratos') id`, [admin, drive]))).rows[0].id;
    await como(db, "service", () => q(`select ged_registrar_verificacao_raiz($1, $2, 1, 'ok')`, [admin, drive]));
    await como(db, admin, () => q(`select ged_definir_situacao_raiz($1, 'ativa')`, [id]));
    if (drive.startsWith("1JM")) elab = id;
  }
}, 120_000);

describe("conferência prévia", () => {
  it("estado inicial de produção: pronto, interruptor desligado, duas raízes sem ponto de continuação", async () => {
    expect(await conferir()).toMatchObject({ pronto: true, interruptor_ainda_desligado: true, raizes_sem_ponto_de_continuacao: 2 });
  });

  it("rodada em andamento bloqueia; esquecida (15 min ou mais) não bloqueia; o interruptor ligado fica fora do `pronto`", async () => {
    await q(`update configuracoes set valor = 'true' where chave = 'administrativo.ged.indexar'`);
    const r = (await como(db, "service", () => q(`select ged_iniciar_indexacao($1, 'inicial', true, null) id`, [elab])) ).rows[0].id;
    expect(await conferir()).toMatchObject({ pronto: false, nenhuma_rodada_em_andamento: false, interruptor_ainda_desligado: false });
    await q(`update ged_trava set tomada_em = now() - interval '16 minutes'`);
    expect(await conferir()).toMatchObject({ pronto: true, nenhuma_rodada_em_andamento: true, nenhuma_rodada_orfa: true });
    // A próxima chamada encerra a esquecida como interrompida e assume.
    const nova = (await como(db, "service", () => q(`select ged_iniciar_indexacao($1, 'inicial', true, null) id`, [elab]))).rows[0].id;
    expect((await q(`select erro from ged_indexacoes where id = $1`, [r])).rows[0].erro).toBe("interrompida");
    await como(db, "service", () => q(`select ged_concluir_indexacao($1, '{}', null, 'teste')`, [nova]));
    expect(await conferir()).toMatchObject({ pronto: true });
  });

  it("rodada órfã (aberta sem ser dona da trava) bloqueia", async () => {
    const orfa = (await q(`insert into ged_indexacoes (raiz_id, tipo) values ($1, 'incremental') returning id`, [elab])).rows[0].id;
    expect(await conferir()).toMatchObject({ pronto: false, nenhuma_rodada_orfa: false });
    await q(`update ged_indexacoes set concluida_em = now(), erro = 'teste' where id = $1`, [orfa]);
  });

  it("agendamento ligado, conexão com erro ou segredo fora do Vault bloqueiam", async () => {
    await q(`insert into cron.job (jobname, schedule, command, active) values ('ged-indexar-30min', '20,50 11-22 * * 1-5', 'select 1', true)`);
    expect(await conferir()).toMatchObject({ pronto: false, agendamento_inativo_ou_ausente: false });
    await q(`update cron.job set active = false`);
    await q(`update ged_conexao set ultimo_erro = 'invalid_grant', ultimo_erro_em = now()`);
    expect(await conferir()).toMatchObject({ pronto: false, conexao_ativa_sem_erro: false });
    await q(`update ged_conexao set ultimo_erro = null, ultimo_erro_em = null`);
    await q(`delete from vault.secrets where name = 'rec_sincronizar_segredo'`);
    expect(await conferir()).toMatchObject({ pronto: false, url_e_segredo_no_vault: false });
  });
});
