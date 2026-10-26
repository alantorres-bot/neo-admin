import { describe, expect, it } from "vitest";
import { idsComMesmoNomeEmOutraRaiz, lerFinalidade, linkDoDrive, mostrarAtalhoDocumentos, padraoBusca } from "./busca";

describe("busca da Central de Documentos", () => {
  it("padrão: normaliza como a indexação, escapa curingas e exige 2 caracteres", () => {
    expect(padraoBusca("  Contrato   de VENDA ")).toBe("%contrato de venda%");
    expect(padraoBusca("Fôrmas")).toBe("%formas%");
    expect(padraoBusca("100%_x")).toBe("%100\\%\\_x%");
    expect(padraoBusca("a")).toBeNull();
    expect(padraoBusca(undefined)).toBeNull();
    expect(padraoBusca(["x"])).toBeNull();
  });

  it("finalidade: só os valores conhecidos", () => {
    expect(lerFinalidade("elaboracao")).toBe("elaboracao");
    expect(lerFinalidade("dossie_cliente")).toBe("dossie_cliente");
    expect(lerFinalidade("toString")).toBe("todas");
    expect(lerFinalidade(undefined)).toBe("todas");
  });

  it("mesmo nome em raízes diferentes é marcado; na mesma raiz, não", () => {
    const linhas = [
      { id: "1", nome: "229.docx", nome_normalizado: "229.docx", raiz_id: "E" },
      { id: "2", nome: "229.docx", nome_normalizado: "229.docx", raiz_id: "D" },
      { id: "3", nome: "x.pdf", nome_normalizado: "x.pdf", raiz_id: "D" },
      { id: "4", nome: "x.pdf", nome_normalizado: "x.pdf", raiz_id: "D" },
    ];
    expect([...idsComMesmoNomeEmOutraRaiz(linhas)].sort()).toEqual(["1", "2"]);
  });

  it("atalho Documentos: só admin geral, com o módulo ativo e alguma raiz ATIVA", () => {
    const ativo = [{ codigo: "administrativo.ged", ativo: true }];
    const inativo = [{ codigo: "administrativo.ged", ativo: false }];
    const raiz = [{ situacao: "ativa" }];
    expect(mostrarAtalhoDocumentos(ativo, true, raiz)).toBe(true);
    expect(mostrarAtalhoDocumentos(ativo, false, raiz)).toBe(false);            // não é admin geral
    expect(mostrarAtalhoDocumentos(inativo, true, raiz)).toBe(false);           // módulo inativo
    expect(mostrarAtalhoDocumentos(ativo, true, [])).toBe(false);
    expect(mostrarAtalhoDocumentos(ativo, true, [{ situacao: "inativa" }])).toBe(false);
    expect(mostrarAtalhoDocumentos(ativo, true, null)).toBe(false);             // erro na consulta: some, não vaza
  });

  it("link: só do Google Drive/Docs, por https", () => {
    expect(linkDoDrive("https://drive.google.com/file/d/abc/view")).toBe("https://drive.google.com/file/d/abc/view");
    expect(linkDoDrive("https://docs.google.com/document/d/abc/edit")).toBe("https://docs.google.com/document/d/abc/edit");
    for (const ruim of ["javascript:alert(1)", "http://drive.google.com/x", "https://drive.google.com.evil.invalid/x", null]) {
      expect(linkDoDrive(ruim)).toBeNull();
    }
  });
});
