// Central de Gestão: regras puras do envio de avisos (Slack) e da criação de tarefas no ClickUp. Usado pelas Edge
// Functions nucleo-notificacoes-enviar e nucleo-clickup-enviar e testado em lib/nucleo/gestao/notificacoes.test.ts.

export const MAX_TENTATIVAS = 3;

export type Notificacao = {
  id: number; evento: string; destinatario_id: string | null; texto: string; link: string | null; tentativas: number;
};

/** Para onde vai o aviso: DM da pessoa (ID do Slack no perfil) ou o canal da gestão; sem destino, é ignorado com motivo. */
export function destinoDoAviso(
  n: Pick<Notificacao, "destinatario_id">, slackDaPessoa: string | null, canalGestao: string | null,
): { destino: string } | { ignorar: string } {
  if (n.destinatario_id) {
    return slackDaPessoa ? { destino: slackDaPessoa } : { ignorar: "Pessoa sem usuário do Slack cadastrado (Configurações > Usuários)." };
  }
  return canalGestao ? { destino: canalGestao } : { ignorar: "Canal da gestão não configurado (Central de Gestão > Avisos)." };
}

/** Texto da mensagem: o aviso e o link para a Central (endereço absoluto; o link relativo vira URL do Neo Admin). */
export function mensagemSlack(n: Pick<Notificacao, "texto" | "link">, urlBase: string): string {
  const base = urlBase.replace(/\/+$/, "");
  const link = n.link ? (n.link.startsWith("http") ? n.link : `${base}${n.link.startsWith("/") ? "" : "/"}${n.link}`) : null;
  return link ? `${n.texto}\n<${link}|Abrir no Neo Admin>` : n.texto;
}

/** Depois de uma falha: tenta de novo até o limite; depois disso, fica "falhou" sem nova tentativa. */
export function aposFalha(tentativasAntes: number): { status: "pendente" | "falhou"; tentativas: number } {
  const tentativas = tentativasAntes + 1;
  return { status: tentativas >= MAX_TENTATIVAS ? "falhou" : "pendente", tentativas };
}

/** Prioridade do ClickUp (1 urgente, 2 alta, 3 normal) a partir da prioridade da pendência. */
export function prioridadeClickup(criticidade: string): 1 | 2 | 3 {
  return criticidade === "critica" ? 1 : criticidade === "alta" ? 2 : 3;
}

/** Corpo da tarefa no ClickUp (API v2, POST /list/{id}/task). Prazo em ms no meio-dia de Cuiabá (UTC-4). */
export function tarefaClickup(
  p: { id: string; titulo: string; descricao: string | null; prazo: string | null; criticidade: string },
  urlBase: string,
): { name: string; description: string; priority: 1 | 2 | 3; due_date?: number; due_date_time?: boolean } {
  const link = `${urlBase.replace(/\/+$/, "")}/gestao/${p.id}`;
  const corpo: ReturnType<typeof tarefaClickup> = {
    name: p.titulo.slice(0, 200),
    description: `${p.descricao ? `${p.descricao}\n\n` : ""}Pendência no Neo Admin: ${link}\n(As mudanças feitas no ClickUp não alteram a pendência.)`,
    priority: prioridadeClickup(p.criticidade),
  };
  if (p.prazo) {
    corpo.due_date = Date.parse(`${p.prazo}T16:00:00Z`);
    corpo.due_date_time = false;
  }
  return corpo;
}
