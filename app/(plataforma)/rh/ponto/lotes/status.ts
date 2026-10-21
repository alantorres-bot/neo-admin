import type { StatusLote } from "@/lib/modulos/rh/ponto/modulo";

export const COR_STATUS: Record<StatusLote, string> = {
  importado: "border-grade text-muted-foreground", enviado: "border-amber-600 text-amber-700", devolvido: "border-destructive text-destructive",
  justificado: "border-sky-700 text-sky-800", concluido: "border-marca text-marca", cancelado: "border-grade text-muted-foreground",
};
