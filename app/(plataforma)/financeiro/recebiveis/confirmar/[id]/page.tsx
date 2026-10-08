import { redirect } from "next/navigation";

// Endereço antigo (as pendências já gravadas no banco apontam para ele): a tela agora fica na Cobrança.
export default async function ConfirmarAntigo({ params, searchParams }: PageProps<"/financeiro/recebiveis/confirmar/[id]">) {
  const { id } = await params;
  const qs = new URLSearchParams();
  for (const [chave, valor] of Object.entries(await searchParams)) {
    const v = Array.isArray(valor) ? valor[0] : valor;
    if (v) qs.set(chave, v);
  }
  redirect(`/financeiro/cobranca/confirmar/${id}${qs.size > 0 ? `?${qs.toString()}` : ""}`);
}
