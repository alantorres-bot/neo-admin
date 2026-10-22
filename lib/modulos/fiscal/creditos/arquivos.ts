// Fiscal > Créditos tributários: validação dos arquivos enviados ao repositório (no SERVIDOR, antes de gravar no bucket).
// Confere extensão permitida, tamanho e o conteúdo real (assinatura dos primeiros bytes), não só o nome ou o tipo informado.

/** Limite da aplicação (a server action aceita até 10 MB no next.config; o bucket aceita 20 MB). */
export const LIMITE_DOCUMENTO = 9 * 1024 * 1024;

type Regra = { mime: string; confere: (b: Uint8Array) => boolean };
const comeca = (b: Uint8Array, ...bytes: number[]) => bytes.every((x, i) => b[i] === x);
const ZIP = (b: Uint8Array) => comeca(b, 0x50, 0x4b, 0x03, 0x04);
const OLE = (b: Uint8Array) => comeca(b, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
/** Texto: sem byte nulo nos primeiros 8 KB (SPED, XML, CSV, TXT). */
const TEXTO = (b: Uint8Array) => !b.subarray(0, 8192).includes(0);

export const EXTENSOES: Record<string, Regra> = {
  pdf: { mime: "application/pdf", confere: (b) => comeca(b, 0x25, 0x50, 0x44, 0x46) },
  png: { mime: "image/png", confere: (b) => comeca(b, 0x89, 0x50, 0x4e, 0x47) },
  jpg: { mime: "image/jpeg", confere: (b) => comeca(b, 0xff, 0xd8, 0xff) },
  jpeg: { mime: "image/jpeg", confere: (b) => comeca(b, 0xff, 0xd8, 0xff) },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", confere: ZIP },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", confere: ZIP },
  xls: { mime: "application/vnd.ms-excel", confere: OLE },
  xml: { mime: "application/xml", confere: (b) => TEXTO(b) && /^\s*(﻿)?</.test(new TextDecoder("latin1").decode(b.subarray(0, 200))) },
  txt: { mime: "text/plain", confere: TEXTO },
  csv: { mime: "text/csv", confere: TEXTO },
};

export const ACCEPT_DOCUMENTOS = Object.keys(EXTENSOES).map((e) => `.${e}`).join(",");

export type ResultadoArquivo = { ok: true; extensao: string; mime: string } | { ok: false; erro: string };

export function validarArquivo(nome: string, bytes: Uint8Array): ResultadoArquivo {
  const ext = /\.([a-z0-9]+)$/i.exec(nome)?.[1]?.toLowerCase() ?? "";
  const regra = EXTENSOES[ext];
  if (!regra) return { ok: false, erro: `Tipo de arquivo não permitido (.${ext || "?"}). Aceitos: ${Object.keys(EXTENSOES).join(", ")}.` };
  if (bytes.length === 0) return { ok: false, erro: "O arquivo está vazio." };
  if (bytes.length > LIMITE_DOCUMENTO) return { ok: false, erro: `Arquivo acima de ${LIMITE_DOCUMENTO / 1024 / 1024} MB.` };
  if (!regra.confere(bytes)) return { ok: false, erro: `O conteúdo não corresponde a um arquivo .${ext} (arquivo renomeado ou corrompido).` };
  return { ok: true, extensao: ext, mime: regra.mime };
}

/** Nome seguro para o caminho no bucket (sem acento, barra ou caractere de controle). */
export function nomeSeguroArquivo(nome: string): string {
  const base = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^[._]+/, "");
  return (base || "arquivo").slice(-120);
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
