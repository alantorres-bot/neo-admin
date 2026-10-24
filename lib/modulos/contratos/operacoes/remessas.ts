// Contratos/Operações — acompanhamento de remessas por contagem (docs/modulos/contratos-operacoes.md, 5.9.4; D-5).
// Só conta remessas: não há saldo por item nem por quantidade.

export type SituacaoRemessa = "prevista" | "remetida" | "entregue" | "cancelada";
export type Remessa = { situacao: SituacaoRemessa; notaId: string | null };

/** "realizadas X de Y": conta só `remetida`/`entregue` com NF de remessa; canceladas não contam; previstas nulo = não informado. */
export function resumoRemessas(remessas: readonly Remessa[], previstas: number | null): { realizadas: number; texto: string; completas: boolean } {
  const realizadas = remessas.filter((r) => (r.situacao === "remetida" || r.situacao === "entregue") && r.notaId !== null).length;
  if (previstas === null) return { realizadas, texto: `${realizadas} realizada(s) de não informado`, completas: false };
  return { realizadas, texto: `${realizadas} realizada(s) de ${previstas}`, completas: realizadas === previstas };
}
