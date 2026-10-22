// Identidade do módulo RH/SST > Colaboradores: o cadastro único do RH, usado pelo vale-transporte e pela folha de pagamento.
// Ver docs/modulos/rh-folha.md (regra 1) e docs/modulos/rh-vale-transporte.md.

export const MODULO_COLABORADORES = "rh.colaboradores";
export const ROTA_COLABORADORES = "/rh/colaboradores";

/** FOPAG = crédito em conta pelo arquivo do BB; PIX = pago à mão. A conta que paga o PIX (e o portador no Consistem) sai da
 *  empregadora, nos Parâmetros de lançamento (0521). */
export const FORMAS_PAGAMENTO = ["fopag", "pix"] as const;
/** As duas formas antigas só aparecem em meses fechados antes de 0521. */
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number] | "pix_neo_formas" | "pix_neo_servicos";
export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  fopag: "FOPAG (arquivo BB)",
  pix: "PIX",
  pix_neo_formas: "PIX - Neo Formas",
  pix_neo_servicos: "PIX - Neo Serviços",
};
export const FORMAS_GRAVADAS = Object.keys(ROTULO_FORMA) as FormaPagamento[];
export const ehFormaPagamento = (v: string): v is (typeof FORMAS_PAGAMENTO)[number] => (FORMAS_PAGAMENTO as readonly string[]).includes(v);

/** Empregadores que aparecem nas planilhas (coluna EMPRESA); o campo aceita outro nome. */
export const EMPREGADORES_SUGERIDOS = ["NEO SERVIÇOS", "OESTE", "NEO FORMAS"] as const;
