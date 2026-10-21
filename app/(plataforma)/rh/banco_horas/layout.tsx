import { notFound } from "next/navigation";
import { Abas } from "@/components/plataforma/abas";
import { MODULO_BANCO_HORAS, ROTA_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

const ABAS = [
  { href: `${ROTA_BANCO_HORAS}/saldos`, rotulo: "Saldos" },
  { href: `${ROTA_BANCO_HORAS}/pagar`, rotulo: "A pagar na folha" },
  { href: `${ROTA_BANCO_HORAS}/importacoes`, rotulo: "Importações" },
  { href: `${ROTA_BANCO_HORAS}/parametros`, rotulo: "Parâmetros" },
];

export default async function LayoutBancoHoras({ children }: LayoutProps<"/rh/banco_horas">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_BANCO_HORAS);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "rh")) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Banco de horas</h1>
        <p className="text-sm text-muted-foreground">
          Saldo dos últimos 6 meses pelo CSV do Control iD. Ciclo de 26 a 25; cada crédito vence no fim do ciclo em que nasceu + 6 meses, e os débitos
          consomem o crédito mais antigo primeiro. O que vence sem compensação vai para a folha.
        </p>
      </div>
      <Abas abas={ABAS} />
      {children}
    </div>
  );
}
