import { redirect } from "next/navigation";
import { ROTA_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";

// A entrada do módulo é a grade de saldos.
export default function PaginaBancoHorasRaiz() {
  redirect(`${ROTA_BANCO_HORAS}/saldos`);
}
