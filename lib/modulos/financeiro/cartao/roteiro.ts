// Fechamento da fatura passo a passo (regras 65 a 67 de docs/modulos/financeiro-cartao.md). Regra da sequência: primeiro resolver o
// que já existe no Consistem, depois criar o que falta. Os encargos vão primeiro porque nunca têm título anterior.
//
// Trava no risco (decisão do Alan, 21/10/2026): "Lançar compra" e "Lançar selecionadas" ficam travados (a) enquanto houver compra
// parcelada lançada pelo total a desdobrar ou divergência sem decisão e (b) na linha que tem um POSSÍVEL TÍTULO JÁ LANÇADO — um
// título dos "Outros títulos de cartão" ou das divergências com o valor da linha (até 5 centavos) ou ≈ N × parcela (N + 5
// centavos, regra 61). Caso real: NuViagens R$ 822,89 × título 30693 de R$ 822,90 com "CRATAO" no complemento (Nubank PF 10/2026).
import { chaveTitulo, TOLERANCIA_PADRAO, type ItemALancar, type ResultadoConciliacao, type TituloPagar } from "./conciliacao";
import type { OutroTitulo } from "./selecao-titulos";

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ---------------------------------------------------------------- "não é o mesmo título" (observação na linha)

const PREFIXO_CONFERIDO = "Conferido: não é o título";

/** Motivo da observação que libera a linha de um possível título: "Conferido: não é o título <chave> (nº …, R$ …)". */
export function motivoNaoEhOMesmo(t: TituloPagar): string {
  return `${PREFIXO_CONFERIDO} ${chaveTitulo(t)} (nº ${t.numeroTitulo}, ${reais(t.valorCentavos)}, ${t.fornecedor})`.slice(0, 500);
}

/** Chaves dos títulos que alguém já conferiu e disse que não são a compra da linha. */
function titulosDispensados(item: ItemALancar): Set<string> {
  const re = new RegExp(`^${PREFIXO_CONFERIDO} (\\S+)`);
  return new Set((item.observacoes ?? []).map((o) => re.exec(o.motivo ?? "")?.[1]).filter((c): c is string => !!c));
}

// ---------------------------------------------------------------- possível título já lançado

/** A linha entra na verificação: compra positiva, sem justificativa, que não é encargo (encargo tem o quadro próprio). */
const linhaDeCompra = (a: ItemALancar) => a.linha.valorCentavos > 0 && !a.justificativa && a.natureza !== "Encargo financeiro";

/** O título pode ser a compra da linha? Mesmo valor (até 5 centavos) ou a compra inteira (N × parcela, N + 5 centavos). */
export function valorCompativel(linha: ItemALancar["linha"], t: TituloPagar, tolerancia = TOLERANCIA_PADRAO): boolean {
  if (Math.abs(t.valorCentavos - linha.valorCentavos) <= tolerancia) return true;
  const n = linha.parcelaTotal ?? 1;
  return n >= 2 && Math.abs(t.valorCentavos - n * linha.valorCentavos) <= n + tolerancia;
}

/**
 * Para cada linha a lançar, os títulos que já existem no Consistem e podem ser a mesma compra: os "Outros títulos de cartão"
 * (citam outro cartão, ambíguos, só a marca, antecipação candidata) e as divergências sem justificativa, que ninguém casou.
 */
export function possiveisTitulos(r: Pick<ResultadoConciliacao, "aLancar" | "divergencias" | "conciliados">, outros: readonly OutroTitulo[]): Map<string, TituloPagar[]> {
  const usados = new Set(r.conciliados.flatMap((c) => [c.titulo, ...(c.titulosExtras ?? [])]).map(chaveTitulo));
  const vistos = new Set<string>();
  const candidatos: TituloPagar[] = [];
  for (const t of [...r.divergencias.filter((d) => !d.justificativa).map((d) => d.titulo), ...outros.map((o) => o.titulo)]) {
    const k = chaveTitulo(t);
    if (usados.has(k) || vistos.has(k)) continue;
    vistos.add(k);
    candidatos.push(t);
  }
  const mapa = new Map<string, TituloPagar[]>();
  for (const a of r.aLancar.filter(linhaDeCompra)) {
    const dispensados = titulosDispensados(a);
    const lista = candidatos.filter((t) => !dispensados.has(chaveTitulo(t)) && valorCompativel(a.linha, t));
    if (lista.length) mapa.set(a.linha.id, lista);
  }
  return mapa;
}

export type TravaLancamento = {
  /** Motivos que travam todo lançamento de compra (vazio = livre). */
  geral: string[];
  /** Linha → motivo (possível título já lançado). */
  porLinha: Map<string, string>;
  /** Linha → títulos que podem ser a mesma compra. */
  possiveis: Map<string, TituloPagar[]>;
};

export const descreverTitulo = (t: TituloPagar) => `nº ${t.numeroTitulo}, ${reais(t.valorCentavos)}, ${t.fornecedor}${t.complemento ? `, “${t.complemento}”` : ""}`;

/** Divergência sem decisão: nem justificativa nem observação (ninguém olhou). */
export const divergenciasSemDecisao = (r: Pick<ResultadoConciliacao, "divergencias">) => r.divergencias.filter((d) => !d.justificativa && !(d.observacoes ?? []).length);

/** O que trava "Lançar compra" e "Lançar selecionadas" agora. */
export function travaDeLancamento(r: Pick<ResultadoConciliacao, "aLancar" | "divergencias" | "conciliados" | "aDesdobrar">, outros: readonly OutroTitulo[]): TravaLancamento {
  const geral: string[] = [];
  const nDesdobrar = (r.aDesdobrar ?? []).length;
  if (nDesdobrar) geral.push(`Desdobre antes no Consistem ${nDesdobrar === 1 ? "a compra parcelada lançada" : `as ${nDesdobrar} compras parceladas lançadas`} pelo total (passo 2).`);
  const nDiv = divergenciasSemDecisao(r).length;
  if (nDiv) geral.push(`Confira antes ${nDiv === 1 ? "o título" : `os ${nDiv} títulos`} sem linha na aba Divergências e registre a decisão (casar, justificar ou observar) (passo 3).`);
  const possiveis = possiveisTitulos(r, outros);
  const porLinha = new Map([...possiveis].map(([id, ts]) => [id, `Possível título já lançado: ${ts.map(descreverTitulo).join("; ")}. Case a linha com ele (Decidir › Casar) ou, se não for a mesma compra, use “Não é o mesmo”.`]));
  return { geral, porLinha, possiveis };
}

/** Motivo para recusar o lançamento destas linhas (null = pode lançar). */
export function recusaDeLancamento(trava: TravaLancamento, linhas: readonly string[]): string | null {
  if (trava.geral.length) return trava.geral.join(" ");
  const travada = linhas.find((id) => trava.porLinha.has(id));
  return travada ? trava.porLinha.get(travada)! : null;
}

// ---------------------------------------------------------------- roteiro

export type EstadoPasso = "feito" | "atual" | "pendente" | "nao_se_aplica";
export type Passo = { numero: number; titulo: string; estado: EstadoPasso; detalhe: string };

/** Partição das linhas a lançar sem justificativa pelos passos 1, 4, 5 e 6. */
function passoDaLinha(a: ItemALancar): 1 | 4 | 5 | 6 {
  if (a.linha.valorCentavos <= 0) return 6;
  if (a.natureza === "Encargo financeiro") return 1;
  if ((a.linha.parcelaNum ?? 1) > 1) return 4;
  return 5;
}

/** Os 8 passos do fechamento, com o estado de cada um; "atual" = o primeiro que falta. */
export function montarRoteiro(e: {
  resultado: ResultadoConciliacao;
  outros: readonly OutroTitulo[];
  /** Códigos dos títulos de encargos já lançados no mês ("34010, 34011"), se houver. */
  encargosLancados?: string | null;
  origemTitulos?: "consistem" | "espelho";
  /** Títulos conciliados com aviso (cartão, vencimento, conta de fluxo, complemento): não bloqueiam, mas vale corrigir antes. */
  titulosComAviso?: number;
}): Passo[] {
  const r = e.resultado;
  const pend = r.aLancar.filter((a) => !a.justificativa);
  const contar = (p: number) => pend.filter((a) => passoDaLinha(a) === p);
  const encargos = contar(1), parcelas = contar(4), compras = contar(5), sobras = contar(6);
  const soma = (l: ItemALancar[]) => reais(l.reduce((s, a) => s + a.linha.valorCentavos, 0));
  const nDesdobrar = (r.aDesdobrar ?? []).length;
  const semDecisao = divergenciasSemDecisao(r).length;
  const possiveis = possiveisTitulos(r, e.outros).size;
  const consistem = (e.origemTitulos ?? "consistem") === "consistem";
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

  const passos: Omit<Passo, "estado">[] = [];
  const feitos: (boolean | null)[] = [];   // null = não se aplica
  const add = (titulo: string, feito: boolean | null, detalhe: string) => { passos.push({ numero: passos.length, titulo, detalhe }); feitos.push(feito); };

  add("Preparar", r.integridadeOk && consistem,
    !r.integridadeOk ? "A soma das linhas não bate com o total da fatura: conferir a importação."
      : !consistem ? "Os títulos vieram do espelho: recarregue para ler o Consistem antes de lançar."
        : "Fatura importada (soma = total) e títulos lidos do Consistem.");
  add("Encargos", encargos.length ? false : e.encargosLancados ? true : null,
    encargos.length ? `${plural(encargos.length, "linha", "linhas")} de encargo (${soma(encargos)}): lance no quadro Encargos do mês.`
      : e.encargosLancados ? `Encargos lançados: ${e.encargosLancados}.` : "Sem encargos nesta fatura.");
  add("Desdobrar", nDesdobrar ? false : null,
    nDesdobrar ? `${plural(nDesdobrar, "compra parcelada lançada", "compras parceladas lançadas")} pelo total: use “Desdobrar no Consistem”.` : "Nenhuma NF lançada pelo total.");
  add("Conferir o que já existe", semDecisao || possiveis ? false : r.divergencias.length || e.outros.length ? true : null,
    semDecisao || possiveis
      ? [semDecisao ? `${plural(semDecisao, "título sem linha", "títulos sem linha")} sem decisão (aba Divergências)` : "",
        possiveis ? `${plural(possiveis, "linha com possível título", "linhas com possível título")} já lançado (aba A lançar)` : ""].filter(Boolean).join(" · ")
      : "Divergências e outros títulos de cartão conferidos.");
  add("Parcelas k/N", parcelas.length ? false : null,
    parcelas.length ? `${plural(parcelas.length, "parcela", "parcelas")} (2/N em diante) sem título: confira no Consistem se a compra não foi lançada pelo total em outro mês; depois lance.` : "Nenhuma parcela sem título.");
  add("Lançar compras", compras.length ? false : null,
    compras.length ? `${plural(compras.length, "compra", "compras")} sem título (${soma(compras)}): Lançar selecionadas para as à vista (um título por linha), Lançar para as demais (ou justificar).` : "Nenhuma compra a lançar.");
  add("Sobras", sobras.length ? false : null,
    sobras.length ? `${plural(sobras.length, "estorno ou crédito", "estornos ou créditos")}: abata do título da compra e justifique.` : "Sem estornos pendentes.");
  const pronto = r.pendentes === 0 && r.residuoCentavos === 0;
  add("Fechar", pronto ? null : false,
    pronto ? `Nada pendente e diferença não justificada zero: o gestor fecha o mês (troca o banco dos títulos e cria o provisório).${e.titulosComAviso ? ` Antes, veja ${plural(e.titulosComAviso, "título com aviso", "títulos com aviso")} na aba Conciliados.` : ""}`
      : r.residuoCentavos !== 0 && r.pendentes === 0 ? `Diferença não justificada de ${reais(r.residuoCentavos)}: apurar antes de fechar.`
        : "Fecha quando não houver pendência e a diferença não justificada for zero.");

  const atual = feitos.findIndex((f, i) => f === false || (i === feitos.length - 1));
  return passos.map((p, i) => ({
    ...p,
    estado: i === atual ? "atual" : feitos[i] === true ? "feito" : feitos[i] === null ? "nao_se_aplica" : "pendente",
  }));
}
