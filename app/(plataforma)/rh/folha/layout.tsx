import { notFound } from "next/navigation";
import { Abas } from "@/components/plataforma/abas";
import { ROTA_COLABORADORES } from "@/lib/modulos/rh/colaboradores/modulo";
import { MODULO_FOLHA, ROTA_FOLHA } from "@/lib/modulos/rh/folha/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

const ABAS = [
  { href: `${ROTA_FOLHA}/meses`, rotulo: "Meses" },
  { href: ROTA_COLABORADORES, rotulo: "Colaboradores" },
];

export default async function LayoutFolha({ children }: LayoutProps<"/rh/folha">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FOLHA);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "rh")) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Folha de pagamento</h1>
        <p className="text-sm text-muted-foreground">
          Fechamento mensal da folha (Neo Serviços, Oeste e Neo Formas): líquido, férias/acréscimos, 13º e avulsos por pessoa; conferência; aprovação do gestor; relatório, arquivo do BB e PIX. O cálculo continua com o escritório.
        </p>
      </div>
      <Abas abas={ABAS} />
      {children}
    </div>
  );
}
