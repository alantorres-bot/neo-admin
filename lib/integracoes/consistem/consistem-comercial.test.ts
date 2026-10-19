import { describe, expect, it } from "vitest";
import {
  candidatosIdNota,
  chaveNfe,
  classificarSonda,
  contarPor,
  cruzarComTitulosAbertos,
  formatoCodigo,
  notasDevolvidas,
  numeroNota,
  resumirAdiantamentos,
  resumirBloqueios,
  resumirExtratoComissoes,
  resumirCanceladas,
  resumirDevolucoes,
  resumirNotas,
  resumirPedidos,
  resumirTitulosDaNota,
  resumirTitulosPagos,
  tamanhoBase64Kb,
} from "../../../supabase/functions/_shared/consistem-comercial";
import * as receber from "../../../supabase/functions/_shared/consistem-receber";
import { buscarResumido, buscarTodasPaginas, type Buscar, type ConfigConsistem } from "../../../supabase/functions/_shared/consistem-receber";

const TOKEN = "eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJhcGkiLCJhdWQiOiJhcGkifQ.c2lnbmF0dXJlLWRlLXRlc3RlLTEyMzQ1";
const cfg: ConfigConsistem = { baseUrl: "https://erp.exemplo.com/api/", token: TOKEN, empresa: "1" };
const semEspera = { esperar: async () => {} };
const resposta = (status: number, corpo: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof corpo === "string" ? corpo : JSON.stringify(corpo)),
});

describe("paridade com consistem-receber (cópia de chaveNfe/numeroNota)", () => {
  it.each(["000123", "12.345", "", null, " 9 ", "5".repeat(44), "NF 0042-1", 1072])("%s", (v) => {
    expect(numeroNota(v)).toBe(receber.numeroNota(v));
    expect(chaveNfe(v)).toBe(receber.chaveNfe(v));
  });
});

describe("buscarResumido (paginação por cabeçalho page/size)", () => {
  it("pede page 0,1,2… até vir uma página incompleta", async () => {
    const paginas: string[] = [];
    const buscar: Buscar = async (_u, init) => {
      paginas.push(`${init.headers.page}/${init.headers.size}`);
      const n = Number(init.headers.page) < 2 ? 2 : 1;
      return resposta(200, Array.from({ length: n }, (_, i) => ({ i })));
    };
    const r = await buscarResumido(buscar, cfg, "comercial/v10/pedidoVendaResumido", { dataDigitacaoInicio: "2026-07-01" }, { ...semEspera, tamanho: 2 });
    expect(r).toHaveLength(5);
    expect(paginas).toEqual(["0/2", "1/2", "2/2"]);
  });
  it("manda o token e a empresa, e os filtros na query", async () => {
    let url = "";
    let headers: Record<string, string> = {};
    await buscarResumido(async (u, init) => ((url = u), (headers = init.headers), resposta(200, [])), cfg, "x", { situacao: 2 }, semEspera);
    expect(url).toBe("https://erp.exemplo.com/api/x?situacao=2");
    expect(headers.Authorization).toBe(TOKEN);
    expect(headers.empresa).toBe("1");
  });
});

describe("buscarTodasPaginas com campoLista", () => {
  it("lê a lista com outro nome (notasDevolucao) e segue o continuationToken", async () => {
    let n = 0;
    const buscar: Buscar = async () =>
      ++n === 1 ? resposta(200, { continuationToken: "t2", notasDevolucao: [{ a: 1 }] }) : resposta(200, { continuationToken: null, notasDevolucao: [{ a: 2 }] });
    const r = await buscarTodasPaginas(buscar, cfg, "comercial/v10/devolucaoNota", {}, { ...semEspera, campoLista: "notasDevolucao" });
    expect(r).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("resumirPedidos", () => {
  const hoje = "2026-10-19";
  const pedidos = [
    { codPedido: "1", situacao: "2", vlrSaldo: 100, dataPrevFat: "2026-10-01", numeroUltimaNF: "", codRepresentante: 5, nomeRepresentante: "LUCAS", nomeCliente: "X" },
    { codPedido: "2", situacao: "6", vlrSaldo: 0, dataPrevFat: "2026-09-01", numeroUltimaNF: "1072", codRepresentante: 0, vlrTotalCancelado: 10 },
    { codPedido: "3", situacao: "2", vlrSaldo: 50, dataPrevFat: "2026-11-01", vlrTotalBloqueado: 50 },
    { codPedido: "4", situacao: "8", vlrSaldo: 20, dataPrevFat: null },
  ];
  it("conta situação, saldo, previsão vencida e campos preenchidos", () => {
    const r = resumirPedidos(pedidos, hoje);
    expect(r.total).toBe(4);
    expect(r.porSituacao[0]).toEqual({ valor: "2", total: 2, nome: "Liberado" });
    expect(r.comSaldo).toBe(3);
    expect(r.previsaoVencidaComSaldo).toBe(1); // o 2 venceu mas não tem saldo; o 4 não tem previsão
    expect(r.semPrevisao).toBe(1);
    expect(r.comNumeroUltimaNF).toBe(1);
    expect(r.comRepresentante).toBe(1); // representante 0 não conta
    expect(r.comNomeRepresentante).toBe(1);
    expect(r.comValorBloqueado).toBe(1);
    expect(r.comValorCancelado).toBe(1);
  });
});

describe("resumirBloqueios", () => {
  it("aceita booleano, 0/1 e S/N", () => {
    const r = resumirBloqueios([
      { libFin: true, flgBloqCredito: false, vencimentoEsp: ["2026-11-01"], percComissRep: 3 },
      { libFin: "S", flgBloqCredito: "1", flgBloqComercial: 1 },
      { libFin: "N", flgBloqCredito: "N" },
    ]);
    expect(r).toMatchObject({ amostra: 3, liberadoFinanceiro: 2, bloqueadoCredito: 1, bloqueadoComercial: 1, comVencimentoEspecial: 1, comPercComissao: 1 });
  });
});

describe("resumirNotas e resumirCanceladas", () => {
  const chave = "5".repeat(44);
  it("separa pedido no cabeçalho de pedido só nos itens", () => {
    const r = resumirNotas([
      { codNumNota: 1, codTipoDeNota: 12, codPedido: "187", chaveAcesso: chave, codRepresentante: 5, valorComissaoRepresentante: 10 },
      { codNumNota: 2, codTipoDeNota: 12, codPedido: "", itensNotaFiscalSaida: [{ codItem: 1, itemPedidoAgrupado: [{ codPedido: "190" }] }] },
      { codNumNota: 3, codTipoDeNota: 5, itensNotaFiscalSaida: [{ codItem: 1, itemPedidoAgrupado: [{ codPedido: "" }] }], valorRetIR: 1.5, qtdVolumes: 3 },
    ]);
    expect(r.total).toBe(3);
    expect(r.porTipo[0]).toEqual({ valor: "12", total: 2 });
    expect(r.comChave).toBe(1);
    expect(r.comPedidoNoCabecalho).toBe(1);
    expect(r.comPedidoSoNosItens).toBe(1);
    expect(r.comRepresentante).toBe(1);
    expect(r.comComissaoRepresentante).toBe(1);
    expect(r.comRetencao).toBe(1);
    expect(r.comVolumes).toBe(1);
  });
  it("canceladas: motivo, protocolo e data/hora", () => {
    expect(resumirCanceladas([{ obsCancNF2: "erro de digitação", protCancelaNfe: "1" }, { dataGeracao1: "2026-10-01" }, {}])).toEqual({
      total: 3, comMotivo: 1, comProtocoloCancelamento: 1, comDataHoraCancelamento: 1,
    });
  });
});

describe("cruzarComTitulosAbertos", () => {
  it("casa nota (sem zeros à esquerda) e cliente", () => {
    const r = cruzarComTitulosAbertos(
      [{ nota: "1072", cliente: "156" }, { nota: "1073", cliente: "156" }, { nota: "1074", cliente: "9" }],
      [
        { codTitulo: "1072A", notaFiscal: "0001072", codCliente: 156 },
        { codTitulo: "1072B", notaFiscal: "1072", codCliente: "156" },
        { codTitulo: "1074U", notaFiscal: "1074", codCliente: 8 }, // outro cliente
        { codTitulo: "Z1", notaFiscal: "", codCliente: 9 },
      ],
    );
    expect(r).toEqual({ notas: 3, comTituloAberto: 1, titulosAbertos: 2 });
  });
});

describe("candidatosIdNota", () => {
  it("lista os formatos possíveis, chave primeiro", () => {
    const c = candidatosIdNota({ codNumNota: 1072, serie: 1, dataEmissao: "2026-10-01T00:00:00", chaveAcesso: "5".repeat(44) });
    expect(c.map((x) => x.formato)).toEqual(["chaveAcesso", "codNumNota", "dataEmissao,codNumNota", "serie,codNumNota", "dataEmissao,serie,codNumNota"]);
    expect(c[2].id).toBe("2026-10-01,1072");
  });
  it("sem chave nem série, só o número", () => {
    expect(candidatosIdNota({ codNumNota: 9 }).map((x) => x.id)).toEqual(["9"]);
  });
});

describe("resumirTitulosDaNota", () => {
  it("conta formatos, parcelas por NF e comissão, sem expor o código", () => {
    const r = resumirTitulosDaNota([
      [
        { formato: "chaveAcesso", status: "erro", erro: "Consistem HTTP 400: nota não encontrada" },
        { formato: "codNumNota", status: "ok", titulos: [
          { codTitulo: "1072A", dataVencimento: "2026-11-01", valorComissaoRepresentanteFat: 5 },
          { codTitulo: "1072B", dataVencimento: "2026-12-01", dataPagamento: "2026-10-10", valorComissaoRepresentanteLiq: 5 },
        ] },
      ],
      [{ formato: "codNumNota", status: "ok", titulos: [{ codTitulo: "1080U", dataVencimento: "2026-11-05", percComissaoRepresentante: 2 }] }],
      [{ formato: "codNumNota", status: "vazio" }],
    ]);
    expect(r.notasTestadas).toBe(3);
    expect(r.notasComTitulos).toBe(2);
    expect(r.formatos).toEqual([
      { formato: "chaveAcesso", ok: 0, vazio: 0, erro: 1 },
      { formato: "codNumNota", ok: 2, vazio: 1, erro: 0 },
    ]);
    expect(r.parcelasPorNota).toEqual([{ parcelas: 1, notas: 1 }, { parcelas: 2, notas: 1 }]);
    expect(r.titulos).toMatchObject({ total: 3, comVencimento: 3, comPagamento: 1, comComissaoFat: 1, comComissaoLiq: 1, comPercComissao: 1 });
    expect(r.titulos.formatosCodTitulo).toEqual([{ valor: "9999A", total: 3 }]);
    expect(r.erros).toEqual(["Consistem HTTP 400: nota não encontrada"]);
  });
});

describe("devoluções", () => {
  const devs = [
    { numeroDocumento: 1, CNPJCPFCliente: "12.345.678/0001-90", motivoDevolucao: 3, notasDevolvidas: [{ codNotaDev: 1072, dataNotaDev: "2026-10-01" }], itensDevolucao: [{}, {}] },
    { numeroDocumento: 2, CNPJCPFCliente: "11122233344", chaveNFeNFCe: "4".repeat(44), notasDevolvidas: [] },
  ];
  it("resume motivo, NF original e itens", () => {
    expect(resumirDevolucoes(devs)).toMatchObject({ total: 2, comNotaDevolvida: 1, comChave: 1, itens: 2 });
  });
  it("lista as NFs originais com o documento só em dígitos", () => {
    expect(notasDevolvidas(devs)).toEqual([{ nota: "1072", documento: "12345678000190" }]);
  });
});

describe("classificarSonda, formatoCodigo, tamanhoBase64Kb e contarPor", () => {
  it("401/403 vira 'sem acesso' com a dica do CSMEN050", () => {
    expect(classificarSonda("mdfe", { erro: { mensagem: "Acesso negado (HTTP 403).", status: 403 } })).toEqual({
      servico: "mdfe", status: "sem_acesso", detalhe: "serviço não liberado no token (CSMEN050, aba Serviço)",
    });
    expect(classificarSonda("mdfe", { registros: 0 }).status).toBe("vazio");
    expect(classificarSonda("mdfe", { registros: 4 })).toEqual({ servico: "mdfe", status: "ok", registros: 4 });
    expect(classificarSonda("x", { erro: { mensagem: "Consistem HTTP 500: falhou", status: 500 } }).status).toBe("erro");
  });
  it("formato do código sem o valor", () => {
    expect(formatoCodigo("1072-A")).toBe("9999-A");
    expect(formatoCodigo(null)).toBe("(vazio)");
  });
  it("tamanho do base64 em KB", () => {
    expect(tamanhoBase64Kb("A".repeat(4096))).toBe(3);
    expect(tamanhoBase64Kb("")).toBeNull();
  });
  it("contarPor ordena do maior para o menor", () => {
    expect(contarPor([{ s: 1 }, { s: 2 }, { s: 2 }, {}], "s")).toEqual([
      { valor: "2", total: 2 }, { valor: "(vazio)", total: 1 }, { valor: "1", total: 1 },
    ]);
  });
});

describe("comissão: títulos pagos, extrato e adiantamentos", () => {
  it("resumirTitulosPagos: prefixos, pago x título e pagamento antecipado", () => {
    const r = resumirTitulosPagos([
      { codTitulo: "AZ00019E", vlrTitulo: 700, vlrPago: 700, dataVencimento: "2026-07-06", dataPagamento: "2026-07-01" },
      { codTitulo: "A1001291B", vlrTitulo: 823.62, vlrPago: 830, notaFiscal: "1291", dataVencimento: "2026-07-07", dataPagamento: "2026-07-10" },
      { codTitulo: "1001291B", vlrTitulo: 823.62, vlrPago: 800, notaFiscal: "1291" },
      { codTitulo: "Z00022B", vlrTitulo: 980, vlrPago: 980 },
    ]);
    expect(r.total).toBe(4);
    expect(Object.fromEntries(r.porPrefixo.map((p) => [p.valor, p.total]))).toEqual({
      "AZ (antecipação)": 1, "A (com NF vinculada)": 1, numérico: 1, "Z (sem NF)": 1,
    });
    expect(r.comNotaFiscal).toBe(2);
    expect([r.pagoIgualTitulo, r.pagoMaiorQueTitulo, r.pagoMenorQueTitulo]).toEqual([2, 1, 1]);
    expect(r.pagoAntesDoVencimento).toBe(1);
  });
  it("resumirExtratoComissoes: achata a lista e conta créditos/débitos", () => {
    const r = resumirExtratoComissoes([{
      continuationToken: null,
      extratosComissaoSobreVendas: [
        { codRepresentante: 5, lancamentos: [
          { tipoLancamento: "C", descricaoLancamento: "Comissão", titulosRefLancamento: [{ codTitulo: "1A", valorComissao: 10 }] },
          { tipoLancamento: "D", descricaoLancamento: "Adiantamento" },
        ] },
        { codRepresentante: 7, lancamentos: [] },
      ],
    }]);
    expect(r).toMatchObject({ extratos: 2, representantes: 2, lancamentos: 2, comTitulos: 1, titulosReferenciados: 1, comValorComissaoNoTitulo: 1 });
    expect(r.porTipo).toEqual([{ valor: "C", total: 1 }, { valor: "D", total: 1 }]);
    expect(resumirExtratoComissoes([]).extratos).toBe(0);
  });
  it("resumirAdiantamentos: só pedido com vlrAntecipado > 0", () => {
    const r = resumirAdiantamentos([
      { situacao: "6", vlrAntecipado: 1000, vlrTotalPedido: 1000 },
      { situacao: "0", vlrAntecipado: 300, vlrTotalPedido: 1000 },
      { situacao: "6", vlrAntecipado: 0 },
    ]);
    expect(r).toMatchObject({ pedidos: 3, comAdiantamento: 2, adiantamentoIgualAoPedido: 1 });
    expect(r.porSituacao.map((s) => s.nome).sort()).toEqual(["Digitado", "Faturado total"]);
  });
});
