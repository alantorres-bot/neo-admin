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
};

export type Estabelecimento = { padrao: string; categoria: string; contaFluxo: string | null };

export const NATUREZAS = ["Estorno / crédito", "Encargo financeiro", "Parcela não desdobrada", "Despesa sem nota fiscal", "Não identificado"] as const;
export type Natureza = (typeof NATUREZAS)[number];

export type ItemALancar = {
  linha: LinhaFatura;
  natureza: Natureza;
  categoria: string;
  contaFluxo: string;
  parcelas: number;
  vencimento: string;
  complementoSugerido: string;
};
export type Modo = "Exato" | "Arredondamento" | "Agrupado";
export type Aderencia = "OK" | "Conferir descrição" | "ALERTA: complemento cita outro cartão";
export type Conciliado = {
  /** Linhas da fatura casadas com o título (uma, ou várias no agrupamento). */
  linhas: LinhaFatura[];
  titulo: TituloPagar;
  modo: Modo;
  /** Diferença fatura − título em centavos (só no arredondamento). */
  diferencaCentavos: number;
  semelhanca: number;
  aderencia: Aderencia;
};
export type Divergencia = { titulo: TituloPagar; causa: string };
export type Compensado = { credito: LinhaFatura; debito: LinhaFatura };
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
  orfaosCentavos: number;
  conciliados: Conciliado[];
  compensados: Compensado[];
  aLancar: ItemALancar[];
  divergencias: Divergencia[];
  quadro: LinhaQuadro[];
  contagens: { linhas: number; compensados: number; titulos: number; conciliados: number; agrupamentos: number; aLancar: number; divergencias: number; cartaoDivergente: number };
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
};

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

function doDicionario(descricao: string, dicionario: readonly Estabelecimento[]): Estabelecimento | null {
  const d = normalizar(descricao);
  let melhor: Estabelecimento | null = null;
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
export function cartaoDivergente(titulo: Pick<TituloPagar, "complemento" | "vencimento">, cartao: CartaoInfo, cartoes: readonly CartaoInfo[]): boolean {
  const id = identificarCartaoDoTitulo({ complemento: titulo.complemento, vencimento: titulo.vencimento }, cartoes);
  if (id.situacao === "cartao") return id.cartao!.codigo !== cartao.codigo;
  if (id.situacao === "ambiguo") return !id.candidatos.some((c) => c.codigo === cartao.codigo);
  return false;
}

const diasEntre = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);

export function causaDivergencia(titulo: TituloPagar, cartao: CartaoInfo, cartoes: readonly CartaoInfo[], vencimento: string, titulos: readonly TituloPagar[]): string {
  if (cartaoDivergente(titulo, cartao, cartoes)) return "Complemento cita cartão diferente — possível cartão trocado";
  if (titulos.filter((t) => t.valorCentavos === titulo.valorCentavos).length > 1) return "Outro título de mesmo valor no ciclo — possível duplicidade";
  if (titulo.vencimento && Math.abs(diasEntre(titulo.vencimento, vencimento)) > JANELA_VENCIMENTO) return "Vencimento fora da janela do vencimento da fatura";
  return "Sem correspondência na fatura — apurar antes de qualquer exclusão";
}

// ---------------------------------------------------------------- conciliação

export function conciliar(e: EntradaConciliacao): ResultadoConciliacao {
  const tolerancia = e.toleranciaCentavos ?? TOLERANCIA_PADRAO;
  const { restantes, compensados } = compensarEstornos(e.linhas);
  const { casamentos, linhasSemTitulo, titulosSemLinha } = casar(restantes, e.titulos, tolerancia);

  const porNatureza = Object.fromEntries(NATUREZAS.map((n) => [n, 0])) as Record<Natureza, number>;
  const aLancar: ItemALancar[] = linhasSemTitulo.map((linha) => {
    const c = classificar(linha, e.estabelecimentos);
    porNatureza[c.natureza] += linha.valorCentavos;
    const parcelas = linha.parcelaTotal ?? 1;
    return {
      linha, natureza: c.natureza, categoria: c.categoria || CONFERIR, contaFluxo: c.contaFluxo || CONFERIR, parcelas, vencimento: e.vencimento,
      complementoSugerido: montarComplemento(e.cartao, parcelas, normalizar(linha.descricao).slice(0, 60)),
    };
  });

  const conciliados: Conciliado[] = casamentos.map((c) => ({
    ...c,
    aderencia: cartaoDivergente(c.titulo, e.cartao, e.cartoes) ? "ALERTA: complemento cita outro cartão" : c.modo === "Agrupado" || c.semelhanca >= LIMIAR_SEMELHANCA ? "OK" : "Conferir descrição",
  }));
  const divergencias: Divergencia[] = titulosSemLinha.map((titulo) => ({ titulo, causa: causaDivergencia(titulo, e.cartao, e.cartoes, e.vencimento, e.titulos) }));

  const somaLinhasCentavos = e.linhas.reduce((s, l) => s + l.valorCentavos, 0);
  const totalTitulosCentavos = e.titulos.reduce((s, t) => s + t.valorCentavos, 0);
  const diferencaCentavos = e.totalInformadoCentavos - totalTitulosCentavos;
  const orfaosCentavos = titulosSemLinha.reduce((s, t) => s + t.valorCentavos, 0);
  const justificado = NATUREZAS.reduce((s, n) => s + porNatureza[n], 0);
  const arredondamentoCentavos = casamentos.reduce((s, c) => s + c.diferencaCentavos, 0);
  const residuoCentavos = diferencaCentavos - justificado - arredondamentoCentavos + orfaosCentavos;
  const cartaoDivergenteN = conciliados.filter((c) => c.aderencia.startsWith("ALERTA")).length;

  const quadro: LinhaQuadro[] = [
    { rotulo: "Total da fatura (documento do emissor)", centavos: e.totalInformadoCentavos },
    { rotulo: "(–) Total dos títulos lançados no Contas a Pagar", centavos: totalTitulosCentavos },
    { rotulo: "(=) Diferença apurada", centavos: diferencaCentavos, destaque: true },
    ...NATUREZAS.map((n) => ({ rotulo: `Justificativa: ${n.toLowerCase()}`, centavos: porNatureza[n] })),
    { rotulo: "Justificativa: arredondamento de desdobramento (acertar como desconto na baixa)", centavos: arredondamentoCentavos },
    { rotulo: "(–) Títulos sem correspondência na fatura", centavos: orfaosCentavos },
    { rotulo: "(=) DIFERENÇA NÃO JUSTIFICADA — deve ser zero", centavos: residuoCentavos, destaque: true },
  ];

  return {
    cartao: e.cartao, vencimento: e.vencimento, totalInformadoCentavos: e.totalInformadoCentavos, somaLinhasCentavos,
    integridadeOk: somaLinhasCentavos === e.totalInformadoCentavos, totalTitulosCentavos, diferencaCentavos, residuoCentavos, porNatureza, arredondamentoCentavos, orfaosCentavos,
    conciliados, compensados, aLancar, divergencias, quadro,
    contagens: {
      linhas: e.linhas.length, compensados: compensados.length, titulos: e.titulos.length,
      conciliados: casamentos.filter((c) => c.modo !== "Agrupado").length, agrupamentos: casamentos.filter((c) => c.modo === "Agrupado").length,
      aLancar: aLancar.length, divergencias: divergencias.length, cartaoDivergente: cartaoDivergenteN,
    },
  };
}
