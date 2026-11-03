// Identidade do módulo RH/SST > Bonificações (o líder lança pelo link; o RH aprova e lança na folha). Ver docs/modulos/rh-bonificacoes.md.
import { valorDaLinha, type Rubrica } from "@/lib/modulos/rh/folha/recibos";

export const MODULO_BONIFICACOES = "rh.bonificacoes";
export const ROTA_BONIFICACOES = "/rh/bonificacoes";
/** Formulário público do líder: /bonificar/<chave do lote>, sem login (qualquer pessoa com o link). */
export const ROTA_BONIFICAR = "/bonificar";
/** Rubrica do recibo Eventual gerado na aprovação (catálogo da folha, 0514: salário × fração). */
export const RUBRICA_BONIFICACAO = "bonificacao_producao";

export const PCTS = [5, 10, 15, 20] as const;
export type Pct = (typeof PCTS)[number];

export const STATUS_LOTE = ["enviado", "devolvido", "preenchido", "aprovado", "cancelado"] as const;
export type StatusLote = (typeof STATUS_LOTE)[number];
export const ROTULO_STATUS: Record<StatusLote, string> = {
  enviado: "Com o líder", devolvido: "Devolvido ao líder", preenchido: "Aguardando aprovação", aprovado: "Aprovado", cancelado: "Cancelado",
};

const FRACAO: Rubrica = { codigo: RUBRICA_BONIFICACAO, descricao: "", natureza: "provento", forma: "fracao_salario", parametro: null, pct_campo: null };

/** Valor da bonificação em centavos: o mesmo cálculo da linha do recibo (salário × pct/100, arredondado em centavos). */
export function valorBonificacao(salario: number, pct: Pct): number {
  return valorDaLinha({ rubrica: FRACAO, referencia: pct / 100 }, { salario, insalubridade_pct: 0, adicional_noturno_pct: 0 }, { assiduidade_mensal: 0, salario_minimo: 0 });
}
