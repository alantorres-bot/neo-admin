// Regras puras da autorização de pagamento (Financeiro > Contas a pagar): status, quem pode o quê, totais e os textos da
// pendência (os mesmos que a função de banco cap_autorizar grava). Sem imports; testado em autorizacao.test.ts.

export type StatusAutorizacao = "rascunho" | "autorizada" | "cancelada";
export const ROTULO_STATUS: Record<StatusAutorizacao, string> = { rascunho: "Rascunho", autorizada: "Autorizada", cancelada: "Cancelada" };
export const ehStatus = (v: string): v is StatusAutorizacao => v === "rascunho" || v === "autorizada" || v === "cancelada";

export type Papel = { podeOperar: boolean; ehGestor: boolean; userId: string };

/** Tipo do anexo (tabela `anexos`) do relatório assinado/escaneado que o financeiro guarda na autorização. */
export const TIPO_ANEXO_AUTORIZACAO = "autorizacao_assinada";

/** Rota da página de impressão (fora da moldura do painel). */
export const rotaImpressao = (id: string): string => `/imprimir/contas-pagar/autorizacao/${id}`;

/** Só gestor autoriza, e só um rascunho. Quem montou pode autorizar a própria (fluxo real: a diretoria monta e autoriza). */
export const podeAutorizar = (status: StatusAutorizacao, p: Papel): boolean => status === "rascunho" && p.ehGestor;

/** Gestor cancela rascunho ou autorizada; quem montou cancela o próprio rascunho. */
export const podeCancelar = (status: StatusAutorizacao, criadoPor: string | null, p: Papel): boolean =>
  status !== "cancelada" && (p.ehGestor || (status === "rascunho" && criadoPor !== null && criadoPor === p.userId && p.podeOperar));

/** Itens só saem de um rascunho, por operador ou acima. */
export const podeRemoverItem = (status: StatusAutorizacao, p: Papel): boolean => status === "rascunho" && p.podeOperar;

/** Pagamentos extras (fora do Consistem) entram e saem só em rascunho, por operador ou acima. */
export const podeEditarExtras = (status: StatusAutorizacao, p: Papel): boolean => status === "rascunho" && p.podeOperar;

export type ItemResumo = {
  tipo: "titulo" | "antecipacao"; valorCentavos: number; removido: boolean; baixadoConsistemEm: string | null;
  /** Data em que a sincronização viu o documento confirmado no Consistem (CCFFB014); ausente/nulo = não consta confirmado. */
  confirmadoConsistemEm?: string | null;
};
/** Pagamento extra: pedido da diretoria que não existe no Consistem (frete avulso, reembolso, taxa…). */
export type ExtraResumo = { valorCentavos: number; removido: boolean };
export type Totais = { quantidade: number; centavos: number };
export type ResumoAutorizacao = {
  titulos: Totais;
  antecipacoes: Totais;
  /** Pagamentos extras (fora do Consistem). */
  extras: Totais;
  /** Títulos + antecipações (o que existe no Consistem). */
  lancamentos: Totais;
  /** Tudo: lançamentos + extras. É o total autorizado. */
  geral: Totais;
  baixados: number;
  /** Itens ainda não baixados que já constam confirmados no Consistem (CCFFB014): prontos para o borderô. */
  confirmados: number;
  /** Itens ainda não baixados e sem confirmação no Consistem: o financeiro precisa confirmá-los no CCFFB014. */
  faltaConfirmar: number;
  removidos: number;
};

export function resumirItens(itens: readonly ItemResumo[], extras: readonly ExtraResumo[] = []): ResumoAutorizacao {
  const zero = (): Totais => ({ quantidade: 0, centavos: 0 });
  const r: ResumoAutorizacao = { titulos: zero(), antecipacoes: zero(), extras: zero(), lancamentos: zero(), geral: zero(), baixados: 0, confirmados: 0, faltaConfirmar: 0, removidos: 0 };
  const somar = (t: Totais, centavos: number) => { t.quantidade++; t.centavos += centavos; };
  for (const i of itens) {
    if (i.removido) {
      r.removidos++;
      continue;
    }
    somar(i.tipo === "titulo" ? r.titulos : r.antecipacoes, i.valorCentavos);
    somar(r.lancamentos, i.valorCentavos);
    somar(r.geral, i.valorCentavos);
    if (i.baixadoConsistemEm) r.baixados++;
    else if (i.confirmadoConsistemEm) r.confirmados++;
    else r.faltaConfirmar++;
  }
  for (const x of extras) {
    if (x.removido) continue;
    somar(r.extras, x.valorCentavos);
    somar(r.geral, x.valorCentavos);
  }
  return r;
}

// ---------------------------------------------------------------- pagamentos extras

export const LIMITES_EXTRA = { descricaoMin: 3, descricaoMax: 200, favorecidoMin: 2, favorecidoMax: 120, valorMaxCentavos: 10_000_000_000 } as const;

/** Mesmas regras da função de banco cap_incluir_extra; devolve a mensagem de erro ou null quando está tudo certo. */
export function validarExtra(e: { descricao: string; favorecido: string; valorCentavos: number | null }): string | null {
  const descricao = e.descricao.trim();
  const favorecido = e.favorecido.trim();
  if (descricao.length < LIMITES_EXTRA.descricaoMin || descricao.length > LIMITES_EXTRA.descricaoMax) return `Informe a descrição do pagamento (${LIMITES_EXTRA.descricaoMin} a ${LIMITES_EXTRA.descricaoMax} caracteres).`;
  if (favorecido.length < LIMITES_EXTRA.favorecidoMin || favorecido.length > LIMITES_EXTRA.favorecidoMax) return `Informe o favorecido (quem recebe), com ${LIMITES_EXTRA.favorecidoMin} a ${LIMITES_EXTRA.favorecidoMax} caracteres.`;
  if (e.valorCentavos === null || !Number.isInteger(e.valorCentavos) || e.valorCentavos <= 0) return "Valor inválido: informe um valor maior que zero, ex.: 1.234,56.";
  if (e.valorCentavos > LIMITES_EXTRA.valorMaxCentavos) return "Valor acima do limite.";
  return null;
}

const reais = (centavos: number) => {
  const [inteiro, frac] = (Math.abs(centavos) / 100).toFixed(2).split(".");
  return `${centavos < 0 ? "-" : ""}R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};

/** Título da pendência da Fila do dia (igual ao gravado por cap_autorizar). */
export const tituloPendenciaExecucao = (codigo: string, totalCentavos: number): string =>
  `Executar autorização de pagamento ${codigo} — ${reais(totalCentavos)}`;

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** Prazo da execução: o menor vencimento (ou pagamento programado) dos itens; se já passou, hoje. */
export function prazoExecucao(datas: readonly (string | null)[], hoje: string): string {
  const validas = datas.filter((d): d is string => d !== null).sort();
  const menor = validas[0] ?? hoje;
  return menor < hoje ? hoje : menor;
}

export const criticidadeExecucao = (prazo: string, hoje: string): "alta" | "normal" => (diasEntre(prazo, hoje) <= 3 ? "alta" : "normal");

/** Rótulo curto da linha do item na autorização. */
export function situacaoDoItem(i: { removido: boolean; baixadoConsistemEm: string | null; tipo: "titulo" | "antecipacao"; confirmadoConsistemEm?: string | null }): string {
  if (i.removido) return "removido";
  if (i.baixadoConsistemEm) return i.tipo === "antecipacao" ? "abatida por NF no Consistem" : "baixado no Consistem";
  if (i.confirmadoConsistemEm) return "confirmado no Consistem";
  return "em aberto no Consistem";
}

const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

export type ItemParaConfirmar = {
  tipo: "titulo" | "antecipacao"; fornecedor: string; numDocumento: string | null; codLancamento: string;
  vencimento: string | null; dataPagamento: string | null; valorCentavos: number; removido: boolean; baixadoConsistemEm: string | null; confirmadoConsistemEm: string | null;
};

/**
 * Lista do que o financeiro ainda precisa confirmar no Consistem (CCFFB014): itens ativos, não baixados e sem confirmação,
 * uma linha por item, para copiar e marcar na tela do ERP. Vazia quando não falta nada.
 */
export function textoFaltaConfirmar(itens: readonly ItemParaConfirmar[]): string {
  const faltam = itens.filter((i) => !i.removido && !i.baixadoConsistemEm && !i.confirmadoConsistemEm);
  const ordenados = [...faltam].sort((a, b) => a.fornecedor.localeCompare(b.fornecedor, "pt-BR") || (a.numDocumento ?? "").localeCompare(b.numDocumento ?? "", "pt-BR"));
  return ordenados.map((i) => {
    const data = i.tipo === "antecipacao" ? i.dataPagamento : i.vencimento;
    return `${i.fornecedor} · ${i.tipo === "antecipacao" ? "antecipação " : ""}${i.numDocumento || `lanç. ${i.codLancamento}`}${data ? ` · ${dataBr(data)}` : ""} · ${reais(i.valorCentavos)}`;
  }).join("\n");
}

// ---------------------------------------------------------------- caixa disponível

/** Valor em reais digitado ("1.234,56", "1234.56", "R$ 1.234") → centavos; null se vazio ou inválido. */
export function parseReais(texto: string): number | null {
  let s = texto.replace(/[R$\s]/g, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{3}$/.test(s) && (s.match(/\./g) ?? []).length >= 1 && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, ""); // "50.000" = cinquenta mil
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(Number((n * 100).toFixed(6)));
}

export type ComparacaoCaixa = { caixaCentavos: number; sobraCentavos: number; excedenteCentavos: number; ultrapassa: boolean } | null;

/** Compara o total (selecionado ou autorizado) com o caixa informado. Ultrapassar é aviso, nunca bloqueio. */
export function compararComCaixa(totalCentavos: number, caixaCentavos: number | null): ComparacaoCaixa {
  if (caixaCentavos === null) return null;
  const diferenca = caixaCentavos - totalCentavos;
  return { caixaCentavos, sobraCentavos: Math.max(diferenca, 0), excedenteCentavos: Math.max(-diferenca, 0), ultrapassa: diferenca < 0 };
}

// ---------------------------------------------------------------- rascunho em montagem

/** Autorização mais recente da empresa ainda em rascunho: é onde "Salvar parcial" e "Extras" da tela de seleção gravam. */
export type RascunhoEmMontagem = {
  id: string;
  codigo: string;
  empresaId: string;
  itens: number;
  extras: number;
  /** Total do rascunho (itens + extras). */
  totalCentavos: number;
  totalExtrasCentavos: number;
  caixaCentavos: number | null;
  observacao: string | null;
};

/** "Rascunho 111026 em montagem: 3 itens · R$ X + 1 extra · R$ Y" (sem a parte dos extras quando não há). */
export function descreverRascunho(r: Pick<RascunhoEmMontagem, "codigo" | "itens" | "extras" | "totalCentavos" | "totalExtrasCentavos">): string {
  const itens = `${r.itens} ${r.itens === 1 ? "item" : "itens"} · ${reais(r.totalCentavos - r.totalExtrasCentavos)}`;
  const extras = r.extras > 0 ? ` + ${r.extras} ${r.extras === 1 ? "extra" : "extras"} · ${reais(r.totalExtrasCentavos)}` : "";
  return `Rascunho ${r.codigo} em montagem: ${itens}${extras}`;
}

/** O que se compara com o caixa na tela de seleção: o rascunho em montagem mais o que está marcado agora. */
export const totalParaCaixa = (rascunho: Pick<RascunhoEmMontagem, "totalCentavos"> | null, marcadosCentavos: number): number =>
  (rascunho?.totalCentavos ?? 0) + marcadosCentavos;

// ---------------------------------------------------------------- Slack

export type DadosMensagemSlack = {
  codigo: string;
  data: string; // dd/mm/aaaa
  empresa: string;
  status: StatusAutorizacao;
  titulos: Totais;
  antecipacoes: Totais;
  /** Pagamentos extras (fora do Consistem); opcional para quem não tem. */
  extras?: Totais;
  totalCentavos: number;
  caixa: ComparacaoCaixa;
  autorizadaPor: string | null;
  observacao: string | null;
  link: string;
};

/** Texto que o diretor cola no canal do financeiro. O sistema nunca envia: só copia e abre o Slack. */
export function mensagemSlack(d: DadosMensagemSlack): string {
  const linhas = [
    `*Autorização de pagamento ${d.codigo}* · ${d.empresa} · ${d.data}${d.status !== "autorizada" ? ` · ${ROTULO_STATUS[d.status].toUpperCase()}` : ""}`,
    `Títulos: ${d.titulos.quantidade} (${reais(d.titulos.centavos)}) · Antecipações: ${d.antecipacoes.quantidade} (${reais(d.antecipacoes.centavos)})${d.extras && d.extras.quantidade > 0 ? ` · Extras (fora do Consistem): ${d.extras.quantidade} (${reais(d.extras.centavos)})` : ""}`,
    `*Total autorizado: ${reais(d.totalCentavos)}*`,
  ];
  if (d.caixa) {
    linhas.push(`Caixa disponível: ${reais(d.caixa.caixaCentavos)} · ${d.caixa.ultrapassa ? `*Ultrapassa em ${reais(d.caixa.excedenteCentavos)}*` : `Sobra ${reais(d.caixa.sobraCentavos)}`}`);
  }
  if (d.observacao) linhas.push(`Obs.: ${d.observacao}`);
  if (d.autorizadaPor) linhas.push(`Autorizada por ${d.autorizadaPor}.`);
  linhas.push(`Relatório e itens: ${d.link}`);
  return linhas.join("\n");
}
