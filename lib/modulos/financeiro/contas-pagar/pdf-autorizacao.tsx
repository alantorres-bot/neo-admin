// PDF do relatório de autorização de pagamento gerado no servidor (@react-pdf/renderer), para o envio no Slack.
// Mesmo conteúdo da página de impressão: cabeçalho da empresa, títulos, antecipações, pagamentos extras, subtotais, total, caixa, rodapé.
// Só lógica de apresentação: recebe os dados já lidos (dados.ts) e devolve os bytes do PDF.
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { compararComCaixa, resumirItens, ROTULO_STATUS, type StatusAutorizacao } from "./autorizacao";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";

export type ItemPdf = {
  tipo: "titulo" | "antecipacao";
  fornecedorNome: string;
  fornecedorDocumento: string | null;
  codFornecedor: string | null;
  numDocumento: string | null;
  codLancamento: string;
  dataVencimento: string | null;
  dataPagamento: string | null;
  complemento: string | null;
  valorCentavos: number;
};

/** Pagamento extra (fora do Consistem): descrição, favorecido e valor. */
export type ExtraPdf = { descricao: string; favorecido: string; valorCentavos: number };

export type DadosPdfAutorizacao = {
  codigo: string;
  data: string; // aaaa-mm-dd
  status: StatusAutorizacao;
  empresaRazaoSocial: string;
  empresaCnpj: string | null;
  observacao: string | null;
  motivoCancelamento: string | null;
  caixaCentavos: number | null;
  criadoPor: string | null;
  criadoEm: string; // já formatado
  autorizadaPor: string | null;
  autorizadaEm: string | null; // já formatado
  canceladaEm: string | null; // aaaa-mm-dd ou formatado
  emitidoEm: string; // já formatado
  itens: ItemPdf[];
  /** Pagamentos extras (fora do Consistem); a tabela só aparece quando há algum. */
  extras?: ExtraPdf[];
};

const estilos = StyleSheet.create({
  pagina: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#000" },
  cabecalho: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: "#000", paddingBottom: 6, marginBottom: 8 },
  empresa: { fontSize: 12, fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  titulo: { fontSize: 12, fontFamily: "Helvetica-Bold", textTransform: "uppercase", textAlign: "right" },
  selo: { marginTop: 3, alignSelf: "flex-end", borderWidth: 1.5, borderColor: "#000", paddingHorizontal: 4, paddingVertical: 1, fontFamily: "Helvetica-Bold", fontSize: 9 },
  secao: { fontSize: 10, fontFamily: "Helvetica-Bold", textTransform: "uppercase", marginTop: 8, marginBottom: 3 },
  linhaCab: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#000", paddingVertical: 2, fontFamily: "Helvetica-Bold" },
  linha: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#999", paddingVertical: 2 },
  cFornecedor: { width: "34%", paddingRight: 4 },
  cDocumento: { width: "16%", paddingRight: 4 },
  cData: { width: "12%", paddingRight: 4 },
  cHistorico: { width: "24%", paddingRight: 4 },
  cValor: { width: "14%", textAlign: "right" },
  cDescricao: { width: "50%", paddingRight: 4 },
  cFavorecido: { width: "36%", paddingRight: 4 },
  pequeno: { fontSize: 7, color: "#333" },
  subtotal: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 2, fontFamily: "Helvetica-Bold" },
  totais: { marginTop: 8, alignSelf: "flex-end", width: 260 },
  totalLinha: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  totalGeral: { borderTopWidth: 2, borderTopColor: "#000", fontFamily: "Helvetica-Bold", fontSize: 10, paddingTop: 3 },
  aviso: { marginTop: 6, borderWidth: 1.5, borderColor: "#000", padding: 4, fontFamily: "Helvetica-Bold" },
  rodape: { marginTop: 12, borderTopWidth: 1, borderTopColor: "#000", paddingTop: 4, fontSize: 8 },
});

function Tabela({ titulo, itens, rotuloData, subtotal }: { titulo: string; itens: ItemPdf[]; rotuloData: string; subtotal: number }) {
  return (
    <View>
      <Text style={estilos.secao}>{titulo} ({itens.length})</Text>
      {itens.length === 0 ? (
        <Text style={estilos.pequeno}>Nenhum.</Text>
      ) : (
        <View>
          <View style={estilos.linhaCab}>
            <Text style={estilos.cFornecedor}>Fornecedor</Text>
            <Text style={estilos.cDocumento}>Documento</Text>
            <Text style={estilos.cData}>{rotuloData}</Text>
            <Text style={estilos.cHistorico}>Histórico</Text>
            <Text style={estilos.cValor}>Valor</Text>
          </View>
          {itens.map((i) => (
            <View key={i.codLancamento} style={estilos.linha} wrap={false}>
              <View style={estilos.cFornecedor}>
                <Text>{i.fornecedorNome}</Text>
              </View>
              <View style={estilos.cDocumento}>
                <Text>{i.numDocumento || "—"}</Text>
              </View>
              <Text style={estilos.cData}>{formatarData(i.tipo === "titulo" ? i.dataVencimento : i.dataPagamento) || "—"}</Text>
              <Text style={estilos.cHistorico}>{i.complemento || "—"}</Text>
              <Text style={estilos.cValor}>{formatarMoeda(i.valorCentavos)}</Text>
            </View>
          ))}
          <View style={estilos.subtotal}>
            <Text>Subtotal {formatarMoeda(subtotal)}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function TabelaExtras({ extras, subtotal }: { extras: ExtraPdf[]; subtotal: number }) {
  return (
    <View>
      <Text style={estilos.secao}>Pagamentos extras — fora do Consistem ({extras.length})</Text>
      <View style={estilos.linhaCab}>
        <Text style={estilos.cDescricao}>Descrição</Text>
        <Text style={estilos.cFavorecido}>Favorecido</Text>
        <Text style={estilos.cValor}>Valor</Text>
      </View>
      {extras.map((x, n) => (
        <View key={n} style={estilos.linha} wrap={false}>
          <Text style={estilos.cDescricao}>{x.descricao}</Text>
          <Text style={estilos.cFavorecido}>{x.favorecido}</Text>
          <Text style={estilos.cValor}>{formatarMoeda(x.valorCentavos)}</Text>
        </View>
      ))}
      <View style={estilos.subtotal}>
        <Text>Subtotal {formatarMoeda(subtotal)}</Text>
      </View>
    </View>
  );
}

export function DocumentoAutorizacao({ d }: { d: DadosPdfAutorizacao }) {
  const titulos = d.itens.filter((i) => i.tipo === "titulo");
  const antecipacoes = d.itens.filter((i) => i.tipo === "antecipacao");
  const extras = d.extras ?? [];
  const resumo = resumirItens(
    d.itens.map((i) => ({ tipo: i.tipo, valorCentavos: i.valorCentavos, removido: false, baixadoConsistemEm: null })),
    extras.map((x) => ({ valorCentavos: x.valorCentavos, removido: false })),
  );
  const caixa = compararComCaixa(resumo.geral.centavos, d.caixaCentavos);
  const selo = d.status === "rascunho" ? "RASCUNHO — SEM VALIDADE" : d.status === "cancelada" ? `CANCELADA${d.canceladaEm ? ` EM ${d.canceladaEm}` : ""}` : null;
  return (
    <Document title={`Autorização de pagamento ${d.codigo}`} author="Neo Admin">
      <Page size="A4" style={estilos.pagina}>
        <View style={estilos.cabecalho}>
          <View>
            <Text style={estilos.empresa}>{d.empresaRazaoSocial}</Text>
            <Text>CNPJ {d.empresaCnpj ?? "—"}</Text>
          </View>
          <View>
            <Text style={estilos.titulo}>Autorização de pagamento {d.codigo}</Text>
            <Text style={{ textAlign: "right" }}>Data: {formatarData(d.data)} · Emitido em {d.emitidoEm}</Text>
            {selo && <Text style={estilos.selo}>{selo}</Text>}
          </View>
        </View>
        {d.observacao && <Text><Text style={{ fontFamily: "Helvetica-Bold" }}>Observação: </Text>{d.observacao}</Text>}
        {d.motivoCancelamento && <Text><Text style={{ fontFamily: "Helvetica-Bold" }}>Motivo do cancelamento: </Text>{d.motivoCancelamento}</Text>}

        <Tabela titulo="Títulos a pagar" itens={titulos} rotuloData="Vencimento" subtotal={resumo.titulos.centavos} />
        <Tabela titulo="Antecipações a fornecedor" itens={antecipacoes} rotuloData="Pagamento prog." subtotal={resumo.antecipacoes.centavos} />
        {extras.length > 0 && <TabelaExtras extras={extras} subtotal={resumo.extras.centavos} />}

        <View style={estilos.totais}>
          <View style={estilos.totalLinha}><Text>Subtotal títulos ({resumo.titulos.quantidade})</Text><Text>{formatarMoeda(resumo.titulos.centavos)}</Text></View>
          <View style={estilos.totalLinha}><Text>Subtotal antecipações ({resumo.antecipacoes.quantidade})</Text><Text>{formatarMoeda(resumo.antecipacoes.centavos)}</Text></View>
          {extras.length > 0 && <View style={estilos.totalLinha}><Text>Subtotal pagamentos extras ({resumo.extras.quantidade})</Text><Text>{formatarMoeda(resumo.extras.centavos)}</Text></View>}
          <View style={[estilos.totalLinha, estilos.totalGeral]}><Text>Total geral ({resumo.geral.quantidade} {resumo.geral.quantidade === 1 ? "item" : "itens"})</Text><Text>{formatarMoeda(resumo.geral.centavos)}</Text></View>
          {caixa && (
            <View>
              <View style={estilos.totalLinha}><Text>Caixa disponível</Text><Text>{formatarMoeda(caixa.caixaCentavos)}</Text></View>
              <View style={[estilos.totalLinha, { fontFamily: "Helvetica-Bold" }]}><Text>{caixa.ultrapassa ? "Excedente (acima do caixa)" : "Sobra de caixa"}</Text><Text>{formatarMoeda(caixa.ultrapassa ? caixa.excedenteCentavos : caixa.sobraCentavos)}</Text></View>
            </View>
          )}
        </View>
        {caixa?.ultrapassa && <Text style={estilos.aviso}>O total autorizado ultrapassa o caixa disponível em {formatarMoeda(caixa.excedenteCentavos)}. Decidir quais itens deixar de pagar.</Text>}

        <View style={estilos.rodape}>
          <Text>Montada por {d.criadoPor ?? "—"} em {d.criadoEm}.</Text>
          {d.autorizadaEm && <Text>Autorizada por {d.autorizadaPor ?? "—"} em {d.autorizadaEm}.</Text>}
          <Text style={{ marginTop: 2, fontSize: 7 }}>Situação: {ROTULO_STATUS[d.status]}. Relatório gerado pelo Neo Admin a partir dos lançamentos do Consistem copiados no momento da autorização. O pagamento e a baixa são feitos no Consistem.</Text>
        </View>
      </Page>
    </Document>
  );
}

/** Bytes do PDF (Node). */
export async function gerarPdfAutorizacao(d: DadosPdfAutorizacao): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<DocumentoAutorizacao d={d} />);
  return new Uint8Array(buffer);
}

export const nomeArquivoAutorizacao = (codigo: string): string => `autorizacao-pagamento-${codigo}.pdf`;
