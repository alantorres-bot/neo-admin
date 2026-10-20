import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MODULO_COMISSOES, ROTA_COMISSOES } from "@/lib/modulos/financeiro/comissoes/regras";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { FormRepresentante } from "../componentes";

export const metadata: Metadata = { title: "Representantes comissionados" };

export default async function PaginaRepresentantes() {
  const sessao = await exigirSessao();
  const ehGestor = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_COMISSOES, "gestor");
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("fin_com_representantes").select("cod_representante, nome, perc_venda, perc_locacao, recebe_de, ativo").order("cod_representante");
  const reps = (data ?? []).map((r) => ({ cod: r.cod_representante as string, nome: r.nome as string, perc_venda: Number(r.perc_venda), perc_locacao: Number(r.perc_locacao), recebe_de: r.recebe_de as string[], ativo: r.ativo as boolean }));

  return (
    <>
      <div>
        <Link href={ROTA_COMISSOES} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Comissões</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Representantes comissionados</h1>
        <p className="text-sm text-muted-foreground">
          Código do representante no Consistem, percentuais e de quem mais ele recebe (ex.: o Fernando recebe também pelas vendas do Heitor).
          Só os representantes daqui entram no fechamento. A mudança vale para os fechamentos em conferência ao buscar os títulos de novo.
        </p>
      </div>
      {reps.map((r) => (
        <Card key={r.cod}>
          <CardHeader><CardTitle>{r.nome} ({r.cod}){r.ativo ? "" : " · inativo"}</CardTitle></CardHeader>
          <CardContent>
            {ehGestor ? <FormRepresentante inicial={r} /> : (
              <CardDescription>Venda {r.perc_venda}% · Locação {r.perc_locacao}% · recebe de {r.recebe_de.join(", ")}</CardDescription>
            )}
          </CardContent>
        </Card>
      ))}
      {ehGestor && (
        <Card>
          <CardHeader><CardTitle>Novo representante</CardTitle></CardHeader>
          <CardContent><FormRepresentante /></CardContent>
        </Card>
      )}
    </>
  );
}
