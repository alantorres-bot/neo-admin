// Texto do e-mail ao líder do setor (rascunho no Gmail de quem envia; ninguém recebe nada sem a pessoa conferir e enviar).
// Termina em "Atenciosamente," sem assinatura no corpo (regra global 3).
import { formatarData } from "@/lib/nucleo/fila";

export type ModoEmail = "envio" | "lembrete" | "devolucao";

export function emailAoLider(d: {
  modo: ModoEmail; setor: string; inicio: string; fim: string; prazo: string | null; ocorrencias: number; link: string; motivo?: string | null;
}): { assunto: string; corpo: string } {
  const periodo = `${formatarData(d.inicio)} a ${formatarData(d.fim)}`;
  const prazo = d.prazo ? ` até ${formatarData(d.prazo)}` : "";
  const assunto = {
    envio: `Inconsistências do ponto — ${d.setor} — ${periodo}`,
    lembrete: `Lembrete: inconsistências do ponto — ${d.setor} — ${periodo}`,
    devolucao: `Devolvido: inconsistências do ponto — ${d.setor} — ${periodo}`,
  }[d.modo];
  const abertura = {
    envio: `O relatório de inconsistências do ponto do setor ${d.setor} (${periodo}) tem ${d.ocorrencias} ocorrência(s) para justificar.`,
    lembrete: `As inconsistências do ponto do setor ${d.setor} (${periodo}) ainda estão aguardando a sua justificativa.`,
    devolucao: `O RH devolveu as justificativas do ponto do setor ${d.setor} (${periodo}) para correção.\n\nMotivo: ${d.motivo ?? ""}`,
  }[d.modo];
  const corpo = [
    "Bom dia!",
    "",
    abertura,
    "",
    `Por favor, acesse o link abaixo (entre com a sua conta Google da Neo Formas), escolha a justificativa de cada ocorrência e clique em "Enviar justificativas"${prazo}:`,
    d.link,
    "",
    "Atenciosamente,",
  ].join("\n");
  return { assunto, corpo };
}
