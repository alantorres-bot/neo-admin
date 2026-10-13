// E-mail da filial ao cliente com o kit (Fases C e F). Modelo do e-mail que a filial já manda (ex.: "Faturamento AQ Engenharia -
// Rio Piracicaba/MG"): saudação, o que segue anexo, o período de faturamento, a obra e o pedido de confirmação. Termina em
// "Atenciosamente," sem assinatura (regra 3 do CLAUDE.md). Regra pura: a tela mostra para a pessoa conferir e editar.
// Três modos: o kit completo; a nota e o demonstrativo antes do boleto; e só o boleto, em resposta ao e-mail anterior.
import type { TipoDocumentoKit } from "./arquivos";

export type ModoEmailCliente = "completo" | "nota" | "boleto";

export type DadosEmailCliente = {
  cliente: string;
  nota: string;
  obra: string | null;
  periodoInicio: string | null;
  periodoFim: string | null;
  /** Tipos de documento anexados ao kit (o boleto entra sempre no modo completo). */
  documentos: readonly TipoDocumentoKit[];
  /** Hora em Cuiabá (0–23), para a saudação. */
  hora: number;
  /** completo (padrão) · nota: antes do boleto, avisando que ele vai depois · boleto: só o boleto, em resposta. */
  modo?: ModoEmailCliente;
  /** Assunto do primeiro e-mail (modo boleto). */
  assuntoAnterior?: string | null;
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

const emLista = (partes: string[]) => (partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`);

/** "Nota Fatura, boleto, demonstrativo e comodato" (na ordem do e-mail da filial), mais a carta de cessão, se houver. */
export function textoAnexos(documentos: readonly TipoDocumentoKit[], comBoleto = true): string {
  const tem = new Set(documentos);
  const partes = ["Nota Fatura"];
  if (comBoleto) partes.push("boleto");
  if (tem.has("demonstrativo")) partes.push("demonstrativo");
  if (tem.has("comodato")) partes.push("comodato");
  if (tem.has("carta_cessao")) partes.push("carta de cessão de crédito");
  return emLista(partes);
}

const fim = ["Gentileza confirmar o recebimento deste e-mail.", "", "Atenciosamente,"];

export function montarEmailCliente(d: DadosEmailCliente): { assunto: string; corpo: string } {
  const assunto = `Faturamento ${d.cliente}${d.obra ? ` - ${d.obra}` : ` - NF ${Number(d.nota)}`}`;
  const periodo = textoPeriodo(d.periodoInicio, d.periodoFim);
  const saudacao = `Prezado cliente, ${saudacaoDoDia(d.hora)}`;
  const referencia = periodo ? ` referente ao período de faturamento ${periodo}` : ` referente à NF ${Number(d.nota)}`;
  const obra = d.obra ? [`Obra: ${d.obra}`, ""] : [];

  if (d.modo === "boleto") {
    const anterior = (d.assuntoAnterior ?? "").trim() || assunto;
    return {
      assunto: /^re:/i.test(anterior) ? anterior : `Re: ${anterior}`,
      corpo: [
        saudacao, "",
        `Segue anexo o boleto referente à NF ${Number(d.nota)}${periodo ? ` (período de faturamento ${periodo})` : ""}, conforme e-mail anterior.`, "",
        ...fim,
      ].join("\n"),
    };
  }
  if (d.modo === "nota") {
    const docs = textoAnexos(d.documentos.filter((t) => t !== "carta_cessao"), false);
    return {
      assunto,
      corpo: [saudacao, "", `Segue anexo ${docs}${referencia}.`, "O boleto será enviado em seguida, neste mesmo e-mail.", "", ...obra, ...fim].join("\n"),
    };
  }
  return { assunto, corpo: [saudacao, "", `Segue anexo ${textoAnexos(d.documentos)}${referencia}.`, "", ...obra, ...fim].join("\n") };
}
