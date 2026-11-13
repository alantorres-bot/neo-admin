/**
 * Persistência local no navegador (IndexedDB). O projeto continua salvo ao fechar o navegador.
 * Em alguns contextos (janela privativa, página embutida, dados do site bloqueados) o IndexedDB não
 * existe ou lança erro: nesses casos o app abre normalmente e só não salva aqui (ver estado/nuvem.ts).
 */
import { createStore, del, entries, get, set, type UseStore } from "idb-keyval";
import type { Projeto } from "../modelo/tipos";
import { versaoValida, type Versao } from "../modelo/versoes";

const CHAVE_ATUAL = "projeto:principal";

let loja: UseStore | null | undefined;
/** Abre o banco na primeira vez em que for usado; null quando o navegador não deixa. */
function banco(): UseStore | null {
  if (loja === undefined) {
    try {
      loja = createStore("apartment-studio", "projetos");
    } catch {
      loja = null;
    }
  }
  return loja;
}

export async function carregarProjeto(): Promise<Projeto | undefined> {
  const b = banco();
  if (!b) return undefined;
  const p = await get<Projeto>(CHAVE_ATUAL, b);
  if (!p || p.versaoModelo !== 2 || !Array.isArray(p.moveis)) return undefined;
  return p;
}

export async function salvarProjeto(projeto: Projeto): Promise<void> {
  const b = banco();
  if (!b) throw new Error("Armazenamento do navegador indisponível");
  await set(CHAVE_ATUAL, projeto, b);
}

/** Cópia de segurança antes de trocar o projeto salvo por uma base nova. */
export async function salvarCopia(projeto: Projeto): Promise<string> {
  const b = banco();
  if (!b) throw new Error("Armazenamento do navegador indisponível");
  const chave = `copia:${new Date().toISOString()}`;
  await set(chave, projeto, b);
  return chave;
}

// ------------------------------------------------------------------------------ versões da decoração
const PREFIXO_VERSAO = "versao:";

/** Versões guardadas neste navegador (lista vazia quando o armazenamento não existe). */
export async function listarVersoes(): Promise<Versao[]> {
  const b = banco();
  if (!b) return [];
  const todas = await entries<string, unknown>(b);
  return todas.filter(([chave, valor]) => String(chave).startsWith(PREFIXO_VERSAO) && versaoValida(valor)).map(([, valor]) => valor as Versao);
}

export async function gravarVersao(versao: Versao): Promise<void> {
  const b = banco();
  if (!b) throw new Error("Armazenamento do navegador indisponível");
  await set(PREFIXO_VERSAO + versao.id, versao, b);
}

export async function apagarVersao(id: string): Promise<void> {
  const b = banco();
  if (!b) return;
  await del(PREFIXO_VERSAO + id, b);
}
