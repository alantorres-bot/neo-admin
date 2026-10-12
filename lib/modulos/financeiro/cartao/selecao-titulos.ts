// Escolha dos títulos (lidos da API do Consistem pela Edge Function, ou do espelho `cap_lancamentos` como plano B) que pertencem
// à fatura em conciliação: tipo C, vencimento na janela do
// vencimento efetivo (±5 dias: o emissor desloca o vencimento nominal para o dia útil) e complemento que identifica o cartão
// (banco + PF/PJ, ou desempate pelo dia do vencimento). Títulos de cartão na janela que citam OUTRO cartão (ou ficaram
// ambíguos) vão para "outros", base do alerta de cartão trocado. Valor: saldo (`valor_atualizado`) enquanto aberto; valor
// do documento quando já baixado no Consistem.
import { identificarCartaoDoTitulo, regraVigente, type CartaoInfo, type RegraCartao } from "./cartoes";
import { JANELA_VENCIMENTO, type TituloPagar } from "./conciliacao";
import { diasEntre, normalizar } from "./texto";

export type LancamentoEspelho = {
  id: string;
  cod_lancamento: string;
  num_documento: string | null;
  cod_fornecedor: string | null;
  fornecedor_nome?: string | null;
  complemento_historico: string | null;
  categoria_doc: string | null;
  data_vencimento: string | null;
  valor_documento: number | string;
  valor_atualizado: number | string;
  baixado_em: string | null;
  /** Data de emissão (para a vigência da regra do fornecedor). */
  data_emissao?: string | null;
  /** Lido da API: o título está num borderô (no fechamento do cartão, os títulos da fatura entram num borderô e ficam sem saldo). */
  tem_bordero?: boolean | null;
};

export type OutroTitulo = { titulo: TituloPagar; situacao: "outro_cartao" | "ambiguo" | "so_marca"; detalhe: string };
/** Opções da seleção: regras fornecedor → cartão do Neo Fiscal (cópia em crt_regras_fornecedor). */
export type OpcoesSelecao = { janela?: number; totalCentavos?: number | null; regras?: readonly RegraCartao[] };
export type SelecaoTitulos = {
  doCartao: TituloPagar[];
  outros: OutroTitulo[];
  /**
   * Título PROVISÓRIO da fatura: no fechamento o financeiro põe os títulos do cartão num borderô do valor da fatura e lança um
   * título provisório contra o banco (excluído depois do pagamento). Valor exato da fatura, citando o cartão ou contra o banco
   * emissor. Fica fora do cruzamento linha a linha (senão viraria divergência e zeraria a diferença apurada sem explicar nada).
   */
  tituloDaFatura: TituloPagar | null;
};

const centavos = (v: number | string) => Math.round(Number(v) * 100);

export function paraTitulo(l: LancamentoEspelho): TituloPagar {
  return {
    id: l.id,
    codLancamento: l.cod_lancamento,
    numeroTitulo: l.num_documento ?? l.cod_lancamento,
    fornecedor: l.fornecedor_nome ?? (l.cod_fornecedor ? `Fornecedor ${l.cod_fornecedor}` : ""),
    vencimento: l.data_vencimento,
    complemento: l.complemento_historico ?? "",
    tipoTitulo: l.categoria_doc ?? "",
    // Sem saldo (baixado, ou no borderô do fechamento do cartão): vale o valor do documento.
    valorCentavos: centavos(l.baixado_em || Number(l.valor_atualizado) <= 0 ? l.valor_documento : l.valor_atualizado),
    emBordero: l.tem_bordero === true,
    codFornecedor: l.cod_fornecedor,
  };
}

export function naJanela(vencimentoTitulo: string | null, vencimentoFatura: string, janela = JANELA_VENCIMENTO): boolean {
  return vencimentoTitulo !== null && Math.abs(diasEntre(vencimentoTitulo, vencimentoFatura)) <= janela;
}

/** É o título provisório da fatura? Valor igual ao total e (cita o cartão, ou o fornecedor é o banco emissor). */
function ehTituloDaFatura(titulo: TituloPagar, cartao: CartaoInfo, cartoes: readonly CartaoInfo[], totalCentavos: number | null): boolean {
  if (totalCentavos === null || totalCentavos <= 0 || titulo.valorCentavos !== totalCentavos) return false;
  const id = identificarCartaoDoTitulo({ complemento: titulo.complemento, vencimento: titulo.vencimento }, cartoes);
  if (id.situacao === "cartao") return id.cartao!.codigo === cartao.codigo;
  if (id.situacao === "ambiguo") return id.candidatos.some((c) => c.codigo === cartao.codigo);
  return normalizar(titulo.fornecedor).includes(normalizar(cartao.banco));
}

export function selecionarTitulos(
  lancamentos: readonly LancamentoEspelho[], cartao: CartaoInfo, cartoes: readonly CartaoInfo[], vencimento: string, janelaOuOpcoes: number | OpcoesSelecao = JANELA_VENCIMENTO, totalLegado: number | null = null,
): SelecaoTitulos {
  const opcoes: OpcoesSelecao = typeof janelaOuOpcoes === "number" ? { janela: janelaOuOpcoes, totalCentavos: totalLegado } : janelaOuOpcoes;
  const janela = opcoes.janela ?? JANELA_VENCIMENTO;
  const totalCentavos = opcoes.totalCentavos ?? null;
  const regras = opcoes.regras ?? [];
  const doCartao: TituloPagar[] = [];
  const outros: OutroTitulo[] = [];
  let tituloDaFatura: TituloPagar | null = null;
  for (const l of lancamentos) {
    if (!naJanela(l.data_vencimento, vencimento, janela)) continue;
    const titulo = paraTitulo(l);
    if (!tituloDaFatura && ehTituloDaFatura(titulo, cartao, cartoes, totalCentavos)) { tituloDaFatura = titulo; continue; }
    const regra = regraVigente(regras, l.cod_fornecedor, l.data_emissao ?? l.data_vencimento);
    if (regra) titulo.cartaoDaRegra = regra.cartao;
    const daRegra = regra?.cartao === cartao.codigo;
    const id = identificarCartaoDoTitulo({ complemento: titulo.complemento, vencimento: titulo.vencimento }, cartoes);
    if (id.situacao === "cartao") {
      if (id.cartao!.codigo === cartao.codigo) doCartao.push(titulo);
      else outros.push({ titulo, situacao: "outro_cartao", detalhe: `Cita o cartão ${id.cartao!.nome}${daRegra ? `, mas a regra do fornecedor no Neo Fiscal é ${cartao.nome}: provável cartão trocado` : ""}` });
    } else if (id.situacao === "ambiguo") {
      if (id.candidatos.some((c) => c.codigo === cartao.codigo)) doCartao.push(titulo); // mesmo banco, PF/PJ indefinido: entra
      else if (daRegra) doCartao.push({ ...titulo, porRegra: true });
      else outros.push({ titulo, situacao: "ambiguo", detalhe: `Cita ${id.candidatos.map((c) => c.nome).join(" ou ")}` });
    } else if (daRegra) {
      doCartao.push({ ...titulo, porRegra: true });   // complemento sem a marca do cartão, mas o fornecedor é pago neste cartão
    } else if (id.soMarca) {
      outros.push({ titulo, situacao: "so_marca", detalhe: "Diz CARTÃO sem o banco" });
    }
  }
  const ordenar = (a: TituloPagar, b: TituloPagar) => (a.vencimento ?? "").localeCompare(b.vencimento ?? "") || a.fornecedor.localeCompare(b.fornecedor) || a.numeroTitulo.localeCompare(b.numeroTitulo);
  doCartao.sort(ordenar);
  outros.sort((a, b) => ordenar(a.titulo, b.titulo));
  return { doCartao, outros, tituloDaFatura };
}
