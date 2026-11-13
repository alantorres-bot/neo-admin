import type { Abertura, Parede, Planta, TipoAbertura, TipoAmbiente } from "../modelo/tipos";

export const NOME_TIPO_ABERTURA: Record<TipoAbertura, string> = {
  porta: "Porta",
  "porta-correr": "Porta de correr",
  janela: "Janela",
  vao: "Vão livre",
};

export const NOME_TIPO_AMBIENTE: Record<TipoAmbiente, string> = {
  sala: "Sala",
  jantar: "Sala de jantar",
  cozinha: "Cozinha",
  quarto: "Quarto",
  banheiro: "Banheiro",
  circulacao: "Circulação",
  varanda: "Varanda",
  servico: "Área de serviço",
  outro: "Outro",
};

/** Ponto sobre o segmento a–b (tolerância em cm). */
function noSegmento(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }, tol = 1) {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L === 0) return false;
  const cruz = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / L;
  const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L);
  return cruz <= tol && t >= -tol / L && t <= 1 + tol / L;
}

/** Nome amigável da parede a partir dos ambientes que ela separa (arestas sobre a parede). */
export function nomeParede(planta: Planta, parede: Parede): string {
  if (parede.nome) return parede.nome;
  const m = new Map(planta.vertices.map((v) => [v.id, v]));
  const a = m.get(parede.a);
  const b = m.get(parede.b);
  const nomes = !a || !b ? [] : planta.ambientes
    .filter((amb) => {
      const n = amb.poligono.length;
      return amb.poligono.some((id, i) => {
        const p = m.get(id);
        const q = m.get(amb.poligono[(i + 1) % n]);
        if (!p || !q) return false;
        // aresta do ambiente sobreposta à parede (com comprimento útil)
        const ini = noSegmento(p, a, b) ? p : noSegmento(a, p, q) ? a : null;
        const fim = noSegmento(q, a, b) ? q : noSegmento(b, p, q) ? b : null;
        return !!ini && !!fim && Math.hypot(fim.x - ini.x, fim.y - ini.y) > 20 && noSegmento(ini, a, b) && noSegmento(fim, a, b);
      });
    })
    .map((x) => x.nome);
  if (parede.tipo === "guarda-corpo") return `Guarda-corpo${nomes[0] ? ` · ${nomes[0]}` : ""}`;
  if (nomes.length === 0) return `Parede ${parede.a}–${parede.b}`;
  if (nomes.length === 1) return `${nomes[0]} · externa`;
  return nomes.join(" / ");
}

export function nomeAbertura(planta: Planta, ab: Abertura): string {
  const parede = planta.paredes.find((p) => p.id === ab.paredeId);
  return `${NOME_TIPO_ABERTURA[ab.tipo]}${parede ? ` · ${nomeParede(planta, parede)}` : ""}`;
}
