import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let empresa: string, fatura: string, ciclo: string;
const linha: Record<string, string> = {};

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const rpc = (usuario: string, sql: string, p: unknown[] = []) => como(db, usuario, () => q(sql, p));
const decidir = (u: string, tipo: string, linhas: string[], titulos: string[] = [], motivo: string | null = "motivo ok", categoria: string | null = null, conta: string | null = null) =>
  rpc(u, `select crt_registrar_decisao($1, $2::crt_tipo_decisao, $3::uuid[], $4::text[], $5, $6, $7) as id`, [fatura, tipo, linhas, titulos, categoria, conta, motivo]);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo', 'Neo', '1') returning id`)).rows[0].id;
  const linhas = JSON.stringify([
    { ordem: 1, descricao: "Anuidade Diferenc 07/12", valor: 50, descartada: false },
    { ordem: 2, descricao: "Credito Anuidade Cartao", valor: -50, descartada: false },
    { ordem: 3, descricao: "Ckt Assessoria", valor: 4936.74, descartada: false },
    { ordem: 4, descricao: "Belenus", valor: 1073.98, descartada: false },
    { ordem: 5, descricao: "Pagamento 1", valor: -9000, descartada: true },
  ]);
  fatura = (await rpc(finOperador, `select crt_importar_fatura($1, 'SICREDI PF', '2026-10-10', 6010.72, 'sicredi', 'f.pdf', $2::jsonb) as id`, [empresa, linhas])).rows[0].id;
  ciclo = (await q(`select ciclo_id from crt_faturas where id = $1`, [fatura])).rows[0].ciclo_id;
  for (const l of (await q(`select id, ordem from crt_fatura_linhas where fatura_id = $1`, [fatura])).rows) linha[l.ordem] = l.id;
});

describe("decisões por item (0135)", () => {
  it("compensar: só linhas que somam zero; consulta não decide; motivo obrigatório", async () => {
    await expect(decidir(finConsulta, "compensar", [linha[1], linha[2]])).rejects.toThrow(/Somente operador/);
    await expect(decidir(finOperador, "compensar", [linha[1], linha[3]])).rejects.toThrow(/somam R\$/);
    await expect(decidir(finOperador, "compensar", [linha[1], linha[2]], [], " ")).rejects.toThrow(/motivo/);
    await expect(decidir(finOperador, "compensar", [linha[1], linha[5]])).rejects.toThrow(/descartada/);
    const id = (await decidir(finOperador, "compensar", [linha[1], linha[2]], [], "anuidade cobrada e estornada")).rows[0].id;
    expect((await rpc(finConsulta, `select tipo, criado_por_nome from crt_vw_decisoes where id = $1`, [id])).rows[0]).toEqual({ tipo: "compensar", criado_por_nome: "operador" });
  });
  it("uma linha não entra em duas decisões de justificar/casar/compensar; classificar substitui a anterior", async () => {
    await expect(decidir(finOperador, "justificar", [linha[1]])).rejects.toThrow(/Já existe decisão para a linha Anuidade/);
    await decidir(finOperador, "classificar", [linha[3]], [], null, "Consultoria", "Serviços de Terceiros");
    await decidir(finOperador, "classificar", [linha[3]], [], null, "Consultoria", "Assessoria");
    const ativas = (await q(`select conta_fluxo from crt_decisoes where tipo = 'classificar' and desfeito_em is null`)).rows;
    expect(ativas).toEqual([{ conta_fluxo: "Assessoria" }]);
    await expect(decidir(finOperador, "classificar", [linha[3]], [], null, " ", null)).rejects.toThrow(/categoria/);
  });
  it("casar: linhas e títulos, título não repete; justificar título sem linha; observar", async () => {
    await decidir(finOperador, "casar", [linha[4]], ["658604"], "título lançado pelo total; fatura cobra a parcela 1/10");
    await expect(decidir(finOperador, "justificar", [], ["658604"])).rejects.toThrow(/o título 658604/);
    await decidir(finOperador, "justificar", [], ["999"], "compra da próxima fatura lançada antes");
    await decidir(finOperador, "observar", [linha[3]], [], "perguntar ao Rodrigo");
    await expect(decidir(finOperador, "casar", [linha[3]], [])).rejects.toThrow(/pelo menos um título/);
  });
  it("desfazer com motivo; nunca delete; imutável", async () => {
    const id = (await q(`select id from crt_decisoes where tipo = 'casar' and desfeito_em is null`)).rows[0].id;
    await expect(rpc(finOperador, `select crt_desfazer_decisao($1, '')`, [id])).rejects.toThrow(/motivo/);
    await rpc(finOperador, `select crt_desfazer_decisao($1, 'casei errado')`, [id]);
    await expect(rpc(finOperador, `select crt_desfazer_decisao($1, 'de novo')`, [id])).rejects.toThrow(/já desfeita/);
    await expect(como(db, "service", () => q(`update crt_decisoes set motivo = 'x' where id = $1`, [id]))).rejects.toThrow(/imutável/);
    await expect(como(db, "service", () => q(`delete from crt_decisoes where id = $1`, [id]))).rejects.toThrow(/não podem ser excluídos/);
    await decidir(finOperador, "casar", [linha[4]], ["658604"], "agora certo");   // liberado depois de desfeito
  });
  it("mês fechado não aceita decisão nova nem desfazer", async () => {
    await rpc(finGestor, `select crt_fechar_ciclo($1, '{}'::jsonb, 0, 0, 1, 1, null)`, [ciclo]);
    await expect(decidir(finOperador, "observar", [linha[2]], [], "depois")).rejects.toThrow(/reabra o mês/);
    const id = (await q(`select id from crt_decisoes where desfeito_em is null limit 1`)).rows[0].id;
    await expect(rpc(finOperador, `select crt_desfazer_decisao($1, 'tentativa')`, [id])).rejects.toThrow(/reabra o mês/);
  });
});
