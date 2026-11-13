/** Persistência local no navegador (IndexedDB). O projeto continua salvo ao fechar o navegador. */
import { createStore, get, set } from "idb-keyval";
import type { Projeto } from "../modelo/tipos";

const banco = createStore("apartment-studio", "projetos");
const CHAVE_ATUAL = "projeto:principal";

export async function carregarProjeto(): Promise<Projeto | undefined> {
  const p = await get<Projeto>(CHAVE_ATUAL, banco);
  if (!p || p.versaoModelo !== 2 || !Array.isArray(p.moveis)) return undefined;
  return p;
}

export async function salvarProjeto(projeto: Projeto): Promise<void> {
  await set(CHAVE_ATUAL, projeto, banco);
}

/** Cópia de segurança antes de trocar o projeto salvo por uma base nova. */
export async function salvarCopia(projeto: Projeto): Promise<string> {
  const chave = `copia:${new Date().toISOString()}`;
  await set(chave, projeto, banco);
  return chave;
}
