import { redirect } from "next/navigation";

// A fila do Faturamento Filial é uma só (/financeiro/filial); esta rota antiga leva ao filtro correspondente.
export default function Pagina() {
  redirect("/financeiro/filial?ver=todas");
}
