import { redirect } from "next/navigation";
import { ROTA_COLABORADORES } from "@/lib/modulos/rh/colaboradores/modulo";

// O cadastro virou o módulo RH > Colaboradores (cadastro único do RH, migration 0510).
export default function PaginaColaboradoresVt() {
  redirect(ROTA_COLABORADORES);
}
