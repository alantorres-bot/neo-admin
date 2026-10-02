// Página provisória de módulo. Cada módulo ganha a sua pasta de rotas (ex.: financeiro/recebiveis/),
// que tem precedência sobre esta rota dinâmica.
import { notFound } from "next/navigation";
import { codigoDoModulo, temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

export default async function PaginaModulo({ params }: PageProps<"/[area]/[modulo]">) {
  const { area, modulo } = await params;
  const sessao = await exigirSessao();
  const encontrado = sessao.modulos.find((m) => m.codigo === codigoDoModulo(area, modulo));
  if (!encontrado || !temAcesso(sessao.acesso, encontrado.area)) notFound();

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">{encontrado.nome}</h1>
      <p className="text-sm text-muted-foreground">
        {encontrado.ativo ? "Módulo ainda em construção." : "Módulo ainda não disponível."}
      </p>
    </div>
  );
}
