import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let comConsulta: string, comGestor: string, finGestor: string;
let pedido: string, nota: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  comConsulta = await novoUsuario(db, "com.consulta@neo.com", { comercial: "consulta" });
  comGestor = await novoUsuario(db, "com.gestor@neo.com", { comercial: "gestor" });
  finGestor = await novoUsuario(db, "fin.gestor@neo.com", { financeiro: "gestor" });
  const empresa = (await q(`insert into empresas (razao_social, nome_curto, codigo_erp) values ('Neo Teste Ltda', 'Neo', '1') returning id`)).rows[0].id;
  // A Edge Function grava como service role (sem RLS); aqui o teste grava como dono do banco.
  pedido = (await q(
    `insert into com_pedidos (empresa_id, cod_pedido, situacao, nome_cliente, valor_total, valor_saldo, data_prev_fat)
     values ($1, '187', '2', 'CLIENTE', 1000, 1000, '2026-10-10') returning id`, [empresa])).rows[0].id;
  await q(`insert into com_pedido_itens (pedido_id, item, cod_produto, qtd_pedida) values ($1, 1, 'A', 10)`, [pedido]);
  nota = (await q(`insert into com_notas (pedido_id, nota, serie, situacao) values ($1, '1350', '1', '2') returning id`, [pedido])).rows[0].id;
  await q(`insert into com_nota_parcelas (nota_id, cod_titulo, valor) values ($1, '1001350A', 500)`, [nota]);
  await q(`insert into com_sincronizacoes (empresa_id, concluida_em) values ($1, now())`, [empresa]);
});

describe("área e módulo (0091, 0700)", () => {
  it("a área Comercial existe e o módulo Pedidos está ativo nela", async () => {
    expect((await q(`select nome, sensivel from areas where codigo = 'comercial'`)).rows[0]).toEqual({ nome: "Comercial", sensivel: false });
    expect((await q(`select area, nome, ativo from modulos where codigo = 'comercial.pedidos'`)).rows[0]).toEqual({ area: "comercial", nome: "Pedidos", ativo: true });
  });
});

describe("espelho dos pedidos (0701)", () => {
  const tabelas = ["com_pedidos", "com_pedido_itens", "com_notas", "com_nota_parcelas", "com_sincronizacoes"];

  it("quem tem a área Comercial lê todas as tabelas", async () => {
    for (const t of tabelas) {
      const r = await como(db, comConsulta, () => q(`select count(*)::int as n from ${t}`));
      expect(r.rows[0].n, t).toBe(1);
    }
  });

  it("quem não tem a área Comercial não vê nada", async () => {
    for (const t of tabelas) {
      const r = await como(db, finGestor, () => q(`select count(*)::int as n from ${t}`));
      expect(r.rows[0].n, t).toBe(0);
    }
  });

  it("nem o gestor do Comercial grava pela API do usuário (só a Edge Function, com a service role)", async () => {
    await expect(como(db, comGestor, () => q(`update com_pedidos set valor_saldo = 0 where id = $1`, [pedido]))).resolves.toMatchObject({ affectedRows: 0 });
    await expect(como(db, comGestor, () => q(`insert into com_pedido_itens (pedido_id, item) values ($1, 2)`, [pedido]))).rejects.toThrow();
    await expect(como(db, comGestor, () => q(`delete from com_notas where id = $1`, [nota]))).resolves.toMatchObject({ affectedRows: 0 });
    expect((await q(`select valor_saldo from com_pedidos where id = $1`, [pedido])).rows[0].valor_saldo).toBe("1000.00");
  });

  it("apagar o pedido leva itens, NFs e parcelas junto (espelho)", async () => {
    const outro = (await q(`insert into com_pedidos (empresa_id, cod_pedido, situacao) select empresa_id, '999', '0' from com_pedidos limit 1 returning id`)).rows[0].id;
    const n = (await q(`insert into com_notas (pedido_id, nota) values ($1, '1') returning id`, [outro])).rows[0].id;
    await q(`insert into com_nota_parcelas (nota_id, cod_titulo) values ($1, 'X')`, [n]);
    await q(`delete from com_pedidos where id = $1`, [outro]);
    expect((await q(`select count(*)::int as n from com_nota_parcelas where cod_titulo = 'X'`)).rows[0].n).toBe(0);
  });

  it("um pedido por código e empresa; uma parcela por título e NF", async () => {
    await expect(q(`insert into com_pedidos (empresa_id, cod_pedido, situacao) select empresa_id, '187', '2' from com_pedidos where id = $1`, [pedido])).rejects.toThrow();
    await expect(q(`insert into com_nota_parcelas (nota_id, cod_titulo) values ($1, '1001350A')`, [nota])).rejects.toThrow();
  });

  it("a função do agendamento não é chamável por usuários", async () => {
    await expect(como(db, comGestor, () => q(`select com_chamar_sincronizacao()`))).rejects.toThrow();
  });
});

describe("MDF-e (0702)", () => {
  it("o prazo do alerta nasce desligado (o Alan define)", async () => {
    expect((await q(`select valor from configuracoes where chave = 'comercial.pedidos.mdfe_dias_alerta'`)).rows[0].valor).toBeNull();
  });
  it("quem tem a área Comercial lê os manifestos; os demais não; ninguém grava pela API do usuário", async () => {
    await q(`insert into com_mdfes (empresa_id, numero, situacao) select empresa_id, '123', '2' from com_pedidos limit 1`);
    expect((await como(db, comConsulta, () => q(`select count(*)::int as n from com_mdfes`))).rows[0].n).toBe(1);
    expect((await como(db, finGestor, () => q(`select count(*)::int as n from com_mdfes`))).rows[0].n).toBe(0);
    await expect(como(db, comGestor, () => q(`insert into com_mdfes (empresa_id, numero) select empresa_id, '9' from com_pedidos limit 1`))).rejects.toThrow();
  });
});
