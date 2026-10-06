// Escolha do contato do cliente (regras puras, sem imports). Uma só regra para boleto, cobrança, confirmação e
// para a Edge Function de sincronização: antes cada tela escolhia do seu jeito e todas caíam no "primeiro contato", mesmo
// quando ele não tinha o canal necessário (e-mail para e-mail, WhatsApp para WhatsApp, telefone para ligar).

/** Finalidades que o sistema entende (a tela oferece só estas; o banco guarda texto). */
export const FINALIDADES = ["boleto", "cobranca", "confirmacao", "akf", "contrato"] as const;
export type Finalidade = (typeof FINALIDADES)[number];

export const ROTULO_FINALIDADE: Record<Finalidade, string> = {
  boleto: "Boleto",
  cobranca: "Cobrança",
  confirmacao: "Confirmação de pagamento",
  akf: "AKF (cessão e antecipação)",
  contrato: "Contrato",
};

export type CanalContato = "email" | "whatsapp" | "telefone";

export type ContatoEscolha = {
  id: string;
  nome: string;
  email?: string | null;
  whatsapp?: string | null;
  telefone?: string | null;
  finalidades: readonly string[];
  canal_preferido?: string | null;
  ativo?: boolean | null;
};

/** 'Cobrança ' -> 'cobranca': minúsculas, sem acento e sem espaços nas pontas (o que a tela e a régua comparam). */
export function normalizarFinalidade(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Finalidades gravadas que o sistema não reconhece (erro de digitação ou legado): a tela avisa para corrigir. */
export function finalidadesDesconhecidas(finalidades: readonly string[]): string[] {
  return finalidades.filter((f) => !(FINALIDADES as readonly string[]).includes(normalizarFinalidade(f)));
}

const preenchido = (v: string | null | undefined) => typeof v === "string" && v.trim() !== "";

/** O contato tem o canal pedido? Para ligar, vale o telefone ou o número do WhatsApp (celular também recebe ligação). */
export function temCanal(c: Pick<ContatoEscolha, "email" | "whatsapp" | "telefone">, canal: CanalContato): boolean {
  if (canal === "email") return preenchido(c.email);
  if (canal === "whatsapp") return preenchido(c.whatsapp);
  return preenchido(c.telefone) || preenchido(c.whatsapp);
}

/**
 * Escolhe o contato para uma mensagem ou ligação. Só devolve quem está ativo E tem o canal pedido; nunca um contato sem o
 * canal. Ordem: (1) tem a finalidade (a primeira da lista vale mais), (2) tem como canal preferido o canal pedido,
 * (3) nome. Sem ninguém com a finalidade, vale qualquer contato ativo com o canal. `preferidoId` (escolha manual da
 * pessoa na tela) vence tudo, desde que o contato exista, esteja ativo e tenha o canal.
 */
export function escolherContato<T extends ContatoEscolha>(
  contatos: readonly T[], finalidades: Finalidade | readonly Finalidade[], canal: CanalContato, preferidoId?: string | null,
): T | null {
  const lista = typeof finalidades === "string" ? [finalidades] : finalidades;
  const candidatos = contatos.filter((c) => c.ativo !== false && temCanal(c, canal));
  if (preferidoId) {
    const escolhido = candidatos.find((c) => c.id === preferidoId);
    if (escolhido) return escolhido;
  }
  const posicao = (c: T): number => {
    const normalizadas = c.finalidades.map(normalizarFinalidade);
    const i = lista.findIndex((f) => normalizadas.includes(f));
    return i === -1 ? lista.length : i;
  };
  return [...candidatos].sort((a, b) =>
    posicao(a) - posicao(b)
    || Number(b.canal_preferido === canal) - Number(a.canal_preferido === canal)
    || a.nome.localeCompare(b.nome, "pt-BR"),
  )[0] ?? null;
}

/** O cliente tem pelo menos um contato ativo com algum meio de falar (e-mail, WhatsApp ou telefone)? */
export function temContatoUtil(contatos: readonly ContatoEscolha[]): boolean {
  return contatos.some((c) => c.ativo !== false && (preenchido(c.email) || preenchido(c.whatsapp) || preenchido(c.telefone)));
}
