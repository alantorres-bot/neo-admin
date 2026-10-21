// E-mail ao líder do setor com quem precisa folgar (horas a mais) ou repor (horas a menos) antes do vencimento (rascunho no
// Gmail de quem envia). Só lista quem tem horas vencendo, quanto e até quando. Termina em "Atenciosamente," (regra global 3).
import { formatarData } from "@/lib/nucleo/fila";
import { horas } from "@/lib/modulos/rh/ponto/modulo";

export type PessoaVencendo = { nome: string; folgarMin: number; reporMin: number; vencimento: string };

export function emailVencendo(setor: string, pessoas: readonly PessoaVencendo[]): { assunto: string; corpo: string } {
  const ordem = [...pessoas].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.nome.localeCompare(b.nome));
  const folgar = ordem.filter((p) => p.folgarMin > 0).map((p) => `- ${p.nome}: ${horas(p.folgarMin)} até ${formatarData(p.vencimento)}`);
  const repor = ordem.filter((p) => p.reporMin > 0).map((p) => `- ${p.nome}: ${horas(p.reporMin)} até ${formatarData(p.vencimento)}`);
  return {
    assunto: `Banco de horas vencendo — ${setor}`,
    corpo: [
      "Bom dia!",
      "",
      `Há horas do banco de horas do setor ${setor} vencendo. Por favor, programe com cada pessoa até a data indicada:`,
      ...(folgar.length ? ["", "Horas a FOLGAR (trabalhou a mais; folga ou saída antecipada). O que não for folgado será pago na folha:", ...folgar] : []),
      ...(repor.length ? ["", "Horas a REPOR (trabalhou a menos; trabalhar a mais). O que não for reposto será descontado na folha:", ...repor] : []),
      "",
      "Atenciosamente,",
    ].join("\n"),
  };
}
