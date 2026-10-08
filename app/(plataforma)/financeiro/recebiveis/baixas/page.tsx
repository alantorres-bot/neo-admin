import { redirect } from "next/navigation";

// Endereço antigo: as baixas a conferir agora ficam na Cobrança.
export default function BaixasAntiga() {
  redirect("/financeiro/cobranca/baixas");
}
