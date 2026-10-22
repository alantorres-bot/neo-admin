import { redirect } from "next/navigation";
import { ROTA_CREDITOS } from "@/lib/modulos/fiscal/creditos/modulo";

export default function PaginaCreditos() {
  redirect(`${ROTA_CREDITOS}/painel`);
}
