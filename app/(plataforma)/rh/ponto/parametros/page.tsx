import type { Metadata } from "next";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerPrazoDias } from "../dados";
import { FormularioPrazo } from "./formulario";

export const metadata: Metadata = { title: "Ponto — parâmetros" };

export default async function PaginaParametrosPonto() {
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const dias = await lerPrazoDias(supabase);
  return (
    <div className="max-w-xl space-y-3">
      <p className="text-sm text-muted-foreground">
        Prazo do líder para justificar, em dias úteis contados do e-mail (segunda a sexta; feriados não contados). Vencido o prazo, a pendência do
        líder fica crítica e o RH ganha &quot;Cobrar líder&quot;, com o botão de lembrete na quinzena.
      </p>
      <FormularioPrazo dias={dias} ehGestor={temAcesso(sessao.acesso, "rh", "gestor")} />
    </div>
  );
}
