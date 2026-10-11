// Parâmetros do módulo Contas a pagar lidos de `configuracoes`. Sem imports.

export const CHAVE_CORTE_ANTECIPACOES = "financeiro.contas-pagar.antecipacoes_a_partir_de";
/** Link do canal do financeiro no Slack (https://app.slack.com/client/T.../C... ou https://<time>.slack.com/archives/C...). */
export const CHAVE_SLACK_CANAL = "financeiro.contas-pagar.slack_canal_url";
/** ID do canal do financeiro no Slack (ex.: C088FV34S4A): onde o Neo Admin publica a autorização (mensagem + PDF). */
export const CHAVE_SLACK_CANAL_ID = "financeiro.contas-pagar.slack_canal_id";
export const CHAVES_CONTAS_PAGAR: readonly string[] = [CHAVE_CORTE_ANTECIPACOES, CHAVE_SLACK_CANAL, CHAVE_SLACK_CANAL_ID];

export type ParametrosContasPagar = {
  /** Antecipações com data de referência anterior a esta ('aaaa-mm-dd') ficam fora da lista; null = todas entram. */
  corteAntecipacoes: string | null;
  /** Canal do Slack para o diretor enviar a autorização; null = abre o Slack no último canal. */
  slackCanalUrl: string | null;
  /** ID do canal para o envio pelo aplicativo do Slack; null = envio não configurado. */
  slackCanalId: string | null;
};

const ehDataIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export function lerParametrosContasPagar(linhas: readonly { chave: string; valor: unknown }[]): ParametrosContasPagar {
  const corte = linhas.find((l) => l.chave === CHAVE_CORTE_ANTECIPACOES)?.valor;
  const slack = linhas.find((l) => l.chave === CHAVE_SLACK_CANAL)?.valor;
  const canalId = linhas.find((l) => l.chave === CHAVE_SLACK_CANAL_ID)?.valor;
  const slackCanalId = typeof canalId === "string" && /^[CG][A-Z0-9]{8,}$/.test(canalId) ? canalId : null;
  // Com o ID do canal, o link de abertura direta dispensa o link configurado à mão.
  const slackCanalUrl = ehLinkSlack(slack) ? slack : slackCanalId ? `https://slack.com/app_redirect?channel=${slackCanalId}` : null;
  return { corteAntecipacoes: ehDataIso(corte) ? corte : null, slackCanalUrl, slackCanalId };
}

/** Só links do Slack (web ou app), para o botão nunca abrir outra coisa. */
export function ehLinkSlack(v: unknown): v is string {
  return typeof v === "string" && /^(https:\/\/([a-z0-9-]+\.)?slack\.com\/|slack:\/\/)/i.test(v);
}
