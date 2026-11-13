/**
 * Projeto-base: a versão do apartamento montada pelo Claude (planta real + mobília do Alan + vistas).
 * Sempre que esta base mudar (novo layout, medida corrigida), aumente BASE_ATUAL: o app usa esse
 * identificador para oferecer a versão nova a quem já tem um projeto salvo no navegador.
 */
import { definirAcabamento } from "./geometria";
import { criarMobilia, criarVistas } from "./mobilia";
import { criarPlantaReal } from "./plantaReal";
import type { Planta, Projeto } from "./tipos";

export const BASE_ATUAL = "2026-11-13.5";

export const AZUL_MARINHO = "#1c2444";

/**
 * Decisões de pintura do Alan sobre a planta entregue:
 * - parede atrás do sofá (divisória da cozinha) em azul-marinho, só do lado da sala — opção A, escolhida em 13/11.
 * As demais paredes ficam off-white; o banheiro já sai azulejado de plantaReal.ts.
 */
function pintar(planta: Planta): Planta {
  return {
    ...planta,
    paredes: planta.paredes.map((p) => (p.id === "p-coz-sala" ? definirAcabamento(p, "esquerda", "amb-sala", { cor: AZUL_MARINHO }) : p)),
  };
}

export function criarProjetoBase(): Projeto {
  const agora = new Date().toISOString();
  return {
    id: "principal",
    nome: "Meu apartamento",
    versaoModelo: 2,
    base: BASE_ATUAL,
    criadoEm: agora,
    atualizadoEm: agora,
    planta: pintar(criarPlantaReal()),
    moveis: criarMobilia(),
    vistas: criarVistas(),
  };
}
