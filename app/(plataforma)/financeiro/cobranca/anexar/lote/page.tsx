import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { BoletosEmLote } from "./componentes";

export const metadata: Metadata = { title: "Anexar boletos em lote — Cobrança" };

export default async function PaginaBoletosEmLote() {
  const sessao = await exigirSessao();
  // Tarefa de Cuiabá: operador do Financeiro (o usuário restrito à unidade não tem a área).
  if (sessao.acesso.restrito || !temAcesso(sessao.acesso, "financeiro", "operador")) notFound();

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/financeiro/cobranca/anexar" />}><ArrowLeft /> Voltar aos boletos a anexar</Button>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Anexar boletos em lote</h2>
        <p className="text-sm text-muted-foreground">
          Matriz e Filial Contagem. Cada boleto vai para o título certo; nada é anexado antes da sua conferência.
        </p>
      </div>
      <BoletosEmLote unidade={null} linkDepois={{ href: "/financeiro/cobranca/enviar", rotulo: "Ver os boletos a enviar" }} />
    </div>
  );
}
