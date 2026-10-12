import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROTA_CARTAO } from "@/lib/modulos/financeiro/cartao/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerCartoes, lerCiclo, lerEmpresas } from "../dados";
import { rotuloCompetencia } from "@/lib/modulos/financeiro/cartao/ciclos";
import { ImportarFatura } from "./componentes";

export const metadata: Metadata = { title: "Importar fatura do cartão" };

export default async function PaginaImportarFatura({ searchParams }: PageProps<"/financeiro/cartao/nova">) {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) notFound();
  const supabase = await criarClienteServidor();
  const cicloPedido = (await searchParams).ciclo;
  const cicloId = typeof cicloPedido === "string" && /^[0-9a-f-]{36}$/i.test(cicloPedido) ? cicloPedido : null;
  const [cartoes, empresas, lido] = await Promise.all([lerCartoes(supabase), lerEmpresas(supabase), cicloId ? lerCiclo(supabase, cicloId) : Promise.resolve(null)]);
  const ciclo = lido?.ciclo ?? null;
  if (cicloId && !ciclo) notFound();

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" render={<Link href={ciclo ? `${ROTA_CARTAO}/ciclo/${ciclo.id}` : `${ROTA_CARTAO}/meses`} />}><ArrowLeft /> {ciclo ? "Voltar ao mês" : "Voltar"}</Button>
      <div>
        <h2 className="text-lg font-bold">Importar fatura{ciclo ? ` ${ciclo.cartao_nome} ${rotuloCompetencia(ciclo.competencia)}` : ""}</h2>
        <p className="text-sm text-muted-foreground">
          Informe o cartão, o vencimento <strong>efetivo impresso na fatura</strong> e o total do emissor, e envie o PDF (ou CSV). O sistema mostra as linhas lidas e só deixa confirmar quando a soma bate com o total — leitura incompleta gera conciliação falsa.
        </p>
      </div>
      <ImportarFatura
        cartoes={cartoes.filter((c) => c.ativo).map((c) => ({ codigo: c.codigo, nome: c.nome, leitor: c.leitor, diaVencimento: c.dia_vencimento }))}
        empresas={empresas}
        ciclo={ciclo ? { id: ciclo.id, empresaId: ciclo.empresa_id, cartao: ciclo.cartao, vencimentoNominal: ciclo.vencimento_nominal, fechamento: ciclo.fechamento } : null}
      />
    </div>
  );
}
