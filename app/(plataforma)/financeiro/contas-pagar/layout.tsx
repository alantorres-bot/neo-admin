import { notFound } from "next/navigation";
import { Abas } from "@/components/plataforma/abas";
import { MODULO_CONTAS_PAGAR, ROTA_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

// Abas do módulo. "Autorizações" (histórico) entra na Fase 2; "Antecipações" e "Parâmetros" na Fase 4.
const ABAS = [{ href: ROTA_CONTAS_PAGAR, rotulo: "Autorizar pagamento" }];

export default async function LayoutContasPagar({ children }: LayoutProps<"/financeiro/contas-pagar">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_CONTAS_PAGAR);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contas a pagar</h1>
        <p className="text-sm text-muted-foreground">
          Títulos e antecipações a fornecedor em aberto no Consistem, juntos, para montar a autorização de pagamento. O Neo Admin só lê o ERP: pagar e dar baixa continuam no Consistem.
        </p>
      </div>
      <Abas abas={ABAS} />
      {children}
    </div>
  );
}
