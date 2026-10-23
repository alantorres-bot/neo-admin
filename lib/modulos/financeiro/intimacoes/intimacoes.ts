// Intimações de cartório (financeiro.intimacoes): rótulos das etapas e a tarefa do adiantamento manual.
// Especificação: docs/modulos/financeiro-intimacoes-cartorio.md.

export const MODULO_INTIMACOES = "financeiro.intimacoes";
export const ROTA_INTIMACOES = "/financeiro/intimacoes";

export const STATUS = [
  "identificada", "titulo_localizado", "aguardando_aprovacao", "adiantamento_pendente", "nf_pendente", "consignacao_pendente",
  "concluida", "revisao", "descartada",
] as const;
export type StatusIntimacao = (typeof STATUS)[number];
export const ehStatus = (v: string): v is StatusIntimacao => (STATUS as readonly string[]).includes(v);

export const ROTULO_STATUS: Record<StatusIntimacao, string> = {
  identificada: "Intimação identificada",
  titulo_localizado: "Título localizado",
  aguardando_aprovacao: "Vencimento aguardando aprovação",
  adiantamento_pendente: "Adiantamento aguardando lançamento manual",
  nf_pendente: "Nota fiscal pendente",
  consignacao_pendente: "Consignação pendente",
  concluida: "Processo concluído",
  revisao: "Revisão necessária",
  descartada: "Descartada",
};

/** Etapas em andamento (a lista abre nelas). */
export const EM_ANDAMENTO: readonly StatusIntimacao[] = ["identificada", "titulo_localizado", "aguardando_aprovacao", "adiantamento_pendente", "nf_pendente", "consignacao_pendente", "revisao"];

export type Cartorios = Record<string, { nome?: string | null; codFornecedor?: number | string | null }>;

export type DadosTarefa = {
  cartorio: string;
  valorCustas: number | null;
  protocolo: string | null;
  localizador: string | null;
  numeroTitulo: string | null;
  credorNome: string | null;
  codLancamento: string | null;
};

export type TarefaAdiantamento = {
  fornecedorNome: string;
  /** Código do cartório como fornecedor no Consistem; null = não cadastrado em financeiro.intimacoes.cartorios. */
  codFornecedor: string | null;
  valorCustas: number | null;
  referencia: string;
  instrucao: string;
};

/**
 * O que a pessoa precisa para lançar À MÃO, na tela do Consistem, o adiantamento das custas ao cartório. O Neo Admin não
 * lança: a inclusão pela API não sai igual à da tela (sem data de pagamento e com valor pago zero; especificação, seção 9).
 */
export function tarefaAdiantamento(d: DadosTarefa, cartorios: Cartorios): TarefaAdiantamento {
  const c = cartorios[d.cartorio] ?? {};
  const cod = c.codFornecedor === null || c.codFornecedor === undefined || String(c.codFornecedor).trim() === "" ? null : String(c.codFornecedor).trim();
  const partes = [
    d.protocolo ? `protocolo ${d.protocolo}` : d.localizador ? `localizador ${d.localizador.slice(0, 8)}` : null,
    d.numeroTitulo ? `título ${d.numeroTitulo}` : null,
    d.credorNome,
  ].filter(Boolean);
  return {
    fornecedorNome: c.nome?.trim() || d.cartorio,
    codFornecedor: cod,
    valorCustas: d.valorCustas,
    referencia: `Custas de protesto — ${partes.join(" · ")}`.slice(0, 60),
    instrucao:
      "Lance o adiantamento a fornecedor pela tela do Consistem (não pela API), com o cartório como fornecedor e o valor exato das custas. " +
      "Depois volte aqui, informe o código do lançamento (se tiver) e confirme. O Neo Admin não verifica o lançamento no Consistem: a confirmação é sua.",
  };
}
