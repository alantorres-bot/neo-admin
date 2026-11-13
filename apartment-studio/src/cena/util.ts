import type { Planta } from "../modelo/tipos";
import { limites } from "../modelo/geometria";

/** cm → m (unidade da cena). */
export const M = (cm: number) => cm / 100;

/** Centro e tamanho da planta, em metros (x, z da cena). */
export function enquadramento(planta: Planta) {
  const l = limites(planta);
  const cx = M((l.minX + l.maxX) / 2);
  const cz = M((l.minY + l.maxY) / 2);
  const larg = M(l.maxX - l.minX);
  const prof = M(l.maxY - l.minY);
  return { cx, cz, larg, prof, raio: Math.hypot(larg, prof) / 2 };
}

export const COR_SELECAO = "#5b9dff";
