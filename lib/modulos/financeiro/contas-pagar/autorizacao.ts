// Regras puras da autorização de pagamento (Financeiro > Contas a pagar): status, quem pode o quê, totais e os textos da
// pendência (os mesmos que a função de banco cap_autorizar grava). Sem imports; testado em autorizacao.test.ts.

export type StatusAutorizacao = "rascunho" | "autorizada" | "cancelada";
export const ROTULO_STATUS: Record<StatusAutorizacao, string> = { rascunho: "Rascunho", autorizada: "Autorizada", cancelada: "Cancelada" };
export const ehStatus = (v: string): v is StatusAutorizacao => v === "rascunho" || v === "autorizada" || v === "cancelada";

export type Papel = { podeOperar: boolean; ehGestor: boolean; userId: string };

/** Só gestor autoriza, e só um rascunho. Quem montou pode autorizar a própria (fluxo real: a diretoria monta e autoriza). */
export const podeAutorizar = (status: StatusAutorizacao, p: Papel): boolean => status === "rascunho" && p.ehGestor;

/** Gestor cancela rascunho ou autorizada; quem montou cancela o próprio rascunho. */
export const podeCancelar = (status: StatusAutorizacao, criadoPor: string | null, p: Papel): boolean =>
  status !== "cancelada" && (p.ehGestor || (status === "rascunho" && criadoPor !== null && criadoPor === p.userId && p.podeOperar));

/** Itens só saem de um rascunho, por operador ou acima. */
export const podeRemoverItem = (status: StatusAutorizacao, p: Papel): boolean => status === "rascunho" && p.podeOperar;

export type ItemResumo = { tipo: "titulo" | "antecipacao"; valorCentavos: number; removido: boolean; baixadoConsistemEm: string | null };
export type Totais = { quantidade: number; centavos: number };
export type ResumoAutorizacao = { titulos: Totais; antecipacoes: Totais; geral: Totais; baixados: number; removidos: number };

export function resumirItens(itens: readonly ItemResumo[]): ResumoAutorizacao {
  const r: ResumoAutorizacao = { titulos: { quantidade: 0, centavos: 0 }, antecipacoes: { quantidade: 0, centavos: 0 }, geral: { quantidade: 0, centavos: 0 }, baixados: 0, removidos: 0 };
  for (const i of itens) {
    if (i.removido) {
      r.removidos++;
      continue;
    }
    const alvo = i.tipo === "titulo" ? r.titulos : r.antecipacoes;
    alvo.quantidade++;
    alvo.centavos += i.valorCentavos;
    r.geral.quantidade++;
    r.geral.centavos += i.valorCentavos;
    if (i.baixadoConsistemEm) r.baixados++;
  }
  return r;
}

const reais = (centavos: number) => {
  const [inteiro, frac] = (Math.abs(centavos) / 100).toFixed(2).split(".");
  return `${centavos < 0 ? "-" : ""}R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
};

/** Título da pendência da Fila do dia (igual ao gravado por cap_autorizar). */
export const tituloPendenciaExecucao = (numero: number, totalCentavos: number): string =>
  `Executar autorização de pagamento nº ${numero} — ${reais(totalCentavos)}`;

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** Prazo da execução: o menor vencimento (ou pagamento programado) dos itens; se já passou, hoje. */
export function prazoExecucao(datas: readonly (string | null)[], hoje: string): string {
  const validas = datas.filter((d): d is string => d !== null).sort();
  const menor = validas[0] ?? hoje;
  return menor < hoje ? hoje : menor;
}

export const criticidadeExecucao = (prazo: string, hoje: string): "alta" | "normal" => (diasEntre(prazo, hoje) <= 3 ? "alta" : "normal");

/** Rótulo curto da linha do item na autorização. */
export function situacaoDoItem(i: { removido: boolean; baixadoConsistemEm: string | null; tipo: "titulo" | "antecipacao" }): string {
  if (i.removido) return "removido";
  if (i.baixadoConsistemEm) return i.tipo === "antecipacao" ? "abatida por NF no Consistem" : "baixado no Consistem";
  return "em aberto no Consistem";
}
