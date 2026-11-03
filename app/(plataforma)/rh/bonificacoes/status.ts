import type { StatusLote } from "@/lib/modulos/rh/bonificacoes/modulo";

export const COR_STATUS: Record<StatusLote, string> = {
  enviado: "border-amber-600 text-amber-700", devolvido: "border-destructive text-destructive", preenchido: "border-sky-700 text-sky-800",
  aprovado: "border-marca text-marca", cancelado: "border-grade text-muted-foreground",
};
