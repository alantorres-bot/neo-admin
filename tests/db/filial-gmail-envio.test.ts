import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// Fase C do Faturamento Filial (migration 0153): Gmail por usuário (Vault) e kit enviado ao cliente.
let db: PGlite;
let melina: string;
let outro: string;
let empresa: string;
let cliente: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const comoMelina = <T>(fn: () => Promise<T>) => como(db, melina, fn, { oauth: true });

beforeAll(async () => {
  db = await criarBanco();
  // Vault mínimo (no Supabase ele já existe): segredo cifrado + view decifrada.
  await db.exec(`
    create schema if not exists vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text, name text, description text);
    create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(p_secret text, p_name text default null, p_description text default null) returns uuid
      language sql as $$ insert into vault.secrets (secret, name, description) values (p_secret, p_name, p_description) returning id $$;
    create function vault.update_secret(p_id uuid, p_secret text) returns void
      language sql as $$ update vault.secrets set secret = p_secret where id = p_id $$;
  `);
  await novoUsuario(db, "admin@neo.com");
  melina = await novoUsuario(db, "minas@neoformas.com.br", { financeiro: "operador" });
  outro = await novoUsuario(db, "outro@neoformas.com.br", { financeiro: "consulta" });
  await q(`update perfis set unidade_restrita = 'contagem' where id = $1`, [melina]);
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
  cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('CLIENTE MG', '{cliente}', 'mg1') returning id`)).rows[0].id;
});

describe("conexão do Gmail por usuário", () => {
  const iniciar = (quem: string) => como(db, quem, async () => (await q(`select gmail_iniciar_conexao('http://localhost:3000/conta') as s`)).rows[0].s as string, { oauth: true });
  const validar = (state: string) => como(db, "service", async () => (await q(`select gmail_validar_conexao($1) as v`, [state])).rows[0].v);
  const concluir = (state: string, email: string, token = "rt-123") => como(db, "service", async () => (await q(`select gmail_concluir_conexao($1, $2, $3) as d`, [state, email, token])).rows[0].d);

  it("state válido uma vez; grava o token no Vault (nunca em tabela) e o usuário só vê e-mail e datas", async () => {
    const state = await iniciar(melina);
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(await validar(state)).toEqual({ perfil_id: melina, email: "minas@neoformas.com.br", destino: "http://localhost:3000/conta" });
    expect(await concluir(state, "Minas@NeoFormas.com.br")).toBe("http://localhost:3000/conta");
    await expect(concluir(state, "minas@neoformas.com.br")).rejects.toThrow(/expirou/);

    const conta = await comoMelina(async () => (await q(`select * from gmail_contas`)).rows);
    expect(conta).toHaveLength(1);
    expect(conta[0].email).toBe("minas@neoformas.com.br");
    expect(Object.keys(conta[0])).not.toContain("refresh_token");
    expect(await como(db, "service", async () => (await q(`select gmail_refresh_token($1) as t`, [melina])).rows[0].t))
      .toEqual({ email: "minas@neoformas.com.br", refresh_token: "rt-123" });
  });

  it("reconectar atualiza o mesmo segredo; outra conta do Google é recusada", async () => {
    const s1 = await iniciar(melina);
    await concluir(s1, "minas@neoformas.com.br", "rt-novo");
    expect((await q(`select count(*)::int n from vault.secrets`)).rows[0].n).toBe(1);
    expect((await como(db, "service", async () => (await q(`select gmail_refresh_token($1) as t`, [melina])).rows[0].t)).refresh_token).toBe("rt-novo");
    const s2 = await iniciar(melina);
    await expect(concluir(s2, "financeiro@neoformas.com.br")).rejects.toThrow(/sua própria conta/);
  });

  it("usuário não lê token, conexões nem a conta de outro; não chama as funções da service role", async () => {
    expect(await como(db, outro, async () => (await q(`select count(*)::int n from gmail_contas`)).rows[0].n)).toBe(0);
    await expect(comoMelina(() => q(`select * from gmail_conexoes`))).rejects.toThrow();
    await expect(comoMelina(() => q(`select gmail_refresh_token($1)`, [melina]))).rejects.toThrow();
    await expect(comoMelina(() => q(`select gmail_concluir_conexao('x', 'y', 'z')`))).rejects.toThrow();
    await expect(comoMelina(() => q(`insert into gmail_contas (perfil_id, email, segredo_id) values ($1, 'x', gen_random_uuid())`, [melina]))).rejects.toThrow();
  });

  it("desconectar apaga o segredo do Vault", async () => {
    await comoMelina(() => q(`select gmail_desconectar()`));
    expect((await q(`select count(*)::int n from vault.secrets`)).rows[0].n).toBe(0);
    expect(await como(db, "service", async () => (await q(`select gmail_refresh_token($1) as t`, [melina])).rows[0].t)).toBeNull();
  });
});

describe("kit enviado ao cliente", () => {
  async function kitPronto(nota: string) {
    const r = await comoMelina(async () => (await q(`select rec_remessa_criar() as r`)).rows[0].r as { id: string });
    const kit = await comoMelina(async () => (await q(`select rec_kit_registrar($1, 'CLIENTE MG', true, null, null, null, null, $2) as id`, [nota, r.id])).rows[0].id as string);
    const t = (await q(`insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio)
      values ($1, $2, $3, '1', current_date + 20, 500, 'aguardando_boleto') returning id`, [empresa, cliente, `4${nota}U`])).rows[0].id as string;
    await q(`insert into anexos (modulo, referencia_tabela, referencia_id, arquivo_path, nome_arquivo, tipo) values ('financeiro.recebiveis', 'rec_titulos', $1, 'x/b.pdf', 'b.pdf', 'boleto')`, [t]);
    return { kit, titulo: t };
  }

  it("a filial marca o envio: kit enviado, parcela 'boleto enviado' com histórico, pendência concluída", async () => {
    const { kit, titulo } = await kitPronto("002501");
    expect((await q(`select estagio from rec_kits where id = $1`, [kit])).rows[0].estagio).toBe("pronta");
    const r = await comoMelina(async () => (await q(`select rec_kit_marcar_enviado($1) as r`, [kit])).rows[0].r);
    expect(r).toEqual({ parcelas: 1 });
    const k = (await q(`select estagio, enviado_por, enviado_em from rec_kits where id = $1`, [kit])).rows[0];
    expect(k.estagio).toBe("enviada");
    expect(k.enviado_por).toBe(melina);
    const t = (await q(`select estagio, boleto_enviado_em from rec_titulos where id = $1`, [titulo])).rows[0];
    expect(t.estagio).toBe("boleto_enviado");
    expect(t.boleto_enviado_em).not.toBeNull();
    expect((await q(`select count(*)::int n from interacoes where referencia_id = $1 and tipo = 'boleto_enviado'`, [titulo])).rows[0].n).toBe(1);
    expect((await q(`select status from pendencias where referencia_id = $1 and titulo like 'Enviar kit%'`, [kit])).rows[0].status).toBe("concluida");
    await expect(comoMelina(() => q(`select rec_kit_marcar_enviado($1)`, [kit]))).rejects.toThrow(/não está pronto/);
  });

  it("kit não pronto e usuário só de consulta são recusados", async () => {
    const r = await comoMelina(async () => (await q(`select rec_remessa_criar() as r`)).rows[0].r as { id: string });
    const kit = await comoMelina(async () => (await q(`select rec_kit_registrar('002502', 'CLIENTE MG', true, null, null, null, null, $1) as id`, [r.id])).rows[0].id as string);
    await expect(comoMelina(() => q(`select rec_kit_marcar_enviado($1)`, [kit]))).rejects.toThrow(/não está pronto/);
    await expect(como(db, outro, () => q(`select rec_kit_marcar_enviado($1)`, [kit]))).rejects.toThrow(/operador/);
  });
});

describe("Fase F (0159): demonstrativos pendentes e envio da nota antes do boleto", () => {
  const anexar = (tabela: string, id: string, tipo: string, modulo = "financeiro.filial") =>
    q(`insert into anexos (modulo, referencia_tabela, referencia_id, arquivo_path, nome_arquivo, tipo) values ($1, $2, $3, 'x/a.pdf', 'a.pdf', $4)`, [modulo, tabela, id, tipo]);
  async function remessaCom(notas: string[]) {
    const r = await comoMelina(async () => (await q(`select rec_remessa_criar() as r`)).rows[0].r as { id: string; numero: number });
    const kits: string[] = [];
    for (const n of notas) kits.push(await comoMelina(async () => (await q(`select rec_kit_registrar($1, 'CLIENTE MG', true, null, null, null, null, $2) as id`, [n, r.id])).rows[0].id as string));
    await comoMelina(() => q(`select rec_remessa_concluir($1)`, [r.id]));
    return { remessa: r, kits };
  }
  const pend = async (ref: string, prefixo: string) => (await q(`select status from pendencias where referencia_id = $1 and titulo like $2`, [ref, `${prefixo}%`])).rows.map((p) => p.status);

  it("remessa sem demonstrativo abre a pendência; ela fecha quando todas as NFs têm demonstrativo", async () => {
    const { remessa, kits } = await remessaCom(["002601", "002602"]);
    expect(await pend(remessa.id, "Subir demonstrativos")).toEqual(["aberta"]);
    await comoMelina(() => anexar("rec_kits", kits[0], "demonstrativo"));
    expect(await pend(remessa.id, "Subir demonstrativos")).toEqual(["aberta"]);
    await comoMelina(() => anexar("rec_kits", kits[1], "demonstrativo"));
    expect(await pend(remessa.id, "Subir demonstrativos")).toEqual(["concluida"]);
  });

  it("remessa já com todos os demonstrativos não abre a pendência", async () => {
    const r = await comoMelina(async () => (await q(`select rec_remessa_criar() as r`)).rows[0].r as { id: string });
    const k = await comoMelina(async () => (await q(`select rec_kit_registrar('002603', 'CLIENTE MG', true, null, null, null, null, $1) as id`, [r.id])).rows[0].id as string);
    await anexar("rec_kits", k, "demonstrativo");
    await comoMelina(() => q(`select rec_remessa_concluir($1)`, [r.id]));
    expect(await pend(r.id, "Subir demonstrativos")).toEqual([]);
  });

  it("envio antecipado: exige nota e demonstrativo; boleto depois abre 'Enviar boleto' e o envio final conclui", async () => {
    const { kits: [kit] } = await remessaCom(["002604"]);
    await expect(comoMelina(() => q(`select rec_kit_marcar_nota_enviada($1)`, [kit]))).rejects.toThrow(/nota fatura e de pelo menos um demonstrativo/);
    await anexar("rec_kits", kit, "nota_fatura");
    await anexar("rec_kits", kit, "demonstrativo");
    await comoMelina(() => q(`select rec_kit_marcar_nota_enviada($1)`, [kit]));
    expect((await q(`select nota_enviada_por from rec_kits where id = $1`, [kit])).rows[0].nota_enviada_por).toBe(melina);
    await expect(comoMelina(() => q(`select rec_kit_marcar_nota_enviada($1)`, [kit]))).rejects.toThrow(/já foi enviada/);

    const t = (await q(`insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio)
      values ($1, $2, '4002604U', '1', current_date + 20, 500, 'aguardando_boleto') returning id`, [empresa, cliente])).rows[0].id as string;
    await anexar("rec_titulos", t, "boleto", "financeiro.recebiveis");
    expect((await q(`select estagio from rec_kits where id = $1`, [kit])).rows[0].estagio).toBe("pronta");
    expect(await pend(kit, "Enviar boleto ao cliente")).toEqual(["aberta"]);
    expect(await pend(kit, "Enviar kit ao cliente")).toEqual([]);

    await expect(comoMelina(() => q(`select rec_kit_marcar_nota_enviada($1)`, [kit]))).rejects.toThrow(/antes do boleto/);
    await comoMelina(() => q(`select rec_kit_marcar_enviado($1)`, [kit]));
    expect(await pend(kit, "Enviar boleto ao cliente")).toEqual(["concluida"]);
    expect((await q(`select descricao from interacoes where referencia_id = $1 and tipo = 'boleto_enviado'`, [t])).rows[0].descricao).toMatch(/Boleto da NF 002604 enviado/);
  });

  it("conversa do e-mail: só a service role grava", async () => {
    const { kits: [kit] } = await remessaCom(["002605"]);
    await expect(comoMelina(() => q(`select rec_kit_registrar_conversa($1, 't', 'm', 'a')`, [kit]))).rejects.toThrow();
    await como(db, "service", () => q(`select rec_kit_registrar_conversa($1, 'thread-1', '<m@x>', 'Faturamento X')`, [kit]));
    expect((await q(`select gmail_thread_id, email_message_id, email_assunto from rec_kits where id = $1`, [kit])).rows[0])
      .toEqual({ gmail_thread_id: "thread-1", email_message_id: "<m@x>", email_assunto: "Faturamento X" });
  });
});
