import { redirect } from "next/navigation";

// A tela de Tarefas virou a Cobrança. Este endereço continua valendo (links antigos): cada fila vai para a aba correspondente.
const DESTINO: Record<string, string> = {
  anexar: "/financeiro/cobranca/anexar",
  enviar: "/financeiro/cobranca/enviar?aba=enviar",
  dados: "/financeiro/cobranca/enviar?aba=dados",
  confirmar: "/financeiro/cobranca/confirmar",
  cobrar: "/financeiro/cobranca/cobrar",
  baixa: "/financeiro/cobranca/baixas",
  contato: "/financeiro/recebiveis/clientes",
};

export default async function PaginaTarefasAntiga({ searchParams }: PageProps<"/financeiro/recebiveis/tarefas">) {
  const { aba } = await searchParams;
  redirect(DESTINO[Array.isArray(aba) ? aba[0] : (aba ?? "")] ?? "/financeiro/cobranca");
}
