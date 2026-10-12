// E-mail de solicitação de antecipação à AKF em HTML (regras puras, sem imports): usado pela Edge Function
// akf-rascunho-gmail e pela prévia da página da solicitação. Parte do corpo em texto já gravado na mensagem, para o HTML
// nunca divergir do texto: as linhas "NF … | cliente | Venc. … | R$ …" viram uma tabela e a linha "Total: …" vira o rodapé.

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type LinhaTabela = { documento: string; cliente: string; vencimento: string; valor: string };

const LINHA = /^NF (.+?) \| (.+) \| Venc\. (\S+) \| (R\$ .+)$/;
const TOTAL = /^Total: (R\$ \S+) \((.+)\)$/;

/** "NF 1335/2 | EFATA | Venc. 20/10/2026 | R$ 120.000,00" -> partes; outra linha -> null. */
export function lerLinhaTitulo(linha: string): LinhaTabela | null {
  const m = LINHA.exec(linha.trim());
  return m ? { documento: m[1], cliente: m[2], vencimento: m[3], valor: m[4] } : null;
}

/** "Total: R$ 170.000,00 (2 títulos)" -> { valor, quantidade }; outra linha -> null. */
export function lerLinhaTotal(linha: string): { valor: string; quantidade: string } | null {
  const m = TOTAL.exec(linha.trim());
  return m ? { valor: m[1], quantidade: m[2] } : null;
}

const FONTE = "font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1f2a37";
const CELULA = "border:1px solid #c9d3e0;padding:5px 10px";
const CABECALHO = `${CELULA};background:#3e5a82;color:#ffffff;font-weight:bold;text-align:left`;

function tabela(linhas: readonly LinhaTabela[], total: { valor: string; quantidade: string } | null): string {
  const corpo = linhas.map((l, i) => `<tr${i % 2 === 1 ? ' style="background:#f5f8fc"' : ""}>`
    + `<td style="${CELULA};white-space:nowrap">${escapar(l.documento)}</td>`
    + `<td style="${CELULA}">${escapar(l.cliente)}</td>`
    + `<td style="${CELULA};white-space:nowrap">${escapar(l.vencimento)}</td>`
    + `<td style="${CELULA};text-align:right;white-space:nowrap">${escapar(l.valor)}</td></tr>`).join("");
  const rodape = total
    ? `<tfoot><tr><td colspan="3" style="${CELULA};font-weight:bold;background:#eaf0f7">Total (${escapar(total.quantidade)})</td>`
      + `<td style="${CELULA};font-weight:bold;background:#eaf0f7;text-align:right;white-space:nowrap">${escapar(total.valor)}</td></tr></tfoot>`
    : "";
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;${FONTE}">`
    + `<thead><tr><th style="${CABECALHO}">Documento</th><th style="${CABECALHO}">Cliente</th><th style="${CABECALHO}">Vencimento</th>`
    + `<th style="${CABECALHO};text-align:right">Valor</th></tr></thead><tbody>${corpo}</tbody>${rodape}</table>`;
}

/**
 * Corpo em texto -> HTML. Linhas de título consecutivas (e o Total logo depois) viram uma tabela; o resto vira texto com
 * quebras de linha. Tudo escapado (nada do texto vira tag).
 */
export function corpoSolicitacaoParaHtml(corpo: string): string {
  const linhas = corpo.replace(/\r\n/g, "\n").split("\n");
  const blocos: string[] = [];
  let texto: string[] = [];
  const fecharTexto = () => {
    if (texto.length > 0) blocos.push(texto.map(escapar).join("<br>"));
    texto = [];
  };
  for (let i = 0; i < linhas.length; i++) {
    const primeira = lerLinhaTitulo(linhas[i]);
    if (!primeira) {
      texto.push(linhas[i]);
      continue;
    }
    // Remove a linha em branco que antecede a tabela (o espaço fica por conta da margem da tabela).
    if (texto.length > 0 && texto[texto.length - 1].trim() === "") texto.pop();
    fecharTexto();
    const itens = [primeira];
    while (i + 1 < linhas.length && lerLinhaTitulo(linhas[i + 1])) itens.push(lerLinhaTitulo(linhas[++i]) as LinhaTabela);
    const total = i + 1 < linhas.length ? lerLinhaTotal(linhas[i + 1]) : null;
    if (total) i++;
    blocos.push(`<div style="margin:10px 0 14px">${tabela(itens, total)}</div>`);
    // A linha em branco depois da tabela também sai.
    if (i + 1 < linhas.length && linhas[i + 1].trim() === "") i++;
  }
  fecharTexto();
  return `<div style="${FONTE}">${blocos.join("")}</div>`;
}
