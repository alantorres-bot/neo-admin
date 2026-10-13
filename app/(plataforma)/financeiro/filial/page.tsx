import { redirect } from "next/navigation";
import { ABA_INICIAL_FILIAL } from "@/lib/modulos/financeiro/filial/abas";

// O Faturamento Filial abre na Remessa: é onde tudo começa.
export default function PaginaFilial() {
  redirect(ABA_INICIAL_FILIAL);
}
