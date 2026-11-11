import { notFound } from "next/navigation";
import { MODULO_PARCELAMENTOS } from "@/lib/modulos/financeiro/parcelamentos/parcelamentos";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { AbasParcelamentos } from "./componentes";

export default async function LayoutParcelamentos({ children }: LayoutProps<"/financeiro/parcelamentos">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_PARCELAMENTOS);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PARCELAMENTOS)) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gestão de Parcelamentos</h1>
        <p className="text-sm text-muted-foreground">
          Parcelamentos provisionados no Contas a Pagar do Consistem (lançamentos P, que viram C quando a guia é lançada) e cadastrados à mão.
          O Consistem é a fonte oficial: aqui só se lê o ERP, classifica e acompanha.
        </p>
      </div>
      <AbasParcelamentos />
      {children}
    </div>
  );
}
