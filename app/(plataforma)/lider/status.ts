import type { Status } from "@/lib/modulos/rh/portal-lider/modulo";

export const COR_STATUS: Record<Status, string> = {
  enviada: "border-amber-600 text-amber-700", em_andamento: "border-sky-700 text-sky-800", concluida: "border-marca text-marca",
  recusada: "border-destructive text-destructive", cancelada: "border-grade text-muted-foreground",
};
