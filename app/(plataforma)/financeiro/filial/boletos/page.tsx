import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MODULO_FILIAL, ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { BoletosEmLote } from "./componentes";

export const metadata: Metadata = { title: "Anexar boletos da filial" };

export default async function PaginaBoletosFilial() {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FILIAL);
  // Tarefa de Cuiabá: operador do Financeiro (o usuário restrito à unidade não tem a área).
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro", "operador")) notFound();

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href={`${ROTA_FILIAL}/boletos-a-anexar`} />}><ArrowLeft /> Boletos a anexar</Button>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Anexar boletos da filial</h2>
        <p className="text-sm text-muted-foreground">
          Os boletos (próprios ou da AKF) das NFs implantadas. Cada um vai para a parcela certa; com o boleto, o kit fica pronto e a filial
          recebe a pendência para enviar ao cliente.
        </p>
      </div>
      <BoletosEmLote />
    </div>
  );
}
