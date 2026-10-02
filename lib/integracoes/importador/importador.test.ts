import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { lerBuffer, textoDaCelula } from "./ler-arquivo";
import {
  aplicarMapeamento, criarModelo, detectarLinhaCabecalho, extrairTabela, lerCamposDestino, lerModelo, nomesDeColunas,
  reaproveitarModelo, sugerirMapeamento, validarMapeamento, type CampoDestino,
} from "./tabela";

const paraBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const campos: CampoDestino[] = [
  { chave: "documento", rotulo: "Documento", obrigatorio: true },
  { chave: "cliente", rotulo: "Cliente", apelidos: ["Nome do cliente", "Razão social"] },
  { chave: "vencimento", rotulo: "Vencimento", obrigatorio: true, apelidos: ["Dt. Vencimento"] },
  { chave: "valor", rotulo: "Valor", apelidos: ["Vlr. Título"] },
];

describe("leitura de CSV", () => {
  it("lê CSV em Windows-1252 com ';' (Consistem) sem estragar acentos nem separadores decimais", async () => {
    const csv = "Documento;Nome do cliente;Dt. Vencimento;Vlr. Título\r\n1001;Construções São João;10/10/2026;1.234,56\r\n1002;Ação Ltda;11/10/2026;99,00\r\n";
    const r = await lerBuffer(paraBuffer(Buffer.from(csv, "latin1")), "abertos.csv");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.planilhas[0].matriz[0]).toEqual(["Documento", "Nome do cliente", "Dt. Vencimento", "Vlr. Título"]);
    expect(r.planilhas[0].matriz[1]).toEqual(["1001", "Construções São João", "10/10/2026", "1.234,56"]);
  });

  it("lê UTF-8 com BOM e vírgula; vírgula dentro de aspas não separa", async () => {
    const csv = "﻿documento,cliente\n1,\"Silva, Souza & Cia\"\n";
    const r = await lerBuffer(paraBuffer(Buffer.from(csv, "utf8")), "a.csv");
    expect(r.ok && r.planilhas[0].matriz).toEqual([["documento", "cliente"], ["1", "Silva, Souza & Cia"]]);
  });

  it("permite forçar o delimitador", async () => {
    const r = await lerBuffer(paraBuffer(Buffer.from("a|b;c\n1|2;3\n")), "a.csv", { delimitador: "|" });
    expect(r.ok && r.planilhas[0].matriz[0]).toEqual(["a", "b;c"]);
  });

  it("recusa formatos não suportados, .xls antigo, arquivo vazio e arquivo grande demais", async () => {
    expect(await lerBuffer(new ArrayBuffer(10), "a.pdf")).toMatchObject({ ok: false });
    expect(await lerBuffer(new ArrayBuffer(10), "a.xls")).toMatchObject({ ok: false, erro: expect.stringContaining(".xlsx") });
    expect(await lerBuffer(new ArrayBuffer(0), "a.csv")).toMatchObject({ ok: false, erro: "O arquivo não tem dados." });
    expect(await lerBuffer(new ArrayBuffer(16 * 1024 * 1024), "a.csv")).toMatchObject({ ok: false, erro: expect.stringContaining("15 MB") });
  });
});

describe("leitura de XLSX", () => {
  it("lê as abas com texto, números, datas (sem deslocar o dia) e fórmulas; ignora aba vazia", async () => {
    const livro = new ExcelJS.Workbook();
    const aba = livro.addWorksheet("Títulos");
    aba.addRow(["Consulta de Títulos em Aberto"]);
    aba.addRow([]);
    aba.addRow(["Documento", "Cliente", "Vencimento", "Valor"]);
    aba.addRow([1001, "Alfa", new Date(Date.UTC(2026, 9, 10)), 1234.56]);
    aba.addRow([1002, { richText: [{ text: "Be" }, { text: "ta" }] }, new Date(Date.UTC(2026, 9, 11, 14, 30)), { formula: "A5*2", result: 2004 }]);
    livro.addWorksheet("Vazia");
    const buffer = Buffer.from(await livro.xlsx.writeBuffer());

    const r = await lerBuffer(paraBuffer(buffer), "abertos.xlsx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.planilhas.map((p) => p.nome)).toEqual(["Títulos"]);
    const m = r.planilhas[0].matriz;
    expect(m[0][0]).toBe("Consulta de Títulos em Aberto");
    expect(m[3]).toEqual(["1001", "Alfa", "10/10/2026", "1234.56"]);
    expect(m[4]).toEqual(["1002", "Beta", "11/10/2026 14:30", "2004"]);
  });

  it("textoDaCelula trata erro, nulo e hiperlink", () => {
    expect(textoDaCelula(null)).toBe("");
    expect(textoDaCelula({ error: "#N/A" })).toBe("");
    expect(textoDaCelula({ text: "site", hyperlink: "https://x.com" })).toBe("site");
    expect(textoDaCelula(42)).toBe("42");
  });
});

describe("tabela e cabeçalho", () => {
  const matriz = [
    ["Consulta de Títulos em Aberto"],
    ["Empresa: Neo Formas", "", "Emissão: 02/10/2026"],
    [],
    ["Documento", "Cliente", "Vencimento", "Valor", ""],
    ["1001", "Alfa", "10/10/2026", "1.234,56", ""],
    ["", "", "", "", ""],
    ["1002", "Beta", "11/10/2026", "99,00"],
  ];

  it("detecta o cabeçalho ignorando as linhas de título do relatório", () => {
    expect(detectarLinhaCabecalho(matriz)).toBe(3);
  });

  it("não confunde uma linha de dados numérica com cabeçalho", () => {
    expect(detectarLinhaCabecalho([["Documento", "Valor"], ["1001", "10,00"], ["1002", "20,00"]])).toBe(0);
    expect(detectarLinhaCabecalho([[""], [""]])).toBe(0);
  });

  it("extrai a tabela: pula linhas vazias, completa linhas curtas e nomeia colunas sem título", () => {
    const t = extrairTabela(matriz, 3);
    expect(t.colunas).toEqual(["Documento", "Cliente", "Vencimento", "Valor", "Coluna 5"]);
    expect(t.linhas).toEqual([
      ["1001", "Alfa", "10/10/2026", "1.234,56", ""],
      ["1002", "Beta", "11/10/2026", "99,00", ""],
    ]);
  });

  it("repetidos ganham sufixo", () => {
    expect(nomesDeColunas(["Valor", "Valor", " ", "Valor"])).toEqual(["Valor", "Valor (2)", "Coluna 3", "Valor (3)"]);
  });
});

describe("campos de destino digitados", () => {
  it("um por linha; asterisco marca obrigatório; chave sem acento em snake_case; ignora vazios e repetidos", () => {
    const campos = lerCamposDestino("Documento*\r\n\nData de Vencimento *\nValor\nvalor\nSituação");
    expect(campos).toEqual([
      { chave: "documento", rotulo: "Documento", obrigatorio: true },
      { chave: "data_de_vencimento", rotulo: "Data de Vencimento", obrigatorio: true },
      { chave: "valor", rotulo: "Valor", obrigatorio: false },
      { chave: "situacao", rotulo: "Situação", obrigatorio: false },
    ]);
    expect(lerCamposDestino("  \n\n")).toEqual([]);
    expect(lerCamposDestino("***")).toEqual([]);
  });
});

describe("mapeamento", () => {
  const tabela = extrairTabela(
    [["Documento", "Nome do cliente", "Dt. Vencimento", "Vlr. Título", "Obs"], ["1001", "Alfa", "10/10/2026", "10,00", "x"]],
    0,
  );

  it("sugere por nome ignorando acento, caixa e pontuação, usando apelidos", () => {
    expect(sugerirMapeamento(tabela.colunas, campos)).toEqual({
      Documento: "documento",
      "Nome do cliente": "cliente",
      "Dt. Vencimento": "vencimento",
      "Vlr. Título": "valor",
    });
  });

  it("cada campo é sugerido para uma única coluna", () => {
    const m = sugerirMapeamento(["Cliente", "CLIENTE", "cliente"], campos);
    expect(Object.values(m)).toEqual(["cliente"]);
  });

  it("valida campos obrigatórios sem coluna e campos ligados a mais de uma coluna", () => {
    expect(validarMapeamento({ Documento: "documento" }, campos).map((p) => [p.tipo, p.campo])).toEqual([["obrigatorio_sem_coluna", "vencimento"]]);
    expect(validarMapeamento({ A: "documento", B: "documento", C: "vencimento" }, campos).map((p) => [p.tipo, p.campo])).toEqual([["campo_duplicado", "documento"]]);
    expect(validarMapeamento({ A: "documento", C: "vencimento" }, campos)).toEqual([]);
  });

  it("aplica o mapeamento: só colunas mapeadas, com o texto bruto", () => {
    const mapa = sugerirMapeamento(tabela.colunas, campos);
    expect(aplicarMapeamento(tabela, mapa)).toEqual([
      { documento: "1001", cliente: "Alfa", vencimento: "10/10/2026", valor: "10,00" },
    ]);
  });

  it("reaproveita o modelo salvo e avisa das colunas que sumiram do arquivo novo", () => {
    const modelo = criarModelo({ Documento: "documento", "Dt. Vencimento": "vencimento", "Coluna Antiga": "valor" }, 3);
    const r = reaproveitarModelo(modelo, ["Documento", "Dt. Vencimento", "Outra"]);
    expect(r.colunas).toEqual({ Documento: "documento", "Dt. Vencimento": "vencimento" });
    expect(r.ausentes).toEqual(["Coluna Antiga"]);
  });

  it("lerModelo só aceita o formato esperado (jsonb vindo do banco não é confiável)", () => {
    const ok = criarModelo({ A: "documento" }, 2);
    expect(lerModelo(JSON.parse(JSON.stringify(ok)))).toEqual(ok);
    expect(lerModelo(null)).toBeNull();
    expect(lerModelo({ versao: 2, linhaCabecalho: 0, colunas: {} })).toBeNull();
    expect(lerModelo({ versao: 1, linhaCabecalho: 0, colunas: { A: 1 } })).toBeNull();
    expect(lerModelo({ Nome: "nome" })).toBeNull();
  });
});
