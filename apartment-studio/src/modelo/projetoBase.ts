/**
 * Projeto-base: a versão do apartamento montada pelo Claude (planta real + mobília do Alan + vistas).
 * Sempre que esta base mudar (novo layout, medida corrigida), aumente BASE_ATUAL: o app usa esse
 * identificador para oferecer a versão nova a quem já tem um projeto salvo no navegador.
 */
import { criarMobilia, criarVistas } from "./mobilia";
import { criarPlantaReal } from "./plantaReal";
import type { Projeto } from "./tipos";

export const BASE_ATUAL = "2026-11-13.1";

export function criarProjetoBase(): Projeto {
  const agora = new Date().toISOString();
  return {
    id: "principal",
    nome: "Meu apartamento",
    versaoModelo: 2,
    base: BASE_ATUAL,
    criadoEm: agora,
    atualizadoEm: agora,
    planta: criarPlantaReal(),
    moveis: criarMobilia(),
    vistas: criarVistas(),
  };
}
