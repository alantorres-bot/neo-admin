import { redirect } from "next/navigation";

// A ficha da NF virou o painel lateral da fila (links antigos e pendências "Enviar kit/boleto ao cliente" chegam aqui).
export default async function Pagina({ params }: PageProps<"/financeiro/filial/[id]">) {
  const { id } = await params;
  redirect(/^[0-9a-f-]{36}$/i.test(id) ? `/financeiro/filial?ver=todas&nf=${id}` : "/financeiro/filial");
}
