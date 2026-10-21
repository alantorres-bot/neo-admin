import { notFound } from "next/navigation";
import { Abas } from "@/components/plataforma/abas";
import { MODULO_PONTO, ROTA_PONTO } from "@/lib/modulos/rh/ponto/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

const ABAS = [
  { href: `${ROTA_PONTO}/lotes`, rotulo: "Quinzenas" },
  { href: `${ROTA_PONTO}/setores`, rotulo: "Setores e líderes" },
  { href: `${ROTA_PONTO}/parametros`, rotulo: "Parâmetros" },
];

export default async function LayoutPonto({ children }: LayoutProps<"/rh/ponto">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_PONTO);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "rh")) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ponto</h1>
        <p className="text-sm text-muted-foreground">
          Inconsistências do Control iD por quinzena (26 a 11 e 12 a 25) e setor: o líder justifica cada ocorrência pelo link do e-mail; o RH ajusta no Control iD e marca.
        </p>
      </div>
      <Abas abas={ABAS} />
      {children}
    </div>
  );
}
