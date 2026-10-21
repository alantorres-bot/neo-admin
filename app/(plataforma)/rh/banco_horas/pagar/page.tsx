import type { Metadata } from "next";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerSaldos } from "../dados";
import { GradePagar } from "./grade";

export const metadata: Metadata = { title: "Banco de horas — a pagar na folha" };

export default async function PaginaPagarBanco() {
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const vencidos = (await lerSaldos(supabase)).filter((s) => s.vencido_min > 0);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Créditos que venceram sem compensação. Inclua as horas na folha (o valor é calculado pelo escritório) e marque &quot;Pago na folha&quot;: as horas saem do saldo,
        consumindo os créditos mais antigos.
      </p>
      <GradePagar linhas={vencidos.map((s) => ({ id: s.pessoa_id, nome: s.nome, setor: s.setor, vencidoMin: s.vencido_min }))} podeOperar={temAcesso(sessao.acesso, "rh", "operador")} />
    </div>
  );
}
