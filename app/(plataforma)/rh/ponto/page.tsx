import { redirect } from "next/navigation";
import { ROTA_PONTO } from "@/lib/modulos/rh/ponto/modulo";

// A entrada do módulo é a lista das quinzenas.
export default function PaginaPonto() {
  redirect(`${ROTA_PONTO}/lotes`);
}
