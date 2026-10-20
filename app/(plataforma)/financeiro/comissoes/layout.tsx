import { notFound } from "next/navigation";
import { MODULO_COMISSOES } from "@/lib/modulos/financeiro/comissoes/regras";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

export default async function LayoutComissoes({ children }: LayoutProps<"/financeiro/comissoes">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_COMISSOES);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_COMISSOES)) notFound();
  return <div className="space-y-6">{children}</div>;
}
