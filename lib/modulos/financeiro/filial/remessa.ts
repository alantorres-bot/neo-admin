// Faturamento da Filial Contagem: remessa e aviso a Cuiabá (migration 0148).
// O aviso é só comunicação interna — relação NF, cliente, vencimento e valor + link da remessa —, aberto pronto no
// Gmail de quem enviou (tela de novo e-mail numa aba nova). Os arquivos ficam no Neo Admin. Nada é enviado pelo sistema.
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";

export type ParcelaInformada = { vencimento: string; valorCentavos: number };

export type ItemAviso = {
  nota: string;
  cliente: string;
  aceitaBoletoFactoring: boolean;
  parcelas: ParcelaInformada[];
};

export type Aviso = { para: string[]; assunto: string; corpo: string };

const MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

/** "FATURAS MG - OUTUBRO 2026 - REMESSA nº 3" (mesmo padrão do assunto que a filial já usa). `data` em aaaa-mm-dd (Cuiabá). */
export function assuntoDaRemessa(numero: number, data: string): string {
  const [ano, mes] = data.split("-").map(Number);
  return `FATURAS MG - ${MESES[mes - 1]} ${ano} - REMESSA nº ${numero}`;
}

const nfCurta = (nota: string) => nota.replace(/^0+(?=\d{4})/, ""); // 002351 → 2351, como nos e-mails

export function linhaDoItem(i: ItemAviso): string {
  const partes = i.parcelas.length === 0
    ? "vencimento e valor a conferir na nota"
    : i.parcelas.map((p) => `venc. ${formatarData(p.vencimento)} - ${formatarMoeda(p.valorCentavos)}`).join("; ");
  return `- NF ${nfCurta(i.nota)} - ${i.cliente} - ${partes}`;
}

export function montarAviso(d: { numero: number; data: string; itens: ItemAviso[]; link: string; para: string[] }): Aviso {
  const itens = [...d.itens].sort((a, b) => a.nota.localeCompare(b.nota));
  const total = itens.reduce((s, i) => s + i.parcelas.reduce((t, p) => t + p.valorCentavos, 0), 0);
  const semFactoring = itens.filter((i) => !i.aceitaBoletoFactoring);
  const linhas = [
    "Bom dia,",
    "",
    `Seguem as faturas da Filial Contagem para implantação (remessa nº ${d.numero}, ${itens.length} ${itens.length === 1 ? "nota" : "notas"}, total ${formatarMoeda(total)}):`,
    "",
    ...itens.map(linhaDoItem),
    "",
  ];
  if (semFactoring.length > 0) {
    linhas.push("OBS.: os clientes abaixo não aceitam boleto de factoring:", ...semFactoring.map((i) => `- NF ${nfCurta(i.nota)} - ${i.cliente}`), "");
  }
  linhas.push(`As notas e os demonstrativos estão na remessa: ${d.link}`, "", "Atenciosamente,");
  return { para: d.para, assunto: assuntoDaRemessa(d.numero, d.data), corpo: linhas.join("\n") };
}

/** Limite prático de tamanho do link (navegadores e o Gmail cortam URLs muito longas). */
export const LIMITE_LINK = 1900;

/**
 * Link que abre a tela de NOVO E-MAIL do Gmail (aba nova) já preenchida — funciona para qualquer conta do Workspace, sem
 * depender de programa de e-mail padrão no Windows (o mailto não abre nada quando não há um). Se a relação não couber,
 * o corpo leva só o resumo e o link da remessa (a relação completa está nela).
 */
export function linkGmail(a: Aviso, link: string): { url: string; resumido: boolean } {
  const montar = (corpo: string) =>
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(a.para.join(","))}&su=${encodeURIComponent(a.assunto)}&body=${encodeURIComponent(corpo)}`;
  const completo = montar(a.corpo);
  if (completo.length <= LIMITE_LINK) return { url: completo, resumido: false };
  const primeira = a.corpo.split("\n").slice(0, 3).join("\n");
  return { url: montar(`${primeira}\n\nA relação completa (NF, cliente, vencimento e valor) e os arquivos estão na remessa: ${link}\n\nAtenciosamente,`), resumido: true };
}

export type ParcelaConsistem = { documento: string; vencimento: string; valorCentavos: number };

/**
 * Compara o que a nota informou com os títulos que chegaram do Consistem. Devolve as divergências em texto
 * (vazio = confere). Compara por ordem de vencimento.
 */
export function divergencias(informadas: readonly ParcelaInformada[], consistem: readonly ParcelaConsistem[]): string[] {
  if (informadas.length === 0 || consistem.length === 0) return [];
  const a = [...informadas].sort((x, y) => x.vencimento.localeCompare(y.vencimento));
  const b = [...consistem].sort((x, y) => x.vencimento.localeCompare(y.vencimento));
  const saida: string[] = [];
  if (a.length !== b.length) saida.push(`A nota tem ${a.length} ${a.length === 1 ? "parcela" : "parcelas"} e o Consistem, ${b.length}.`);
  const totalA = a.reduce((s, p) => s + p.valorCentavos, 0);
  const totalB = b.reduce((s, p) => s + p.valorCentavos, 0);
  if (totalA !== totalB) saida.push(`Total da nota ${formatarMoeda(totalA)} × Consistem ${formatarMoeda(totalB)}.`);
  if (a.length === b.length) {
    a.forEach((p, i) => {
      const t = b[i];
      if (p.vencimento !== t.vencimento) saida.push(`${t.documento}: vencimento na nota ${formatarData(p.vencimento)} × Consistem ${formatarData(t.vencimento)}.`);
      if (p.valorCentavos !== t.valorCentavos && totalA === totalB) saida.push(`${t.documento}: valor na nota ${formatarMoeda(p.valorCentavos)} × Consistem ${formatarMoeda(t.valorCentavos)}.`);
    });
  }
  return saida;
}

/** jsonb do banco ([{vencimento, valor}]) → parcelas em centavos. */
export function lerParcelasInformadas(v: unknown): ParcelaInformada[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((e) => {
    const o = e as { vencimento?: unknown; valor?: unknown };
    return typeof o?.vencimento === "string" && o.valor != null ? [{ vencimento: o.vencimento, valorCentavos: Math.round(Number(o.valor) * 100) }] : [];
  });
}
