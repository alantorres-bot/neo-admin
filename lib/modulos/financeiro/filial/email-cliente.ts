// E-mail da filial ao cliente com o kit (Fase C). Modelo do e-mail que a filial já manda (ex.: "Faturamento AQ Engenharia -
// Rio Piracicaba/MG"): saudação, o que segue anexo, o período de faturamento, a obra e o pedido de confirmação. Termina em
// "Atenciosamente," sem assinatura (regra 3 do CLAUDE.md). Regra pura: a tela mostra para a pessoa conferir e editar.
import type { TipoDocumentoKit } from "./arquivos";

export type DadosEmailCliente = {
  cliente: string;
  nota: string;
  obra: string | null;
  periodoInicio: string | null;
  periodoFim: string | null;
  /** Tipos de documento anexados ao kit (o boleto entra sempre). */
  documentos: readonly TipoDocumentoKit[];
  /** Hora em Cuiabá (0–23), para a saudação. */
  hora: number;
};

export function saudacaoDoDia(hora: number): string {
  return hora < 12 ? "bom dia" : hora < 18 ? "boa tarde" : "boa noite";
}

/** "13/10 a 11/11/2026" (ano só no fim quando é o mesmo); "28/12/2026 a 27/01/2027" quando muda o ano. */
export function textoPeriodo(inicio: string | null, fim: string | null): string | null {
  if (!inicio || !fim) return null;
  const [ai, mi, di] = inicio.split("-");
  const [af, mf, df] = fim.split("-");
  return ai === af ? `${di}/${mi} a ${df}/${mf}/${af}` : `${di}/${mi}/${ai} a ${df}/${mf}/${af}`;
}

/** "Nota Fatura, boleto, demonstrativo e comodato" (na ordem do e-mail da filial), mais a carta de cessão, se houver. */
export function textoAnexos(documentos: readonly TipoDocumentoKit[]): string {
  const tem = new Set(documentos);
  const partes = ["Nota Fatura", "boleto"];
  if (tem.has("demonstrativo")) partes.push("demonstrativo");
  if (tem.has("comodato")) partes.push("comodato");
  if (tem.has("carta_cessao")) partes.push("carta de cessão de crédito");
  return partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`;
}

export function montarEmailCliente(d: DadosEmailCliente): { assunto: string; corpo: string } {
  const assunto = `Faturamento ${d.cliente}${d.obra ? ` - ${d.obra}` : ` - NF ${Number(d.nota)}`}`;
  const periodo = textoPeriodo(d.periodoInicio, d.periodoFim);
  const linhas = [
    `Prezado cliente, ${saudacaoDoDia(d.hora)}`,
    "",
    `Segue anexo ${textoAnexos(d.documentos)}${periodo ? ` referente ao período de faturamento ${periodo}` : ` referente à NF ${Number(d.nota)}`}.`,
    "",
  ];
  if (d.obra) linhas.push(`Obra: ${d.obra}`, "");
  linhas.push("Gentileza confirmar o recebimento deste e-mail.", "", "Atenciosamente,");
  return { assunto, corpo: linhas.join("\n") };
}
