import { describe, expect, it } from "vitest";
import {
  assinaturaPedido,
  dataIso,
  diasAlertaMdfe,
  diasDesdeEmissao,
  ehNotaSemTitulos,
  normalizarDetalhePedido,
  normalizarMdfe,
  normalizarNotaPedido,
  normalizarParcela,
  normalizarPedidoCompleto,
  normalizarPedidoResumido,
  notasParaLerParcelas,
  pedidoAtrasado,
  pedidoFaturou,
  planejarPendenciasMdfe,
  planejarPendenciasAtraso,
  TITULO_PENDENCIA_ATRASO,
  TITULO_PENDENCIA_MDFE,
} from "../../../supabase/functions/_shared/consistem-comercial";

describe("normalização da carteira", () => {
  it("pedido resumido: códigos em texto, datas ISO e valores com 2 casas", () => {
    const p = normalizarPedidoResumido({
      codPedido: 187, situacao: "5", codCliente: 156, nomeCliente: " CLIENTE X ", codRepresentante: 3, nomeRepresentante: "FERNANDO",
      codTipoNF: 4, descTipoNF: "VENDA", codCondVenda: null, dataEmissao: "2026-10-01", dataDigitacao: "2026-10-01T00:00:00",
      dataPrevFat: "2026-10-10", dataUltimoFat: "", vlrTotalPedido: 1000.005, vlrTotalFaturado: "400", vlrSaldo: 600, vlrTotalCancelado: null,
    });
    expect(p).toMatchObject({
      cod_pedido: "187", situacao: "5", cod_cliente: "156", nome_cliente: "CLIENTE X", cod_representante: "3", cod_cond_venda: null,
      data_digitacao: "2026-10-01", data_ultimo_fat: null, valor_total: 1000.01, valor_faturado: 400, valor_saldo: 600, valor_cancelado: 0,
    });
    expect(normalizarPedidoResumido({ codPedido: "" })).toBeNull();
  });
  it("pedido completo: faturado = total - saldo - cancelado", () => {
    expect(normalizarPedidoCompleto({ codPedido: "9", situacao: "5", vlrTotalPedido: 1000, vlrSaldo: 300, vlrTotalCancelado: 100 })?.valor_faturado).toBe(600);
    expect(normalizarPedidoCompleto({ codPedido: "9", vlrTotalPedido: 100, vlrSaldo: 150 })?.valor_faturado).toBe(0);
  });
  it("datas inválidas viram null", () => {
    expect(dataIso("0000-00-00")).toBeNull();
    expect(dataIso("0/03/2026")).toBeNull();
    expect(dataIso("2026-13-45")).toBeNull();
    expect(dataIso("2026-03-30T10:00:00Z")).toBe("2026-03-30");
    expect(dataIso("09/09/2026")).toBe("2026-09-09");
    expect(dataIso("31/02/2026")).toBeNull();
  });
  it("detalhe: itens numerados, sem número ou repetido não se perde", () => {
    const d = normalizarDetalhePedido({
      vlrAntecipado: 1000, codPortador: 41, observacaoPedido: "",
      itensPedido: [
        { itemPedido: 1, codProduto: "A", qtdPedida: 10, qtdFaturada: 4, qtdCancelada: 0, precoUnit: 12.5 },
        { itemPedido: 1, codProduto: "B", qtdPedida: 2 },
        { codProduto: "C", qtdPedida: "3" },
      ],
    });
    expect(d.valor_antecipado).toBe(1000);
    expect(d.cod_portador).toBe("41");
    expect(d.observacao).toBeNull();
    expect(d.itens.map((i) => i.item)).toEqual([1, 10_001, 10_002]);
    expect(d.itens[2]).toMatchObject({ cod_produto: "C", qtd_pedida: 3, qtd_faturada: 0, preco_unitario: null });
  });
  it("NF do pedido e parcela", () => {
    const n = normalizarNotaPedido({ codNumNota: "0001350", serie: 1, chaveAcesso: "5".repeat(44), situacao: 2, dataEmissao: "2026-09-03", dataHoraSaida: "2026-09-03T14:00:00Z", valorTotal: 816000, qtdVolumes: 3 });
    expect(n).toMatchObject({ nota: "1350", serie: "1", chave_acesso: "5".repeat(44), situacao: "2", data_hora_saida: "2026-09-03T14:00:00.000Z", valor_total: 816000, qtd_volumes: 3 });
    expect(normalizarNotaPedido({ codNumNota: 7, chaveAcesso: "123" })?.chave_acesso).toBeNull();
    expect(normalizarParcela({ codTitulo: "1001350A", dataVencimento: "2026-09-04", dataPagamento: null, valorTitulo: 136000 })).toMatchObject({
      cod_titulo: "1001350A", data_vencimento: "2026-09-04", data_pagamento: null, valor: 136000, valor_juros: null,
    });
    expect(ehNotaSemTitulos('Consistem HTTP 400: [{"mensagem":"Títulos não encontrados para a nota fiscal 1399!"}]')).toBe(true);
    expect(ehNotaSemTitulos("Nota Fiscal de Saída não encontrada!")).toBe(false);
  });
});

describe("o que reler", () => {
  const base = { situacao: "2", valor_total: 100, valor_faturado: 0, valor_saldo: 100, valor_cancelado: 0, data_prev_fat: "2026-10-10" };
  it("assinatura muda com situação, valores e previsão", () => {
    const a = assinaturaPedido(base);
    expect(assinaturaPedido({ ...base })).toBe(a);
    expect(assinaturaPedido({ ...base, valor_saldo: 50 })).not.toBe(a);
    expect(assinaturaPedido({ ...base, data_prev_fat: null })).not.toBe(a);
  });
  it("pedidoFaturou", () => {
    expect(pedidoFaturou({ situacao: "2", valor_faturado: 0 })).toBe(false);
    expect(pedidoFaturou({ situacao: "6", valor_faturado: 0 })).toBe(true);
    expect(pedidoFaturou({ situacao: "2", valor_faturado: 10 })).toBe(true);
  });
  it("notasParaLerParcelas: com chave, não cancelada, que gera título, nunca lida ou com parcela aberta", () => {
    const chave = "5".repeat(44);
    const notas = [
      { id: "lida-paga", chave_acesso: chave, situacao: "2", sem_titulos: false, parcelas_lidas_em: "2026-10-01", parcelas_abertas: 0 },
      { id: "aberta-antiga", chave_acesso: chave, situacao: "2", sem_titulos: false, parcelas_lidas_em: "2026-10-01", parcelas_abertas: 2 },
      { id: "nunca", chave_acesso: chave, situacao: "2", sem_titulos: false, parcelas_lidas_em: null, parcelas_abertas: 0 },
      { id: "sem-chave", chave_acesso: null, situacao: "2", sem_titulos: false, parcelas_lidas_em: null, parcelas_abertas: 0 },
      { id: "cancelada", chave_acesso: chave, situacao: "3", sem_titulos: false, parcelas_lidas_em: null, parcelas_abertas: 0 },
      { id: "sem-titulos", chave_acesso: chave, situacao: "2", sem_titulos: true, parcelas_lidas_em: null, parcelas_abertas: 0 },
    ];
    expect(notasParaLerParcelas(notas, 10).map((n) => n.id)).toEqual(["nunca", "aberta-antiga"]);
    expect(notasParaLerParcelas(notas, 1).map((n) => n.id)).toEqual(["nunca"]);
  });
});

describe("pendência de pedido atrasado", () => {
  const hoje = "2026-10-19";
  const p = (id: string, o: Partial<Parameters<typeof pedidoAtrasado>[0]> = {}) => ({
    id, cod_pedido: id, situacao: "2", valor_saldo: 1500.5, data_prev_fat: "2026-10-10", nome_cliente: "CLIENTE", contraparte_id: null, ...o,
  });
  it("pedidoAtrasado: saldo, previsão passada, não cancelado nem faturado total", () => {
    expect(pedidoAtrasado(p("1"), hoje)).toBe(true);
    expect(pedidoAtrasado(p("1", { data_prev_fat: hoje }), hoje)).toBe(false); // vence hoje: ainda não atrasou
    expect(pedidoAtrasado(p("1", { valor_saldo: 0 }), hoje)).toBe(false);
    expect(pedidoAtrasado(p("1", { situacao: "9" }), hoje)).toBe(false);
    expect(pedidoAtrasado(p("1", { data_prev_fat: null }), hoje)).toBe(false);
  });
  it("abre, atualiza e conclui", () => {
    const r = planejarPendenciasAtraso(
      [p("novo"), p("mudou", { valor_saldo: 10 }), p("igual"), p("faturou", { valor_saldo: 0 })],
      [
        { id: "pend-mudou", referencia_id: "mudou", descricao: "texto antigo" },
        { id: "pend-igual", referencia_id: "igual", descricao: "Pedido igual · CLIENTE · previsão 10/10/2026 · saldo a faturar R$ 1.500,50" },
        { id: "pend-faturou", referencia_id: "faturou", descricao: "x" },
        { id: "pend-sumiu", referencia_id: "nao-existe", descricao: "x" },
      ],
      hoje,
    );
    expect(r.abrir).toEqual([{
      titulo: TITULO_PENDENCIA_ATRASO, descricao: "Pedido novo · CLIENTE · previsão 10/10/2026 · saldo a faturar R$ 1.500,50", prazo: hoje,
      contraparte_id: null, referencia_tabela: "com_pedidos", referencia_id: "novo", link: "/comercial/pedidos/novo",
    }]);
    expect(r.atualizar).toEqual([{ id: "pend-mudou", descricao: "Pedido mudou · CLIENTE · previsão 10/10/2026 · saldo a faturar R$ 10,00" }]);
    expect(r.concluir.sort()).toEqual(["pend-faturou", "pend-sumiu"]);
  });
});

describe("MDF-e (Fase 2)", () => {
  const hoje = "2026-10-21";
  it("normalizarMdfe: lê 'situcao' (grafia da API), chave só com 44 dígitos", () => {
    const m = normalizarMdfe({ numeroMDFe: "000123", ufFinal: "MG", chaveMDFe: "5".repeat(44), numeroProtocolo: "999", situcao: 2, dataEmissao: "2026-10-01", horaEmissao: "10:00:00", valorTotalCarga: 1500.5, placaVeiculos: "ABC1D23" });
    expect(m).toEqual({ numero: "123", chave: "5".repeat(44), protocolo: "999", uf_final: "MG", placas: "ABC1D23", situacao: "2", data_emissao: "2026-10-01", hora_emissao: "10:00:00", valor_carga: 1500.5 });
    expect(normalizarMdfe({ numeroMDFe: "7", chaveMDFe: "12", situacao: 4 })).toMatchObject({ chave: null, situacao: "4" });
    expect(normalizarMdfe({ numeroMDFe: "" })).toBeNull();
  });
  it("diasAlertaMdfe: inteiro de 1 a 365, senão desligado", () => {
    expect(diasAlertaMdfe(null)).toBeNull();
    expect(diasAlertaMdfe(5)).toBe(5);
    expect(diasAlertaMdfe("10")).toBe(10);
    expect(diasAlertaMdfe(0)).toBeNull();
    expect(diasAlertaMdfe(2.5)).toBeNull();
    expect(diasAlertaMdfe("")).toBeNull();
  });
  it("planejarPendenciasMdfe: só em aberto e com prazo vencido; desligado conclui tudo", () => {
    const mdfes = [
      { id: "a", numero: "1", situacao: "2", data_emissao: "2026-10-11", uf_final: "MG", placas: "ABC1D23" }, // 10 dias, autorizado
      { id: "b", numero: "2", situacao: "4", data_emissao: "2026-10-01", uf_final: null, placas: null },     // encerrado
      { id: "c", numero: "3", situacao: "1", data_emissao: "2026-10-20", uf_final: null, placas: null },     // 1 dia
      { id: "d", numero: "4", situacao: "5", data_emissao: "2026-10-16", uf_final: null, placas: null },     // 5 dias, contingência
    ];
    const r = planejarPendenciasMdfe(mdfes, [{ id: "p-d", referencia_id: "d" }, { id: "p-b", referencia_id: "b" }], hoje, 5);
    expect(r.abrir.map((x) => x.referencia_id)).toEqual(["a"]);
    expect(r.abrir[0]).toMatchObject({
      titulo: TITULO_PENDENCIA_MDFE, referencia_tabela: "com_mdfes", link: "/comercial/pedidos/mdfe",
      descricao: "MDF-e 1 · Autorizado · emitido em 11/10/2026 (10 dias) · destino MG · placa ABC1D23",
    });
    expect(r.concluir).toEqual(["p-b"]);
    expect(planejarPendenciasMdfe(mdfes, [{ id: "p-d", referencia_id: "d" }], hoje, null)).toEqual({ abrir: [], concluir: ["p-d"] });
  });
  it("diasDesdeEmissao", () => {
    expect(diasDesdeEmissao("2026-10-11", hoje)).toBe(10);
    expect(diasDesdeEmissao(null, hoje)).toBe(0);
  });
});
