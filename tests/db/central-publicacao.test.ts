// Central de Gestão, Fase 6: contrato de publicação (0097), pendências do Fiscal (0206) e grupo Cobrança (0180).
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let finGestor: string, finOperador: string, fiscalOperador: string, fiscalGestor: string;
let empresa: string, estab: string, tipoComRegra: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const hoje = `(now() at time zone 'America/Cuiaba')::date`;
const publicar = (dados: object) => q(`select publicar_pendencia($1) id`, [JSON.stringify(dados)]).then((r) => r.rows[0].id as string);
const abertas = async (chave: string) =>
  (await q(`select id, titulo, status, prazo::text, criticidade, responsavel_id, precisa_distribuir, origem from pendencias where chave_origem = $1 order by criado_em`, [chave])).rows;

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com");   // o primeiro usuário vira admin_geral (migration 0003)
  finGestor = await novoUsuario(db, "fin.gestor@neo.com", { financeiro: "gestor" });
  finOperador = await novoUsuario(db, "fin.operador@neo.com", { financeiro: "operador" });
  fiscalOperador = await novoUsuario(db, "fiscal.operador@neo.com", { fiscal: "operador" });
  fiscalGestor = await novoUsuario(db, "fiscal.gestor@neo.com", { fiscal: "gestor" });
  empresa = (await q(`insert into empresas (razao_social, nome_curto) values ('Empresa Teste Ltda', 'Teste') returning id`)).rows[0].id;
  estab = (await q(`insert into fis_estabelecimentos (empresa_id, nome, cnpj, uf) values ($1, 'Matriz Cuiabá', '11222333000181', 'MT') returning id`, [empresa])).rows[0].id;
  tipoComRegra = (await q(`insert into fis_tipos_obrigacao (codigo, nome, esfera, periodicidade, dia_vencimento) values ('TESTE_DCTF', 'DCTF teste', 'federal', 'mensal', 15) returning id`)).rows[0].id;
});

describe("contrato de publicação", () => {
  it("só rotinas do módulo publicam: usuário logado não chama a função", async () => {
    await como(db, finGestor, async () => {
      await expect(q(`select publicar_pendencia('{"modulo":"financeiro.recebiveis","chave_origem":"x","titulo":"x"}')`)).rejects.toThrow(/permission denied/);
      await expect(q(`select encerrar_pendencia('financeiro.recebiveis', 'x')`)).rejects.toThrow(/permission denied/);
    });
  });

  it("publicar de novo atualiza (inclusive o título) em vez de duplicar", async () => {
    const a = await publicar({ modulo: "financeiro.recebiveis", chave_origem: "teste:1", titulo: "Versão 1", prazo: null });
    const b = await publicar({ modulo: "financeiro.recebiveis", chave_origem: "teste:1", titulo: "Versão 2", prioridade: "alta" });
    expect(b).toBe(a);
    expect(await abertas("teste:1")).toMatchObject([{ titulo: "Versão 2", criticidade: "alta", origem: "modulo", status: "aberta" }]);
  });

  it("o responsável escolhido por uma pessoa não é sobrescrito; encerrar fecha só a do módulo", async () => {
    const id = await publicar({ modulo: "financeiro.recebiveis", chave_origem: "teste:2", titulo: "Com dono" });
    await como(db, finGestor, () => q(`update pendencias set responsavel_id = $2 where id = $1`, [id, finOperador]));
    await publicar({ modulo: "financeiro.recebiveis", chave_origem: "teste:2", titulo: "Com dono", responsavel_id: finGestor });
    expect((await abertas("teste:2"))[0].responsavel_id).toBe(finOperador);

    const manual = await como(db, finGestor, async () =>
      (await q(`select pendencia_criar('{"modulo":"financeiro.recebiveis","titulo":"Manual com a mesma chave?"}') id`)).rows[0].id);
    await q(`update pendencias set chave_origem = 'teste:2-manual' where id = $1`, [manual]);
    expect((await q(`select encerrar_pendencia('financeiro.recebiveis', 'teste:2-manual') n`)).rows[0].n).toBe(0);   // tarefa manual não é encerrada
    expect((await q(`select encerrar_pendencia('financeiro.recebiveis', 'teste:2') n`)).rows[0].n).toBe(1);
    expect((await abertas("teste:2"))[0].status).toBe("concluida");
  });

  it("publicação não é ação da pessoa que disparou: não gera atividade nem passa pelas regras de 'quem pode'", async () => {
    // um operador comum dispara (via rotina do módulo) uma atualização de título, que ele não poderia fazer à mão
    await q(`create function teste_rotina_modulo() returns uuid language sql security definer as $$ select publicar_pendencia('{"modulo":"financeiro.recebiveis","chave_origem":"teste:3","titulo":"Título novo"}') $$`);
    await q(`grant execute on function teste_rotina_modulo() to authenticated`);
    await publicar({ modulo: "financeiro.recebiveis", chave_origem: "teste:3", titulo: "Título antigo" });
    const id = await como(db, finOperador, async () => (await q(`select teste_rotina_modulo() id`)).rows[0].id);
    expect((await abertas("teste:3"))[0].titulo).toBe("Título novo");
    expect((await q(`select usuario_id from auditoria where tabela = 'pendencias' and registro_id = $1 order by id desc limit 1`, [id])).rows[0].usuario_id).toBeNull();
    // e a sessão da pessoa volta ao normal depois da publicação
    const eu = await como(db, finOperador, async () => (await q(`select teste_rotina_modulo(), auth.uid() eu`)).rows[0].eu);
    expect(eu).toBe(finOperador);
  });

  it("encerrar_pendencias_exceto: fecha o que saiu da lista", async () => {
    await publicar({ modulo: "financeiro.recebiveis", chave_origem: "lista:a", titulo: "A" });
    await publicar({ modulo: "financeiro.recebiveis", chave_origem: "lista:b", titulo: "B" });
    expect((await q(`select encerrar_pendencias_exceto('financeiro.recebiveis', 'lista:', array['lista:a']) n`)).rows[0].n).toBe(1);
    expect((await abertas("lista:b"))[0].status).toBe("cancelada");
    expect((await abertas("lista:a"))[0].status).toBe("aberta");
  });
});

describe("Fiscal: obrigações e divergências", () => {
  let competencias = 0;   // uma competência por obrigação (a obrigação é única por tipo, estabelecimento e competência)
  const novaObrigacao = async (vencimentoDias: number | null, extra: Record<string, unknown> = {}) =>
    (await q(`insert into fis_obrigacoes (tipo_id, empresa_id, estabelecimento_id, competencia, vencimento, responsavel_id, ficticio)
              values ($1, $2, $3, (date_trunc('month', ${hoje}) - make_interval(months => $7::int))::date,
                      case when $4::int is null then null else ${hoje} + $4::int end, $5, $6) returning id`,
      [tipoComRegra, empresa, estab, vencimentoDias, extra.responsavel ?? null, extra.ficticio ?? false, competencias++])).rows[0].id as string;

  it("obrigação que vence em até 10 dias vira 'Entregar …' com o vencimento como prazo; transmitida, conclui", async () => {
    const id = await novaObrigacao(5, { responsavel: fiscalOperador });
    let p = await abertas(`obrigacao:${id}`);
    expect(p).toMatchObject([{ status: "aberta", responsavel_id: fiscalOperador, precisa_distribuir: false }]);
    expect(p[0].titulo).toMatch(/^Entregar DCTF teste \d{2}\/\d{4} — Matriz Cuiabá$/);
    expect(p[0].prazo).toBe((await q(`select (${hoje} + 5)::text d`)).rows[0].d);
    await q(`update fis_obrigacoes set status = 'transmitida', data_transmissao = ${hoje}, numero_recibo = '123' where id = $1`, [id]);
    p = await abertas(`obrigacao:${id}`);
    expect(p[0].status).toBe("concluida");
  });

  it("fora da janela não aparece; entra pela rotina diária quando chega a hora", async () => {
    const id = await novaObrigacao(30);
    expect(await abertas(`obrigacao:${id}`)).toEqual([]);
    await q(`alter table fis_obrigacoes disable trigger trg_fis_obrigacoes_central`);
    await q(`update fis_obrigacoes set vencimento = ${hoje} + 3 where id = $1`, [id]);   // simula a passagem do tempo
    await q(`alter table fis_obrigacoes enable trigger trg_fis_obrigacoes_central`);
    expect(await abertas(`obrigacao:${id}`)).toEqual([]);
    await q(`select fis_pendencias_rotina()`);
    expect(await abertas(`obrigacao:${id}`)).toMatchObject([{ status: "aberta", precisa_distribuir: true }]);   // sem responsável
  });

  it("sem vencimento: 'Confirmar vencimento' com prioridade alta e sem prazo, que a Central mostra como 'Avaliar'", async () => {
    const id = await novaObrigacao(null, { responsavel: fiscalOperador });
    const p = await abertas(`obrigacao-vencimento:${id}`);
    expect(p).toMatchObject([{ status: "aberta", criticidade: "alta", prazo: null }]);
    const d = (await como(db, fiscalGestor, () => q(`select destaque, motivos from central_pendencias('gestao', $1)`, [JSON.stringify({ id: p[0].id })]))).rows[0];
    expect(d.destaque).toBe("avaliar");
    // registrado o vencimento, troca para "Entregar…"
    await q(`update fis_obrigacoes set vencimento = ${hoje} + 2 where id = $1`, [id]);
    expect((await abertas(`obrigacao-vencimento:${id}`))[0].status).toBe("cancelada");
    expect((await abertas(`obrigacao:${id}`))[0].status).toBe("aberta");
  });

  it("dados fictícios não geram pendência", async () => {
    const id = await novaObrigacao(1, { ficticio: true });
    expect(await abertas(`obrigacao:${id}`)).toEqual([]);
  });

  it("divergência aberta sem tarefa vira 'Analisar divergência', precisa distribuir; com tarefa, sai; resolvida, conclui", async () => {
    const div = (await q(`insert into fis_divergencias (empresa_id, motivo, valor_diferenca) values ($1, 'Crédito de PIS diferente da EFD', 1234.5) returning id, numero`, [empresa])).rows[0];
    let p = await abertas(`divergencia:${div.id}`);
    expect(p).toMatchObject([{ status: "aberta", precisa_distribuir: true }]);
    expect(p[0].titulo).toBe(`Analisar divergência nº ${div.numero}: Crédito de PIS diferente da EFD`);

    const tarefa = (await q(`insert into fis_tarefas (tipo, titulo, alvo, alvo_id) values ('tarefa', 'Analisar a divergência', 'divergencia', $1) returning id`, [div.id])).rows[0].id;
    p = await abertas(`divergencia:${div.id}`);
    expect(p[0].status).toBe("cancelada");
    await q(`update fis_tarefas set status = 'cancelada' where id = $1`, [tarefa]);
    p = await abertas(`divergencia:${div.id}`);
    expect(p.map((x) => x.status)).toEqual(["cancelada", "aberta"]);   // voltou a pedir análise, sem duplicar a aberta

    await q(`update fis_divergencias set status = 'resolvida', resolucao = 'EFD retificada' where id = $1`, [div.id]);
    expect((await abertas(`divergencia:${div.id}`)).map((x) => x.status)).toEqual(["cancelada", "concluida"]);
  });

  it("quem vê: o Fiscal, não o Financeiro", async () => {
    const id = await novaObrigacao(1, { responsavel: fiscalOperador });
    const pid = (await abertas(`obrigacao:${id}`))[0].id;
    const ve = async (quem: string) => (await como(db, quem, () => q(`select 1 from pendencias where id = $1`, [pid]))).rows.length;
    expect(await ve(fiscalOperador)).toBe(1);
    expect(await ve(finGestor)).toBe(0);
  });
});

describe("Cobrança na Central", () => {
  it("as pendências de cobrança do Recebíveis aparecem no módulo Cobrança; as de boleto, não", async () => {
    await q(`insert into pendencias (modulo, titulo, prazo) values ('financeiro.recebiveis', 'Cobrar D+5: Cliente Alfa — venc. 15/10', ${hoje}),
                                                                ('financeiro.recebiveis', 'Anexar boleto: NF 1 — Cliente Beta', ${hoje})`);
    const linhas = (await como(db, finOperador, () => q(`select titulo, modulo, modulo_nome from central_pendencias('minhas', '{}') where titulo like any (array['Cobrar D+5%', 'Anexar boleto%'])`))).rows;
    expect(linhas).toEqual(expect.arrayContaining([
      { titulo: "Cobrar D+5: Cliente Alfa — venc. 15/10", modulo: "financeiro.cobranca", modulo_nome: "Cobrança" },
      { titulo: "Anexar boleto: NF 1 — Cliente Beta", modulo: "financeiro.recebiveis", modulo_nome: "Recebíveis" },
    ]));
    const filtradas = (await como(db, finOperador, () => q(`select titulo from central_pendencias('minhas', '{"modulo":"financeiro.cobranca"}')`))).rows.map((r) => r.titulo);
    expect(filtradas).toContain("Cobrar D+5: Cliente Alfa — venc. 15/10");
    expect(filtradas).not.toContain("Anexar boleto: NF 1 — Cliente Beta");
    // o dado continua no módulo dono (as telas da Cobrança e a sincronização dependem disso)
    expect((await q(`select modulo from pendencias where titulo like 'Cobrar D+5: Cliente Alfa%'`)).rows[0].modulo).toBe("financeiro.recebiveis");
  });
});
