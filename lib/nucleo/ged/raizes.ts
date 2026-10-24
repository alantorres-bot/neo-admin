// GED — pastas-raiz (docs/modulos/administrativo-ged.md, 5.2.4 e 5.3.0).
// Raízes sobrepostas (uma dentro da outra) são recusadas; só a raiz `ativa` é indexada.

export type SituacaoRaiz = "em_verificacao" | "ativa" | "inativa";

/** Raiz como o cadastro a enxerga: o ID do Drive e os IDs de todas as pastas acima dela. */
export type RaizCaminho = { driveId: string; ancestrais: readonly string[] };

/** A nova raiz é a mesma, está dentro ou está acima de alguma raiz já cadastrada? Devolve o driveId em conflito ou null. */
export function raizSobreposta(nova: RaizCaminho, cadastradas: readonly RaizCaminho[]): string | null {
  const conflito = cadastradas.find(
    (r) => r.driveId === nova.driveId || nova.ancestrais.includes(r.driveId) || r.ancestrais.includes(nova.driveId),
  );
  return conflito?.driveId ?? null;
}

export const podeIndexar = (situacao: SituacaoRaiz): boolean => situacao === "ativa";
