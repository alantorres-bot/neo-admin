import { redirect } from "next/navigation";
import { ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";

// A entrada do módulo é a grade dos meses do ano.
export default function PaginaValeTransporte() {
  redirect(`${ROTA_VT}/meses`);
}
