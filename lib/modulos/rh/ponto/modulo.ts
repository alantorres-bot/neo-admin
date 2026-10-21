// Identidade do módulo RH/SST > Ponto (inconsistências por quinzena). Ver docs/modulos/rh-ponto.md.

export const MODULO_PONTO = "rh.ponto";
export const ROTA_PONTO = "/rh/ponto";
/** Tela do líder: fora de /rh (o líder não tem a área RH). */
export const ROTA_JUSTIFICAR = "/ponto/justificar";

/** Tipos de justificativa (decisão 4 da especificação), com a ação sugerida ao RH no Control iD. */
export const TIPOS = ["esqueceu_bater", "batida_indevida", "saida_atraso", "falta_injustificada", "justificada", "outro"] as const;
export type Tipo = (typeof TIPOS)[number];

export const ROTULO_TIPO: Record<Tipo, string> = {
  esqueceu_bater: "Esqueceu de bater (trabalhou normalmente)",
  batida_indevida: "Batida indevida (trabalhou normalmente)",
  saida_atraso: "Saída antecipada, atraso ou meio período",
  falta_injustificada: "Falta sem justificativa",
  justificada: "Falta ou atraso justificado (atestado/declaração)",
  outro: "Outro",
};

export const STATUS_LOTE = ["importado", "enviado", "devolvido", "justificado", "concluido", "cancelado"] as const;
export type StatusLote = (typeof STATUS_LOTE)[number];
export const ROTULO_STATUS: Record<StatusLote, string> = {
  importado: "Importado", enviado: "Com o líder", devolvido: "Devolvido ao líder", justificado: "Justificado", concluido: "Concluído", cancelado: "Cancelado",
};

/** Minutos → "hh:mm" (negativo com sinal). null → "". */
export function horas(min: number | null | undefined): string {
  if (min === null || min === undefined) return "";
  const a = Math.abs(min);
  return `${min < 0 ? "-" : ""}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/** "hh:mm" ou "-hh:mm" → minutos; outra coisa → null. */
export function minutos(texto: string | null | undefined): number | null {
  const m = /^(-)?(\d{1,3}):(\d{2})$/.exec((texto ?? "").trim());
  return m ? (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
}

/** Horário informado pelo líder ("17:00", "7:5" não vale). Vazio → null. */
export function horarioValido(texto: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(texto.trim());
}

/**
 * Ação sugerida ao RH para ajustar no Control iD. Só sugere: quem decide é o RH (nenhuma regra de desconto ou DSR aqui).
 * Banco de horas: compara o saldo que veio no PDF com a falta/atraso do dia.
 */
export function acaoSugerida(tipo: Tipo | null, faltaAtrasoMin: number, saldoBancoMin: number | null): string {
  switch (tipo) {
    case null: return "";
    case "esqueceu_bater": return "Incluir a marcação que falta";
    case "batida_indevida": return "Desconsiderar a marcação indevida";
    case "falta_injustificada": return "Descontar";
    case "justificada": return "Abonar (com o documento)";
    case "outro": return "Ver a observação do líder";
    case "saida_atraso":
      if (saldoBancoMin === null) return "Abater no banco de horas, se houver saldo; senão descontar";
      if (saldoBancoMin >= faltaAtrasoMin) return `Abater no banco de horas (saldo ${horas(saldoBancoMin)})`;
      if (saldoBancoMin > 0) return `Saldo do banco (${horas(saldoBancoMin)}) menor que a falta (${horas(faltaAtrasoMin)}): abater o saldo e descontar o restante`;
      return `Descontar (sem saldo no banco: ${horas(saldoBancoMin)})`;
  }
}

/** O que o líder precisa preencher para enviar: tipo em todas; observação em "Outro"; horário, se houver, válido. */
export function pendenciasDoFormulario(itens: readonly { tipo: Tipo | null; observacao: string | null; horario: string | null }[]): string[] {
  const erros: string[] = [];
  const semTipo = itens.filter((i) => !i.tipo).length;
  if (semTipo) erros.push(`${semTipo} ocorrência(s) sem justificativa.`);
  const outroSemObs = itens.filter((i) => i.tipo === "outro" && !(i.observacao ?? "").trim()).length;
  if (outroSemObs) erros.push(`${outroSemObs} ocorrência(s) "Outro" sem observação.`);
  const horarioRuim = itens.filter((i) => (i.horario ?? "").trim() && !horarioValido(i.horario!)).length;
  if (horarioRuim) erros.push(`${horarioRuim} horário(s) inválido(s) (use hh:mm).`);
  return erros;
}
