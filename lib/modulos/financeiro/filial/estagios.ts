// Estágios do faturamento da filial, do ponto de vista de quem trabalha (a fila única). O `estagio` técnico do kit no banco
// (recebida, implantada, pronta, enviada, cancelada) continua o mesmo; aqui ele é lido junto com os documentos para dizer:
//  - em que estágio a NF está (o primeiro passo que falta, na ordem do fluxo);
//  - as tarefas abertas de cada lado (filial e Cuiabá correm em paralelo: o demonstrativo é anexado enquanto se implanta);
//  - a urgência, pelo vencimento, enquanto o cliente ainda não recebeu o boleto.
// O normal é enviar ao cliente tudo junto (nota, demonstrativo e boleto); a nota antes do boleto é exceção (estágios 5 e 6).

export const ESTAGIOS_FILA = [
  "falta_demonstrativo",
  "a_implantar",
  "aguardando_boleto",
  "pronta",
  "nota_enviada",
  "boleto_a_enviar",
  "enviada",
  "cancelada",
] as const;
export type EstagioFila = (typeof ESTAGIOS_FILA)[number];

export const ROTULO_ESTAGIO_FILA: Record<EstagioFila, string> = {
  falta_demonstrativo: "Falta demonstrativo",
  a_implantar: "A implantar",
  aguardando_boleto: "Aguardando boleto",
  pronta: "Pronta para envio",
  nota_enviada: "Nota enviada · aguardando boleto",
  boleto_a_enviar: "Boleto a enviar",
  enviada: "Enviada",
  cancelada: "Cancelada",
};

/** Quem faz a próxima tarefa do estágio. */
export const DONO_ESTAGIO: Record<EstagioFila, "filial" | "cuiaba" | null> = {
  falta_demonstrativo: "filial",
  a_implantar: "cuiaba",
  aguardando_boleto: "cuiaba",
  pronta: "filial",
  nota_enviada: "cuiaba",
  boleto_a_enviar: "filial",
  enviada: null,
  cancelada: null,
};

/** Rótulo do estágio; o kit pronto fora da janela diz quando enviar ("Pronta para envio · enviar a partir de 15/11"). */
export function rotuloSituacao(s: Pick<Situacao, "estagio" | "envioAPartirDe">): string {
  if (!s.envioAPartirDe) return ROTULO_ESTAGIO_FILA[s.estagio];
  const [, m, d] = s.envioAPartirDe.split("-");
  return `${ROTULO_ESTAGIO_FILA[s.estagio]} · enviar a partir de ${d}/${m}`;
}

/** Data a partir da qual o envio entra na janela (vencimento − janela); vazio se já está na janela ou não há vencimento. */
export function inicioDaJanelaDeEnvio(vencimento: string | null, hoje: string, janelaDias: number): string | null {
  if (!vencimento) return null;
  const inicio = new Date(Date.parse(`${vencimento}T00:00:00Z`) - janelaDias * 86_400_000).toISOString().slice(0, 10);
  return inicio > hoje ? inicio : null;
}

export const ehEstagioFila = (v: string): v is EstagioFila => (ESTAGIOS_FILA as readonly string[]).includes(v);

export type Papel = "filial" | "cuiaba";

export type KitParaSituacao = {
  /** Estágio técnico do kit no banco. */
  estagio: "recebida" | "implantada" | "pronta" | "enviada" | "cancelada";
  notas: number;
  demonstrativos: number;
  cartas: number;
  exigeCarta: boolean;
  /** Parcelas do Consistem ligadas ao kit (0 = ainda não implantada). */
  parcelas: number;
  boletos: number;
  notaEnviada: boolean;
  /**
   * Kit pronto que ainda não está na janela de envio (vence daqui a mais de 30 dias, editável na Regra de cobrança): a data a
   * partir da qual o envio vira tarefa (15/10/2026). Vazio = já pode enviar.
   */
  envioAPartirDe?: string | null;
};

export type Situacao = {
  estagio: EstagioFila;
  /** Tarefas abertas de cada lado (podem existir dos dois ao mesmo tempo). */
  tarefas: Record<Papel, string[]>;
  /** Pronta, mas o envio só vira tarefa a partir desta data (ver `KitParaSituacao.envioAPartirDe`). */
  envioAPartirDe?: string;
};

export function situacaoDaNota(k: KitParaSituacao): Situacao {
  if (k.estagio === "cancelada") return { estagio: "cancelada", tarefas: { filial: [], cuiaba: [] } };
  if (k.estagio === "enviada") return { estagio: "enviada", tarefas: { filial: [], cuiaba: [] } };

  const filial: string[] = [];
  const cuiaba: string[] = [];
  if (k.notas === 0) filial.push("Anexar nota fatura");
  if (k.demonstrativos === 0) filial.push("Anexar demonstrativo");
  if (k.estagio === "recebida") cuiaba.push("Implantar");
  if (k.estagio === "implantada") {
    if (k.boletos < k.parcelas || k.parcelas === 0) cuiaba.push("Anexar boleto");
    if (k.exigeCarta && k.cartas === 0) cuiaba.push("Anexar carta de cessão");
    if (cuiaba.length === 0) cuiaba.push("Anexar boleto");
  }

  let estagio: EstagioFila;
  if (k.notaEnviada) {
    estagio = k.estagio === "pronta" ? "boleto_a_enviar" : "nota_enviada";
  } else if (k.demonstrativos === 0) {
    estagio = "falta_demonstrativo";
  } else if (k.estagio === "recebida") {
    estagio = "a_implantar";
  } else if (k.estagio === "implantada") {
    estagio = "aguardando_boleto";
  } else {
    estagio = "pronta";
  }
  if ((estagio === "pronta" || estagio === "boleto_a_enviar") && k.envioAPartirDe) {
    return { estagio, tarefas: { filial, cuiaba }, envioAPartirDe: k.envioAPartirDe };
  }
  if (estagio === "pronta") filial.push("Enviar ao cliente");
  if (estagio === "boleto_a_enviar") filial.push("Enviar boleto");
  return { estagio, tarefas: { filial, cuiaba } };
}

export type Urgencia = "atrasada" | "critica" | "atencao" | "normal" | "sem_data";
export const ROTULO_URGENCIA: Record<Urgencia, string> = {
  atrasada: "Atrasada", critica: "Crítica", atencao: "Atenção", normal: "Normal", sem_data: "Sem vencimento",
};
export const ORDEM_URGENCIA: Record<Urgencia, number> = { atrasada: 0, critica: 1, atencao: 2, normal: 3, sem_data: 4 };

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * Urgência pelo vencimento (o do título ou, antes da implantação, o da nota), só enquanto o cliente ainda não recebeu o boleto:
 * venceu → atrasada; até 5 dias → crítica; até 10 → atenção; mais → normal. Enviada ou cancelada: null.
 */
export function urgenciaDaNota(estagio: EstagioFila, vencimento: string | null, hoje: string): Urgencia | null {
  if (estagio === "enviada" || estagio === "cancelada") return null;
  if (!vencimento) return "sem_data";
  const dias = diasEntre(vencimento, hoje);
  return dias < 0 ? "atrasada" : dias <= 5 ? "critica" : dias <= 10 ? "atencao" : "normal";
}

/** "venceu há 2 dias", "vence hoje", "amanhã", "em 8 dias". */
export function textoVencimento(vencimento: string | null, hoje: string): string {
  if (!vencimento) return "—";
  const dias = diasEntre(vencimento, hoje);
  if (dias < 0) return `venceu há ${-dias} ${dias === -1 ? "dia" : "dias"}`;
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "amanhã";
  return `em ${dias} dias`;
}

/**
 * Próxima ação para quem está vendo. Sem tarefa sua: "Aguardando Cuiabá" / "Aguardando filial"; para a filial, se a NF está
 * crítica ou atrasada e parada com Cuiabá, "Cobrar boleto de Cuiabá".
 */
export function proximaAcao(s: Situacao, papel: Papel, urgencia: Urgencia | null): { rotulo: string; minha: boolean } {
  if (s.estagio === "enviada" || s.estagio === "cancelada") return { rotulo: "Ver", minha: false };
  const minhas = s.tarefas[papel];
  if (minhas.length > 0) return { rotulo: minhas[0], minha: true };
  const outro = papel === "filial" ? "cuiaba" : "filial";
  if (papel === "filial" && s.tarefas.cuiaba.length > 0 && (urgencia === "critica" || urgencia === "atrasada")) {
    return { rotulo: "Cobrar boleto de Cuiabá", minha: true };
  }
  return { rotulo: s.tarefas[outro].length > 0 ? (outro === "cuiaba" ? "Aguardando Cuiabá" : "Aguardando filial") : "—", minha: false };
}
