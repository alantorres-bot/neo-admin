// Registro dos leitores (escolhido pela coluna `crt_cartoes.leitor`) e a leitura de CSV como "página" para o leitor genérico.
import type { CodigoLeitor } from "../modulo";
import { lerGenerico } from "./generico";
import { lerInter } from "./inter";
import { lerUnicred } from "./unicred";
import { lerNubank } from "./nubank";
import { lerPicpay } from "./picpay";
import { lerSicredi } from "./sicredi";
import type { ContextoLeitura, Leitor, PaginaTexto, ResultadoLeitura } from "./tipos";

export const LEITOR: Record<CodigoLeitor, Leitor> = { sicredi: lerSicredi, picpay: lerPicpay, inter: lerInter, unicred: lerUnicred, nubank: lerNubank, generico: lerGenerico };

export function lerFatura(leitor: CodigoLeitor, paginas: readonly PaginaTexto[], contexto: ContextoLeitura): ResultadoLeitura {
  return LEITOR[leitor](paginas, contexto);
}

/** Matriz de um CSV/XLSX vira uma página: cada linha da planilha é uma linha visual, cada célula um item (x = coluna). */
export function paginaDeMatriz(matriz: readonly (readonly string[])[]): PaginaTexto {
  const itens = matriz.flatMap((linha, r) => linha.map((celula, c) => ({ x: c * 100, y: r * 10, w: 90, texto: String(celula ?? "").trim() })).filter((i) => i.texto));
  return { numero: 1, largura: 1000, altura: matriz.length * 10, itens };
}

export type { ContextoLeitura, ItemTexto, Leitor, LinhaLida, PaginaTexto, ResultadoLeitura } from "./tipos";
