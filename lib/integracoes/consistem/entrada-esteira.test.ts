import { describe, expect, it } from "vitest";
import {
  agruparBoletosPendentes,
  descricaoPendenciaBoleto,
  criticidadeBoleto,
  decidirEntrada,
  indexarNotas,
  dentroDaJanelaDoBoleto,
  LIMITE_ENTRADA_LOTE,
  ligarTituloNota,
  normalizarNotaSaida,
  normalizarTituloApi,
  planejarPendenciasBoleto,
  planejarSincronizacao,
  prazoBoleto,
  PREFIXO_BOLETO,
  tituloPendenciaBoleto,
  type NotaEsteira,
  type NotaSaida,
  type TituloEsteira,
  type TituloApi,
  type TituloBanco,
} from "../../../supabase/functions/_shared/consistem-receber";

const CHAVE = "3".repeat(44);

const nota = (extra: Partial<NotaSaida> = {}): NotaSaida => ({
  nota: "1371", serie: "1", chave: "", codCliente: "156", valorCentavos: 300_000, emissao: "2026-10-05", pedidos: ["187"], ...extra,
});
const titulo = (documento: string, extra: Partial<TituloApi> = {}): TituloApi => ({
  documento, parcela: "1", codCliente: "156", emissao: "2026-10-05", vencimento: "2026-11-05", valorCentavos: 100_000,
  codPortador: "91", nota: "1371", chaveNfe: "", tipoCobranca: "1", ...extra,
});

describe("normalizarTituloApi com dados de nota", () => {
  const base = { codTitulo: "1371A", codCliente: 156, codPortador: 91, dataEmissao: "2026-10-05", dataVenc: "2026-11-05", valorTitulo: "1000.00", notaFiscal: "001371", chaveNfeNotaFiscal: CHAVE, tipoCobranca: 1 };
  it("lê nota (sem zeros), chave e tipo de cobrança", () => {
    const r = normalizarTituloApi(base);
    expect(r.ok && r.titulo).toMatchObject({ nota: "1371", chaveNfe: CHAVE, tipoCobranca: "1" });
  });
  it("título sem NF (série Z) fica com nota e chave vazias", () => {
    const r = normalizarTituloApi({ ...base, notaFiscal: "", chaveNfeNotaFiscal: null });
    expect(r.ok && r.titulo).toMatchObject({ nota: "", chaveNfe: "" });
  });
});

describe("normalizarNotaSaida", () => {
  it("junta o pedido do cabeçalho e os dos itens (faturamento agrupado), sem repetir", () => {
    const n = normalizarNotaSaida({
      codNumNota: "000150", serie: "1", chaveAcesso: CHAVE, codCliente: 7, valorTotal: "2.500,00", dataEmissao: "2026-10-05T00:00:00", codPedido: "10",
      itensNotaFiscalSaida: [
        { itemPedidoAgrupado: [{ codPedido: "10" }, { codPedido: "11" }] },
        { itemPedidoAgrupado: [{ codPedido: "12" }, { codPedido: " 11 " }] },
        { codProduto: "x" },
      ],
    });
    expect(n).toEqual({ nota: "150", serie: "1", chave: CHAVE, codCliente: "7", valorCentavos: 250_000, emissao: "2026-10-05", pedidos: ["10", "11", "12"] });
  });
  it("NF sem pedido nenhum devolve lista vazia; sem número da nota é descartada", () => {
    expect(normalizarNotaSaida({ codNumNota: "9", codCliente: 1 })?.pedidos).toEqual([]);
    expect(normalizarNotaSaida({ codNumNota: "", codCliente: 1 })).toBeNull();
    expect(normalizarNotaSaida({ codNumNota: "000", codCliente: 1 })).toBeNull();
  });
});

describe("ligarTituloNota", () => {
  const notas = [nota({ chave: CHAVE }), nota({ nota: "200", codCliente: "9", pedidos: [] })];
  const indice = indexarNotas(notas);

  it("liga pela chave da NF-e mesmo que o número difira", () => {
    expect(ligarTituloNota({ nota: "", chaveNfe: CHAVE, codCliente: "999" }, indice)).toEqual({ ok: true, indice: 0, via: "chave" });
  });
  it("sem chave, liga por número da nota + cliente", () => {
    expect(ligarTituloNota({ nota: "200", chaveNfe: "", codCliente: "9" }, indice)).toEqual({ ok: true, indice: 1, via: "nota_cliente" });
  });
  it("mesmo número de nota mas outro cliente não liga", () => {
    expect(ligarTituloNota({ nota: "200", chaveNfe: "", codCliente: "1" }, indice)).toEqual({ ok: false, motivo: "nao_encontrada" });
  });
  it("título sem nota não liga", () => {
    expect(ligarTituloNota({ nota: "", chaveNfe: "", codCliente: "9" }, indice)).toEqual({ ok: false, motivo: "sem_nota" });
  });
  it("duas NFs com o mesmo número e cliente (séries diferentes) é ambíguo: não liga", () => {
    const amb = indexarNotas([nota({ nota: "5", serie: "1" }), nota({ nota: "5", serie: "2" })]);
    expect(ligarTituloNota({ nota: "5", chaveNfe: "", codCliente: "156" }, amb)).toEqual({ ok: false, motivo: "ambigua" });
  });
  it("chave desconhecida cai para nota + cliente", () => {
    expect(ligarTituloNota({ nota: "200", chaveNfe: "9".repeat(44), codCliente: "9" }, indice)).toMatchObject({ ok: true, via: "nota_cliente" });
  });
});

const te = (id: string, extra: Partial<TituloEsteira> = {}): TituloEsteira => ({
  id, documento: `DOC-${id}`, parcela: "1", vencimento: "2026-11-05", valorCentavos: 100_000, notaSaidaId: null,
  contraparteId: "c1", codCliente: "156", nomeCliente: "ACME LTDA", ...extra,
});
const ne = (id: string, nota = "1371", pedidos: string[] = ["187"]): NotaEsteira => ({ id, nota, pedidos });

describe("janela de 30 dias para anexar boleto", () => {
  const HOJE = "2026-10-06";
  it("vence em 30 dias ou menos (inclusive vencido) entra; além de 30 dias não", () => {
    expect(dentroDaJanelaDoBoleto("2026-11-05", HOJE)).toBe(true); // 30 dias
    expect(dentroDaJanelaDoBoleto("2026-11-06", HOJE)).toBe(false); // 31 dias
    expect(dentroDaJanelaDoBoleto("2026-10-01", HOJE)).toBe(true); // vencido
  });

  it("NF com parcelas em datas diferentes: só as da janela aparecem na pendência; NF toda fora vira `fora`", () => {
    const plano = planejarPendenciasBoleto(
      [
        te("1", { notaSaidaId: "n1", vencimento: "2026-10-30" }),
        te("2", { notaSaidaId: "n1", vencimento: "2026-12-30" }),
        te("3", { notaSaidaId: "n2", vencimento: "2027-01-15" }),
        te("4", { vencimento: "2026-12-01" }),
      ],
      [ne("n1"), ne("n2", "1400")],
      HOJE,
      new Set(["n2", "4"]), // já têm pendência aberta, mas estão fora da janela
    );
    expect(plano.novas.map((g) => g.referenciaId)).toEqual(["n1"]);
    expect(plano.novas[0].titulos.map((t) => t.id)).toEqual(["1"]); // a parcela de 30/12 não entra
    expect(plano.fora.sort()).toEqual(["4", "n2"]);
  });

  it("quem já tem pendência aberta dentro da janela não abre outra, mas o texto é atualizado com o que falta", () => {
    const plano = planejarPendenciasBoleto([te("1", { vencimento: "2026-10-20" })], [], HOJE, new Set(["1"]));
    expect(plano.novas).toEqual([]);
    expect(plano.fora).toEqual([]);
    expect(plano.atualizar.map((g) => g.referenciaId)).toEqual(["1"]);
  });

  it("NF que tinha 4 parcelas e ficou com 1 aguardando: o título novo deixa de dizer 4 parcelas", () => {
    const antes = planejarPendenciasBoleto(
      [1, 2, 3, 4].map((i) => te(String(i), { notaSaidaId: "n1", vencimento: "2026-10-2" + i })), [ne("n1")], HOJE, new Set(),
    ).novas[0];
    const depois = planejarPendenciasBoleto([te("4", { notaSaidaId: "n1", vencimento: "2026-10-24" })], [ne("n1")], HOJE, new Set(["n1"])).atualizar[0];
    expect(tituloPendenciaBoleto(antes)).toContain("(4 parcelas)");
    expect(tituloPendenciaBoleto(depois)).not.toContain("parcelas");
  });
});

describe("agruparBoletosPendentes", () => {
  it("parcelas da mesma NF viram um grupo; título sem NF é um grupo por título", () => {
    const grupos = agruparBoletosPendentes(
      [
        te("1", { notaSaidaId: "n1", vencimento: "2026-11-05" }),
        te("2", { notaSaidaId: "n1", vencimento: "2026-12-05" }),
        te("3", { vencimento: "2026-10-20" }),
        te("4", { vencimento: "2026-10-25" }),
      ],
      [ne("n1")],
    );
    expect(grupos).toHaveLength(3);
    expect(grupos[0]).toMatchObject({ referenciaTabela: "rec_titulos", referenciaId: "3" }); // mais urgente primeiro
    const daNota = grupos.find((g) => g.referenciaTabela === "rec_notas_saida")!;
    expect(daNota.referenciaId).toBe("n1");
    expect(daNota.titulos).toHaveLength(2);
    expect(daNota.valorCentavos).toBe(200_000);
    expect(daNota.vencimentoMaisProximo).toBe("2026-11-05");
  });

  it("nota que não veio na lista (id desconhecido) cai para título avulso", () => {
    const g = agruparBoletosPendentes([te("1", { notaSaidaId: "n-sumiu" })], []);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ referenciaTabela: "rec_titulos", nota: null });
  });

  it("ordem estável quando o vencimento é igual", () => {
    const g = agruparBoletosPendentes([te("b", { vencimento: "2026-10-20" }), te("a", { vencimento: "2026-10-20" })], []);
    expect(g.map((x) => x.referenciaId)).toEqual(["a", "b"]);
  });
});

describe("tituloPendenciaBoleto e descricaoPendenciaBoleto", () => {
  const grupo = (titulos: TituloEsteira[], notas: NotaEsteira[]) => agruparBoletosPendentes(titulos, notas)[0];

  it("uma parcela, com NF", () => {
    expect(tituloPendenciaBoleto(grupo([te("1", { notaSaidaId: "n1" })], [ne("n1")]))).toBe("Anexar boleto: NF 1371 — ACME LTDA");
  });
  it("várias parcelas, com NF", () => {
    const g = grupo([te("1", { notaSaidaId: "n1" }), te("2", { notaSaidaId: "n1" }), te("3", { notaSaidaId: "n1" })], [ne("n1")]);
    expect(tituloPendenciaBoleto(g)).toBe("Anexar boleto(s): NF 1371 — ACME LTDA (3 parcelas)");
  });
  it("sem NF usa o documento; sem nome de cliente usa o código", () => {
    expect(tituloPendenciaBoleto(grupo([te("1", { documento: "Z00031A", nomeCliente: "" })], []))).toBe("Anexar boleto: Z00031A — cliente 156");
    expect(tituloPendenciaBoleto(grupo([te("1", { documento: "A-2", parcela: "2" })], []))).toBe("Anexar boleto: A-2/2 — ACME LTDA");
  });
  it("sempre começa pelo prefixo usado na consulta de pendências abertas", () => {
    expect(tituloPendenciaBoleto(grupo([te("1"), te("2", { notaSaidaId: null })], [])).startsWith(PREFIXO_BOLETO)).toBe(true);
  });
  it("a descrição lista documento, vencimento e valor, e os pedidos da NF", () => {
    const g = grupo(
      [te("1", { notaSaidaId: "n1", documento: "1371A", vencimento: "2026-11-05", valorCentavos: 123_456 }), te("2", { notaSaidaId: "n1", documento: "1371B", parcela: "2", vencimento: "2026-12-05", valorCentavos: 100_000 })],
      [ne("n1", "1371", ["187", "188"])],
    );
    const d = descricaoPendenciaBoleto(g);
    expect(d).toContain("• 1371A — vence 05/11/2026 — R$ 1.234,56");
    expect(d).toContain("• 1371B/2 — vence 05/12/2026 — R$ 1.000,00");
    expect(d).toContain("Pedidos: 187, 188.");
  });
  it("NF com um pedido no singular; sem pedido, sem a linha de pedidos; lista longa é cortada", () => {
    expect(descricaoPendenciaBoleto(grupo([te("1", { notaSaidaId: "n1" })], [ne("n1", "1", ["9"])]))).toContain("Pedido: 9.");
    expect(descricaoPendenciaBoleto(grupo([te("1", { notaSaidaId: "n1" })], [ne("n1", "1", [])]))).not.toContain("Pedido");
    const muitos = Array.from({ length: 15 }, (_, i) => te(String(i), { notaSaidaId: "n1", documento: `D${i}` }));
    expect(descricaoPendenciaBoleto(grupo(muitos, [ne("n1")]))).toContain("… e mais 3");
  });
});
describe("decidirEntrada", () => {
  it("só abre depois da data de início e sem lote grande", () => {
    expect(decidirEntrada(3, "2026-10-06", "2026-10-06")).toEqual({ abrir: true });
    expect(decidirEntrada(3, "2026-10-05", "2026-10-06")).toEqual({ abrir: false, motivo: "antes_do_inicio" });
    expect(decidirEntrada(3, "2026-10-06", null)).toEqual({ abrir: false, motivo: "sem_inicio" });
    expect(decidirEntrada(0, "2026-10-06", "2026-10-06")).toEqual({ abrir: false, motivo: "sem_novos" });
    expect(decidirEntrada(LIMITE_ENTRADA_LOTE, "2026-10-06", "2026-10-06").abrir).toBe(true);
    expect(decidirEntrada(LIMITE_ENTRADA_LOTE + 1, "2026-10-06", "2026-10-06")).toEqual({ abrir: false, motivo: "lote_grande" });
  });
});

describe("prazo e criticidade do boleto", () => {
  it("prazo = D-8 do vencimento, ou hoje se já passou", () => {
    expect(prazoBoleto("2026-11-05", "2026-10-06")).toBe("2026-10-28");
    expect(prazoBoleto("2026-10-10", "2026-10-06")).toBe("2026-10-06");
    expect(prazoBoleto("2026-09-01", "2026-10-06")).toBe("2026-10-06");
  });
  it("critica até 3 dias, alta até 10, normal depois", () => {
    expect(criticidadeBoleto("2026-10-09", "2026-10-06")).toBe("critica");
    expect(criticidadeBoleto("2026-10-01", "2026-10-06")).toBe("critica"); // vencido
    expect(criticidadeBoleto("2026-10-10", "2026-10-06")).toBe("alta");
    expect(criticidadeBoleto("2026-10-16", "2026-10-06")).toBe("alta");
    expect(criticidadeBoleto("2026-10-17", "2026-10-06")).toBe("normal");
  });
});

describe("planejarSincronizacao: enriquecimento com dados de nota", () => {
  const banco = (extra: Partial<TituloBanco> = {}): TituloBanco => ({
    id: "1", documento: "1371A", parcela: "1", emissao: "2026-10-05", vencimento: "2026-11-05", valorCentavos: 100_000, estagio: "importado", origem: "importacao", ...extra,
  });
  it("completa nota e chave que faltam, sem contar como alteração", () => {
    const p = planejarSincronizacao([titulo("1371A", { chaveNfe: CHAVE })], [banco()]);
    expect(p.alterados).toEqual([]);
    expect(p.inalterados).toBe(1);
    expect(p.enriquecidos).toEqual([{ id: "1", campos: { nota_fiscal: "1371", chave_nfe: CHAVE, cod_portador: "91", tipo_cobranca: "1" } }]);
  });
  it("não sobrescreve nota e chave já gravadas, mas acompanha mudança de portador", () => {
    const p = planejarSincronizacao(
      [titulo("1371A", { chaveNfe: CHAVE, codPortador: "998" })],
      [banco({ notaFiscal: "1371", chaveNfe: CHAVE, codPortador: "91", tipoCobranca: "1" })],
    );
    expect(p.enriquecidos).toEqual([{ id: "1", campos: { cod_portador: "998" } }]);
  });
  it("nada a completar quando está tudo igual", () => {
    const p = planejarSincronizacao([titulo("1371A")], [banco({ notaFiscal: "1371", chaveNfe: "", codPortador: "91", tipoCobranca: "1" })]);
    expect(p.enriquecidos).toEqual([]);
  });
  it("título encerrado no banco não é enriquecido", () => {
    const p = planejarSincronizacao([titulo("1371A")], [banco({ estagio: "pago" })]);
    expect(p.enriquecidos).toEqual([]);
  });
});
