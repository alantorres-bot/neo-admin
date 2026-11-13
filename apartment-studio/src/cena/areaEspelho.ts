/** Retângulo espelhado na frente de um móvel (cm, no referencial do móvel) e as emendas entre as portas. */
export interface AreaEspelho {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z: number;
  emendas: number[];
}

/** Junta as frentes espelhadas de um móvel (portas lado a lado no mesmo plano) num retângulo só. */
export function areaDeEspelho(frentes: { p: [number, number, number]; s: [number, number, number] }[]): AreaEspelho | null {
  if (frentes.length === 0) return null;
  const z = Math.max(...frentes.map((f) => f.p[2] + f.s[2] / 2));
  const noPlano = frentes.filter((f) => Math.abs(f.p[2] + f.s[2] / 2 - z) < 0.5);
  const x0 = Math.min(...noPlano.map((f) => f.p[0] - f.s[0] / 2));
  const x1 = Math.max(...noPlano.map((f) => f.p[0] + f.s[0] / 2));
  const y0 = Math.min(...noPlano.map((f) => f.p[1] - f.s[1] / 2));
  const y1 = Math.max(...noPlano.map((f) => f.p[1] + f.s[1] / 2));
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  // emenda = borda esquerda de cada porta, menos a primeira
  const emendas = noPlano
    .map((f) => f.p[0] - f.s[0] / 2)
    .filter((x) => x - x0 > 1)
    .map((x) => Math.round((x - 0.15) * 100) / 100);
  return { x0, x1, y0, y1, z, emendas: [...new Set(emendas)] };
}
