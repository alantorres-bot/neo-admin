import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { Conferencia } from "./componentes";

export const metadata: Metadata = { title: "Conferir com a planilha da AKF" };

export default async function PaginaConferenciaAkf() {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === "financeiro.akf");
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro", "operador")) notFound();

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href="/financeiro/akf" />}><ArrowLeft /> Voltar à AKF</Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Conferir com a planilha da AKF</h1>
        <p className="text-sm text-muted-foreground">
          A planilha da AKF é a verdade sobre o que está descontado. Esta tela a compara com a carteira do app e mostra o que falta marcar como antecipado
          (portador 998 ou cedido) e quais antecipações parciais faltam lançar. Cada correção só é aplicada quando você confirma.
        </p>
      </div>
      <Conferencia hoje={hojeEmCuiaba()} />
    </div>
  );
}
