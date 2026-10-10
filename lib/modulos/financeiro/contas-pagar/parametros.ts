// Parâmetros do módulo Contas a pagar lidos de `configuracoes`. Sem imports.

export const CHAVE_CORTE_ANTECIPACOES = "financeiro.contas-pagar.antecipacoes_a_partir_de";
/** Link do canal do financeiro no Slack (https://app.slack.com/client/T.../C... ou https://<time>.slack.com/archives/C...). */
export const CHAVE_SLACK_CANAL = "financeiro.contas-pagar.slack_canal_url";
export const CHAVES_CONTAS_PAGAR: readonly string[] = [CHAVE_CORTE_ANTECIPACOES, CHAVE_SLACK_CANAL];

export type ParametrosContasPagar = {
  /** Antecipações com data de referência anterior a esta ('aaaa-mm-dd') ficam fora da lista; null = todas entram. */
  corteAntecipacoes: string | null;
  /** Canal do Slack para o diretor enviar a autorização; null = abre o Slack no último canal. */
  slackCanalUrl: string | null;
};

const ehDataIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export function lerParametrosContasPagar(linhas: readonly { chave: string; valor: unknown }[]): ParametrosContasPagar {
  const corte = linhas.find((l) => l.chave === CHAVE_CORTE_ANTECIPACOES)?.valor;
  const slack = linhas.find((l) => l.chave === CHAVE_SLACK_CANAL)?.valor;
  return { corteAntecipacoes: ehDataIso(corte) ? corte : null, slackCanalUrl: ehLinkSlack(slack) ? slack : null };
}

/** Só links do Slack (web ou app), para o botão nunca abrir outra coisa. */
export function ehLinkSlack(v: unknown): v is string {
  return typeof v === "string" && /^(https:\/\/([a-z0-9-]+\.)?slack\.com\/|slack:\/\/)/i.test(v);
}
