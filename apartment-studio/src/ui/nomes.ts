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

/** Nome amigável da parede a partir dos ambientes que ela separa. */
export function nomeParede(planta: Planta, parede: Parede): string {
  const nomes = planta.ambientes
    .filter((amb) => {
      const n = amb.poligono.length;
      return amb.poligono.some((id, i) => {
        const prox = amb.poligono[(i + 1) % n];
        return (id === parede.a && prox === parede.b) || (id === parede.b && prox === parede.a);
      });
    })
    .map((a) => a.nome);
  if (parede.tipo === "guarda-corpo") return `Guarda-corpo${nomes[0] ? ` · ${nomes[0]}` : ""}`;
  if (nomes.length === 0) return `Parede ${parede.a}–${parede.b}`;
  if (nomes.length === 1) return `${nomes[0]} · externa`;
  return nomes.join(" / ");
}

export function nomeAbertura(planta: Planta, ab: Abertura): string {
  const parede = planta.paredes.find((p) => p.id === ab.paredeId);
  return `${NOME_TIPO_ABERTURA[ab.tipo]}${parede ? ` · ${nomeParede(planta, parede)}` : ""}`;
}
