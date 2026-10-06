// Módulo AKF (regras puras, sem imports). A AKF Securitizadora recebe títulos da Neo Formas em cessão/antecipação; no
// Consistem o título cedido fica com o portador 998. Portado do Gestor AKF (`carteira.py`, `parametros.py`), em TypeScript.
// Este arquivo cresce a cada fase do módulo (seleção, borderô, conciliação, passivo, prorrogação).

/** Código do portador, no Consistem, dos títulos que estão na AKF. */
export const PORTADOR_AKF = "998";

/** Texto sem acento, em maiúsculas e com espaços simples: para comparar nomes de cliente. */
export function normalizarTexto(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** O cliente é "sem boleto de factoring"? Casa por trecho do nome normalizado (como no Gestor AKF). */
export function clienteSemBoleto(nomeCliente: string, termos: readonly string[]): boolean {
  const alvo = normalizarTexto(nomeCliente);
  return termos.some((t) => {
    const termo = normalizarTexto(t);
    return termo !== "" && alvo.includes(termo);
  });
}

export type DadosAkf = {
  estagio: string;
  /** Faixa de atraso da view `rec_vw_titulos`: 'a_vencer', '01_15', ..., ou 'encerrado'. */
  faixa: string;
  cedido?: boolean | null;
  contestado?: boolean | null;
  codPortador?: string | null;
};

/** O título está na AKF: marcado como cedido ou com o portador 998. */
export const estaNaAkf = (t: Pick<DadosAkf, "cedido" | "codPortador">): boolean => !!t.cedido || t.codPortador === PORTADOR_AKF;

/** Estágios em que o título ainda pode ser antecipado: nada de promessa, renegociação ou jurídico. */
export const ESTAGIOS_ANTECIPAVEIS = ["importado", "aguardando_boleto", "boleto_enviado", "confirmado_cliente"] as const;

/**
 * Disponível para antecipar: em aberto, a vencer, fora da AKF, sem contestação e em estágio normal
 * (regra do Gestor AKF: "não está na AKF e não está vencido").
 */
export function disponivelParaAntecipar(t: DadosAkf): boolean {
  if (t.faixa !== "a_vencer" || estaNaAkf(t) || t.contestado) return false;
  return (ESTAGIOS_ANTECIPAVEIS as readonly string[]).includes(t.estagio);
}

/** Cedido e já vencido, sem encerrar: o foco da cobrança junto à AKF. */
export function vencidoNaAkf(t: DadosAkf): boolean {
  return estaNaAkf(t) && t.faixa !== "a_vencer" && t.faixa !== "encerrado";
}

/** Cedido e ainda em aberto (a vencer ou vencido). */
export function abertoNaAkf(t: DadosAkf): boolean {
  return estaNaAkf(t) && t.faixa !== "encerrado";
}
