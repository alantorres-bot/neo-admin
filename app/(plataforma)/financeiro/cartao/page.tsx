import { redirect } from "next/navigation";
import { ROTA_CARTAO } from "@/lib/modulos/financeiro/cartao/modulo";

// A entrada do módulo é a grade cartão × mês.
export default function PaginaCartao() {
  redirect(`${ROTA_CARTAO}/meses`);
}
