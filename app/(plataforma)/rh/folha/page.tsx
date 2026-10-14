import { redirect } from "next/navigation";
import { ROTA_FOLHA } from "@/lib/modulos/rh/folha/modulo";

// A entrada do módulo é a grade dos meses do ano.
export default function PaginaFolha() {
  redirect(`${ROTA_FOLHA}/meses`);
}
