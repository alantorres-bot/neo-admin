import { notFound } from "next/navigation";
import { Abas } from "@/components/plataforma/abas";
import { MODULO_VT, ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

const ABAS = [{ href: `${ROTA_VT}/colaboradores`, rotulo: "Colaboradores" }];

export default async function LayoutValeTransporte({ children }: LayoutProps<"/rh/vale_transporte">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_VT);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "rh")) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vale-transporte</h1>
        <p className="text-sm text-muted-foreground">
          Quem recebe VT em Cuiabá: código de fornecedor no Consistem (nome e CPF vêm de lá), forma de pagamento habitual, valor da passagem e conta para o arquivo do BB.
        </p>
      </div>
      <Abas abas={ABAS} />
      {children}
    </div>
  );
}
