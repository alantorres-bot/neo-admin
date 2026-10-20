// Identidade do módulo Financeiro > Cartão de crédito (conciliação da fatura x contas a pagar). Ver docs/modulos/financeiro-cartao.md.

export const MODULO_CARTAO = "financeiro.cartao";
export const ROTA_CARTAO = "/financeiro/cartao";

/** Leitores de fatura disponíveis (coluna `crt_cartoes.leitor`). `generico` é o plano B para emissor ainda não calibrado. */
export const LEITORES = ["sicredi", "picpay", "inter", "unicred", "nubank", "generico"] as const;
export type CodigoLeitor = (typeof LEITORES)[number];
export const ROTULO_LEITOR: Record<CodigoLeitor, string> = {
  sicredi: "Sicredi (PDF em colunas)",
  picpay: "PicPay (PDF em duas colunas)",
  inter: "Inter (PDF com senha; data por extenso)",
  unicred: "Unicred Visa (PDF com senha; letras espaçadas)",
  nubank: "Nubank (PDF sem senha; seção Transações)",
  generico: "Genérico (data, descrição e valor por linha)",
};
export const ehLeitor = (v: string): v is CodigoLeitor => (LEITORES as readonly string[]).includes(v);

/** Tamanho máximo da fatura enviada (PDF ou CSV). O `bodySizeLimit` das server actions acompanha este valor (next.config.ts). */
export const TAMANHO_MAXIMO_FATURA = 8 * 1024 * 1024;
