// Fiscal > Créditos tributários (migrations 0200–0203): regras de negócio no banco, com RLS e papéis.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let admin: string, leitor: string, analista: string, revisor: string, contador: string, analistaB: string;
let empA: string, empB: string, estabA: string, estabA2: string;
let icms: string, pis: string, catIcms: string, catPis: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const j = (o: unknown) => JSON.stringify(o);
const rpc = async (quem: string, fn: string, args: unknown[] = [], tipos: string[] = []) => {
  const params = args.map((_, i) => `$${i + 1}${tipos[i] ? `::${tipos[i]}` : ""}`).join(", ");
  return (await como(db, quem, () => q(`select ${fn}(${params}) as r`, args))).rows[0].r;
};
const criarCredito = (quem: string, o: Record<string, unknown>) => rpc(quem, "fis_credito_criar", [j(o)], ["jsonb"]);
const mov = (quem: string, o: Record<string, unknown>) => rpc(quem, "fis_movimento_registrar", [j(o)], ["jsonb"]);
const saldo = async (id: string) => Number((await q(`select saldo from fis_creditos_saldos where id = $1`, [id])).rows[0].saldo);
const apuracao = async (ini: string, fim: string, credito: string) =>
  (await q(`select competencia::text, saldo_inicial::float8 si, gerado::float8 g, utilizado::float8 u, compensado::float8 c, saldo_final::float8 sf
              from fis_apuracao($1::date, $2::date) where credito_id = $3 order by competencia`, [ini, fim, credito])).rows;

/** Anexa e vincula um documento (já "enviado" ao bucket) ao alvo. */
async function anexar(quem: string, empresa: string, tipo: string, alvo: string, alvoId: string) {
  return rpc(quem, "fis_documento_registrar", [j({
    tipo, titulo: `Documento ${tipo}`, empresa_id: empresa, arquivo_path: `fiscal.creditos/${empresa}/${crypto.randomUUID()}-arq.pdf`,
    nome_arquivo: "arq.pdf", mime: "application/pdf", tamanho_bytes: 1000, sha256: "a".repeat(64),
  }), j([{ alvo, alvo_id: alvoId }])], ["jsonb", "jsonb"]);
}

beforeAll(async () => {
  db = await criarBanco();
  admin = await novoUsuario(db, "admin@neo.com");
  leitor = await novoUsuario(db, "leitor@neo.com", { fiscal: "consulta" });
  analista = await novoUsuario(db, "analista@neo.com", { fiscal: "operador" });
  revisor = await novoUsuario(db, "revisor@neo.com", { fiscal: "gestor" });
  contador = await novoUsuario(db, "contador@neo.com", { fiscal: "gestor" });
  analistaB = await novoUsuario(db, "analista.b@neo.com", { fiscal: "operador" });
  empA = (await q(`insert into empresas (razao_social, nome_curto, cnpj) values ('Indústria A (FICTÍCIA)', 'A', '11.111.111/0001-11') returning id`)).rows[0].id;
  empB = (await q(`insert into empresas (razao_social, nome_curto, cnpj) values ('Indústria B (FICTÍCIA)', 'B', '22.222.222/0001-22') returning id`)).rows[0].id;
  estabA = await rpc(admin, "fis_salvar_estabelecimento", [j({ empresa_id: empA, nome: "Matriz A", cnpj: "11111111000111", uf: "MT", matriz: true })], ["jsonb"]);
  estabA2 = await rpc(admin, "fis_salvar_estabelecimento", [j({ empresa_id: empA, nome: "Filial A", cnpj: "11111111000292", uf: "MT" })], ["jsonb"]);
  await rpc(admin, "fis_salvar_estabelecimento", [j({ empresa_id: empB, nome: "Matriz B", cnpj: "22222222000122", uf: "SP" })], ["jsonb"]);
  await como(db, admin, () => q(`select fis_definir_membro($1, 'contador', null)`, [contador]));
  await como(db, admin, () => q(`select fis_definir_membro($1, 'analista', $2::uuid[])`, [analistaB, `{${empB}}`]));
  icms = (await q(`select id from fis_tributos where codigo = 'ICMS'`)).rows[0].id;
  pis = (await q(`select id from fis_tributos where codigo = 'PIS'`)).rows[0].id;
  catIcms = (await q(`select id from fis_categorias where codigo = 'ICMS_SALDO_CREDOR'`)).rows[0].id;
  catPis = (await q(`select id from fis_categorias where codigo = 'PIS_NAO_CUMULATIVO'`)).rows[0].id;
});

const base = () => ({ estabelecimento_id: estabA, tributo_id: icms, categoria_id: catIcms, origem: "apuracao_mensal" });

describe("papéis e escopo", () => {
  it("papel efetivo sai do nível na área e do cadastro de membros", async () => {
    const papel = async (u: string) => (await como(db, u, () => q(`select fis_papel_atual()::text as p`))).rows[0].p;
    expect(await papel(leitor)).toBe("leitor");
    expect(await papel(analista)).toBe("analista");
    expect(await papel(revisor)).toBe("revisor");
    expect(await papel(contador)).toBe("contador");
    expect(await papel(admin)).toBe("administrador");
  });
  it("só o administrador altera parâmetros fiscais", async () => {
    await expect(rpc(revisor, "fis_salvar_tributo", [j({ codigo: "ISS", nome: "ISS", esfera: "municipal" })], ["jsonb"])).rejects.toThrow(/administrador/);
    expect(await rpc(admin, "fis_salvar_tributo", [j({ codigo: "ISS", nome: "ISS", esfera: "municipal" })], ["jsonb"])).toBeTruthy();
  });
  it("leitor não lança; analista restrito à empresa B não vê nem lança na A", async () => {
    await expect(criarCredito(leitor, { ...base(), competencia_origem: "2025-01-01", descricao: "x crédito", valor_original: 10 })).rejects.toThrow(/analista/);
    await expect(criarCredito(analistaB, { ...base(), competencia_origem: "2025-01-01", descricao: "x crédito", valor_original: 10 })).rejects.toThrow(/Somente/);
    const n = (await como(db, analistaB, () => q(`select count(*)::int n from fis_estabelecimentos`))).rows[0].n;
    expect(n).toBe(1);
  });
});

describe("crédito, validação e razão", () => {
  let cr: string;
  it("cria o crédito com o lançamento inicial no razão e impede duplicidade", async () => {
    cr = await criarCredito(analista, { ...base(), competencia_origem: "2025-01-01", data_entrada: "2025-01-31", descricao: "Saldo credor ICMS jan/2025", valor_original: "10000.00" });
    const c = (await q(`select codigo, validacao::text, responsavel_lancamento from fis_creditos where id = $1`, [cr])).rows[0];
    expect(c.codigo).toMatch(/^CR-2025-\d{5}$/);
    expect(c.validacao).toBe("pendente");
    expect(c.responsavel_lancamento).toBe(analista);
    expect(await saldo(cr)).toBe(10000);
    await expect(criarCredito(analista, { ...base(), competencia_origem: "2025-01-01", descricao: "Outra descrição", valor_original: 10000 })).rejects.toThrow(/duplicado/);
  });

  it("crédito pendente de validação não é disponível nem utilizável", async () => {
    const s = (await q(`select disponibilidade, saldo_disponivel::float8 d from fis_creditos_saldos where id = $1`, [cr])).rows[0];
    expect(s).toEqual({ disponibilidade: "pendente_validacao", d: 0 });
    await expect(mov(analista, { credito_id: cr, tipo: "utilizacao", valor: 100, data: "2025-02-20", competencia: "2025-02-01", descricao: "Dedução" })).rejects.toThrow(/não está validado/);
  });

  it("validação: só revisor/contador/admin, exige documentos e registra a decisão", async () => {
    await expect(rpc(analista, "fis_credito_validar", [cr, "validado", null, null], ["uuid", "fis_validacao", "numeric", "text"])).rejects.toThrow(/aprova ou valida/);
    await expect(rpc(revisor, "fis_credito_validar", [cr, "validado", null, null], ["uuid", "fis_validacao", "numeric", "text"])).rejects.toThrow(/Documentação pendente para validar: Memória de cálculo/);
    await anexar(analista, empA, "memoria_calculo", "credito", cr);
    await rpc(revisor, "fis_credito_validar", [cr, "validado", null, "Conferido com o livro"], ["uuid", "fis_validacao", "numeric", "text"]);
    const s = (await q(`select disponibilidade, saldo_disponivel::float8 d from fis_creditos_saldos where id = $1`, [cr])).rows[0];
    expect(s).toEqual({ disponibilidade: "disponivel", d: 10000 });
    const d = (await q(`select decisao, usuario_id from fis_decisoes where alvo_id = $1 order by id desc limit 1`, [cr])).rows[0];
    expect(d).toEqual({ decisao: "validacao:validado", usuario_id: revisor });
  });

  it("segregação: quem lançou não valida", async () => {
    const outro = await criarCredito(revisor, { ...base(), estabelecimento_id: estabA2, competencia_origem: "2025-01-01", descricao: "Crédito da filial", valor_original: 500 });
    await anexar(revisor, empA, "memoria_calculo", "credito", outro);
    await expect(rpc(revisor, "fis_credito_validar", [outro, "validado", null, null], ["uuid", "fis_validacao", "numeric", "text"])).rejects.toThrow(/segregação/);
  });

  it("autoaprovação (0204): só com a chave ligada, só o Administrador e com justificativa", async () => {
    const tipos = ["uuid", "fis_validacao", "numeric", "text"];
    const proprio = await criarCredito(admin, { ...base(), estabelecimento_id: estabA2, competencia_origem: "2025-01-01", descricao: "Crédito lançado pelo admin", valor_original: 700, tipo_entrada: "saldo_inicial", data_entrada: "2025-01-01" });
    await anexar(admin, empA, "memoria_calculo", "credito", proprio);
    const inicial = (await q(`select id from fis_movimentos where credito_id = $1`, [proprio])).rows[0].id;
    await expect(rpc(admin, "fis_movimento_decidir", [inicial, true, "Conferido com a EFD"], ["uuid", "boolean", "text"])).rejects.toThrow(/segregação/);
    await q(`update configuracoes set valor = 'true' where chave = 'fiscal.creditos.permitir_autoaprovacao'`);
    try {
      await expect(rpc(admin, "fis_movimento_decidir", [inicial, true, null], ["uuid", "boolean", "text"])).rejects.toThrow(/Autoaprovação: justifique/);
      await rpc(admin, "fis_movimento_decidir", [inicial, true, "Conferido com a EFD"], ["uuid", "boolean", "text"]);
      await rpc(admin, "fis_credito_validar", [proprio, "validado", null, "Saldo conferido com a EFD"], tipos);
      const d = (await q(`select justificativa from fis_decisoes where alvo_id = $1 order by id desc limit 1`, [proprio])).rows[0];
      expect(d.justificativa).toBe("[autoaprovação] Saldo conferido com a EFD");
      // revisor continua sem a exceção
      const doRevisor = await criarCredito(revisor, { ...base(), estabelecimento_id: estabA2, competencia_origem: "2025-01-01", descricao: "Crédito do revisor", valor_original: 300 });
      await anexar(revisor, empA, "memoria_calculo", "credito", doRevisor);
      await expect(rpc(revisor, "fis_credito_validar", [doRevisor, "validado", null, "Conferido por mim mesmo"], tipos)).rejects.toThrow(/segregação/);
    } finally {
      await q(`update configuracoes set valor = 'false' where chave = 'fiscal.creditos.permitir_autoaprovacao'`);
    }
  });

  it("utilização parcial, saldo transportado e bloqueio acima do saldo", async () => {
    await mov(analista, { credito_id: cr, tipo: "utilizacao", valor: "3000.00", data: "2025-02-20", competencia: "2025-02-01", descricao: "Dedução na apuração de fev" });
    expect(await saldo(cr)).toBe(7000);
    await expect(mov(analista, { credito_id: cr, tipo: "utilizacao", valor: 7000.01, data: "2025-03-20", competencia: "2025-03-01", descricao: "Excesso" }))
      .rejects.toThrow(/Saldo insuficiente.*R\$ 7\.000,00/);
    const ap = await apuracao("2025-01-01", "2025-03-01", cr);
    expect(ap).toEqual([
      { competencia: "2025-01-01", si: 0, g: 10000, u: 0, c: 0, sf: 10000 },
      { competencia: "2025-02-01", si: 10000, g: 0, u: 3000, c: 0, sf: 7000 },
      { competencia: "2025-03-01", si: 7000, g: 0, u: 0, c: 0, sf: 7000 },
    ]);
  });

  it("utilização em competência anterior não pode deixar saldo negativo depois", async () => {
    // fev já usou 3.000; uma saída de 7.500 em jan deixaria fev negativo
    await expect(mov(analista, { credito_id: cr, tipo: "utilizacao", valor: 7500, data: "2025-01-31", competencia: "2025-01-01", descricao: "Dedução jan" }))
      .rejects.toThrow(/Saldo insuficiente/);
  });

  it("saídas pendentes de aprovação reservam saldo", async () => {
    const aj = await mov(analista, { credito_id: cr, tipo: "ajuste_negativo", valor: 5000, data: "2025-03-10", competencia: "2025-03-01", descricao: "Ajuste a aprovar" });
    expect((await q(`select status from fis_movimentos where id = $1`, [aj])).rows[0].status).toBe("pendente");
    expect(await saldo(cr)).toBe(7000);
    await expect(mov(analista, { credito_id: cr, tipo: "utilizacao", valor: 2500, data: "2025-03-20", competencia: "2025-03-01", descricao: "Dedução mar" })).rejects.toThrow(/Saldo insuficiente/);
    await expect(rpc(analista, "fis_movimento_decidir", [aj, false, "Não procede o ajuste"], ["uuid", "boolean", "text"])).rejects.toThrow(/aprova ou valida/);
    await rpc(revisor, "fis_movimento_decidir", [aj, false, "Ajuste sem memória de cálculo"], ["uuid", "boolean", "text"]);
    expect((await q(`select status from fis_movimentos where id = $1`, [aj])).rows[0].status).toBe("rejeitado");
  });

  it("arredondamento: no máximo 2 casas, sem arredondar em silêncio; somas exatas", async () => {
    await expect(mov(analista, { credito_id: cr, tipo: "utilizacao", valor: "0.105", data: "2025-03-20", competencia: "2025-03-01", descricao: "Centavos" })).rejects.toThrow(/2 casas/);
    await mov(analista, { credito_id: cr, tipo: "utilizacao", valor: "0.10", data: "2025-03-20", competencia: "2025-03-01", descricao: "Centavos A" });
    await mov(analista, { credito_id: cr, tipo: "utilizacao", valor: "0.20", data: "2025-03-21", competencia: "2025-03-01", descricao: "Centavos B" });
    expect((await q(`select saldo::text from fis_creditos_saldos where id = $1`, [cr])).rows[0].saldo).toBe("6999.70");
  });

  it("movimentação duplicada é barrada; reenvio do mesmo formulário (chave) não duplica", async () => {
    const chave = crypto.randomUUID();
    const dados = { credito_id: cr, tipo: "utilizacao", valor: "100.00", data: "2025-03-25", competencia: "2025-03-01", descricao: "Dedução", chave_idempotencia: chave };
    const a = await mov(analista, dados);
    expect(await mov(analista, dados)).toBe(a);
    await expect(mov(analista, { ...dados, chave_idempotencia: crypto.randomUUID() })).rejects.toThrow(/duplicada.*nº/);
    expect(await saldo(cr)).toBe(6899.7);
  });

  it("razão imutável: sem update de valor e sem delete, nem pela service role", async () => {
    const m = (await q(`select id from fis_movimentos where credito_id = $1 limit 1`, [cr])).rows[0].id;
    await expect(q(`update fis_movimentos set valor = 1, valor_assinado = 1 where id = $1`, [m])).rejects.toThrow(/imutáveis/);
    await expect(q(`delete from fis_movimentos where id = $1`, [m])).rejects.toThrow(/não podem ser excluídos/);
    await expect(como(db, analista, () => q(`update fis_creditos set valor_original = 1 where id = $1`, [cr]))).resolves.toBeTruthy();
    expect((await q(`select valor_original::float8 v from fis_creditos where id = $1`, [cr])).rows[0].v).toBe(10000); // RLS: sem política de update
  });

  it("estorno: devolve o saldo, não estorna duas vezes e preserva o original", async () => {
    const util = (await q(`select id from fis_movimentos where credito_id = $1 and tipo = 'utilizacao' and valor = 3000`, [cr])).rows[0].id;
    await expect(rpc(analista, "fis_movimento_estornar", [util, "curto"], ["uuid", "text"])).rejects.toThrow(/motivo/);
    const e = await rpc(analista, "fis_movimento_estornar", [util, "Dedução lançada em duplicidade no ERP"], ["uuid", "text"]);
    expect(await saldo(cr)).toBe(9899.7);
    const o = (await q(`select estornado, valor::float8 v from fis_movimentos where id = $1`, [util])).rows[0];
    expect(o).toEqual({ estornado: true, v: 3000 });
    const est = (await q(`select tipo, classe, competencia::text, valor_assinado::float8 va, estorno_de from fis_movimentos where id = $1`, [e])).rows[0];
    expect(est).toEqual({ tipo: "estorno", classe: "utilizacao", competencia: "2025-02-01", va: 3000, estorno_de: util });
    await expect(rpc(analista, "fis_movimento_estornar", [util, "Segunda tentativa de estorno"], ["uuid", "text"])).rejects.toThrow(/já foi estornado/);
    // a apuração mostra a utilização líquida (estorno na coluna do original, sem dupla contagem)
    const fev = (await apuracao("2025-02-01", "2025-02-01", cr))[0];
    expect(fev).toMatchObject({ si: 10000, u: 0, sf: 10000 });
  });

  it("estorno de entrada que deixaria saldo negativo é barrado", async () => {
    const c2 = await criarCredito(analista, { ...base(), competencia_origem: "2025-04-01", data_entrada: "2025-04-30", descricao: "Crédito abr", valor_original: 1000 });
    await anexar(analista, empA, "memoria_calculo", "credito", c2);
    await rpc(contador, "fis_credito_validar", [c2, "validado", null, null], ["uuid", "fis_validacao", "numeric", "text"]);
    await mov(analista, { credito_id: c2, tipo: "utilizacao", valor: 600, data: "2025-05-20", competencia: "2025-05-01", descricao: "Uso maio" });
    const entrada = (await q(`select id from fis_movimentos where credito_id = $1 and tipo = 'credito_apurado'`, [c2])).rows[0].id;
    await expect(rpc(analista, "fis_movimento_estornar", [entrada, "Crédito lançado a maior"], ["uuid", "text"])).rejects.toThrow(/negativo/);
  });

  it("virada de exercício: saldo inicial de janeiro = saldo final de dezembro anterior", async () => {
    await mov(analista, { credito_id: cr, tipo: "utilizacao", valor: 899.7, data: "2025-12-20", competencia: "2025-12-01", descricao: "Dedução dez" });
    await mov(analista, { credito_id: cr, tipo: "utilizacao", valor: 1000, data: "2026-01-20", competencia: "2026-01-01", descricao: "Dedução jan/26" });
    const ap = await apuracao("2025-12-01", "2026-01-01", cr);
    expect(ap[0].sf).toBe(9000);
    expect(ap[1]).toMatchObject({ competencia: "2026-01-01", si: 9000, u: 1000, sf: 8000 });
    const so2026 = await apuracao("2026-01-01", "2026-01-01", cr);
    expect(so2026[0].si).toBe(9000);
  });
});

describe("fechamento, reabertura e correção de competência anterior", () => {
  let cr: string;
  beforeAll(async () => {
    cr = await criarCredito(analista, { ...base(), tributo_id: pis, categoria_id: catPis, competencia_origem: "2025-06-01", data_entrada: "2025-06-30", descricao: "PIS jun/25", valor_original: 2000 });
    await anexar(analista, empA, "memoria_calculo", "credito", cr);
    await rpc(revisor, "fis_credito_validar", [cr, "validado", null, null], ["uuid", "fis_validacao", "numeric", "text"]);
    await mov(analista, { credito_id: cr, tipo: "utilizacao", valor: 500, data: "2025-07-20", competencia: "2025-07-01", descricao: "Dedução jul" });
  });
  const fechar = (quem: string, comp: string, just: string | null = null, aceitar = false) =>
    rpc(quem, "fis_periodo_fechar", [estabA, pis, comp, just, aceitar], ["uuid", "uuid", "date", "text", "boolean"]);
  const periodo = async (comp: string) => (await q(`select * from fis_periodos where estabelecimento_id = $1 and tributo_id = $2 and competencia = $3`, [estabA, pis, comp])).rows[0];

  it("analista não fecha; fechamento é sequencial", async () => {
    await expect(fechar(analista, "2025-06-01")).rejects.toThrow(/fecha ou reconcilia/);
    await expect(fechar(revisor, "2025-07-01")).rejects.toThrow(/anteriores.*06\/2025/);
    await fechar(revisor, "2025-06-01");
    await fechar(contador, "2025-07-01");
    const p = await periodo("2025-07-01");
    expect(p.status).toBe("fechado");
    expect(Number(p.snapshot.saldo_inicial)).toBe(2000);
    expect(Number(p.snapshot.saldo_final)).toBe(1500);
  });

  it("competência fechada não recebe lançamento", async () => {
    await expect(mov(analista, { credito_id: cr, tipo: "utilizacao", valor: 10, data: "2025-07-25", competencia: "2025-07-01", descricao: "Tardio" }))
      .rejects.toThrow(/07\/2025 está fechada/);
  });

  it("diferença com o saldo oficial exige justificativa para fechar", async () => {
    await rpc(analista, "fis_periodo_informar_saldos", [estabA, pis, "2025-08-01", j({ saldo_oficial: "1400.00", saldo_oficial_fonte: "EFD-Contribuições 08/2025" })], ["uuid", "uuid", "date", "jsonb"]);
    await expect(fechar(revisor, "2025-08-01")).rejects.toThrow(/difere do saldo oficial/);
    const v = (await como(db, revisor, () => q(`select * from fis_verificar($1, 2025) where regra = 'R09_SALDO_OFICIAL'`, [empA]))).rows;
    expect(v).toHaveLength(1);
    expect(Number(v[0].valor)).toBe(100);
    await fechar(revisor, "2025-08-01", "Crédito extemporâneo ainda não escriturado na EFD");
    expect((await periodo("2025-08-01")).status).toBe("fechado");
  });

  it("reabrir: contador não reabre; revisor reabre com motivo; correção marca as seguintes para reconciliação", async () => {
    const jun = (await periodo("2025-06-01")).id;
    await expect(rpc(contador, "fis_periodo_reabrir", [jun, "Correção de lançamento de junho"], ["uuid", "text"])).rejects.toThrow(/reabre/);
    await expect(rpc(revisor, "fis_periodo_reabrir", [jun, "curto"], ["uuid", "text"])).rejects.toThrow(/motivo/);
    const r = await rpc(revisor, "fis_periodo_reabrir", [jun, "Crédito de junho apurado a menor (nota não escriturada)"], ["uuid", "text"]);
    expect(r.posteriores_fechadas).toEqual(["07/2025", "08/2025"]);
    await mov(analista, { credito_id: cr, tipo: "ajuste_positivo", valor: 100, data: "2025-06-30", competencia: "2025-06-01", descricao: "Complemento jun" });
    const aj = (await q(`select id from fis_movimentos where credito_id = $1 and tipo = 'ajuste_positivo'`, [cr])).rows[0].id;
    await rpc(revisor, "fis_movimento_decidir", [aj, true, null], ["uuid", "boolean", "text"]);
    expect((await periodo("2025-07-01")).requer_reconciliacao).toBe(true);
    expect((await periodo("2025-08-01")).requer_reconciliacao).toBe(true);
    const alertas = (await como(db, revisor, () => q(`select regra, competencia::text from fis_verificar($1, 2025) where regra = 'R01_RECONCILIAR' order by competencia`, [empA]))).rows;
    expect(alertas.map((a) => a.competencia)).toEqual(["2025-07-01", "2025-08-01"]);
  });

  it("reconciliação em ordem e com registro; a trilha de eventos fica preservada", async () => {
    const jul = (await periodo("2025-07-01")).id;
    const ago = (await periodo("2025-08-01")).id;
    await expect(rpc(revisor, "fis_periodo_reconciliar", [jul, "Conferido o novo saldo"], ["uuid", "text"])).rejects.toThrow(/anteriores/);
    await fechar(revisor, "2025-06-01");
    await expect(rpc(revisor, "fis_periodo_reconciliar", [ago, "Conferido o novo saldo"], ["uuid", "text"])).rejects.toThrow(/anteriores/);
    await rpc(revisor, "fis_periodo_reconciliar", [jul, "Conferido: saldo inicial passou a 2.100,00"], ["uuid", "text"]);
    await rpc(revisor, "fis_periodo_reconciliar", [ago, "Conferido: transporte de julho"], ["uuid", "text"]);
    const p = await periodo("2025-07-01");
    expect(p.requer_reconciliacao).toBe(false);
    expect(Number(p.snapshot.saldo_inicial)).toBe(2100);
    const ev = (await q(`select evento from fis_periodos_eventos where periodo_id = $1 order by em, evento`, [jul])).rows.map((e) => e.evento);
    expect(ev).toEqual(expect.arrayContaining(["fechamento", "marcado_reconciliar", "reconciliacao"]));
    await expect(q(`delete from fis_periodos_eventos where periodo_id = $1`, [jul])).rejects.toThrow(/imutáveis/);
  });

  it("auditoria registra créditos, movimentos e períodos", async () => {
    const n = (await q(`select tabela, count(*)::int n from auditoria where tabela in ('fis_creditos', 'fis_movimentos', 'fis_periodos') group by tabela order by tabela`)).rows;
    expect(n.map((x) => x.tabela)).toEqual(["fis_creditos", "fis_movimentos", "fis_periodos"]);
  });
});

describe("compensação, transferência e arquivamento", () => {
  let pagto: string;
  it("compensação só com forma permitida na categoria; sem protocolo gera alerta", async () => {
    const cat = (await q(`select id from fis_categorias where codigo = 'PAGAMENTO_INDEVIDO'`)).rows[0].id;
    pagto = await criarCredito(analista, { estabelecimento_id: estabA, tributo_id: pis, categoria_id: cat, origem: "pagamento_indevido", competencia_origem: "2025-03-01", descricao: "DARF PIS pago a maior", valor_original: 800 });
    await anexar(analista, empA, "memoria_calculo", "credito", pagto);
    await anexar(analista, empA, "comprovante_pagamento", "credito", pagto);
    await rpc(revisor, "fis_credito_validar", [pagto, "validado", 750, "Reconhecido parcialmente: 50,00 de multa"], ["uuid", "fis_validacao", "numeric", "text"]);
    expect(await saldo(pagto)).toBe(750);
    await expect(mov(analista, { credito_id: pagto, tipo: "utilizacao", valor: 10, data: "2025-09-10", competencia: "2025-09-01", descricao: "Dedução" })).rejects.toThrow(/não permite a forma "deducao"/);
    await mov(analista, { credito_id: pagto, tipo: "compensacao", valor: 300, data: "2025-09-10", competencia: "2025-09-01", descricao: "Compensação de Cofins" });
    const v = (await como(db, revisor, () => q(`select regra from fis_verificar($1, 2025) where credito_id = $2`, [empA, pagto]))).rows.map((r) => r.regra);
    expect(v).toContain("R06_COMPENSACAO_SEM_PROTOCOLO");
  });

  it("transferência exige fundamento e aprovação de outra pessoa; aprova as duas pernas", async () => {
    const destino = await criarCredito(analista, { ...base(), estabelecimento_id: estabA2, competencia_origem: "2025-09-01", descricao: "Crédito ICMS filial set/25", valor_original: 1 });
    await expect(rpc(analista, "fis_transferir", [j({ origem_id: pagto, destino_id: destino, valor: 100, data: "2025-09-15", competencia: "2025-09-01", fundamento: "curto" })], ["jsonb"]))
      .rejects.toThrow(/fundamento/);
    await expect(rpc(analista, "fis_transferir", [j({ origem_id: pagto, destino_id: destino, valor: 100, data: "2025-09-15", competencia: "2025-09-01", fundamento: "Autorização da diretoria e parecer do contador" })], ["jsonb"]))
      .rejects.toThrow(/não permite a forma "transferencia"/);
  });

  it("arquivamento lógico: com saldo só como lançamento indevido (estorna as entradas)", async () => {
    const x = await criarCredito(analista, { ...base(), competencia_origem: "2025-10-01", descricao: "Lançado por engano", valor_original: 50 });
    await expect(rpc(analista, "fis_credito_arquivar", [x, "Lançamento em duplicidade com outro crédito", false], ["uuid", "text", "boolean"])).rejects.toThrow(/ainda tem saldo/);
    await rpc(analista, "fis_credito_arquivar", [x, "Lançamento em duplicidade com outro crédito", true], ["uuid", "text", "boolean"]);
    const c = (await q(`select arquivado, saldo::float8 s, disponibilidade from fis_creditos_saldos where id = $1`, [x])).rows[0];
    expect(c).toEqual({ arquivado: true, s: 0, disponibilidade: "arquivado" });
    expect((await q(`select count(*)::int n from fis_movimentos where credito_id = $1`, [x])).rows[0].n).toBe(2);
  });
});

describe("obrigações: arquivo salvo ≠ transmitida", () => {
  let ob: string;
  const tipoEfd = async () => (await q(`select id from fis_tipos_obrigacao where codigo = 'EFD_ICMS_IPI'`)).rows[0].id;
  it("sem regra cadastrada, o vencimento fica a confirmar", async () => {
    ob = await rpc(analista, "fis_obrigacao_salvar", [j({ tipo_id: await tipoEfd(), estabelecimento_id: estabA, competencia: "2026-08-01", responsavel_id: analista })], ["jsonb"]);
    const o = (await q(`select vencimento, vencimento_confirmado, status::text from fis_obrigacoes where id = $1`, [ob])).rows[0];
    expect(o).toEqual({ vencimento: null, vencimento_confirmado: false, status: "nao_iniciada" });
    await expect(rpc(analista, "fis_obrigacao_salvar", [j({ tipo_id: await tipoEfd(), estabelecimento_id: estabA, competencia: "2026-08-01" })], ["jsonb"])).rejects.toThrow(/Já existe/);
  });

  it("subir o arquivo da declaração não muda a situação; transmitir exige recibo vinculado", async () => {
    await anexar(analista, empA, "arquivo_declaracao", "obrigacao", ob);
    expect((await q(`select status::text from fis_obrigacoes where id = $1`, [ob])).rows[0].status).toBe("nao_iniciada");
    const st = (para: string, quem = analista, p: Record<string, unknown> = {}) => rpc(quem, "fis_obrigacao_status", [ob, para, j(p)], ["uuid", "fis_status_obrigacao", "jsonb"]);
    await st("em_preparacao");
    await expect(st("transmitida", analista, { data_transmissao: "2026-09-15", numero_recibo: "123" })).rejects.toThrow(/Pronta para transmissão/);
    await expect(st("pronta_transmissao")).rejects.toThrow(/aprova ou valida/);
    await st("pronta_transmissao", revisor);
    await expect(st("transmitida", analista, { data_transmissao: "2026-09-15" })).rejects.toThrow(/número do recibo/);
    await expect(st("transmitida", analista, { data_transmissao: "2026-09-15", numero_recibo: "REC-1" })).rejects.toThrow(/Recibo de transmissão.*não comprova/);
    await anexar(analista, empA, "recibo_transmissao", "obrigacao", ob);
    await st("transmitida", analista, { data_transmissao: "2026-09-15", numero_recibo: "REC-1" });
    await expect(st("entregue_conferida", analista)).rejects.toThrow(/aprova ou valida/);
    await st("entregue_conferida", revisor, { observacao: "Recibo conferido no portal" });
    const o = (await q(`select status::text, numero_recibo, transmitida_por, conferida_por from fis_obrigacoes where id = $1`, [ob])).rows[0];
    expect(o).toEqual({ status: "entregue_conferida", numero_recibo: "REC-1", transmitida_por: analista, conferida_por: revisor });
    const ev = (await q(`select count(*)::int n from fis_obrigacoes_eventos where obrigacao_id = $1`, [ob])).rows[0].n;
    expect(ev).toBe(5);
  });

  it("retificação gera a retificadora e preserva a original", async () => {
    const r = await rpc(analista, "fis_obrigacao_retificar", [ob, "Inclusão de notas de entrada omitidas"], ["uuid", "text"]);
    expect((await q(`select status::text from fis_obrigacoes where id = $1`, [ob])).rows[0].status).toBe("retificada");
    expect((await q(`select status::text, retificadora_de from fis_obrigacoes where id = $1`, [r])).rows[0]).toEqual({ status: "em_preparacao", retificadora_de: ob });
  });
});

describe("conciliação, tarefas e documentos", () => {
  it("divergência com responsável vira tarefa e pendência do núcleo", async () => {
    const d = await rpc(revisor, "fis_divergencia_registrar", [j({
      empresa_id: empA, estabelecimento_id: estabA, tributo_id: icms, competencia: "2025-03-01", fonte_comparada: "apuracao_oficial",
      valor_interno: "6899.70", valor_externo: "6999.70", motivo: "Saldo da EFD maior que o controle", responsavel_id: contador, prazo_interno: "2026-11-10",
    })], ["jsonb"]);
    expect(Number((await q(`select valor_diferenca from fis_divergencias where id = $1`, [d])).rows[0].valor_diferenca)).toBe(-100);
    const t = (await q(`select id, responsavel_id from fis_tarefas where alvo_id = $1`, [d])).rows[0];
    expect(t.responsavel_id).toBe(contador);
    const p = (await q(`select modulo, responsavel_id, status::text from pendencias where referencia_id = $1`, [t.id])).rows[0];
    expect(p).toEqual({ modulo: "fiscal.creditos", responsavel_id: contador, status: "aberta" });
    await expect(rpc(analista, "fis_divergencia_status", [d, "resolvida", "Ajustado na EFD retificadora"], ["uuid", "text", "text"])).rejects.toThrow(/aprova ou valida/);
    await rpc(contador, "fis_tarefa_status", [t.id, "concluida", "Analisado: falta escriturar estorno"], ["uuid", "text", "text"]);
    expect((await q(`select status::text from pendencias where referencia_id = $1`, [t.id])).rows[0].status).toBe("concluida");
    await rpc(contador, "fis_divergencia_status", [d, "resolvida", "Ajustado na EFD retificadora de 03/2025"], ["uuid", "text", "text"]);
  });

  it("analista não atribui tarefa a outra pessoa; revisor atribui", async () => {
    await expect(rpc(analista, "fis_tarefa_criar", [j({ titulo: "Enviar memória", empresa_id: empA, responsavel_id: contador })], ["jsonb"])).rejects.toThrow(/atribui/);
    expect(await rpc(revisor, "fis_tarefa_criar", [j({ titulo: "Enviar memória", empresa_id: empA, responsavel_id: analista })], ["jsonb"])).toBeTruthy();
  });

  it("nova versão substitui a anterior e herda os vínculos", async () => {
    const cr = (await q(`select id from fis_creditos where descricao = 'PIS jun/25'`)).rows[0].id;
    const v1 = (await q(`select d.id from fis_documentos d join fis_documentos_vinculos v on v.documento_id = d.id where v.alvo_id = $1`, [cr])).rows[0].id;
    const v2 = await rpc(analista, "fis_documento_registrar", [j({
      substitui_id: v1, motivo_substituicao: "Memória revisada", empresa_id: empA, arquivo_path: `fiscal.creditos/${empA}/${crypto.randomUUID()}-v2.pdf`,
      nome_arquivo: "v2.pdf", mime: "application/pdf", tamanho_bytes: 10, sha256: "b".repeat(64),
    })], ["jsonb"]);
    const docs = (await q(`select id, versao, situacao, raiz_id from fis_documentos where id in ($1, $2) order by versao`, [v1, v2])).rows;
    expect(docs).toEqual([{ id: v1, versao: 1, situacao: "substituido", raiz_id: null }, { id: v2, versao: 2, situacao: "vigente", raiz_id: v1 }]);
    expect((await q(`select count(*)::int n from fis_documentos_vinculos where documento_id = $1 and alvo_id = $2`, [v2, cr])).rows[0].n).toBe(1);
    await expect(rpc(analista, "fis_documento_registrar", [j({ substitui_id: v1, motivo_substituicao: "De novo", empresa_id: empA, arquivo_path: `fiscal.creditos/${empA}/x.pdf` })], ["jsonb"]))
      .rejects.toThrow(/vigente/);
    await expect(rpc(analista, "fis_documento_registrar", [j({ tipo: "outro", titulo: "Fora da pasta", empresa_id: empA, arquivo_path: `fiscal.creditos/${empB}/x.pdf` })], ["jsonb"]))
      .rejects.toThrow(/Caminho/);
  });

  it("documento só abre para quem enxerga a empresa (storage + RLS)", async () => {
    const path = (await q(`select arquivo_path from fis_documentos where empresa_id = $1 and arquivo_path is not null limit 1`, [empA])).rows[0].arquivo_path;
    await q(`insert into storage.objects (bucket_id, name) values ('fiscal', $1)`, [path]);
    const ver = async (u: string) => (await como(db, u, () => q(`select count(*)::int n from storage.objects where bucket_id = 'fiscal' and name = $1`, [path]))).rows[0].n;
    expect(await ver(leitor)).toBe(1);
    expect(await ver(analistaB)).toBe(0);
  });
});

describe("importação com validação, prévia e confirmação", () => {
  it("separa válidas, com erro e duplicadas; só importa ao confirmar", async () => {
    const linha = (n: number, d: Record<string, unknown>, erros: string[] = []) => ({ linha: n, dados: d, erros });
    const ok = { cnpj_estabelecimento: "11111111000111", tributo: "ICMS", categoria: "ICMS_SALDO_CREDOR", competencia_origem: "2025-11-01", valor_original: "1234.56", descricao: "Importado nov" };
    const lote = await rpc(analista, "fis_imp_preparar", ["creditos", "creditos.xlsx", j({}), j([
      linha(2, ok),
      linha(3, { ...ok, tributo: "XYZ" }),
      linha(4, ok),
      linha(5, { ...ok, valor_original: "1" }, ["Data inválida."]),
    ])], ["text", "text", "jsonb", "jsonb"]);
    const l = (await q(`select linha, status from fis_imp_linhas where lote_id = $1 order by linha`, [lote])).rows;
    expect(l).toEqual([{ linha: 2, status: "valida" }, { linha: 3, status: "erro" }, { linha: 4, status: "duplicada" }, { linha: 5, status: "erro" }]);
    expect((await q(`select count(*)::int n from fis_creditos where descricao = 'Importado nov'`)).rows[0].n).toBe(0);
    const r = await rpc(analista, "fis_imp_confirmar", [lote], ["uuid"]);
    expect(r).toEqual({ importadas: 1, rejeitadas: 0, com_erro: 2, duplicadas: 1 });
    expect((await q(`select count(*)::int n from fis_creditos where descricao = 'Importado nov' and importacao_lote_id = $1`, [lote])).rows[0].n).toBe(1);
    await expect(rpc(analista, "fis_imp_confirmar", [lote], ["uuid"])).rejects.toThrow(/já foi/);
  });

  it("movimento importado acima do saldo é rejeitado na confirmação, com o motivo", async () => {
    const cod = (await q(`select codigo from fis_creditos where descricao = 'PIS jun/25'`)).rows[0].codigo;
    const lote = await rpc(analista, "fis_imp_preparar", ["movimentos", "movs.csv", j({}), j([
      { linha: 2, dados: { codigo_credito: cod, tipo: "utilizacao", competencia: "2025-09-01", data: "2025-09-20", valor: "100.00", descricao: "Uso set" }, erros: [] },
      { linha: 3, dados: { codigo_credito: cod, tipo: "utilizacao", competencia: "2025-10-01", data: "2025-10-20", valor: "99999.00", descricao: "Uso out" }, erros: [] },
    ])], ["text", "text", "jsonb", "jsonb"]);
    const r = await rpc(analista, "fis_imp_confirmar", [lote], ["uuid"]);
    expect(r.importadas).toBe(1);
    expect(r.rejeitadas).toBe(1);
    expect((await q(`select mensagem from fis_imp_linhas where lote_id = $1 and linha = 3`, [lote])).rows[0].mensagem).toMatch(/Saldo insuficiente/);
  });
});

describe("painel", () => {
  it("indicadores saem dos dados e respeitam os filtros", async () => {
    const p = await rpc(revisor, "fis_painel", [j({ ano: 2025, empresa_id: empA })], ["jsonb"]);
    const s = (await q(`select sum(saldo_disponivel)::float8 d, sum(entradas) filter (where not arquivado)::float8 r from fis_creditos_saldos where empresa_id = $1`, [empA])).rows[0];
    expect(Number(p.creditos.disponivel)).toBe(s.d);
    expect(Number(p.creditos.registrado)).toBe(s.r);
    expect(p.mensal).toHaveLength(12);
    const soIcms = await rpc(revisor, "fis_painel", [j({ ano: 2025, empresa_id: empA, tributo_id: icms })], ["jsonb"]);
    expect(soIcms.por_tributo.every((t: { codigo: string }) => t.codigo === "ICMS")).toBe(true);
    const b = await rpc(analistaB, "fis_painel", [j({ ano: 2025 })], ["jsonb"]);
    expect(Number(b.creditos.registrado)).toBe(0);
  });
});
