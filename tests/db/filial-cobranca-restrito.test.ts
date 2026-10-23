import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

// Fase E (migration 0158): a filial cobra os clientes de Contagem, sem ver nem alterar a Matriz.
let db: PGlite;
let melina: string;
let cuiaba: string;
let empresa: string;
let clienteMg: string;
let clienteMt: string;
let n = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const comoMelina = <T>(fn: () => Promise<T>) => como(db, melina, fn, { oauth: true });
async function titulo(cp: string, prefixo: "4" | "1", estagio = "vencido", vencimento = "current_date - 3") {
  const doc = `${prefixo}00${String(2600 + ++n).padStart(4, "0")}U`;
  return (await q(`insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, vencimento, valor, estagio)
    values ($1, $2, $3, '1', ${vencimento}, 1000, $4) returning id`, [empresa, cp, doc, estagio])).rows[0].id as string;
}

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  melina = await novoUsuario(db, "minas@neo.com", { financeiro: "operador" });
  cuiaba = await novoUsuario(db, "cuiaba@neo.com", { financeiro: "operador" });
  await q(`update perfis set unidade_restrita = 'contagem' where id = $1`, [melina]);
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
  clienteMg = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('CLIENTE MG', '{cliente}', 'mg') returning id`)).rows[0].id;
  clienteMt = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('CLIENTE MT', '{cliente}', 'mt') returning id`)).rows[0].id;
});

describe("cobrança da filial pelo usuário restrito", () => {
  it("lê a régua e os modelos de mensagem", async () => {
    expect(await comoMelina(async () => (await q(`select count(*)::int n from rec_regua_marcos`)).rows[0].n)).toBeGreaterThan(0);
  });

  it("registra cobrança de título da unidade; título da Matriz é recusado", async () => {
    const mg = await titulo(clienteMg, "4");
    const mt = await titulo(clienteMt, "1");
    await comoMelina(() => q(`select rec_registrar_cobranca($1::uuid[], 1, 'enviada', 'email'::canal, null, null)`, [[mg]]));
    const hist = await comoMelina(async () => (await q(`select referencia_id from interacoes where tipo like 'cobranca%' or tipo like '%cobran%'`)).rows);
    expect(hist.map((h) => h.referencia_id)).toContain(mg);
    await expect(comoMelina(() => q(`select rec_registrar_cobranca($1::uuid[], 1, 'enviada', 'email'::canal, null, null)`, [[mt]]))).rejects.toThrow();
  });

  it("vê só histórico, títulos e pendências da unidade", async () => {
    const mt = await titulo(clienteMt, "1");
    await como(db, cuiaba, () => q(`select rec_registrar_cobranca($1::uuid[], 1, 'enviada', 'email'::canal, null, null)`, [[mt]]));
    const refs = await comoMelina(async () => (await q(`select referencia_id from interacoes`)).rows.map((r) => r.referencia_id));
    expect(refs).not.toContain(mt);
    const docs = await comoMelina(async () => (await q(`select documento from rec_titulos`)).rows.map((r) => r.documento as string));
    expect(docs.every((d) => d.startsWith("400"))).toBe(true);
    await q(`insert into pendencias (modulo, titulo, prazo, referencia_tabela, referencia_id) values
      ('financeiro.recebiveis', 'Cobrar D+1: CLIENTE MG (Filial Contagem) — venc. 01/10', current_date, 'contrapartes', $1),
      ('financeiro.recebiveis', 'Cobrar D+1: CLIENTE MT — venc. 01/10', current_date, 'contrapartes', $2)`, [clienteMg, clienteMt]);
    const pend = await comoMelina(async () => (await q(`select titulo from pendencias where titulo like 'Cobrar D+1:%'`)).rows.map((r) => r.titulo));
    expect(pend).toEqual(["Cobrar D+1: CLIENTE MG (Filial Contagem) — venc. 01/10"]);
  });

  it("muda só os campos da cobrança do título; valor e vencimento não", async () => {
    const mg = await titulo(clienteMg, "4", "aguardando_boleto", "current_date + 10");
    await comoMelina(() => q(`update rec_titulos set linha_digitavel = '1' where id = $1`, [mg]));
    await expect(comoMelina(() => q(`update rec_titulos set valor = 1 where id = $1`, [mg]))).rejects.toThrow(/só se alteram os dados da cobrança|só mudam pela sincronização/);
    await expect(comoMelina(() => q(`update rec_titulos set vencimento = current_date where id = $1`, [mg]))).rejects.toThrow(/só se alteram|só mudam pela sincronização/);
    // Desde a 0184, nem Cuiabá muda valor e vencimento à mão: são dados do Consistem (só a sincronização altera).
    await expect(como(db, cuiaba, () => q(`update rec_titulos set valor = 900 where id = $1`, [mg]))).rejects.toThrow(/só mudam pela sincronização/);
  });

  it("marca boleto enviado e registra confirmação de título da unidade", async () => {
    const mg = await titulo(clienteMg, "4", "aguardando_boleto", "current_date + 5");
    await q(`insert into anexos (modulo, referencia_tabela, referencia_id, arquivo_path, nome_arquivo, tipo) values ('financeiro.recebiveis', 'rec_titulos', $1, 'x/b.pdf', 'b.pdf', 'boleto')`, [mg]);
    await comoMelina(() => q(`select rec_marcar_boleto_enviado($1::uuid[], 'email'::canal, 'teste')`, [[mg]]));
    expect((await q(`select estagio from rec_titulos where id = $1`, [mg])).rows[0].estagio).toBe("boleto_enviado");
    await comoMelina(() => q(`select rec_registrar_confirmacao($1::uuid[], 'confirmou', 'whatsapp'::canal, 'teste')`, [[mg]]));
    expect((await q(`select estagio from rec_titulos where id = $1`, [mg])).rows[0].estagio).toBe("confirmado_cliente");
  });

  it("mensagens: cria rascunho e vê só as próprias", async () => {
    await como(db, cuiaba, () => q(`insert into mensagens (modulo, canal, destinatario, corpo, status) values ('financeiro.recebiveis', 'email', 'a@b.com', 'x', 'rascunho')`));
    await comoMelina(() => q(`insert into mensagens (modulo, canal, destinatario, corpo, status) values ('financeiro.recebiveis', 'email', 'c@d.com', 'y', 'rascunho')`));
    const minhas = await comoMelina(async () => (await q(`select destinatario from mensagens`)).rows.map((r) => r.destinatario));
    expect(minhas).toEqual(["c@d.com"]);
  });

  it("marca de confirmação: cliente da unidade sim, da Matriz não; Cuiabá em qualquer cliente", async () => {
    await comoMelina(() => q(`select rec_cliente_definir_confirmacao($1, true)`, [clienteMg]));
    expect((await q(`select confirmar_pagamento from rec_clientes_config where contraparte_id = $1`, [clienteMg])).rows[0].confirmar_pagamento).toBe(true);
    await expect(comoMelina(() => q(`select rec_cliente_definir_confirmacao($1, true)`, [clienteMt]))).rejects.toThrow(/Somente operador/);
    await como(db, cuiaba, () => q(`select rec_cliente_definir_confirmacao($1, false)`, [clienteMt]));
    expect(await comoMelina(async () => (await q(`select confirmar_pagamento from rec_clientes_config where contraparte_id = $1`, [clienteMg])).rows[0].confirmar_pagamento)).toBe(true);
  });

  it("continua sem contas a pagar, cartão e AKF; e não mexe em título da Matriz", async () => {
    for (const t of ["cap_autorizacoes", "crt_faturas", "akf_operacoes"]) {
      expect(await comoMelina(async () => (await q(`select count(*)::int n from ${t}`)).rows[0].n), t).toBe(0);
    }
    const mt = await titulo(clienteMt, "1");
    const r = await comoMelina(async () => (await q(`update rec_titulos set linha_digitavel = '9' where id = $1 returning id`, [mt])).rows.length);
    expect(r).toBe(0);
  });
});
