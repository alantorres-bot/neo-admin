// Identidade do módulo RH/SST > Vale-transporte. Ver docs/modulos/rh-vale-transporte.md.

export const MODULO_VT = "rh.vale_transporte";
export const ROTA_VT = "/rh/vale_transporte";

/** Coluna PAGAMENTO da planilha. FOPAG = crédito em conta pelo arquivo do BB; PIX = pago à mão pela empresa indicada. */
export const FORMAS_PAGAMENTO = ["fopag", "pix_neo_formas", "pix_neo_servicos"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];
export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  fopag: "FOPAG (arquivo BB)",
  pix_neo_formas: "PIX - Neo Formas",
  pix_neo_servicos: "PIX - Neo Serviços",
};
export const ehFormaPagamento = (v: string): v is FormaPagamento => (FORMAS_PAGAMENTO as readonly string[]).includes(v);

/** Empregadores que aparecem na planilha (coluna EMPRESA); o campo aceita outro nome. */
export const EMPREGADORES_SUGERIDOS = ["NEO SERVIÇOS", "OESTE", "NEO FORMAS"] as const;
