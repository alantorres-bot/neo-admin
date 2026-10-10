import { exigirSessao } from "@/lib/nucleo/sessao";

/**
 * Páginas de impressão: sem a moldura do painel (trilho, barra vermelha, menu), só a folha. Exigem login como as demais;
 * cada página confere a permissão do módulo perto dos dados.
 */
export default async function LayoutImpressao({ children }: LayoutProps<"/">) {
  await exigirSessao();
  return <main className="folha mx-auto w-full max-w-[210mm] bg-white px-6 py-6 text-[12px] text-black print:max-w-none print:px-0 print:py-0">{children}</main>;
}
