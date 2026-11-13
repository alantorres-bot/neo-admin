/** Persistência local no navegador (IndexedDB). O projeto continua salvo ao fechar o navegador. */
import { createStore, get, set } from "idb-keyval";
import type { Projeto } from "../modelo/tipos";

const banco = createStore("apartment-studio", "projetos");
const CHAVE_ATUAL = "projeto:principal";

export async function carregarProjeto(): Promise<Projeto | undefined> {
  const p = await get<Projeto>(CHAVE_ATUAL, banco);
  if (!p || p.versaoModelo !== 1) return undefined;
  return p;
}

export async function salvarProjeto(projeto: Projeto): Promise<void> {
  await set(CHAVE_ATUAL, projeto, banco);
}
