import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string;
let empresa: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const servico = (sql: string, p: unknown[] = []) => como(db, "service", () => q(sql, p));
const estab = async (padrao: string) => (await q(`select id from crt_estabelecimentos where padrao = $1`, [padrao])).rows[0].id as string;
const reservar = (u: string, nome: string, est: string | null = null, cat = 17, grupo = 22) =>
  rpc(u, `select crt_reservar_cadastro_fornecedor($1, $2, $3, $4, $5) as id`, [empresa, nome, cat, grupo, est]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo', 'Neo', '1') returning id`)).rows[0].id;
  await q(`insert into cap_fornecedores (empresa_id, cod_fornecedor, nome, nome_fantasia) values ($1, '928', 'GOOGLE SUITE', null)`, [empresa]);
});

describe("configuração e marketplace (0140)", () => {
  it("endereço único dos 'Outros' e Mercado Livre como marketplace", async () => {
    const cfg = (await q(`select valor from configuracoes where chave = 'financeiro.cartao.fornecedor_outros'`)).rows[0].valor;
    expect(cfg).toMatchObject({ endereco: "RUA CANADA", numero: "277", bairro: "SANTA ROSA", cep: "78040050", codCategoria: 17, codGrupo: 22 });
    expect((await q(`select padrao from crt_estabelecimentos where marketplace order by padrao`)).rows.map((r) => r.padrao)).toEqual(["EBAZAR", "MERCADO*MERCADOLIVRE", "MERCADOLIVRE"]);
  });
});

describe("cadastrar fornecedor 'Outros'", () => {
  it("chave desligada, consulta, nome existente e marketplace são recusados", async () => {
    await expect(reservar(finOperador, "NUVIAGENS")).rejects.toThrow(/desligado/);
    await q(`update configuracoes set valor = 'true'::jsonb where chave = 'financeiro.cartao.lancar_no_erp'`);
    await expect(reservar(finConsulta, "NUVIAGENS")).rejects.toThrow(/Somente operador/);
    await expect(reservar(finOperador, "google suite")).rejects.toThrow(/928 · GOOGLE SUITE/);
    await expect(reservar(finOperador, "MERCADO LIVRE", await estab("MERCADOLIVRE"))).rejects.toThrow(/Marketplace/);
    await expect(reservar(finOperador, "X")).rejects.toThrow(/2 a 60/);
    await expect(reservar(finOperador, "LOJA", null, 0, 22)).rejects.toThrow(/Categoria/);
  });
  it("monta o corpo tipo 3 com o endereço fixo; o mesmo nome não entra duas vezes; cadastrado vai para o espelho e para a sugestão", async () => {
    const nuv = await estab("NUVIAGENS");
    const id = (await reservar(finOperador, "  nuviagens  turismo ", nuv, 13, 16)).rows[0].id;
    const r = (await q(`select nome, payload from crt_fornecedores_cadastrados where id = $1`, [id])).rows[0];
    expect(r.nome).toBe("NUVIAGENS TURISMO");
    expect(r.payload).toEqual({ nome: "NUVIAGENS TURISMO", nomeFantasia: "NUVIAGENS TURISMO", situacao: 1, classificacao: 3, codCategoria: 13, codGrupo: 16,
      endereco: "RUA CANADA", numero: "277", bairro: "SANTA ROSA", cep: "78040050", cidade: "CUIABA", estado: "MT", inscEstadual: "ISENTO", codIbge: "5103403" });
    await expect(reservar(finOperador, "Nuviagens Turismo")).rejects.toThrow(/já está sendo/);
    await expect(rpc(finOperador, `select crt_iniciar_cadastro_fornecedor($1)`, [id])).rejects.toThrow(/permission denied/);
    await servico(`select crt_iniciar_cadastro_fornecedor($1)`, [id]);
    await servico(`select crt_concluir_cadastro_fornecedor($1, '1500', '{"codFornecedor":1500}'::jsonb, null)`, [id]);
    expect((await q(`select nome from cap_fornecedores where empresa_id = $1 and cod_fornecedor = '1500'`, [empresa])).rows[0].nome).toBe("NUVIAGENS TURISMO");
    expect((await q(`select lancamento_erp from crt_estabelecimentos where id = $1`, [nuv])).rows[0].lancamento_erp.codFornecedor).toBe(1500);
    await expect(servico(`update crt_fornecedores_cadastrados set nome = 'X' where id = $1`, [id])).rejects.toThrow(/imutável/);
    await expect(servico(`delete from crt_fornecedores_cadastrados where id = $1`, [id])).rejects.toThrow(/não podem ser excluídos/);
  });
  it("erro do Consistem libera nova tentativa; sem resposta é resolvido à mão", async () => {
    const a = (await reservar(finOperador, "POSTO SAO JOSE")).rows[0].id;
    await servico(`select crt_iniciar_cadastro_fornecedor($1)`, [a]);
    await servico(`select crt_concluir_cadastro_fornecedor($1, null, null, 'Consistem HTTP 400: grupo inválido')`, [a]);
    const b = (await reservar(finOperador, "POSTO SAO JOSE")).rows[0].id;
    await servico(`select crt_iniciar_cadastro_fornecedor($1)`, [b]);
    await expect(rpc(finOperador, `select crt_resolver_cadastro_fornecedor($1, '77', '')`, [b])).rejects.toThrow(/conferido/);
    await rpc(finOperador, `select crt_resolver_cadastro_fornecedor($1, '1501', 'achei no Consistem')`, [b]);
    expect((await q(`select situacao, cod_fornecedor from crt_fornecedores_cadastrados where id = $1`, [b])).rows[0]).toEqual({ situacao: "cadastrado", cod_fornecedor: "1501" });
  });
  it("ligar estabelecimento a fornecedor existente; marketplace não liga", async () => {
    const google = await estab("GOOGLE");
    await expect(rpc(finConsulta, `select crt_ligar_fornecedor($1, '928')`, [google])).rejects.toThrow(/Somente operador/);
    await rpc(finOperador, `select crt_ligar_fornecedor($1, '928')`, [google]);
    expect((await q(`select lancamento_erp from crt_estabelecimentos where id = $1`, [google])).rows[0].lancamento_erp).toMatchObject({ codFornecedor: 928 });
    await expect(rpc(finOperador, `select crt_ligar_fornecedor($1, '624')`, [await estab("MERCADOLIVRE")])).rejects.toThrow(/Marketplace/);
  });
});

describe("genéricos (0141)", () => {
  it("posto, restaurante, padaria, hotel, pousada e supermercado são fornecedor por compra", async () => {
    expect((await q(`select padrao from crt_estabelecimentos where fornecedor_por_compra order by padrao`)).rows.map((r) => r.padrao))
      .toEqual(["HOTEL", "PADARIA", "POSTO", "POUSADA", "RESTAURANTE", "SUPERMERCADO"]);
  });
});

describe("próximo código (0142)", () => {
  it("maior código do espelho + 1, só para a service role", async () => {
    expect((await servico(`select crt_proximo_codigo_fornecedor($1) as n`, [empresa])).rows[0].n).toBe(1502);
    await expect(rpc(finOperador, `select crt_proximo_codigo_fornecedor($1)`, [empresa])).rejects.toThrow(/permission denied/);
  });
});
