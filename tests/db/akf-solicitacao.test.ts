import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finConsulta: string, finOperador: string, finGestor: string;
let empresa: string, cliente: string, clienteMb: string;
let contador = 0;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);

/** Título a vencer em `dias` dias, com a Neo (portador 91), em estágio antecipável. */
async function titulo(valor = 1000, opcoes: { dias?: number; estagio?: string; portador?: string | null; cedido?: boolean; contestado?: boolean; parcela?: string; cliente?: string } = {}) {
  const n = ++contador;
  return (await q(
    `insert into rec_titulos (empresa_id, contraparte_id, documento, parcela, emissao, vencimento, valor, estagio, cod_portador, cedido, contestado)
     values ($1, $2, $3, $4, (now() at time zone 'America/Cuiaba')::date - 30, (now() at time zone 'America/Cuiaba')::date + $5::int, $6, $7::rec_estagio, $8, $9, $10) returning id`,
    [empresa, opcoes.cliente ?? cliente, `SOL${n}`, opcoes.parcela ?? "1", opcoes.dias ?? 20, valor, opcoes.estagio ?? "boleto_enviado", opcoes.portador === undefined ? "91" : opcoes.portador, opcoes.cedido ?? false, opcoes.contestado ?? false],
  )).rows[0].id as string;
}
type Item = { titulo_id: string; valor?: number | null; sem_boleto?: boolean; observacao?: string };
const criar = (usuario: string, itens: Item[], observacao: string | null = null, data: string | null = null) =>
  como(db, usuario, () => q(`select akf_criar_solicitacao($1::jsonb, $2, $3::date) as r`, [JSON.stringify(itens), observacao, data]));
const cancelar = (usuario: string, id: string, motivo: string) => como(db, usuario, () => q(`select akf_cancelar_solicitacao($1::uuid, $2) as r`, [id, motivo]));
const operacao = async (id: string) => (await q(`select numero, status, itens, total::float as total, parciais, sem_boleto, criado_por_nome from akf_vw_operacoes where id = $1`, [id])).rows[0];
const itensDe = async (id: string) => (await q(`select documento, cliente_nome, valor_titulo::float as valor_titulo, valor_restante::float as valor_restante, valor_solicitado::float as valor_solicitado, parcial, sem_boleto, observacao, ordem from akf_operacao_titulos where operacao_id = $1 order by ordem`, [id])).rows;

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  finConsulta = await novoUsuario(db, "consulta@neo.com", { financeiro: "consulta" });
  finOperador = await novoUsuario(db, "operador@neo.com", { financeiro: "operador" });
  finGestor = await novoUsuario(db, "gestor@neo.com", { financeiro: "gestor" });
  await q(`update perfis set nome = 'Operador Teste' where id = $1`, [finOperador]);
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Neo Teste Ltda', 'Neo') returning id`)).rows[0].id;
  cliente = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('EFATA CONSTRUTORA LTDA', '{cliente}', 's1') returning id`)).rows[0].id;
  clienteMb = (await q(`insert into contrapartes (nome, tipos, codigo_erp) values ('MB ENGENHARIA', '{cliente}', 's2') returning id`)).rows[0].id;
});

describe("parâmetros e destinatários (migration 0130)", () => {
  it("lista de clientes sem boleto e OBS atualizadas; cópia e contraparte AKF criadas", async () => {
    const c = Object.fromEntries((await q(`select chave, valor from configuracoes where chave like 'financeiro.akf.%'`)).rows.map((r) => [r.chave, r.valor]));
    expect(c["financeiro.akf.clientes_sem_boleto"]).toEqual(["MIP", "MB", "JANEIRO", "RAJA", "CAPARAO", "HOUSE GARDEN", "QRTZ 39", "ROCCA", "JBL", "LEANDRO", "J.MIRO", "BF OTICA"]);
    expect(c["financeiro.akf.observacao_sem_boleto"]).toBe("Operar com 01 dia após o vencimento e não emitir boleto.");
    expect(c["financeiro.akf.copia"]).toEqual(["rodrigofelicio@neoformas.com.br", "financeiro@neoformas.com.br"]);
    const akf = (await q(`select id, nome, tipos from contrapartes where nome = 'AKF Securitizadora'`)).rows[0];
    expect(String(akf.tipos)).toBe("{outro}");
    expect(c["financeiro.akf.contraparte_id"]).toBe(akf.id);
    const contatos = (await q(`select nome, email, finalidades from contatos where contraparte_id = $1 order by nome`, [akf.id])).rows;
    expect(contatos.map((k) => [k.nome, k.email, k.finalidades])).toEqual([["André Kamil", "andre.kamil@akfsec.com.br", ["akf"]], ["Kayza", "kayza@akfsec.com.br", ["akf"]]]);
  });
  it("mensagens ganhou a coluna cc", async () => {
    const r = (await q(`select column_name from information_schema.columns where table_name = 'mensagens' and column_name = 'cc'`)).rows;
    expect(r).toHaveLength(1);
  });
});

describe("akf_criar_solicitacao", () => {
  it("cria a solicitação com os títulos copiados, numerada, ordenada por vencimento e com interação por título", async () => {
    const a = await titulo(120000, { dias: 20, parcela: "2" });
    const b = await titulo(50000, { dias: 5, cliente: clienteMb });
    const r = (await criar(finOperador, [{ titulo_id: a }, { titulo_id: b, sem_boleto: true, observacao: " operar com vencimento para 20/10 " }], "Lote de teste")).rows[0].r;
    expect(r.itens).toBe(2);
    expect(r.total).toBe(170000);
    expect(await operacao(r.id)).toEqual({ numero: r.numero, status: "rascunho", itens: 2, total: 170000, parciais: 0, sem_boleto: 1, criado_por_nome: "Operador Teste" });
    const itens = await itensDe(r.id);
    expect(itens.map((i) => i.documento)).toEqual([`SOL${contador}`, `SOL${contador - 1}/2`]); // o de 5 dias vem antes do de 20
    expect(itens[0]).toMatchObject({ cliente_nome: "MB ENGENHARIA", valor_titulo: 50000, valor_restante: 50000, valor_solicitado: 50000, parcial: false, sem_boleto: true, observacao: "operar com vencimento para 20/10", ordem: 1 });
    expect(itens[1]).toMatchObject({ cliente_nome: "EFATA CONSTRUTORA LTDA", valor_solicitado: 120000, parcial: false, sem_boleto: false, observacao: null, ordem: 2 });
    const i = (await q(`select tipo, descricao from interacoes where referencia_id = $1`, [b])).rows[0];
    expect(i.tipo).toBe("akf_solicitacao");
    expect(i.descricao).toBe(`Incluído na solicitação de antecipação nº ${r.numero}: R$ 50.000,00. Operar 01 dia após o vencimento, sem boleto.`);
    // o título em si não muda (nada é marcado como cedido antes do borderô)
    expect((await q(`select cedido from rec_titulos where id = $1`, [a])).rows[0].cedido).toBe(false);
    // numeração sequencial
    const r2 = (await criar(finOperador, [{ titulo_id: await titulo() }])).rows[0].r;
    expect(r2.numero).toBe(r.numero + 1);
  });

  it("antecipação parcial: valor menor que o restante marca parcial; usa o restante quando já há parte na AKF", async () => {
    const a = await titulo(350000);
    const r = (await criar(finOperador, [{ titulo_id: a, valor: 200000 }])).rows[0].r;
    expect((await itensDe(r.id))[0]).toMatchObject({ valor_titulo: 350000, valor_restante: 350000, valor_solicitado: 200000, parcial: true });
    expect((await q(`select descricao from interacoes where referencia_id = $1 and tipo = 'akf_solicitacao'`, [a])).rows[0].descricao).toContain("(parcial; restava R$ 350.000,00)");
    expect((await operacao(r.id)).parciais).toBe(1);

    const b = await titulo(1000);
    await como(db, finOperador, () => q(`select akf_desdobrar_titulo($1::uuid, 400, (now() at time zone 'America/Cuiaba')::date + 10)`, [b]));
    const r2 = (await criar(finOperador, [{ titulo_id: b }])).rows[0].r;
    expect((await itensDe(r2.id))[0]).toMatchObject({ valor_titulo: 1000, valor_restante: 600, valor_solicitado: 600, parcial: false });
    await expect(criar(finOperador, [{ titulo_id: await titulo(2000), valor: 1000.5 }])).resolves.toBeTruthy();
  });

  it("recusa valor acima do restante, zero, com 3 casas, título repetido e lista vazia", async () => {
    const a = await titulo(1000);
    await expect(criar(finOperador, [{ titulo_id: a, valor: 1200 }])).rejects.toThrow(/passa do que resta com a Neo \(R\$ 1\.000,00\)/);
    await expect(criar(finOperador, [{ titulo_id: a, valor: 0 }])).rejects.toThrow(/Informe o valor/);
    await expect(criar(finOperador, [{ titulo_id: a, valor: 10.123 }])).rejects.toThrow(/2 casas/);
    await expect(criar(finOperador, [{ titulo_id: a }, { titulo_id: a }])).rejects.toThrow(/mais de uma vez/);
    await expect(criar(finOperador, [])).rejects.toThrow(/pelo menos um título/);
    await expect(criar(finOperador, [{ titulo_id: a }], null, "2000-01-01")).rejects.toThrow(/30 dias/);
  });

  it("só título disponível para antecipar: recusa vencido, na AKF, contestado, encerrado e estágio não antecipável", async () => {
    await expect(criar(finOperador, [{ titulo_id: await titulo(1000, { dias: -3 }) }])).rejects.toThrow(/já venceu/);
    await expect(criar(finOperador, [{ titulo_id: await titulo(1000, { portador: "998" }) }])).rejects.toThrow(/já está na AKF/);
    await expect(criar(finOperador, [{ titulo_id: await titulo(1000, { cedido: true }) }])).rejects.toThrow(/já está na AKF/);
    await expect(criar(finOperador, [{ titulo_id: await titulo(1000, { contestado: true }) }])).rejects.toThrow(/contestado/);
    await expect(criar(finOperador, [{ titulo_id: await titulo(1000, { estagio: "promessa" }) }])).rejects.toThrow(/estágio antecipável/);
    await expect(criar(finOperador, [{ titulo_id: await titulo(1000, { estagio: "cancelado" }) }])).rejects.toThrow(/encerrado/);
    // tudo ou nada: o título bom não fica numa solicitação órfã
    const bom = await titulo(1000);
    const antes = Number((await q(`select count(*) as n from akf_operacoes`)).rows[0].n);
    await expect(criar(finOperador, [{ titulo_id: bom }, { titulo_id: await titulo(1000, { dias: -1 }) }])).rejects.toThrow();
    expect(Number((await q(`select count(*) as n from akf_operacoes`)).rows[0].n)).toBe(antes);
    expect(Number((await q(`select count(*) as n from akf_vw_titulos_solicitados where titulo_id = $1`, [bom])).rows[0].n)).toBe(0);
  });

  it("título já em solicitação aberta não entra em outra; depois de cancelada, entra", async () => {
    const a = await titulo(1000);
    const r = (await criar(finOperador, [{ titulo_id: a }])).rows[0].r;
    await expect(criar(finOperador, [{ titulo_id: a }])).rejects.toThrow(new RegExp(`outra solicitação em aberto \\(nº ${r.numero}\\)`));
    expect((await q(`select numero, status, parcial from akf_vw_titulos_solicitados where titulo_id = $1`, [a])).rows[0]).toEqual({ numero: r.numero, status: "rascunho", parcial: false });
    await cancelar(finOperador, r.id, "Montada errada.");
    await expect(criar(finOperador, [{ titulo_id: a }])).resolves.toBeTruthy();
  });

  it("permissão: consulta não monta nem cancela; gestor monta", async () => {
    const a = await titulo(1000);
    await expect(criar(finConsulta, [{ titulo_id: a }])).rejects.toThrow(/Somente operador/);
    const r = (await criar(finGestor, [{ titulo_id: a }])).rows[0].r;
    await expect(cancelar(finConsulta, r.id, "Tentativa sem permissão.")).rejects.toThrow(/não encontrada|permissão/);
    expect((await operacao(r.id)).status).toBe("rascunho");
  });
});

describe("akf_marcar_solicitada e akf_cancelar_solicitacao", () => {
  async function solicitacaoComMensagem() {
    const a = await titulo(1000);
    const r = (await criar(finOperador, [{ titulo_id: a }])).rows[0].r;
    const akf = (await q(`select id from contrapartes where nome = 'AKF Securitizadora'`)).rows[0].id;
    const msg = (await como(db, finOperador, () => q(
      `insert into mensagens (modulo, contraparte_id, canal, destinatario, cc, assunto, corpo, status)
       values ('financeiro.akf', $1, 'email', 'andre.kamil@akfsec.com.br,kayza@akfsec.com.br', 'financeiro@neoformas.com.br', 'ANTECIPAÇÕES - 12/10/2026', 'corpo', 'rascunho') returning id`, [akf],
    ))).rows[0].id as string;
    return { titulo: a, operacao: r.id as string, numero: r.numero as number, mensagem: msg };
  }

  it("exige o rascunho do Gmail na mensagem; depois marca solicitada, copia assunto/corpo e registra a interação", async () => {
    const s = await solicitacaoComMensagem();
    await expect(como(db, "service", () => q(`select akf_marcar_solicitada($1::uuid, $2::uuid, $3::uuid)`, [s.operacao, s.mensagem, finOperador]))).rejects.toThrow(/ainda não tem o rascunho/);
    await como(db, "service", () => q(`update mensagens set id_externo = 'r-123' where id = $1`, [s.mensagem]));
    await como(db, "service", () => q(`select akf_marcar_solicitada($1::uuid, $2::uuid, $3::uuid)`, [s.operacao, s.mensagem, finOperador]));
    const o = (await q(`select status, mensagem_id, assunto, corpo, solicitada_por, rascunho_gmail, destinatario, cc, solicitada_por_nome from akf_vw_operacoes where id = $1`, [s.operacao])).rows[0];
    expect(o).toMatchObject({ status: "solicitada", mensagem_id: s.mensagem, assunto: "ANTECIPAÇÕES - 12/10/2026", corpo: "corpo", solicitada_por: finOperador, rascunho_gmail: "r-123", destinatario: "andre.kamil@akfsec.com.br,kayza@akfsec.com.br", cc: "financeiro@neoformas.com.br", solicitada_por_nome: "Operador Teste" });
    const i = (await q(`select tipo, canal, usuario_id from interacoes where referencia_id = $1 and tipo = 'akf_solicitacao_rascunho'`, [s.titulo])).rows[0];
    expect(i).toEqual({ tipo: "akf_solicitacao_rascunho", canal: "email", usuario_id: finOperador });
    // não volta a rascunho, nem marca de novo
    await expect(como(db, "service", () => q(`select akf_marcar_solicitada($1::uuid, $2::uuid)`, [s.operacao, s.mensagem]))).rejects.toThrow(/não está em rascunho/);
    await expect(como(db, finOperador, () => q(`update akf_operacoes set status = 'rascunho' where id = $1`, [s.operacao]))).rejects.toThrow(/não volta a rascunho/);
    // o título continua em solicitação aberta (status solicitada)
    expect((await q(`select status from akf_vw_titulos_solicitados where titulo_id = $1`, [s.titulo])).rows[0].status).toBe("solicitada");
  });

  it("cancela rascunho e solicitada com motivo, descarta a mensagem e bloqueia tudo depois", async () => {
    const s = await solicitacaoComMensagem();
    await expect(cancelar(finOperador, s.operacao, "ok")).rejects.toThrow(/Informe o motivo/);
    await como(db, "service", () => q(`update mensagens set id_externo = 'r-9' where id = $1`, [s.mensagem]));
    await como(db, "service", () => q(`select akf_marcar_solicitada($1::uuid, $2::uuid, $3::uuid)`, [s.operacao, s.mensagem, finOperador]));
    await cancelar(finOperador, s.operacao, "A AKF não operou; refazer na semana que vem.");
    const o = (await q(`select status, motivo_cancelamento, cancelada_por from akf_operacoes where id = $1`, [s.operacao])).rows[0];
    expect(o).toEqual({ status: "cancelada", motivo_cancelamento: "A AKF não operou; refazer na semana que vem.", cancelada_por: finOperador });
    expect((await q(`select status from mensagens where id = $1`, [s.mensagem])).rows[0].status).toBe("descartada");
    expect((await q(`select tipo from interacoes where referencia_id = $1 and tipo = 'akf_solicitacao_cancelada'`, [s.titulo])).rows).toHaveLength(1);
    expect(Number((await q(`select count(*) as n from akf_vw_titulos_solicitados where titulo_id = $1`, [s.titulo])).rows[0].n)).toBe(0);
    await expect(cancelar(finOperador, s.operacao, "De novo, por engano.")).rejects.toThrow(/já está cancelada/);
    await expect(como(db, finOperador, () => q(`update akf_operacoes set observacao = 'x' where id = $1`, [s.operacao]))).rejects.toThrow(/cancelada e não pode/);
  });

  it("itens são imutáveis e nada é apagado", async () => {
    const s = await solicitacaoComMensagem();
    await expect(como(db, finOperador, () => q(`update akf_operacao_titulos set valor_solicitado = 1 where operacao_id = $1`, [s.operacao]))).rejects.toThrow(/não podem ser alterados/);
    await expect(como(db, "service", () => q(`delete from akf_operacao_titulos where operacao_id = $1`, [s.operacao]))).rejects.toThrow();
    await expect(como(db, "service", () => q(`delete from akf_operacoes where id = $1`, [s.operacao]))).rejects.toThrow();
    await expect(como(db, finOperador, () => q(`update akf_operacoes set numero = 999 where id = $1`, [s.operacao]))).rejects.toThrow(/não mudam/);
  });

  it("quem não é do Financeiro não vê solicitações", async () => {
    const sem = await novoUsuario(db, "sem@neo.com", { fiscal: "consulta" });
    const r = await como(db, sem, () => q(`select count(*) as n from akf_vw_operacoes`));
    expect(Number(r.rows[0].n)).toBe(0);
    const r2 = await como(db, finConsulta, () => q(`select count(*) as n from akf_vw_operacoes`));
    expect(Number(r2.rows[0].n)).toBeGreaterThan(0);
  });
});

describe("akf_excluir_solicitacao (0133)", () => {
  const excluir = (usuario: string, id: string, motivo: string | null = null) => como(db, usuario, () => q(`select akf_excluir_solicitacao($1::uuid, $2) as r`, [id, motivo]));

  it("só cancelada e só gestor; fica gravada com quem, quando e motivo; nada é apagado", async () => {
    const a = await titulo(1000);
    const r = (await criar(finOperador, [{ titulo_id: a }])).rows[0].r;
    await expect(excluir(finGestor, r.id)).rejects.toThrow(/Só solicitação cancelada/);
    await cancelar(finOperador, r.id, "Montada por engano.");
    await expect(excluir(finOperador, r.id)).rejects.toThrow(/Somente gestor/);
    const ok = (await excluir(finGestor, r.id, "  limpeza  ")).rows[0].r;
    expect(ok.numero).toBe(r.numero);
    const o = (await q(`select status, excluida_por, motivo_exclusao, excluida_em is not null as excluida from akf_vw_operacoes where id = $1`, [r.id])).rows[0];
    expect(o).toEqual({ status: "cancelada", excluida_por: finGestor, motivo_exclusao: "limpeza", excluida: true });
    expect(Number((await q(`select count(*) as n from akf_operacao_titulos where operacao_id = $1`, [r.id])).rows[0].n)).toBe(1);
    await expect(excluir(finGestor, r.id)).rejects.toThrow(/já excluída/);
  });

  it("sem motivo grava 'Excluída da lista'; ao excluir nada mais muda", async () => {
    const r = (await criar(finOperador, [{ titulo_id: await titulo(1000) }])).rows[0].r;
    await cancelar(finOperador, r.id, "Não vai mais.");
    await expect(como(db, finGestor, () => q(`update akf_operacoes set excluida_em = now(), observacao = 'x' where id = $1`, [r.id]))).rejects.toThrow(/nada mais/);
    await excluir(finGestor, r.id);
    expect((await q(`select motivo_exclusao from akf_operacoes where id = $1`, [r.id])).rows[0].motivo_exclusao).toBe("Excluída da lista");
  });
});
