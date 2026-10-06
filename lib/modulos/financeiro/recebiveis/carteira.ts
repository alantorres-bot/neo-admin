// Carteira de recebíveis (regras puras). A faixa de atraso e o valor atualizado vêm da view `rec_vw_titulos`
// (0100); aqui só somamos, agrupamos e formatamos. Dinheiro é somado em CENTAVOS (inteiros) para não acumular
// erro de ponto flutuante.

export const FAIXAS_ABERTAS = ["a_vencer", "01_15", "16_30", "31_60", "60_mais"] as const;
export type Faixa = (typeof FAIXAS_ABERTAS)[number];

export const ROTULO_FAIXA: Record<Faixa, string> = {
  a_vencer: "A vencer",
  "01_15": "1 a 15 dias",
  "16_30": "16 a 30 dias",
  "31_60": "31 a 60 dias",
  "60_mais": "Mais de 60 dias",
};

/** Estágios do título (enum `rec_estagio`, 0100). */
export const ROTULO_ESTAGIO: Record<string, string> = {
  importado: "Importado",
  aguardando_boleto: "Aguardando boleto",
  boleto_enviado: "Boleto enviado",
  confirmado_cliente: "Confirmado pelo cliente",
  vencido: "Vencido",
  promessa: "Promessa de pagamento",
  em_renegociacao: "Em renegociação",
  renegociado: "Renegociado",
  pago: "Pago",
  juridico: "Jurídico",
  cancelado: "Cancelado",
};

export const ehFaixa = (v: string): v is Faixa => (FAIXAS_ABERTAS as readonly string[]).includes(v);

/** Valor numérico do banco (o PostgREST devolve `numeric` ora como número, ora como texto) em centavos. */
export function emCentavos(valor: number | string | null | undefined): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Math.round(Number(n.toFixed(6)) * 100) : 0;
}

export type LinhaResumo = {
  faixa: string;
  valor: number | string;
  valor_atualizado: number | string;
  contraparte_id: string;
  estagio?: string;
  cedido?: boolean | null;
  contestado?: boolean | null;
  /** 'matriz' ou 'contagem' (documento que começa com 400). */
  unidade?: string;
};

export type TotalFaixa = { faixa: Faixa; quantidade: number; centavos: number; percentual: number };

export type ResumoCarteira = {
  quantidade: number;
  clientes: number;
  totalCentavos: number;
  /** Valor original + multa e juros dos vencidos. */
  atualizadoCentavos: number;
  vencido: { quantidade: number; centavos: number };
  aVencer: { quantidade: number; centavos: number };
  porFaixa: TotalFaixa[];
};

/** Resume só os títulos em aberto (faixa 'encerrado' ou desconhecida fica de fora). */
export function resumirCarteira(linhas: readonly LinhaResumo[]): ResumoCarteira {
  const porFaixa = new Map<Faixa, { quantidade: number; centavos: number }>(FAIXAS_ABERTAS.map((f) => [f, { quantidade: 0, centavos: 0 }]));
  const clientes = new Set<string>();
  let quantidade = 0;
  let totalCentavos = 0;
  let atualizadoCentavos = 0;

  for (const l of linhas) {
    if (!ehFaixa(l.faixa)) continue;
    const centavos = emCentavos(l.valor);
    const f = porFaixa.get(l.faixa)!;
    f.quantidade++;
    f.centavos += centavos;
    quantidade++;
    totalCentavos += centavos;
    atualizadoCentavos += emCentavos(l.valor_atualizado);
    clientes.add(l.contraparte_id);
  }

  const lista: TotalFaixa[] = FAIXAS_ABERTAS.map((faixa) => {
    const f = porFaixa.get(faixa)!;
    return { faixa, ...f, percentual: totalCentavos > 0 ? Math.round((f.centavos / totalCentavos) * 100) : 0 };
  });
  const aVencer = lista[0];
  const vencidos = lista.slice(1);
  return {
    quantidade,
    clientes: clientes.size,
    totalCentavos,
    atualizadoCentavos,
    vencido: { quantidade: vencidos.reduce((s, f) => s + f.quantidade, 0), centavos: vencidos.reduce((s, f) => s + f.centavos, 0) },
    aVencer: { quantidade: aVencer.quantidade, centavos: aVencer.centavos },
    porFaixa: lista,
  };
}

// ---------------------------------------------------------------- situação do título (abas da Carteira)

/**
 * Em que situação cada título aberto está, num só rótulo (como as abas de uma consulta do ERP). A ordem de precedência é:
 * contestado/cedido/jurídico/em renegociação > promessa > aguardando boleto > vencido > boleto enviado > confirmado > a vencer sem ação.
 */
export const GRUPOS_SITUACAO = ["aguardando_boleto", "boleto_enviado", "confirmado", "sem_acao", "vencido", "promessa", "especial"] as const;
export type GrupoSituacao = (typeof GRUPOS_SITUACAO)[number];

export const ROTULO_GRUPO: Record<GrupoSituacao, string> = {
  aguardando_boleto: "Aguardando boleto",
  boleto_enviado: "Boleto enviado",
  confirmado: "Confirmados",
  sem_acao: "A vencer, sem ação",
  vencido: "Vencidos",
  promessa: "Promessa de pagamento",
  especial: "Contestados e outros",
};

/** Texto curto do selo de cada situação (na lista). */
export const ROTULO_GRUPO_SELO: Record<GrupoSituacao, string> = {
  aguardando_boleto: "Aguardando boleto",
  boleto_enviado: "Boleto enviado",
  confirmado: "Confirmado",
  sem_acao: "A vencer",
  vencido: "Vencido",
  promessa: "Promessa",
  especial: "Especial",
};

export const ehGrupo = (v: string): v is GrupoSituacao => (GRUPOS_SITUACAO as readonly string[]).includes(v);

/** Estágios cobertos pelo grupo "vencido" (título passado do vencimento, ainda sem pagamento, acordo nem pausa). */
export const ESTAGIOS_DO_GRUPO_VENCIDO = ["importado", "boleto_enviado", "confirmado_cliente", "vencido"] as const;

export type DadosSituacao = { estagio: string; faixa: string; cedido?: boolean | null; contestado?: boolean | null };

export function grupoDaSituacao(t: DadosSituacao): GrupoSituacao {
  if (t.cedido || t.contestado || t.estagio === "em_renegociacao" || t.estagio === "juridico") return "especial";
  if (t.estagio === "promessa") return "promessa";
  if (t.estagio === "aguardando_boleto") return "aguardando_boleto";
  if (t.faixa !== "a_vencer") return "vencido";
  if (t.estagio === "boleto_enviado") return "boleto_enviado";
  if (t.estagio === "confirmado_cliente") return "confirmado";
  return "sem_acao";
}

export type TotalGrupo = { grupo: GrupoSituacao; quantidade: number; centavos: number };

/** Quantidade e valor de cada situação, sobre os títulos em aberto. */
export function resumirPorGrupo(linhas: readonly (LinhaResumo & Partial<DadosSituacao>)[]): TotalGrupo[] {
  const m = new Map<GrupoSituacao, { quantidade: number; centavos: number }>(GRUPOS_SITUACAO.map((g) => [g, { quantidade: 0, centavos: 0 }]));
  for (const l of linhas) {
    if (!ehFaixa(l.faixa) || !l.estagio) continue;
    const g = m.get(grupoDaSituacao({ estagio: l.estagio, faixa: l.faixa, cedido: l.cedido, contestado: l.contestado }))!;
    g.quantidade++;
    g.centavos += emCentavos(l.valor);
  }
  return GRUPOS_SITUACAO.map((grupo) => ({ grupo, ...m.get(grupo)! }));
}

/** O que a última interação registrada diz sobre o título (coluna "Andamento"). */
export const ROTULO_ANDAMENTO: Record<string, string> = {
  boleto_enviado: "Boleto enviado",
  rascunho_gmail: "Rascunho de e-mail criado",
  confirmacao: "Cliente confirmou o pagamento",
  sem_resposta_confirmacao: "Sem resposta à confirmação",
  cobranca: "Cobrança enviada",
  promessa: "Cliente prometeu pagar",
  contestacao: "Cliente contestou",
};

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 123456 -> 'R$ 1.234,56' */
export function formatarMoeda(centavos: number): string {
  return MOEDA.format(centavos / 100).replace(/ /g, " ");
}

export const formatarValor = (valor: number | string | null | undefined): string => formatarMoeda(emCentavos(valor));

export function descreverAtraso(dias: number): string {
  if (dias <= 0) return "A vencer";
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

// ---------------------------------------------------------------- resposta da sincronização

export type ResumoSincronizacao = {
  empresa: string;
  titulosNaApi: number;
  novos: number;
  alterados: number;
  inalterados: number;
  possiveisBaixas: number;
  divergentes: number;
  recusados: number;
  duplicadosNaApi?: number;
  contrapartesNovas?: number;
  contrapartesVinculadas?: number;
  pendenciasCriadas?: number;
  pendenciasCanceladas?: number;
  valorTotalApi?: number;
  simulacao: boolean;
};

const plural = (n: number, singular: string, pluralTxt: string) => `${n} ${n === 1 ? singular : pluralTxt}`;

/** Linhas de texto para mostrar o resultado da sincronização ao usuário. */
export function descreverSincronizacao(r: ResumoSincronizacao): string[] {
  const linhas = [
    `${r.simulacao ? "Simulação (nada foi gravado)" : "Sincronização concluída"} — ${r.empresa}: ${plural(r.titulosNaApi, "título em aberto no Consistem", "títulos em aberto no Consistem")}.`,
    `Novos: ${r.novos} · Alterados: ${r.alterados} · Sem mudança: ${r.inalterados}`,
  ];
  if (!r.simulacao && (r.contrapartesNovas || r.contrapartesVinculadas)) {
    linhas.push(`Clientes criados: ${r.contrapartesNovas ?? 0} · Vinculados a cadastro existente: ${r.contrapartesVinculadas ?? 0}`);
  }
  if (r.possiveisBaixas > 0) {
    linhas.push(`${plural(r.possiveisBaixas, "título saiu", "títulos saíram")} da lista do Consistem: ${r.simulacao ? "viraria pendência" : "viraram pendências"} "Possível baixa" na Fila do dia. Nenhuma baixa é dada automaticamente.`);
  }
  if (r.divergentes > 0) linhas.push(`${plural(r.divergentes, "título encerrado aqui, mas ainda em aberto no Consistem", "títulos encerrados aqui, mas ainda em aberto no Consistem")} (não alterados).`);
  if (r.recusados > 0) linhas.push(`${plural(r.recusados, "registro recusado", "registros recusados")} por dados inválidos.`);
  if ((r.duplicadosNaApi ?? 0) > 0) linhas.push(`${plural(r.duplicadosNaApi!, "título repetido", "títulos repetidos")} na resposta do Consistem (usado o primeiro).`);
  if (!r.simulacao && (r.pendenciasCanceladas ?? 0) > 0) linhas.push(`${plural(r.pendenciasCanceladas!, "pendência de baixa cancelada", "pendências de baixa canceladas")}: o título voltou à lista.`);
  return linhas;
}
