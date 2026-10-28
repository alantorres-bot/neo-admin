// Contratos/Operações — evidência do PDF enviado da minuta (docs/modulos/contratos-operacoes.md, 5.5.3; R4-P2 — PDF da minuta).
// Ciclo: `vinculado_no_envio` (final) ou `pendente` → `regularizado` | `sem_pdf_justificado` (uma vez, auditado).
// Fora daqui, por estarem pendentes [PENDENTE 22]: quem regulariza, quem justifica, o prazo e se o contrato chega a
// `assinado` com PDF pendente. O efeito sobre o faturamento é o PENDENTE 29: nenhuma função deste arquivo o presume.

export const PDF_SITUACOES = ["vinculado_no_envio", "pendente", "regularizado", "sem_pdf_justificado"] as const;
export type PdfSituacao = (typeof PDF_SITUACOES)[number];

export const ROTULO_PDF_SITUACAO: Record<PdfSituacao, string> = {
  vinculado_no_envio: "PDF vinculado no envio",
  pendente: "PDF pendente",
  regularizado: "PDF regularizado",
  sem_pdf_justificado: "Sem PDF (justificado)",
};

/** O documento do GED como a minuta o enxerga. */
export type DocumentoPdf = {
  id: string;
  tipo: string;
  tipoSituacao: "sugerido" | "confirmado" | "sem_tipo";
  mime: string;
  situacao: string;
  vinculoAtivo: boolean;
};

const TIPOS_PDF_MINUTA = ["contrato_minuta", "aditamento"];

/**
 * Confere se o documento pode ser o PDF enviado de uma versão (5.5.3 e AF-10): confirmado no GED, tipo de minuta ou
 * aditamento, PDF, vigente, e não usado como PDF enviado de outra versão. Devolve o motivo da recusa ou null.
 */
export function recusarPdf(doc: DocumentoPdf, pdfsJaUsados: readonly string[]): string | null {
  if (doc.tipoSituacao !== "confirmado") return "O PDF ainda não foi confirmado no GED.";
  if (!TIPOS_PDF_MINUTA.includes(doc.tipo)) return "O documento não é uma minuta nem um aditamento.";
  if (doc.mime !== "application/pdf") return "O documento não é um PDF.";
  if (doc.situacao !== "vigente") return "O documento não está vigente no GED.";
  if (pdfsJaUsados.includes(doc.id)) return "Este PDF já é o PDF enviado de outra versão.";
  return null;
}

export type Envio = {
  driveRevisao: string | null;
  pdfSituacao: "vinculado_no_envio" | "pendente";
  pdf?: DocumentoPdf | null;
  motivoPendente?: string | null;
};

/** Marcar a versão como `enviada`: exige a revisão do DOCX e a situação do PDF (5.5.3). Devolve os erros. */
export function validarEnvio(envio: Envio, pdfsJaUsados: readonly string[]): string[] {
  const erros: string[] = [];
  if (!envio.driveRevisao) erros.push("Informe a revisão do arquivo de trabalho enviada.");
  if (envio.pdfSituacao === "vinculado_no_envio") {
    const recusa = envio.pdf ? recusarPdf(envio.pdf, pdfsJaUsados) : "Escolha o PDF enviado ou marque o PDF como pendente.";
    if (recusa) erros.push(recusa);
  } else if (!envio.motivoPendente?.trim()) {
    erros.push("Informe o motivo de o PDF estar pendente.");
  }
  return erros;
}

export type Regularizacao =
  | { para: "regularizado"; pdf: DocumentoPdf }
  | { para: "sem_pdf_justificado"; justificativa: string; outraEvidencia: string };

/** Saída do `pendente`, uma única vez. Devolve os erros; vazia = pode gravar (e auditar). Não confere quem pode [PENDENTE 22]. */
export function validarRegularizacao(atual: PdfSituacao, r: Regularizacao, pdfsJaUsados: readonly string[]): string[] {
  if (atual !== "pendente") return ["Só um PDF pendente pode ser regularizado; o PDF já vinculado não se troca."];
  if (r.para === "regularizado") {
    const recusa = recusarPdf(r.pdf, pdfsJaUsados);
    return recusa ? [recusa] : [];
  }
  const erros: string[] = [];
  if (!r.justificativa.trim()) erros.push("Informe a justificativa.");
  if (!r.outraEvidencia.trim()) erros.push("Informe a outra evidência do envio.");
  return erros;
}

/** Só mostra o PDF como vinculado quando a evidência é efetiva: situação final com PDF, confirmado no GED e vínculo ativo. */
export function pdfApareceVinculado(situacao: PdfSituacao, doc: DocumentoPdf | null): boolean {
  if (situacao !== "vinculado_no_envio" && situacao !== "regularizado") return false;
  return doc !== null && doc.tipoSituacao === "confirmado" && doc.vinculoAtivo;
}
