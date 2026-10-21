// E-mail ao líder do setor com quem tem crédito de banco de horas vencendo (rascunho no Gmail de quem envia).
// Só lista quem precisa compensar, quanto e até quando. Termina em "Atenciosamente," (regra global 3).
import { formatarData } from "@/lib/nucleo/fila";
import { horas } from "@/lib/modulos/rh/ponto/modulo";

export function emailVencendo(setor: string, pessoas: readonly { nome: string; vencendoMin: number; vencimento: string }[]): { assunto: string; corpo: string } {
  const linhas = [...pessoas].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.nome.localeCompare(b.nome))
    .map((p) => `- ${p.nome}: ${horas(p.vencendoMin)} até ${formatarData(p.vencimento)}`);
  return {
    assunto: `Banco de horas vencendo — ${setor}`,
    corpo: [
      "Bom dia!",
      "",
      `As pessoas abaixo, do setor ${setor}, têm horas no banco que vencem em breve. Por favor, programe a compensação (folga ou saída antecipada) até a data indicada; o que não for compensado será pago na folha.`,
      "",
      ...linhas,
      "",
      "Atenciosamente,",
    ].join("\n"),
  };
}
