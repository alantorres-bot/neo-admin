import { notFound } from "next/navigation";
import { Abas } from "@/components/plataforma/abas";
import { MODULO_CARTAO, ROTA_CARTAO } from "@/lib/modulos/financeiro/cartao/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

const ABAS = [
  { href: `${ROTA_CARTAO}/meses`, rotulo: "Meses" },
  { href: `${ROTA_CARTAO}/faturas`, rotulo: "Faturas" },
  { href: `${ROTA_CARTAO}/cartoes`, rotulo: "Cartões" },
  { href: `${ROTA_CARTAO}/estabelecimentos`, rotulo: "Estabelecimentos" },
];

export default async function LayoutCartao({ children }: LayoutProps<"/financeiro/cartao">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_CARTAO);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cartão de crédito</h1>
        <p className="text-sm text-muted-foreground">
          Conciliação da fatura do cartão com os títulos do Contas a Pagar (espelho do Consistem): o que falta lançar, divergências e o quadro de conciliação. O Neo Admin só lê o ERP; lançar e dar baixa continuam no Consistem.
        </p>
      </div>
      <Abas abas={ABAS} />
      {children}
    </div>
  );
}
