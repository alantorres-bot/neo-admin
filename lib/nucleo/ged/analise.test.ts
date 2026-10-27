// GED — padronização de nomes (5.12): classificação, campos com evidência, nome padronizado e extração de texto.
// Os nomes seguem a ESTRUTURA dos nomes reais do Drive (amostra de 26/10/2026), com clientes fictícios.
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { getDocumentProxy } from "unpdf";
import {
  analisarDocumento,
  criarExtratores,
  extrairTexto,
  limparCampoNome,
  montarNomePadrao,
  unificarClientesDeContratos,
  validarNomeEditado,
  type ClienteCadastro,
  type EntradaAnalise,
} from "../../../supabase/functions/_shared/ged";

const CLIENTES: ClienteCadastro[] = [
  { id: "c-alfa", nome: "ALFA CONSTRUTORA LTDA", documento: "11.222.333/0001-81" },
  { id: "c-beta", nome: "Beta Empreendimentos", documento: null },
];
const PROPRIO = "17209767000128"; // empresa do grupo (nunca é o cliente)
const dossie = (nome: string, o: Partial<EntradaAnalise> = {}): EntradaAnalise =>
  ({ nome, pasta: "Alfa", pastaNivel1: "Alfa", finalidade: "dossie_cliente", texto: null, clientes: CLIENTES, cnpjsProprios: [PROPRIO], ...o });
const elab = (nome: string, o: Partial<EntradaAnalise> = {}): EntradaAnalise =>
  ({ nome, pasta: "2026", pastaNivel1: "Contratos", finalidade: "elaboracao", texto: null, clientes: CLIENTES, cnpjsProprios: [PROPRIO], ...o });
const resumo = (e: EntradaAnalise) => {
  const a = analisarDocumento(e);
  return { tipo: a.tipo, numero: a.numero?.valor ?? null, assunto: a.assunto?.valor ?? null, confianca: a.confianca };
};

describe("classificação pelos nomes (estrutura da amostra real)", () => {
  it.each([
    ["NF 863 - ALFA (ADAPTAÇÃO).pdf", "nf_venda", "863", null],
    ["NF 794 - REM 02 ALFA.pdf", "nf_remessa", "794", "Remessa 02"],
    ["REM 05 - NF 689 ALFA CONSTRUÇÕES.pdf", "nf_remessa", "689", "Remessa 05"],
    ["1_1349 - VENDA ALFA.pdf", "nf_venda", "1349", null],
    ["NF 407 - PARCELA 07 (SALDO).pdf", "nf_venda", "407", "Parcela 07"],
    ["CC-E NF 753 - ALFA.pdf", "carta_correcao", "753", null],
    ["DIFAL NE 596 - ALFA MARACANAU.pdf", "difal", null, null],
    ["FL 411 - ALFA (Parcela 02).pdf", "fatura_locacao", "411", "Parcela 02"],
    ["FL 477 - ALFA (MEDIÇÃO 11).pdf", "fatura_locacao", "477", "Medicao 11"],
    ["FATURA DE LOCAÇÃO - 405.pdf", "fatura_locacao", "405", null],
    ["CNPJ - ALFA EMPREENDIMENTOS (1).pdf", "cartao_cnpj", null, null],
    ["INSC. CNPJ NOVA- ALFA.pdf", "cartao_cnpj", null, null],
    ["QSA.pdf", "qsa", null, null],
    ["cnh mr.pdf", "documento_pessoal", null, null],
    ["Alfa_ CFDF Inscr. Estad..pdf", "inscricao_estadual", null, null],
    ["Procuração de Fulano - Venc. 20.10.2026.pdf", "procuracao", null, null],
    ["160---CONTRATO-DE-VENDA-FRMAS-----Alfa-Caucaia-pdf-D4Sign.pdf", "contrato_assinado", "160", "Venda"],
    ["CTR-110-2024---Alfa-Village-I-pdf-D4Sign.pdf", "contrato_assinado", "110", null],
    ["CTR 136 2026 - Alfa pdf-D4Sign.pdf", "contrato_assinado", "136", null],
    ["119 - CONTRATO DE VENDA FÔRMAS  - Alfa Fortaleza.pdf", "contrato_venda", "119", null],
    ["REMESSA 02.pdf", "outro", null, "Remessa 02"],
    ["VILLAGE DAS ARVORES II.jpeg", "outro", null, null],
  ])("%s → %s", (nome, tipo, numero, assunto) => {
    expect(resumo(dossie(nome))).toMatchObject({ tipo, numero, assunto });
  });

  it("proposta comercial: número com a revisão e o assunto do miolo do nome", () => {
    expect(resumo(dossie("26.120 V Rev01 - Alfa Construtora - 2º Jogo - Lot. Pq. Universitário - Mossoró - RN.pdf"))).toEqual({
      tipo: "proposta_comercial", numero: "26.120 Rev01", assunto: "2º Jogo Lot. Pq. Universitário Mossoró RN", confianca: "media",
    });
    expect(resumo(dossie("26.190 V R04 - Alfa Construtora.docx"))).toMatchObject({ tipo: "proposta_comercial", numero: "26.190 Rev04", assunto: null });
  });

  it("elaboração: pasta de modelos = modelo; arquivo de trabalho com número e cliente curto do nome", () => {
    expect(resumo(elab("CONTRATO DE VENDA FÔRMAS.docx", { pasta: "0-PADRÃO" })).tipo).toBe("modelo_contrato");
    const a = analisarDocumento(elab("229 - CONTRATO DE VENDA FÔRMAS - Beta Empreendimentos.docx"));
    expect([a.tipo, a.numero?.valor, a.cliente?.valor, a.cliente?.contraparteId]).toEqual(["contrato_venda", "229", "Beta Empreendimentos", "c-beta"]);
  });
});

describe("conteúdo, cadastro, confiança e o que nunca é inventado", () => {
  const TEXTO_NF = "DANFE Documento Auxiliar da Nota Fiscal Eletrônica NF-e Nº 000.000.794 Série 1 Natureza da operação REMESSA DE FÔRMAS "
    + "Emitente 17.209.767/0001-28 Destinatário ALFA CONSTRUTORA LTDA 11.222.333/0001-81 Data de emissão 14/07/2025";

  it("NF com nome e conteúdo: confiança alta; número, data e cliente pelo CNPJ do cadastro (o CNPJ do grupo é ignorado)", () => {
    const a = analisarDocumento(dossie("NF 794 - REM 02 ALFA.pdf", { pastaNivel1: "Pasta qualquer", texto: TEXTO_NF }));
    expect(a.tipo).toBe("nf_remessa");
    expect(a.tipoEvidencia).toEqual(["nome", "texto"]);
    expect(a.confianca).toBe("alta");
    expect(a.numero).toEqual({ valor: "794", evidencia: ["nome", "texto"] });
    expect(a.data).toEqual({ valor: "2025-07-14", evidencia: ["texto"] });
    // Pasta sem relação com o cliente: a razão social sem o sufixo jurídico.
    expect(a.cliente).toEqual({ valor: "ALFA CONSTRUTORA", contraparteId: "c-alfa", evidencia: ["texto", "cadastro"] });
    expect(a.metodo).toBe("texto");
    // Pasta do mesmo cliente: o nome curto da pasta.
    expect(analisarDocumento(dossie("NF 794 - REM 02 ALFA.pdf", { texto: TEXTO_NF })).cliente?.valor).toBe("Alfa");
  });

  // Erros da 1ª análise em produção (26/10/2026), com nomes fictícios.
  const MINUTA = "CONTRATO PARTICULAR DE COMPRA E VENDA DE FÔRMAS Pelo presente instrumento as partes ".padEnd(1600, "x ")
    + " Cláusula 9: o DIFAL é do comprador. Termo aditivo por escrito. Inscrição estadual do comprador. Documento assinado eletronicamente.";
  it.each([
    ["228 - CONTRATO DE VENDA - Alfa.docx", MINUTA, "contrato_venda", "228"],
    ["1-228 - CONTRATO DE VENDA - Alfa pdf.pdf", MINUTA, "contrato_venda", "228"],
    ["CTR 136.2026 - Alfa.docx", MINUTA, "contrato_venda", "136"],
    ["CTR 137.2026 - Alfa.pdf", "CONTRATO PARTICULAR DE LOCAÇÃO DE FÔRMAS entre as partes", "contrato_locacao", "137"],
    ["2-26.190 V R04 - Alfa Construtora.pdf.pdf", null, "proposta_comercial", "26.190 Rev04"],
    ["Autorização de faturamento - Alfa.pdf", "AUTORIZAÇÃO DE FATURAMENTO Razão social Alfa Inscrição Estadual 123456 Endereço", "outro", null],
  ])("%s → %s (nome antes do conteúdo; conteúdo só pelo cabeçalho)", (nome, texto, tipo, numero) => {
    expect(resumo(dossie(nome, { texto }))).toMatchObject({ tipo, numero });
  });
  it("cliente curto: do arquivo de trabalho com ponto no número (CTR 138.2026) e sem o ano no fim da pasta", () => {
    const texto = "CONTRATO PARTICULAR DE LOCAÇÃO DE FÔRMAS entre as partes";
    expect(analisarDocumento(elab("CTR 138.2026 - Gama.docx", { texto })).cliente?.valor).toBe("Gama");
    expect(analisarDocumento(dossie("1_1400 - REMESSA 01.pdf", { pastaNivel1: "Alfa 2026" })).cliente?.valor).toBe("Alfa");
  });
  it("contrato assinado só pelo D4Sign (no nome ou no conteúdo), não por cláusula da minuta", () => {
    expect(resumo(dossie("228 - CONTRATO DE VENDA - Alfa pdf-D4Sign.pdf", { texto: MINUTA })).tipo).toBe("contrato_assinado");
    expect(resumo(dossie("228 - CONTRATO DE VENDA - Alfa.pdf", { texto: `${MINUTA} Assinaturas D4Sign` })).tipo).toBe("contrato_assinado");
  });

  it("nome sem pista + conteúdo de NF: tipo pelo texto (confiança média)", () => {
    const a = analisarDocumento(dossie("1_1066.pdf".replace("1_1066", "documento"), { texto: TEXTO_NF }));
    expect([a.tipo, a.confianca, a.numero?.valor]).toEqual(["nf_remessa", "media", "794"]);
  });

  it("XML de NF-e: número, data, natureza e CNPJ do destinatário pelas tags", () => {
    const xml = `<nfeProc><NFe><infNFe Id="NFe1"><ide><natOp>VENDA DE MERCADORIA</natOp><nNF>1349</nNF><dhEmi>2025-03-10T10:00:00-04:00</dhEmi></ide>
      <emit><CNPJ>17209767000128</CNPJ></emit><dest><CNPJ>11222333000181</CNPJ><xNome>ALFA</xNome></dest></infNFe></NFe></nfeProc>`;
    const a = analisarDocumento(dossie("nota.xml", { texto: xml }));
    expect([a.tipo, a.numero?.valor, a.data?.valor, a.cliente?.contraparteId]).toEqual(["nf_venda", "1349", "2025-03-10", "c-alfa"]);
  });

  it("sem evidência: tipo `outro`, confiança baixa, sem número/data inventados; cliente só pela pasta do dossiê", () => {
    const a = analisarDocumento(dossie("scan0001.pdf", { pastaNivel1: "Gama Obras" }));
    expect([a.tipo, a.confianca, a.numero, a.data, a.metodo]).toEqual(["outro", "baixa", null, null, "metadados"]);
    expect(a.cliente).toEqual({ valor: "Gama Obras", contraparteId: null, evidencia: ["pasta"] });
    expect(a.justificativa).toMatch(/sem texto do arquivo/);
  });

  it("data só com rótulo de emissão/assinatura/data por perto e válida", () => {
    expect(analisarDocumento(dossie("x.pdf", { texto: "contrato x ".repeat(5) + "vencimento 31/02/2025 emissão 31/02/2025" })).data).toBeNull();
    expect(analisarDocumento(dossie("x.pdf", { texto: "contrato x ".repeat(5) + "assinado em 05/09/2024" })).data?.valor).toBe("2024-09-05");
  });
});

describe("nome padronizado", () => {
  const base = { tipo: "nf_remessa" as const, numero: { valor: "794", evidencia: [] }, assunto: { valor: "Remessa 02", evidencia: [] },
    cliente: { valor: "Construtora Ação/Teste", contraparteId: null, evidencia: [] }, data: { valor: "2025-07-14", evidencia: [] } };

  it("formato legível: TIPO - número - assunto - cliente - data, sem acento nem caractere proibido, extensão minúscula", () => {
    expect(montarNomePadrao(base, "PDF")).toBe("NF REMESSA - 794 - Remessa 02 - Construtora Acao Teste - 2025-07-14.pdf");
  });

  it("campos ausentes são omitidos", () => {
    expect(montarNomePadrao({ tipo: "cartao_cnpj", numero: null, assunto: null, cliente: { valor: "Alfa", contraparteId: null, evidencia: [] }, data: null }, "pdf"))
      .toBe("CARTAO CNPJ - Alfa.pdf");
    expect(montarNomePadrao({ tipo: "outro", numero: null, assunto: null, cliente: null, data: null }, "jpeg")).toBe("DOCUMENTO.jpeg");
  });

  it("colisão na pasta (atual ou já sugerido, sem diferenciar maiúsculas): (2), (3)…", () => {
    const n1 = montarNomePadrao(base, "pdf");
    expect(montarNomePadrao(base, "pdf", [n1.toUpperCase()])).toBe(n1.replace(".pdf", " (2).pdf"));
    expect(montarNomePadrao(base, "pdf", [n1, n1.replace(".pdf", " (2).pdf")])).toBe(n1.replace(".pdf", " (3).pdf"));
  });

  it("limite de 150 caracteres cortando só o assunto", () => {
    const n = montarNomePadrao({ ...base, assunto: { valor: "x".repeat(300), evidencia: [] } }, "pdf");
    expect(n.length).toBeLessThanOrEqual(150);
    expect(n).toMatch(/^NF REMESSA - 794 - x+ - Construtora Acao Teste - 2025-07-14\.pdf$/);
  });

  it("campo não carrega o separador nem caracteres proibidos; nome editado passa pelas mesmas regras", () => {
    expect(limparCampoNome(' a - b : c * "d" ')).toBe("a b c d");
    expect(validarNomeEditado("NF VENDA - 12 - Cliente: X - 2025-01-01", "pdf")).toBe("NF VENDA - 12 - Cliente X - 2025-01-01.pdf");
    expect(validarNomeEditado("NF VENDA - 12.pdf", "pdf")).toBe("NF VENDA - 12.pdf");
    expect(validarNomeEditado("   ", "pdf")).toBeNull();
    expect(validarNomeEditado("A".repeat(200), "pdf")).toBeNull();
  });
});

describe("extração de texto (as mesmas bibliotecas da Edge: unpdf e jszip)", () => {
  const ex = criarExtratores({ abrirPdf: (b) => getDocumentProxy(b), abrirZip: (b) => JSZip.loadAsync(b) });

  it("DOCX e XLSX: texto do XML interno; XML: conteúdo; outros formatos: não suportado", async () => {
    const docx = new JSZip();
    docx.file("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>CONTRATO DE VENDA de fôrmas entre as partes &amp; anexos</w:t></w:r></w:p></w:body></w:document>");
    const r1 = await extrairTexto(await docx.generateAsync({ type: "uint8array" }), "docx", ex);
    expect(r1.situacao).toBe("texto");
    expect(r1.texto).toContain("CONTRATO DE VENDA de fôrmas entre as partes & anexos");
    const xlsx = new JSZip();
    xlsx.file("xl/sharedStrings.xml", "<sst><si><t>Planilha de medição da obra</t></si><si><t>Total geral do período</t></si></sst>");
    expect((await extrairTexto(await xlsx.generateAsync({ type: "uint8array" }), "xlsx", ex)).texto).toMatch(/Planilha de medição da obra\s+Total geral/);
    expect((await extrairTexto(new TextEncoder().encode("<infNFe><nNF>12</nNF><natOp>VENDA DE MERCADORIA DO ESTABELECIMENTO</natOp></infNFe>"), "xml", ex)).situacao).toBe("texto");
    for (const ext of ["zip", "p7s", "doc", "xls", "jpeg", "lnk"]) expect((await extrairTexto(new Uint8Array([1, 2, 3]), ext, ex)).situacao).toBe("nao_suportado");
  });

  it("PDF com camada de texto é lido; PDF sem texto (como o escaneado) fica `sem_texto`", async () => {
    const { pdfComTexto } = await import("./pdf-teste");
    const r = await extrairTexto(await pdfComTexto("DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA NF-e numero 794"), "pdf", ex);
    expect(r.situacao).toBe("texto");
    expect(r.texto).toMatch(/NOTA FISCAL ELETRONICA/);
    expect((await extrairTexto(await pdfComTexto(""), "pdf", ex)).situacao).toBe("sem_texto");
  });

  it("docx sem o XML do corpo ou com pouco texto: sem_texto", async () => {
    const vazio = new JSZip();
    vazio.file("outro.xml", "<x/>");
    expect((await extrairTexto(await vazio.generateAsync({ type: "uint8array" }), "docx", ex)).situacao).toBe("sem_texto");
  });
});

describe("mesmo contrato, mesmo cliente", () => {
  const cli = (valor: string, contraparteId: string | null, ...evidencia: ("nome" | "pasta" | "texto" | "cadastro")[]) => ({ valor, contraparteId, evidencia });
  const ctr = (tipo: string, n: string, cliente: ReturnType<typeof cli>, assunto: string | null = null) =>
    ({ tipo, numero: { valor: n, evidencia: ["nome" as const] }, assunto: assunto ? { valor: assunto, evidencia: ["nome" as const] } : null, cliente });

  it("o arquivo divergente segue a maioria do cadastro; o assinado conta como a mesma espécie", () => {
    const lote = [
      ctr("contrato_locacao", "137", cli("CANOPUS TERESINA", "c-ter", "texto", "cadastro")),
      ctr("contrato_locacao", "137", cli("CANOPUS", "c-can", "texto", "cadastro")),
      ctr("contrato_venda", "228", cli("Junqueira", null, "pasta")),
    ];
    const gravadas = [
      ctr("contrato_assinado", "137", cli("CANOPUS TERESINA", "c-ter", "texto", "cadastro"), "Locacao"),
      ctr("contrato_venda", "228", cli("CONSTRUJUNQUEIRA", "c-jun", "texto", "cadastro")),
      ctr("contrato_venda", "137", cli("OUTRO", "c-out", "texto", "cadastro")), // venda 137 é outro contrato
    ];
    const m = unificarClientesDeContratos(lote, gravadas);
    expect([...m.keys()]).toEqual([1, 2]);
    expect(m.get(1)).toMatchObject({ cliente: { valor: "CANOPUS TERESINA", contraparteId: "c-ter" } });
    expect(m.get(1)!.nota).toMatch(/contrato 137 \(2 de 3\); o texto deste arquivo aponta outro cliente/);
    expect(m.get(2)).toMatchObject({ cliente: { valor: "CONSTRUJUNQUEIRA", contraparteId: "c-jun", evidencia: ["texto", "cadastro"] } });
  });

  it("mesmo cadastro com rótulos diferentes vira um só; arquivo sozinho não muda", () => {
    const m = unificarClientesDeContratos(
      [ctr("contrato_locacao", "136", cli("Amorim Coutinho -", "c-am", "texto", "cadastro")), ctr("contrato_locacao", "999", cli("X", null, "nome"))],
      [ctr("contrato_locacao", "136", cli("Amorim Coutinho", "c-am", "nome", "cadastro"))],
    );
    expect(m.size).toBe(0); // "Amorim Coutinho -" limpo é "Amorim Coutinho": nada a mudar
  });
});