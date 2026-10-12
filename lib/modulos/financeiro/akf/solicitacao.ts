// Solicitação de antecipação à AKF (Fase 2 do módulo): regras puras, sem imports, testadas em solicitacao.test.ts.
// Monta o e-mail no padrão que o Financeiro já usa com a AKF ("André/Kayza, / Boa tarde! / Favor operar os títulos abaixo:",
// uma linha por título, total e OBS numeradas) e descreve a solicitação para as telas.

export const ROTA_AKF = "/financeiro/akf";
export const MODULO_AKF = "financeiro.akf";

export const STATUS_SOLICITACAO = ["rascunho", "solicitada", "cancelada"] as const;
export type StatusSolicitacao = (typeof STATUS_SOLICITACAO)[number];
export const ROTULO_STATUS_SOLICITACAO: Record<StatusSolicitacao, string> = {
  rascunho: "Em montagem",
  solicitada: "Solicitada à AKF",
  cancelada: "Cancelada",
};
export const ehStatusSolicitacao = (v: string): v is StatusSolicitacao => (STATUS_SOLICITACAO as readonly string[]).includes(v);

/** Um título como entra no e-mail (valores em centavos; vencimento aaaa-mm-dd). */
export type ItemEmail = {
  documento: string;
  cliente: string;
  vencimento: string;
  valorSolicitadoCentavos: number;
  /** Valor que restava com a Neo (título inteiro ou restante da antecipação parcial). */
  valorRestanteCentavos: number;
  parcial: boolean;
  semBoleto: boolean;
  observacao?: string | null;
};

export type DadosEmailSolicitacao = {
  itens: readonly ItemEmail[];
  /** Data da solicitação (aaaa-mm-dd), vai no assunto. */
  data: string;
  /** Hora local (0–23) para a saudação. */
  hora: number;
  /** Abertura: "André/Kayza" (primeiros nomes dos destinatários). */
  tratamento: string;
  /** Texto da OBS dos clientes sem boleto de factoring (configuração financeiro.akf.observacao_sem_boleto). */
  observacaoSemBoleto: string;
  /** Observação geral da solicitação (opcional), vira a última OBS. */
  observacaoGeral?: string | null;
};

const formatarReais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);

export function saudacao(hora: number): string {
  if (hora < 12) return "Bom dia!";
  if (hora < 18) return "Boa tarde!";
  return "Boa noite!";
}

/** "André Kamil", "Kayza" -> "André/Kayza" (primeiro nome de cada destinatário). */
export function tratamentoDe(nomes: readonly string[]): string {
  const primeiros = nomes.map((n) => n.trim().split(/\s+/)[0]).filter((n) => n !== "");
  return primeiros.length > 0 ? primeiros.join("/") : "Prezados";
}

/** Primeira palavra do nome do cliente ("EFATA CONSTRUTORA LTDA" -> "EFATA"), para o assunto de título único. */
export function nomeCurto(cliente: string): string {
  return cliente.trim().split(/\s+/)[0] ?? "";
}

export function linhaTitulo(i: ItemEmail): string {
  return `NF ${i.documento} | ${i.cliente} | Venc. ${dataBr(i.vencimento)} | R$ ${formatarReais(i.valorSolicitadoCentavos)}`;
}

const comPonto = (texto: string) => {
  const t = texto.trim();
  return t === "" || /[.!?]$/.test(t) ? t : `${t}.`;
};

/** Uma linha por observação, na ordem dos títulos: sem boleto, parcial, observação do título; por fim a observação geral. */
export function observacoes(d: Pick<DadosEmailSolicitacao, "itens" | "observacaoSemBoleto" | "observacaoGeral">): string[] {
  const linhas: string[] = [];
  for (const i of d.itens) {
    if (i.semBoleto) linhas.push(`NF ${i.documento} - ${comPonto(d.observacaoSemBoleto)}`);
    if (i.parcial) linhas.push(`NF ${i.documento} - Operar R$ ${formatarReais(i.valorSolicitadoCentavos)} (parcial; valor do título R$ ${formatarReais(i.valorRestanteCentavos)}).`);
    if (i.observacao && i.observacao.trim() !== "") linhas.push(`NF ${i.documento} - ${comPonto(i.observacao)}`);
  }
  if (d.observacaoGeral && d.observacaoGeral.trim() !== "") linhas.push(comPonto(d.observacaoGeral));
  return linhas;
}

/** 1 linha -> "OBS - ..."; várias -> "OBS 01 - ...", "OBS 02 - ...". */
export function numerarObs(linhas: readonly string[]): string[] {
  if (linhas.length === 1) return [`OBS - ${linhas[0]}`];
  return linhas.map((l, n) => `OBS ${String(n + 1).padStart(2, "0")} - ${l}`);
}

export function assuntoSolicitacao(itens: readonly ItemEmail[], data: string): string {
  if (itens.length === 1) {
    const curto = nomeCurto(itens[0].cliente);
    return `Antecipação NF ${itens[0].documento}${curto ? ` - ${curto}` : ""}`;
  }
  return `ANTECIPAÇÕES - ${dataBr(data)}`;
}

export const totalCentavos = (itens: readonly ItemEmail[]) => itens.reduce((s, i) => s + i.valorSolicitadoCentavos, 0);

/**
 * Corpo do e-mail. Termina em "Atenciosamente," sem assinatura (regra global 3 do Neo Admin: a assinatura é do Gmail).
 * Estrutura: tratamento / saudação / "Favor operar os títulos abaixo:" / linhas / Total / OBS / Atenciosamente,
 */
export function montarEmailSolicitacao(d: DadosEmailSolicitacao): { assunto: string; corpo: string } {
  const total = totalCentavos(d.itens);
  const n = d.itens.length;
  const linhas = [`${d.tratamento},`, "", saudacao(d.hora), "", "Favor operar os títulos abaixo:", ""];
  for (const i of d.itens) linhas.push(linhaTitulo(i));
  linhas.push(`Total: R$ ${formatarReais(total)} (${n} ${n === 1 ? "título" : "títulos"})`);
  const obs = numerarObs(observacoes(d));
  if (obs.length > 0) linhas.push("", ...obs);
  linhas.push("", "Atenciosamente,");
  return { assunto: assuntoSolicitacao(d.itens, d.data), corpo: linhas.join("\n") };
}

// ---------------------------------------------------------------------------------------------- tela de seleção

/** Estado de uma linha no seletor (o que a pessoa marcou/digitou). */
export type MarcacaoTitulo = { valorTexto: string; semBoleto: boolean; observacao: string };

/** "200.000,00" / "200000" / "200000.5" -> centavos; vazio -> null; inválido -> undefined. */
export function lerValorDigitado(texto: string): number | null | undefined {
  const s = texto.replace(/[R$\s]/g, "");
  if (s === "") return null;
  const normalizado = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 100);
}

/**
 * Valor a mandar para o banco a partir do que foi digitado: null = o restante (valor cheio); número = valor em reais.
 * Devolve erro quando o texto é inválido ou passa do restante.
 */
export function valorParaSolicitar(texto: string, restanteCentavos: number): { ok: true; valor: number | null; parcial: boolean } | { ok: false; erro: string } {
  const centavos = lerValorDigitado(texto);
  if (centavos === undefined) return { ok: false, erro: "Valor inválido: use números, ex.: 200.000,00." };
  if (centavos === null || centavos === restanteCentavos) return { ok: true, valor: null, parcial: false };
  if (centavos > restanteCentavos) return { ok: false, erro: `O valor passa do que resta com a Neo (R$ ${formatarReais(restanteCentavos)}).` };
  return { ok: true, valor: centavos / 100, parcial: true };
}
