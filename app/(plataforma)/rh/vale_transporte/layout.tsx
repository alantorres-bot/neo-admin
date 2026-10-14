import { notFound } from "next/navigation";
import { Abas } from "@/components/plataforma/abas";
import { ROTA_COLABORADORES } from "@/lib/modulos/rh/colaboradores/modulo";
import { MODULO_VT, ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

const ABAS = [
  { href: `${ROTA_VT}/meses`, rotulo: "Meses" },
  { href: `${ROTA_VT}/ano`, rotulo: "Resumo do ano" },
  { href: ROTA_COLABORADORES, rotulo: "Colaboradores" },
  { href: `${ROTA_VT}/parametros`, rotulo: "Parâmetros" },
];

export default async function LayoutValeTransporte({ children }: LayoutProps<"/rh/vale_transporte">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_VT);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "rh")) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vale-transporte</h1>
        <p className="text-sm text-muted-foreground">
          VT de Cuiabá mês a mês: faltas, atestados, extras, férias e abatimentos por pessoa; aprovação do gestor; relatório, arquivo do BB, PIX e títulos no Consistem.
        </p>
      </div>
      <Abas abas={ABAS} />
      {children}
    </div>
  );
}
