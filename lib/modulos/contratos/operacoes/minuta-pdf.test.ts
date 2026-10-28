import { describe, expect, it } from "vitest";
import { pdfApareceVinculado, recusarPdf, validarEnvio, validarRegularizacao, type DocumentoPdf } from "./minuta-pdf";

const pdf: DocumentoPdf = { id: "d1", tipo: "contrato_minuta", tipoSituacao: "confirmado", mime: "application/pdf", situacao: "vigente", vinculoAtivo: true };

describe("recusarPdf", () => {
  it("aceita PDF confirmado, de minuta, vigente e não usado", () => {
    expect(recusarPdf(pdf, [])).toBeNull();
    expect(recusarPdf({ ...pdf, tipo: "aditamento" }, [])).toBeNull();
  });
  it("recusa o que não está confirmado, não é PDF, não é vigente ou já serve a outra versão (AF-10)", () => {
    expect(recusarPdf({ ...pdf, tipoSituacao: "sugerido" }, [])).not.toBeNull();
    expect(recusarPdf({ ...pdf, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, [])).not.toBeNull();
    expect(recusarPdf({ ...pdf, situacao: "substituido" }, [])).not.toBeNull();
    expect(recusarPdf({ ...pdf, tipo: "contrato_assinado" }, [])).not.toBeNull();
    expect(recusarPdf(pdf, ["d1"])).toBe("Este PDF já é o PDF enviado de outra versão.");
  });
});

describe("validarEnvio", () => {
  it("exige a revisão do DOCX", () => {
    expect(validarEnvio({ driveRevisao: null, pdfSituacao: "vinculado_no_envio", pdf }, [])).toHaveLength(1);
  });
  it("vinculado no envio exige PDF válido", () => {
    expect(validarEnvio({ driveRevisao: "r1", pdfSituacao: "vinculado_no_envio", pdf }, [])).toEqual([]);
    expect(validarEnvio({ driveRevisao: "r1", pdfSituacao: "vinculado_no_envio" }, [])).toHaveLength(1);
  });
  it("pendente exige motivo", () => {
    expect(validarEnvio({ driveRevisao: "r1", pdfSituacao: "pendente", motivoPendente: " " }, [])).toHaveLength(1);
    expect(validarEnvio({ driveRevisao: "r1", pdfSituacao: "pendente", motivoPendente: "PDF com o cliente" }, [])).toEqual([]);
  });
});

describe("validarRegularizacao", () => {
  it("pendente → regularizado só com PDF válido e não usado", () => {
    expect(validarRegularizacao("pendente", { para: "regularizado", pdf }, [])).toEqual([]);
    expect(validarRegularizacao("pendente", { para: "regularizado", pdf }, ["d1"])).toHaveLength(1);
  });
  it("sem PDF justificado exige justificativa e outra evidência", () => {
    expect(validarRegularizacao("pendente", { para: "sem_pdf_justificado", justificativa: "", outraEvidencia: "" }, [])).toHaveLength(2);
  });
  it("não troca PDF já vinculado nem regulariza duas vezes", () => {
    expect(validarRegularizacao("vinculado_no_envio", { para: "regularizado", pdf }, [])).toHaveLength(1);
    expect(validarRegularizacao("regularizado", { para: "regularizado", pdf }, [])).toHaveLength(1);
  });
});

describe("pdfApareceVinculado", () => {
  it("nunca aparece vinculado com situação pendente ou documento não confirmado", () => {
    expect(pdfApareceVinculado("pendente", pdf)).toBe(false);
    expect(pdfApareceVinculado("regularizado", { ...pdf, tipoSituacao: "sugerido" })).toBe(false);
    expect(pdfApareceVinculado("vinculado_no_envio", { ...pdf, vinculoAtivo: false })).toBe(false);
    expect(pdfApareceVinculado("vinculado_no_envio", pdf)).toBe(true);
  });
});
