// Baixa com evidência do Consistem: o que a pessoa precisa conferir antes de marcar. Usado pela tela "Baixas a conferir" e pela
// aba "Registrar baixa" das Tarefas (mesmos avisos, mesma regra do que já vem marcado).
import { diferencaDias } from "../../../nucleo/fila";

/** Pagamento até 7 dias atrás vem marcado; mais antigo vem desmarcado, com aviso. */
export const DIAS_PAGAMENTO_RECENTE = 7;

/** Motivo para conferir antes de marcar (nulo = pagamento recente, de valor igual ao do título: vem marcado). */
export function avisoDaBaixa(t: { valorCentavos: number; valorPagoCentavos: number; pagoEm: string }, hoje: string): string | null {
  const avisos: string[] = [];
  if (t.valorPagoCentavos !== t.valorCentavos) avisos.push("valor difere do título (juros ou desconto)");
  const dias = diferencaDias(hoje, t.pagoEm);
  if (dias > DIAS_PAGAMENTO_RECENTE) avisos.push(`pagamento de há ${dias} dias (baixa lançada com atraso no Consistem, ou código de título reutilizado)`);
  return avisos.length > 0 ? `${avisos.join("; ")}: confira antes de marcar` : null;
}
