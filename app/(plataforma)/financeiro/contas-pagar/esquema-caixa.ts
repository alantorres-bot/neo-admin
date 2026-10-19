import { z } from "zod";
import { LIMITES_ADICIONAL } from "@/lib/modulos/financeiro/contas-pagar/caixa";

/** Composição do caixa (contas + adicionais do dia) vinda da tela. Os saldos o banco lê sozinho ao gravar. */
export const esquemaComposicao = z.object({
  contas: z.array(z.string().uuid()).max(50, "No máximo 50 contas."),
  adicionais: z.array(z.object({
    descricao: z.string().trim().min(LIMITES_ADICIONAL.descricaoMin, "Descreva cada valor adicional (3 a 200 caracteres).").max(LIMITES_ADICIONAL.descricaoMax, "A descrição pode ter até 200 caracteres."),
    valorCentavos: z.number().int().min(1, "Valor adicional inválido.").max(LIMITES_ADICIONAL.valorMaxCentavos, "Valor acima do limite."),
  })).max(LIMITES_ADICIONAL.maximo, "No máximo 30 valores adicionais."),
});
