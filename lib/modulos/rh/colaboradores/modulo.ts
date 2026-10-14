// Identidade do módulo RH/SST > Colaboradores: o cadastro único do RH, usado pelo vale-transporte e pela folha de pagamento.
// Ver docs/modulos/rh-folha.md (regra 1) e docs/modulos/rh-vale-transporte.md.

export const MODULO_COLABORADORES = "rh.colaboradores";
export const ROTA_COLABORADORES = "/rh/colaboradores";

/** Coluna PAGAMENTO das planilhas. FOPAG = crédito em conta pelo arquivo do BB; PIX = pago à mão pela empresa indicada. */
export const FORMAS_PAGAMENTO = ["fopag", "pix_neo_formas", "pix_neo_servicos"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];
export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  fopag: "FOPAG (arquivo BB)",
  pix_neo_formas: "PIX - Neo Formas",
  pix_neo_servicos: "PIX - Neo Serviços",
};
export const ehFormaPagamento = (v: string): v is FormaPagamento => (FORMAS_PAGAMENTO as readonly string[]).includes(v);

/** Empregadores que aparecem nas planilhas (coluna EMPRESA); o campo aceita outro nome. */
export const EMPREGADORES_SUGERIDOS = ["NEO SERVIÇOS", "OESTE", "NEO FORMAS"] as const;
