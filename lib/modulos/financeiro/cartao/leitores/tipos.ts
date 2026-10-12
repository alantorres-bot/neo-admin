// Tipos comuns dos leitores de fatura. O PDF vira itens de texto POSICIONADOS (x, y em pontos, origem no canto superior
// esquerdo); cada emissor tem um leitor que sabe onde ficam a data, a descrição, a parcela e o valor. Texto corrido não
// serve: Sicredi e PicPay são em colunas e o texto "lido em ordem" embaralha as linhas.
import type { CodigoLeitor } from "../modulo";

export type ItemTexto = { x: number; y: number; w: number; texto: string };
export type PaginaTexto = { numero: number; largura: number; altura: number; itens: ItemTexto[] };

/** Uma linha de transação da fatura, já normalizada. Valor negativo = estorno/crédito. */
export type LinhaLida = {
  ordem: number;
  pagina: number;
  /** 'AAAA-MM-DD' (o ano é inferido quando a fatura só traz dia/mês). */
  dataCompra: string | null;
  descricao: string;
  valorCentavos: number;
  parcelaNum: number | null;
  parcelaTotal: number | null;
  /** Linha que não é despesa do ciclo (pagamento da fatura anterior, saldo, total): fica registrada, mas fora do cruzamento. */
  descartada: boolean;
  motivoDescarte: string | null;
  textoOrigem: string;
};

export type ResultadoLeitura = {
  leitor: CodigoLeitor;
  linhas: LinhaLida[];
  /** "Total da fatura" impresso pelo emissor, quando o leitor o encontra. */
  totalImpressoCentavos: number | null;
  /** Vencimento impresso pelo emissor ('AAAA-MM-DD'), quando encontrado. */
  vencimentoImpresso: string | null;
  avisos: string[];
};

export type ContextoLeitura = {
  /** Vencimento efetivo informado pela pessoa ('AAAA-MM-DD'): referência para inferir o ano das compras. */
  vencimento: string;
};

export type Leitor = (paginas: readonly PaginaTexto[], contexto: ContextoLeitura) => ResultadoLeitura;
