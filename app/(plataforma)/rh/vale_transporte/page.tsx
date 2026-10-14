import { redirect } from "next/navigation";
import { ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";

// Por enquanto (Fase A) a entrada do módulo é o cadastro; a Fase B traz as competências mensais.
export default function PaginaValeTransporte() {
  redirect(`${ROTA_VT}/colaboradores`);
}
