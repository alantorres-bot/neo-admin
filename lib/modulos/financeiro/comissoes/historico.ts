// Financeiro / Comissões: leitura da planilha anual "Comissões <Nome> - <ano>.xlsx" (uma aba por mês) para o histórico
// do que já foi pago antes do sistema (regra 13). Puro e testado; valores em centavos.
import { dataDaPlanilha, valorDaPlanilha, type Tipo } from "./regras";

export type LinhaHistorico = {
  origem: "titulo" | "manual" | "antecipacao";
  cod_titulo: string | null;
  nome_cliente: string | null;
  data_pagamento: string | null;   // a planilha não tem a data do pagamento: vale o vencimento (ou a emissão)
  tipo: Tipo;
  valor_base_centavos: number;
  percentual: number;
  valor_comissao_centavos: number;
  observacao: string | null;
};

export type MesHistorico = { aba: string; competencia: string; linhas: LinhaHistorico[]; total_centavos: number };

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const norm = (v: unknown) => texto(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Documento que é título do Consistem: Z… (às vezes AZ…) ou número com a letra da parcela (1001323C, A1001273D, 000928G). */
export const ehDocumentoDeTitulo = (d: string) => /^A?(Z\d+[A-Z]|\d{6,}[A-Z])$/i.test(d.trim());

/** Ano da planilha pelo nome do arquivo ("Comissões Fernando - 2026.xlsx"); sem ano no nome, null. */
export function anoDoArquivo(nome: string): number | null {
  const m = nome.match(/(20\d{2})/);
  return m ? Number(m[1]) : null;
}

/**
 * Lê as abas da planilha anual. Cada aba com nome de mês vira um mês; o mês vem do NOME DA ABA (o "Mês de Referência"
 * de dentro às vezes fica copiado do mês anterior). Cabeçalho: Nº docto, REF/Parcela, Sacado, Dt. emissão,
 * Dt. vencimento, Vl. total, Tipo, Comissão; percentuais Venda/Locação acima dele. Depois de "TOTAL DO MÊS", as linhas
 * "ANTECIPAÇÃO…"/"ANTECIPADO" são antecipações já pagas; "SALDO…" é ignorado. Confere a soma com o TOTAL DO MÊS.
 */
export function lerPlanilhaHistorico(abas: { nome: string; matriz: unknown[][] }[], ano: number, nomeRepresentante: string): { meses: MesHistorico[]; erros: string[] } {
  const meses: MesHistorico[] = [];
  const erros: string[] = [];
  const primeiroNome = norm(nomeRepresentante).split(/\s+/)[0] ?? "";
  for (const aba of abas) {
    const mes = MESES.indexOf(norm(aba.nome));
    if (mes < 0) continue;
    const m = aba.matriz;
    const titulo = m.slice(0, 10).flat().map(norm).find((c) => c.startsWith("comissoes -"));
    if (titulo && primeiroNome && !titulo.includes(primeiroNome)) {
      erros.push(`Aba ${aba.nome}: a planilha não é de ${nomeRepresentante} ("${titulo}").`);
      continue;
    }
    const iCab = m.findIndex((l) => l.some((c) => norm(c).includes("docto")));
    if (iCab < 0) { erros.push(`Aba ${aba.nome}: não achei o cabeçalho (Nº docto).`); continue; }
    const cab = m[iCab].map(norm);
    const col = {
      doc: cab.findIndex((c) => c.includes("docto")),
      ref: cab.findIndex((c) => c === "ref" || c.startsWith("parcela")),
      sacado: cab.findIndex((c) => c.includes("sacado")),
      emissao: cab.findIndex((c) => c.includes("emiss")),
      vencimento: cab.findIndex((c) => c.includes("venc")),
      valor: cab.findIndex((c) => c.includes("vl. total") || c.includes("valor")),
      tipo: cab.findIndex((c) => c.startsWith("tipo")),
      comissao: cab.findIndex((c) => c.startsWith("comiss")),
    };
    if ([col.doc, col.valor, col.comissao].some((i) => i < 0)) { erros.push(`Aba ${aba.nome}: faltam as colunas Nº docto, Vl. total ou Comissão.`); continue; }
    // Percentuais (Venda / Locação) acima do cabeçalho: o número logo depois do rótulo.
    const percDe = (rotulo: string) => {
      for (const l of m.slice(0, iCab)) {
        const i = l.findIndex((c) => norm(c) === rotulo);
        if (i >= 0) {
          const v = Number(texto(l[i + 1]).replace(",", "."));
          if (Number.isFinite(v) && v > 0) return v < 1 ? Math.round(v * 100_000) / 1000 : v; // 0,015 → 1,5%
        }
      }
      return null;
    };
    const percVenda = percDe("venda"), percLocacao = percDe("locacao");
    const competencia = `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
    const linhas: LinhaHistorico[] = [];
    let totalPlanilha: number | null = null;
    let depoisDoTotal = false;
    m.slice(iCab + 1).forEach((l, i) => {
      const n = iCab + i + 2;
      const rotulo = l.map(norm).find((c) => /^(total do mes|antecip|saldo)/.test(c)) ?? "";
      const comissao = valorDaPlanilha(l[col.comissao]);
      if (rotulo.startsWith("total do mes")) { depoisDoTotal = true; totalPlanilha = comissao; return; }
      if (depoisDoTotal) {
        if (rotulo.startsWith("antecip") && comissao !== null && comissao > 0) {
          const descricao = texto(l.find((c) => norm(c).startsWith("antecip")));
          const data = descricao.match(/(\d{2}\/\d{2}\/\d{4})/);
          linhas.push({
            origem: "antecipacao", cod_titulo: null, nome_cliente: null, data_pagamento: data ? dataDaPlanilha(data[1]) : null, tipo: "venda",
            valor_base_centavos: comissao, percentual: 0, valor_comissao_centavos: comissao, observacao: descricao || "Antecipação de comissão",
          });
        }
        return;
      }
      const docto = texto(l[col.doc]);
      const sacado = col.sacado >= 0 ? texto(l[col.sacado]) : "";
      const valor = valorDaPlanilha(l[col.valor]);
      if (docto === "" && sacado === "") return; // soma da coluna ou linha-modelo vazia
      if (valor === null || valor <= 0) { erros.push(`Aba ${aba.nome}, linha ${n}: valor inválido.`); return; }
      const tipo: Tipo = col.tipo >= 0 && norm(l[col.tipo]).startsWith("loca") ? "locacao" : "venda";
      const percPadrao = (tipo === "locacao" ? percLocacao : percVenda) ?? 0;
      const valorComissao = comissao ?? Math.round((valor * percPadrao) / 100);
      const percentual = valor > 0 ? Math.round((valorComissao / valor) * 100_000) / 1000 : percPadrao;
      const ref = col.ref >= 0 ? texto(l[col.ref]) : "";
      const data = dataDaPlanilha(col.vencimento >= 0 ? l[col.vencimento] : null) ?? dataDaPlanilha(col.emissao >= 0 ? l[col.emissao] : null);
      const titulo = ehDocumentoDeTitulo(docto);
      linhas.push({
        origem: titulo ? "titulo" : "manual", cod_titulo: docto || null, nome_cliente: sacado || null, data_pagamento: data, tipo,
        valor_base_centavos: valor, percentual, valor_comissao_centavos: valorComissao,
        observacao: [titulo ? null : docto ? `Documento ${docto}` : "Sem documento (adiantamento)", ref ? `REF ${ref}` : null].filter(Boolean).join(" · ") || null,
      });
    });
    const soma = linhas.filter((l) => l.origem !== "antecipacao").reduce((s, l) => s + l.valor_comissao_centavos, 0);
    // cada linha arredonda ao centavo e a planilha soma sem arredondar: tolera 1 centavo por linha
    if (totalPlanilha !== null && Math.abs(totalPlanilha - soma) > Math.max(1, linhas.length)) {
      erros.push(`Aba ${aba.nome}: a soma das linhas (${(soma / 100).toFixed(2)}) não bate com o TOTAL DO MÊS (${((totalPlanilha as number) / 100).toFixed(2)}).`);
      continue;
    }
    if (linhas.length > 0) meses.push({ aba: aba.nome, competencia, linhas, total_centavos: soma });
  }
  return { meses, erros };
}
