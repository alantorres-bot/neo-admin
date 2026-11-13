/**
 * Gravador mínimo de planilhas .xlsx (SpreadsheetML), sem dependências: só o que o caderno precisa —
 * várias abas, larguras de coluna, cabeçalho congelado, filtro, estilos básicos e fórmulas.
 */
import { deflateRawSync } from "node:zlib";

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP com compressão deflate. `arquivos`: [{ nome, conteudo (string|Buffer) }]. Data fixa: saída reproduzível. */
export function zip(arquivos) {
  const partes = [];
  const central = [];
  let deslocamento = 0;
  const dataDos = ((2026 - 1980) << 9) | (11 << 5) | 13;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, "utf8");
    const bruto = Buffer.isBuffer(a.conteudo) ? a.conteudo : Buffer.from(a.conteudo, "utf8");
    const comp = deflateRawSync(bruto, { level: 9 });
    const crc = crc32(bruto);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(dataDos, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(bruto.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nome, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(dataDos, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(bruto.length, 24);
    c.writeUInt16LE(nome.length, 28);
    c.writeUInt32LE(deslocamento, 42);
    central.push(c, nome);
    deslocamento += local.length + nome.length + comp.length;
  }
  const tamCentral = central.reduce((a, b) => a + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamCentral, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, ...central, fim]);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const coluna = (i) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Estilos disponíveis (índice em cellXfs). */
export const E = { padrao: 0, cabecalho: 1, texto: 2, inteiro: 3, decimal2: 4, titulo: 5, preencher: 6, negrito: 7, decimal1: 8, moeda: 9, grupo: 10, nota: 11, decimal3: 12 };

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0.000"/></numFmts>
<fonts count="5"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font><font><i/><sz val="9"/><color rgb="FF4B5563"/><name val="Arial"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF111111"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF7D6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF9CA3AF"/></left><right style="thin"><color rgb="FF9CA3AF"/></right><top style="thin"><color rgb="FF9CA3AF"/></top><bottom style="thin"><color rgb="FF9CA3AF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="4" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * Célula: valor simples (string/número) ou { v, s (estilo), f (fórmula) }.
 * Aba: { nome, colunas: [larguras], linhas: [[células]], congelar (nº de linhas), filtro ("A1:G20") }.
 */
function xmlDaAba(aba) {
  const linhas = aba.linhas
    .map((linha, i) => {
      const celulas = linha
        .map((cel, j) => {
          if (cel === null || cel === undefined || cel === "") return "";
          const ref = `${coluna(j)}${i + 1}`;
          const c = typeof cel === "object" ? cel : { v: cel };
          const estilo = c.s ?? (typeof c.v === "number" ? E.inteiro : E.texto);
          if (c.f) return `<c r="${ref}" s="${estilo}"><f>${esc(c.f)}</f></c>`;
          if (typeof c.v === "number") return `<c r="${ref}" s="${estilo}"><v>${c.v}</v></c>`;
          if (c.v === undefined || c.v === "") return `<c r="${ref}" s="${estilo}"/>`;
          return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
        })
        .join("");
      const altura = aba.alturas?.[i];
      return `<row r="${i + 1}"${altura ? ` ht="${altura}" customHeight="1"` : ""}>${celulas}</row>`;
    })
    .join("");
  const cols = aba.colunas.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const congelar = aba.congelar ? `<pane ySplit="${aba.congelar}" topLeftCell="A${aba.congelar + 1}" activePane="bottomLeft" state="frozen"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"${aba.primeira ? ' tabSelected="1"' : ""}>${congelar}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="14"/>
<cols>${cols}</cols><sheetData>${linhas}</sheetData>${aba.filtro ? `<autoFilter ref="${aba.filtro}"/>` : ""}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

export function xlsx(abas) {
  const arquivos = [
    {
      nome: "[Content_Types].xml",
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    },
    { nome: "_rels/.rels", conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    {
      nome: "xl/workbook.xml",
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${abas.map((a, i) => `<sheet name="${esc(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`,
    },
    {
      nome: "xl/_rels/workbook.xml.rels",
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { nome: "xl/styles.xml", conteudo: ESTILOS },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, conteudo: xmlDaAba({ ...a, primeira: i === 0 }) })),
  ];
  return zip(arquivos);
}
