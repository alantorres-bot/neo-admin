import { redirect } from "next/navigation";

// A remessa é um filtro da fila única (links antigos e pendências "Implantar remessa nº N" chegam aqui).
export default async function Pagina({ params }: PageProps<"/financeiro/filial/remessas/[numero]">) {
  const { numero } = await params;
  redirect(/^\d{1,9}$/.test(numero) ? `/financeiro/filial?ver=todas&remessa=${numero}` : "/financeiro/filial");
}
