// Regras puras do caixa disponível da autorização de pagamento: saldos conciliados das contas bancárias da empresa
// (registrados em Saldos bancários) + valores adicionais do dia (depósitos esperados, ainda sem registro).
// A função de banco cap_aplicar_composicao_caixa faz a mesma soma lendo os saldos do banco; a tela usa estas regras
// para mostrar a prévia. Sem imports; testado em caixa.test.ts.

/** Conta bancária com o último saldo conciliado registrado (até hoje). */
export type ContaCaixa = {
  id: string;
  descricao: string;
  banco: string;
  agencia: string;
  conta: string;
  entraNoCaixa: boolean;
  /** Último saldo ativo (até hoje); null = nunca registrado. Pode ser negativo. */
  saldoCentavos: number | null;
  dataSaldo: string | null; // aaaa-mm-dd
};

export type AdicionalCaixa = { descricao: string; valorCentavos: number };

/** O que a tela manda gravar: quais contas entram e os adicionais. Os saldos o banco lê sozinho. */
export type Composicao = { contas: string[]; adicionais: AdicionalCaixa[] };

/** Linha da composição gravada na autorização (view cap_vw_autorizacoes, campo caixa_composicao). */
export type LinhaComposicao = { tipo: "saldo" | "adicional"; descricao: string; dataSaldo: string | null; valorCentavos: number };

export const LIMITES_ADICIONAL = { descricaoMin: 3, descricaoMax: 200, valorMaxCentavos: 10_000_000_000, maximo: 30 } as const;

/** Mesmas regras da função de banco; devolve a mensagem de erro ou null. */
export function validarAdicional(a: { descricao: string; valorCentavos: number | null }): string | null {
  const d = a.descricao.trim();
  if (d.length < LIMITES_ADICIONAL.descricaoMin || d.length > LIMITES_ADICIONAL.descricaoMax) {
    return `Descreva o valor adicional (${LIMITES_ADICIONAL.descricaoMin} a ${LIMITES_ADICIONAL.descricaoMax} caracteres), ex.: "Depósito previsto cliente X".`;
  }
  if (a.valorCentavos === null || !Number.isInteger(a.valorCentavos) || a.valorCentavos <= 0) return "Valor inválido: informe um valor maior que zero, ex.: 1.234,56.";
  if (a.valorCentavos > LIMITES_ADICIONAL.valorMaxCentavos) return "Valor acima do limite.";
  return null;
}

/** Saldo digitado ("-1.234,56", "R$ 10.000", "1234.56") → centavos, aceitando negativo; null se vazio ou inválido. */
export function parseSaldo(texto: string): number | null {
  let s = texto.replace(/[R$\s]/g, "");
  const negativo = s.startsWith("-") || (s.startsWith("(") && s.endsWith(")"));
  s = s.replace(/^-|^\(|\)$/g, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // "50.000" = cinquenta mil
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const c = Math.round(Number((Number(s) * 100).toFixed(6)));
  return negativo ? -c : c;
}

/** Contas marcadas por padrão: as que entram no caixa (decisão do gestor em Saldos bancários). */
export const composicaoPadrao = (contas: readonly ContaCaixa[]): Composicao => ({
  contas: contas.filter((c) => c.entraNoCaixa).map((c) => c.id),
  adicionais: [],
});

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export type CaixaComposto = {
  linhas: { contaId: string; descricao: string; dataSaldo: string | null; valorCentavos: number }[];
  adicionais: AdicionalCaixa[];
  saldosCentavos: number;
  adicionaisCentavos: number;
  totalCentavos: number;
  /** Avisos que não impedem: saldo de outro dia, conta sem saldo. */
  avisos: string[];
};

/** Soma o caixa: saldo de cada conta marcada (conta sem saldo vale 0 e avisa) + adicionais. */
export function comporCaixa(contas: readonly ContaCaixa[], composicao: Composicao, hoje: string): CaixaComposto {
  const marcadas = new Set(composicao.contas);
  const linhas: CaixaComposto["linhas"] = [];
  const avisos: string[] = [];
  for (const c of contas) {
    if (!marcadas.has(c.id)) continue;
    if (c.saldoCentavos === null) {
      avisos.push(`${c.descricao}: sem saldo registrado (conta como R$ 0,00).`);
    } else if (c.dataSaldo !== null && c.dataSaldo < hoje) {
      avisos.push(`${c.descricao}: saldo de ${ddmm(c.dataSaldo)}, não de hoje.`);
    }
    linhas.push({ contaId: c.id, descricao: c.descricao, dataSaldo: c.dataSaldo, valorCentavos: c.saldoCentavos ?? 0 });
  }
  const saldosCentavos = linhas.reduce((s, l) => s + l.valorCentavos, 0);
  const adicionaisCentavos = composicao.adicionais.reduce((s, a) => s + a.valorCentavos, 0);
  return { linhas, adicionais: composicao.adicionais, saldosCentavos, adicionaisCentavos, totalCentavos: saldosCentavos + adicionaisCentavos, avisos };
}

/** Rótulo da conta: "SICREDI C/C · ag. 0802 · c/c 12345-6". */
export function rotuloConta(c: Pick<ContaCaixa, "descricao" | "agencia" | "conta">): string {
  return [c.descricao, c.agencia ? `ag. ${c.agencia}` : "", c.conta ? `c/c ${c.conta}` : ""].filter(Boolean).join(" · ");
}

/** Lê o jsonb `caixa_composicao` da view (valores em reais) em linhas com centavos; ignora o que não reconhece. */
export function lerComposicaoGravada(bruto: unknown): LinhaComposicao[] {
  if (!Array.isArray(bruto)) return [];
  const linhas: LinhaComposicao[] = [];
  for (const x of bruto) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    if (r.tipo !== "saldo" && r.tipo !== "adicional") continue;
    const valor = Number(r.valor);
    if (!Number.isFinite(valor)) continue;
    linhas.push({
      tipo: r.tipo,
      descricao: String(r.descricao ?? ""),
      dataSaldo: typeof r.data_saldo === "string" ? r.data_saldo : null,
      valorCentavos: Math.round(Number((valor * 100).toFixed(6))),
    });
  }
  return linhas;
}

/** Composição gravada → o que reabrir no diálogo (as contas pelo id gravado e os adicionais). */
export function composicaoDaGravada(bruto: unknown): Composicao | null {
  if (!Array.isArray(bruto) || bruto.length === 0) return null;
  const contas: string[] = [];
  const adicionais: AdicionalCaixa[] = [];
  for (const x of bruto) {
    const r = (x ?? {}) as Record<string, unknown>;
    if (r.tipo === "saldo" && typeof r.conta_id === "string") contas.push(r.conta_id);
    if (r.tipo === "adicional") {
      const valor = Number(r.valor);
      if (Number.isFinite(valor)) adicionais.push({ descricao: String(r.descricao ?? ""), valorCentavos: Math.round(Number((valor * 100).toFixed(6))) });
    }
  }
  return { contas, adicionais };
}

/** Corpo jsonb das funções de banco (valores em reais). */
export const composicaoParaBanco = (c: Composicao) => ({
  contas: c.contas,
  adicionais: c.adicionais.map((a) => ({ descricao: a.descricao.trim(), valor: a.valorCentavos / 100 })),
});
