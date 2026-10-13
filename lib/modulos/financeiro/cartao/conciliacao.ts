// Conciliação da fatura do cartão × títulos do Contas a Pagar — porta fiel de `scripts/conciliar.py` da skill
// conciliacao-fatura-cartao (calibrada com a fatura Nubank 06/2026). Regras em docs/modulos/financeiro-cartao.md, seção 5.
//
// Quatro fases: (1) compensação de pares que se anulam (IOF × "IOF de volta", estorno × relançamento); (2) casamento exato
// por valor; (3) casamento com tolerância de centavos (arredondamento de desdobramento); (4) agrupamento (várias linhas iguais
// da fatura num título só). O VALOR é a chave real; a semelhança de texto só desempata. O que sobra da fatura é classificado
// (estorno → encargo → parcela > 1 → dicionário → não identificado) e vira sugestão de lançamento; o título que sobra vira
// divergência com a causa provável. Regra de ouro: nunca classificar por aproximação — na dúvida, [CONFERIR].
import { identificarCartaoDoTitulo, montarComplemento, type CartaoInfo } from "./cartoes";
import { normalizar, semelhanca } from "./texto";

export const TOLERANCIA_PADRAO = 5;      // centavos — desdobramento arredondado
export const JANELA_VENCIMENTO = 5;      // dias — vencimento nominal × dia útil efetivo
export const LIMIAR_SEMELHANCA = 0.45;   // abaixo disso o casamento por valor é "fraco" (conferir descrição)
export const LIMIAR_COMPENSACAO = 0.6;   // mínimo para considerar que o estorno se refere à compra
export const CONFERIR = "[CONFERIR]";

const ENCARGOS = ["IOF", "ANUIDADE", "TARIFA", "JUROS", "MULTA", "ENCARGO", "SEGURO", "MORA", "ROTATIVO", "PARCELAMENTO DE FATURA"];

export type LinhaFatura = {
  id: string;
  ordem: number;
  dataCompra: string | null;
  descricao: string;
  valorCentavos: number;
  parcelaNum: number | null;
  parcelaTotal: number | null;
};

export type TituloPagar = {
  id: string;
  /** Código do lançamento no Consistem (codLancamento). */
  codLancamento?: string;
  numeroTitulo: string;
  fornecedor: string;
  vencimento: string | null;
  complemento: string;
  /** "Descrição Conta" (conta de fluxo) do título, quando conhecida. */
  tipoTitulo: string;
  valorCentavos: number;
  /** O título está no borderô do fechamento do cartão (lido da API). */
  emBordero?: boolean;
  /** Código do fornecedor no Consistem. */
  codFornecedor?: string | null;
  /** Banco/portador atual do título no Consistem (lido da API). */
  codBanco?: string | null;
  /** Entrou na fatura só pela regra do fornecedor no Neo Fiscal (o complemento não cita o cartão). */
  porRegra?: boolean;
  /** Cartão da regra do fornecedor no Neo Fiscal na data da compra, quando há regra. */
  cartaoDaRegra?: string | null;
  /** Antecipação a fornecedor (tipo A) paga no cartão; `vencimento` é a data de pagamento. */
  antecipacao?: boolean;
};

export type Estabelecimento = { padrao: string; categoria: string; contaFluxo: string | null };

export const NATUREZAS = ["Estorno / crédito", "Encargo financeiro", "Parcela não desdobrada", "Despesa sem nota fiscal", "Não identificado"] as const;
export type Natureza = (typeof NATUREZAS)[number];

// ---------------------------------------------------------------- decisões por item (Fase 2b; tabela crt_decisoes)

export const TIPOS_DECISAO = ["classificar", "justificar", "casar", "compensar", "observar"] as const;
export type TipoDecisao = (typeof TIPOS_DECISAO)[number];
export const ROTULO_DECISAO: Record<TipoDecisao, string> = {
  classificar: "Classificação", justificar: "Justificativa", casar: "Casamento à mão", compensar: "Compensação à mão", observar: "Observação",
};
export type DecisaoItem = {
  id: string;
  tipo: TipoDecisao;
  /** Ids das linhas da fatura (crt_fatura_linhas.id). */
  linhas: string[];
  /** Códigos dos lançamentos no Consistem. */
  titulos: string[];
  categoria: string | null;
  contaFluxo: string | null;
  motivo: string | null;
  autor: string | null;
  em: string;
};

export type ItemALancar = {
  linha: LinhaFatura;
  natureza: Natureza;
  categoria: string;
  contaFluxo: string;
  parcelas: number;
  vencimento: string;
  complementoSugerido: string;
  /** Decisão "justificar": a linha não gera título novo e deixa de ser pendente. */
  justificativa?: DecisaoItem;
  /** Decisão "classificar" aplicada (categoria/conta trocadas). */
  classificacao?: DecisaoItem;
  observacoes?: DecisaoItem[];
};
export type Modo = "Exato" | "Arredondamento" | "Agrupado" | "Manual" | "Antecipação";
export type Aderencia = "OK" | "Conferir descrição" | "ALERTA: complemento cita outro cartão" | "Conferir: antecipação sem o cartão no texto";
export type Conciliado = {
  /** Linhas da fatura casadas com o título (uma, ou várias no agrupamento). */
  linhas: LinhaFatura[];
  titulo: TituloPagar;
  modo: Modo;
  /** Diferença fatura − título em centavos (só no arredondamento). */
  diferencaCentavos: number;
  semelhanca: number;
  aderencia: Aderencia;
  /** Casamento à mão: os demais títulos do casamento e a decisão. */
  titulosExtras?: TituloPagar[];
  decisao?: DecisaoItem;
};
export type Divergencia = { titulo: TituloPagar; causa: string; justificativa?: DecisaoItem; observacoes?: DecisaoItem[] };
export type Compensado = { credito: LinhaFatura; debito: LinhaFatura; outras?: LinhaFatura[]; decisao?: DecisaoItem };
/** Decisão que não teve efeito nesta apuração (o item sumiu, já foi resolvido ou o título saiu da janela). */
export type DecisaoSemEfeito = { decisao: DecisaoItem; motivo: string };
export type LinhaQuadro = { rotulo: string; centavos: number; destaque?: boolean };

export type ResultadoConciliacao = {
  cartao: CartaoInfo;
  vencimento: string;
  totalInformadoCentavos: number;
  somaLinhasCentavos: number;
  integridadeOk: boolean;
  totalTitulosCentavos: number;
  diferencaCentavos: number;
  residuoCentavos: number;
  porNatureza: Record<Natureza, number>;
  /** Soma das diferenças dos casamentos com tolerância (fatura − título): acertadas como desconto na baixa. */
  arredondamentoCentavos: number;
  /** Soma das diferenças dos casamentos à mão (fatura − títulos), justificadas pela decisão. */
  ajusteManualCentavos: number;
  /** Itens a lançar SEM justificativa: o que impede o fechamento. */
  pendentes: number;
  decisoes: DecisaoItem[];
  decisoesSemEfeito: DecisaoSemEfeito[];
  orfaosCentavos: number;
  conciliados: Conciliado[];
  compensados: Compensado[];
  aLancar: ItemALancar[];
  divergencias: Divergencia[];
  quadro: LinhaQuadro[];
  contagens: { linhas: number; compensados: number; titulos: number; conciliados: number; agrupamentos: number; manuais: number; aLancar: number; pendentes: number; divergencias: number; cartaoDivergente: number };
};

export type EntradaConciliacao = {
  cartao: CartaoInfo;
  cartoes: readonly CartaoInfo[];
  /** Vencimento efetivo da fatura ('AAAA-MM-DD'). */
  vencimento: string;
  totalInformadoCentavos: number;
  /** Linhas da fatura que são despesa do ciclo (as descartadas ficam de fora). */
  linhas: readonly LinhaFatura[];
  titulos: readonly TituloPagar[];
  estabelecimentos: readonly Estabelecimento[];
  toleranciaCentavos?: number;
  /** Decisões ativas da fatura. */
  decisoes?: readonly DecisaoItem[];
  /** Títulos da janela que citam outro cartão (ou ambíguos): só entram se uma decisão "casar" os pegar (cartão trocado). */
  titulosExtras?: readonly TituloPagar[];
  /**
   * Antecipações pagas na janela que NÃO citam o cartão nem têm regra do fornecedor: casam sozinhas só com linha da fatura que
   * sobrou e tem o MESMO valor em centavos (modo "Antecipação", conferir); ou por decisão "casar".
   */
  antecipacoes?: readonly TituloPagar[];
};

/** Chave do título nas decisões: o código do lançamento no Consistem (ou o id, quando não há). */
export const chaveTitulo = (t: TituloPagar) => t.codLancamento ?? t.id;

// ---------------------------------------------------------------- compensação

/** Objeto de uma linha que pode se anular com outra: sem os prefixos "IOF de", "IOF de volta de", "Estorno de". */
export function assuntoCompensavel(descricao: string): string {
  let d = normalizar(descricao);
  d = d.replace(/^IOF DE VOLTA DE\s*/, "").replace(/^IOF DE\s*/, "").replace(/^ESTORNO DE\s*/, "");
  return d.replace(/^["']+|["']+$/g, "").trim();
}

/**
 * Remove pares que se anulam (negativa e positiva de mesmo valor absoluto sobre o mesmo objeto). Estorno SEM contrapartida
 * positiva permanece: é crédito real a abater no Contas a Pagar.
 */
export function compensarEstornos(linhas: readonly LinhaFatura[]): { restantes: LinhaFatura[]; compensados: Compensado[] } {
  const negativas = linhas.filter((l) => l.valorCentavos < 0).sort((a, b) => a.valorCentavos - b.valorCentavos);
  const positivas = linhas.filter((l) => l.valorCentavos > 0);
  const usadas = new Set<string>();
  const compensados: Compensado[] = [];
  for (const neg of negativas) {
    const alvo = assuntoCompensavel(neg.descricao);
    if (!alvo) continue;
    let melhor: LinhaFatura | null = null, melhorSim = 0;
    for (const pos of positivas) {
      if (usadas.has(pos.id) || pos.valorCentavos !== -neg.valorCentavos) continue;
      const sim = semelhanca(assuntoCompensavel(pos.descricao), alvo);
      if (sim > melhorSim) { melhor = pos; melhorSim = sim; }
    }
    if (melhor && melhorSim >= LIMIAR_COMPENSACAO) {
      usadas.add(melhor.id); usadas.add(neg.id);
      compensados.push({ credito: neg, debito: melhor });
    }
  }
  return { restantes: linhas.filter((l) => !usadas.has(l.id)), compensados };
}

// ---------------------------------------------------------------- casamento

type Casamento = { linhas: LinhaFatura[]; titulo: TituloPagar; modo: Modo; diferencaCentavos: number; semelhanca: number };

/** Três passes: valor exato (desempate pela descrição) → tolerância de centavos → várias linhas iguais num título só. */
export function casar(linhas: readonly LinhaFatura[], titulos: readonly TituloPagar[], tolerancia: number): { casamentos: Casamento[]; linhasSemTitulo: LinhaFatura[]; titulosSemLinha: TituloPagar[] } {
  const casadosL = new Set<string>(), casadosT = new Set<string>();
  const casamentos: Casamento[] = [];
  const sim = (l: LinhaFatura, t: TituloPagar) => semelhanca(l.descricao, t.complemento);

  for (const linha of linhas) {
    const cand = titulos.filter((t) => !casadosT.has(t.id) && t.valorCentavos === linha.valorCentavos);
    if (cand.length === 0) continue;
    const t = cand.reduce((m, c) => (sim(linha, c) > sim(linha, m) ? c : m));
    casadosT.add(t.id); casadosL.add(linha.id);
    casamentos.push({ linhas: [linha], titulo: t, modo: "Exato", diferencaCentavos: 0, semelhanca: sim(linha, t) });
  }
  for (const linha of linhas) {
    if (casadosL.has(linha.id)) continue;
    const cand = titulos.filter((t) => !casadosT.has(t.id) && Math.abs(t.valorCentavos - linha.valorCentavos) <= tolerancia);
    if (cand.length === 0) continue;
    const t = cand.reduce((m, c) => (Math.abs(c.valorCentavos - linha.valorCentavos) < Math.abs(m.valorCentavos - linha.valorCentavos) ? c : m));
    casadosT.add(t.id); casadosL.add(linha.id);
    casamentos.push({ linhas: [linha], titulo: t, modo: "Arredondamento", diferencaCentavos: linha.valorCentavos - t.valorCentavos, semelhanca: sim(linha, t) });
  }
  const grupos = new Map<string, LinhaFatura[]>();
  for (const linha of linhas) {
    if (casadosL.has(linha.id)) continue;
    const chave = normalizar(linha.descricao);
    grupos.set(chave, [...(grupos.get(chave) ?? []), linha]);
  }
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const soma = grupo.reduce((s, l) => s + l.valorCentavos, 0);
    const t = titulos.find((x) => !casadosT.has(x.id) && Math.abs(x.valorCentavos - soma) <= tolerancia);
    if (!t) continue;
    casadosT.add(t.id);
    for (const l of grupo) casadosL.add(l.id);
    casamentos.push({ linhas: grupo, titulo: t, modo: "Agrupado", diferencaCentavos: soma - t.valorCentavos, semelhanca: 1 });
  }
  return { casamentos, linhasSemTitulo: linhas.filter((l) => !casadosL.has(l.id)), titulosSemLinha: titulos.filter((t) => !casadosT.has(t.id)) };
}

// ---------------------------------------------------------------- classificação

/** Estabelecimento do dicionário cuja chave aparece na descrição (a chave mais longa vence). */
export function doDicionario<E extends Pick<Estabelecimento, "padrao">>(descricao: string, dicionario: readonly E[]): E | null {
  const d = normalizar(descricao);
  let melhor: E | null = null;
  for (const e of dicionario) {
    const p = normalizar(e.padrao);
    if (p && d.includes(p) && (!melhor || p.length > normalizar(melhor.padrao).length)) melhor = e;
  }
  return melhor;
}
const contaDe = (e: Estabelecimento | null) => (e?.contaFluxo && !e.contaFluxo.includes("[A PREENCHER]") ? e.contaFluxo : "");

export function classificar(linha: LinhaFatura, dicionario: readonly Estabelecimento[]): { natureza: Natureza; categoria: string; contaFluxo: string } {
  const desc = normalizar(linha.descricao);
  const e = doDicionario(linha.descricao, dicionario);
  if (linha.valorCentavos < 0) return { natureza: "Estorno / crédito", categoria: "Estorno", contaFluxo: "" };
  if (ENCARGOS.some((t) => desc.includes(t))) return { natureza: "Encargo financeiro", categoria: "Encargo financeiro", contaFluxo: contaDe(e) };
  if (linha.parcelaNum !== null && linha.parcelaNum > 1) return { natureza: "Parcela não desdobrada", categoria: e?.categoria ?? "", contaFluxo: contaDe(e) };
  if (e?.categoria) return { natureza: "Despesa sem nota fiscal", categoria: e.categoria, contaFluxo: contaDe(e) };
  return { natureza: "Não identificado", categoria: "", contaFluxo: "" };
}

/** O complemento do título cita um cartão diferente do conciliado (tolerante a grafia: "NUBANCK" não é cartão trocado). */
export function cartaoDivergente(titulo: Pick<TituloPagar, "complemento" | "vencimento" | "cartaoDaRegra">, cartao: CartaoInfo, cartoes: readonly CartaoInfo[]): boolean {
  if (titulo.cartaoDaRegra && titulo.cartaoDaRegra !== cartao.codigo) return true;   // a regra do Neo Fiscal manda outro cartão
  const id = identificarCartaoDoTitulo({ complemento: titulo.complemento, vencimento: titulo.vencimento }, cartoes);
  if (id.situacao === "cartao") return id.cartao!.codigo !== cartao.codigo;
  if (id.situacao === "ambiguo") return !id.candidatos.some((c) => c.codigo === cartao.codigo);
  return false;
}

const diasEntre = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);

export function causaDivergencia(titulo: TituloPagar, cartao: CartaoInfo, cartoes: readonly CartaoInfo[], vencimento: string, titulos: readonly TituloPagar[]): string {
  if (titulo.cartaoDaRegra && titulo.cartaoDaRegra !== cartao.codigo) return `A regra do fornecedor no Neo Fiscal é o cartão ${titulo.cartaoDaRegra} — possível cartão trocado`;
  if (cartaoDivergente(titulo, cartao, cartoes)) return "Complemento cita cartão diferente — possível cartão trocado";
  if (titulo.porRegra) return "Fornecedor pago neste cartão pela regra do Neo Fiscal, mas sem linha na fatura — confirmar se esta compra foi no cartão";
  if (titulos.filter((t) => t.valorCentavos === titulo.valorCentavos).length > 1) return "Outro título de mesmo valor no ciclo — possível duplicidade";
  if (titulo.vencimento && Math.abs(diasEntre(titulo.vencimento, vencimento)) > JANELA_VENCIMENTO) return "Vencimento fora da janela do vencimento da fatura";
  return "Sem correspondência na fatura — apurar antes de qualquer exclusão";
}

// ---------------------------------------------------------------- conciliação

export function conciliar(e: EntradaConciliacao): ResultadoConciliacao {
  const tolerancia = e.toleranciaCentavos ?? TOLERANCIA_PADRAO;
  const decisoes = [...(e.decisoes ?? [])];
  const semEfeito: DecisaoSemEfeito[] = [];
  const linhaPorId = new Map(e.linhas.map((l) => [l.id, l]));
  const usadasL = new Set<string>();
  const usadosT = new Set<string>();
  const titulosDoCartao = [...e.titulos];
  const extrasPorChave = new Map([...(e.titulosExtras ?? []), ...(e.antecipacoes ?? [])].map((t) => [chaveTitulo(t), t]));

  // 1) Compensações à mão (linhas que somam zero).
  const compensadosManuais: Compensado[] = [];
  for (const d of decisoes.filter((x) => x.tipo === "compensar")) {
    const ls = d.linhas.map((id) => linhaPorId.get(id));
    if (ls.some((l) => !l || usadasL.has(l.id))) { semEfeito.push({ decisao: d, motivo: "Uma das linhas não está mais disponível." }); continue; }
    const lista = ls as LinhaFatura[];
    if (lista.reduce((s, l) => s + l.valorCentavos, 0) !== 0) { semEfeito.push({ decisao: d, motivo: "As linhas não somam zero." }); continue; }
    lista.forEach((l) => usadasL.add(l.id));
    const credito = lista.find((l) => l.valorCentavos < 0) ?? lista[0];
    const debito = lista.find((l) => l !== credito && l.valorCentavos > 0) ?? lista.find((l) => l !== credito)!;
    compensadosManuais.push({ credito, debito, outras: lista.filter((l) => l !== credito && l !== debito), decisao: d });
  }

  // 2) Casamentos à mão (linhas ↔ títulos; o título pode vir dos "outros cartões": cartão trocado).
  const casamentosManuais: Casamento[] = [];
  const decisoesCasar: DecisaoItem[] = [];
  for (const d of decisoes.filter((x) => x.tipo === "casar")) {
    const ls = d.linhas.map((id) => linhaPorId.get(id));
    const ts = d.titulos.map((c) => titulosDoCartao.find((t) => chaveTitulo(t) === c) ?? extrasPorChave.get(c));
    if (ls.some((l) => !l || usadasL.has(l.id))) { semEfeito.push({ decisao: d, motivo: "Uma das linhas não está mais disponível." }); continue; }
    if (ts.some((t) => !t || usadosT.has(chaveTitulo(t)))) { semEfeito.push({ decisao: d, motivo: "Um dos títulos não está mais na janela do vencimento." }); continue; }
    const linhasC = ls as LinhaFatura[];
    const titulosC = ts as TituloPagar[];
    linhasC.forEach((l) => usadasL.add(l.id));
    for (const t of titulosC) {
      usadosT.add(chaveTitulo(t));
      if (!titulosDoCartao.includes(t)) titulosDoCartao.push(t);   // título de outro cartão casado à mão passa a contar nesta fatura
    }
    const diferenca = linhasC.reduce((s, l) => s + l.valorCentavos, 0) - titulosC.reduce((s, t) => s + t.valorCentavos, 0);
    casamentosManuais.push({ linhas: linhasC, titulo: titulosC[0], modo: "Manual", diferencaCentavos: diferenca, semelhanca: 1 });
    decisoesCasar.push(d);
  }

  // 3) Cruzamento automático no que sobrou.
  const { restantes, compensados: compensadosAuto } = compensarEstornos(e.linhas.filter((l) => !usadasL.has(l.id)));
  const auto = casar(restantes, titulosDoCartao.filter((t) => !usadosT.has(chaveTitulo(t))), tolerancia);
  const compensados = [...compensadosManuais, ...compensadosAuto];
  const casamentos = auto.casamentos;
  const { titulosSemLinha } = auto;

  // 3b) Antecipações sem o cartão no texto: só valor idêntico, uma para uma, com linha que sobrou (conferir).
  const casamentosAntecipacao: Casamento[] = [];
  const antecipacoesLivres = (e.antecipacoes ?? []).filter((a) => !usadosT.has(chaveTitulo(a)));
  const linhasSemTitulo: LinhaFatura[] = [];
  for (const l of auto.linhasSemTitulo) {
    const a = l.valorCentavos > 0 ? antecipacoesLivres.find((x) => !usadosT.has(chaveTitulo(x)) && x.valorCentavos === l.valorCentavos) : undefined;
    if (!a) { linhasSemTitulo.push(l); continue; }
    usadosT.add(chaveTitulo(a));
    titulosDoCartao.push(a);
    casamentosAntecipacao.push({ linhas: [l], titulo: a, modo: "Antecipação", diferencaCentavos: 0, semelhanca: semelhanca(l.descricao, a.complemento) });
  }

  // 4) Decisões sobre os itens que restaram.
  const ativasPorLinha = (id: string, tipo: TipoDecisao) => decisoes.filter((d) => d.tipo === tipo && d.linhas.includes(id));
  const ativasPorTitulo = (t: TituloPagar, tipo: TipoDecisao) => decisoes.filter((d) => d.tipo === tipo && d.titulos.includes(chaveTitulo(t)));

  const porNatureza = Object.fromEntries(NATUREZAS.map((n) => [n, 0])) as Record<Natureza, number>;
  const aLancar: ItemALancar[] = linhasSemTitulo.map((linha) => {
    const c = classificar(linha, e.estabelecimentos);
    porNatureza[c.natureza] += linha.valorCentavos;
    const parcelas = linha.parcelaTotal ?? 1;
    const classificacao = ativasPorLinha(linha.id, "classificar").at(-1);
    const justificativa = ativasPorLinha(linha.id, "justificar")[0];
    const observacoes = ativasPorLinha(linha.id, "observar");
    return {
      linha, natureza: c.natureza,
      categoria: classificacao?.categoria || c.categoria || CONFERIR, contaFluxo: classificacao?.contaFluxo || c.contaFluxo || CONFERIR,
      parcelas, vencimento: e.vencimento,
      complementoSugerido: montarComplemento(e.cartao, parcelas, normalizar(linha.descricao).slice(0, 60)),
      ...(classificacao ? { classificacao } : {}), ...(justificativa ? { justificativa } : {}), ...(observacoes.length ? { observacoes } : {}),
    };
  });

  const conciliados: Conciliado[] = [
    ...casamentosManuais.map((c, i): Conciliado => {
      const d = decisoesCasar[i];
      const todos = d.titulos.map((k) => titulosDoCartao.find((t) => chaveTitulo(t) === k)!);
      return { ...c, aderencia: "OK", titulosExtras: todos.slice(1), decisao: d };
    }),
    ...casamentosAntecipacao.map((c): Conciliado => ({ ...c, aderencia: "Conferir: antecipação sem o cartão no texto" })),
    ...casamentos.map((c): Conciliado => ({
      ...c,
      aderencia: cartaoDivergente(c.titulo, e.cartao, e.cartoes) ? "ALERTA: complemento cita outro cartão" : c.modo === "Agrupado" || c.semelhanca >= LIMIAR_SEMELHANCA ? "OK" : "Conferir descrição",
    })),
  ];
  const divergencias: Divergencia[] = titulosSemLinha.map((titulo) => {
    const justificativa = ativasPorTitulo(titulo, "justificar")[0];
    const observacoes = ativasPorTitulo(titulo, "observar");
    return { titulo, causa: causaDivergencia(titulo, e.cartao, e.cartoes, e.vencimento, titulosDoCartao), ...(justificativa ? { justificativa } : {}), ...(observacoes.length ? { observacoes } : {}) };
  });

  // Justificativa sem item correspondente (o item foi resolvido pelo cruzamento ou sumiu): sem efeito.
  for (const d of decisoes.filter((x) => x.tipo === "justificar")) {
    const alvoLinha = d.linhas[0] && aLancar.some((a) => a.linha.id === d.linhas[0]);
    const alvoTitulo = d.titulos[0] && divergencias.some((v) => chaveTitulo(v.titulo) === d.titulos[0]);
    if (!alvoLinha && !alvoTitulo) semEfeito.push({ decisao: d, motivo: "O item já foi resolvido pelo cruzamento (ou não está mais na fatura)." });
  }

  const somaLinhasCentavos = e.linhas.reduce((s, l) => s + l.valorCentavos, 0);
  const totalTitulosCentavos = titulosDoCartao.reduce((s, t) => s + t.valorCentavos, 0);
  const diferencaCentavos = e.totalInformadoCentavos - totalTitulosCentavos;
  const orfaosCentavos = titulosSemLinha.reduce((s, t) => s + t.valorCentavos, 0);
  const justificado = NATUREZAS.reduce((s, n) => s + porNatureza[n], 0);
  const arredondamentoCentavos = casamentos.reduce((s, c) => s + c.diferencaCentavos, 0);
  const ajusteManualCentavos = casamentosManuais.reduce((s, c) => s + c.diferencaCentavos, 0);
  const residuoCentavos = diferencaCentavos - justificado - arredondamentoCentavos - ajusteManualCentavos + orfaosCentavos;
  const pendentes = aLancar.filter((a) => !a.justificativa).length;
  const cartaoDivergenteN = conciliados.filter((c) => c.aderencia.startsWith("ALERTA")).length;

  const quadro: LinhaQuadro[] = [
    { rotulo: "Total da fatura (documento do emissor)", centavos: e.totalInformadoCentavos },
    { rotulo: "(–) Total dos títulos lançados no Contas a Pagar", centavos: totalTitulosCentavos },
    { rotulo: "(=) Diferença apurada", centavos: diferencaCentavos, destaque: true },
    ...NATUREZAS.map((n) => ({ rotulo: `Justificativa: ${n.toLowerCase()}`, centavos: porNatureza[n] })),
    { rotulo: "Justificativa: arredondamento de desdobramento (acertar como desconto na baixa)", centavos: arredondamentoCentavos },
    { rotulo: "Justificativa: diferença de casamentos à mão (decisão registrada)", centavos: ajusteManualCentavos },
    { rotulo: "(–) Títulos sem correspondência na fatura", centavos: orfaosCentavos },
    { rotulo: "(=) DIFERENÇA NÃO JUSTIFICADA — deve ser zero", centavos: residuoCentavos, destaque: true },
  ];

  return {
    cartao: e.cartao, vencimento: e.vencimento, totalInformadoCentavos: e.totalInformadoCentavos, somaLinhasCentavos,
    integridadeOk: somaLinhasCentavos === e.totalInformadoCentavos, totalTitulosCentavos, diferencaCentavos, residuoCentavos, porNatureza, arredondamentoCentavos,
    ajusteManualCentavos, pendentes, decisoes, decisoesSemEfeito: semEfeito, orfaosCentavos,
    conciliados, compensados, aLancar, divergencias, quadro,
    contagens: {
      linhas: e.linhas.length, compensados: compensados.length, titulos: titulosDoCartao.length,
      conciliados: casamentos.filter((c) => c.modo !== "Agrupado").length + casamentosAntecipacao.length, agrupamentos: casamentos.filter((c) => c.modo === "Agrupado").length,
      manuais: casamentosManuais.length, aLancar: aLancar.length, pendentes, divergencias: divergencias.length, cartaoDivergente: cartaoDivergenteN,
    },
  };
}
