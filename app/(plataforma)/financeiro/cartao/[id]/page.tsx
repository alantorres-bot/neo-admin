import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROTA_CARTAO } from "@/lib/modulos/financeiro/cartao/modulo";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { conciliacaoDaRequisicao, lerCompras, lerEncargos, quandoEm } from "../dados";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BotaoCancelarFatura } from "./componentes";
import { PainelConciliacao } from "./painel";

export const metadata: Metadata = { title: "Conciliação da fatura" };

export default async function PaginaConciliacao({ params }: PageProps<"/financeiro/cartao/[id]">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await conciliacaoDaRequisicao(id);
  if (!c) notFound();
  const { fatura, resultado: r, outros } = c;
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");
  const supabase = await criarClienteServidor();
  const [encargos, compras] = fatura.status === "importada" ? await Promise.all([lerEncargos(supabase, c), lerCompras(supabase, c)]) : [null, null];
  const podeCancelar = fatura.status === "importada" && (temAcesso(sessao.acesso, "financeiro", "gestor") || (podeOperar && fatura.importado_por === sessao.userId));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" render={<Link href={`${ROTA_CARTAO}/faturas`} />}><ArrowLeft /> Faturas</Button>
          <h2 className="text-lg font-bold">
            {fatura.cartao_nome} · vencimento {formatarData(fatura.vencimento)}
            {fatura.status === "cancelada" && <Badge variant="outline" className="ml-2 align-middle">Cancelada em {fatura.cancelado_em ? quandoEm(fatura.cancelado_em) : ""}</Badge>}
          </h2>
          <p className="text-sm text-muted-foreground">
            {fatura.empresa_nome} · importada em {quandoEm(fatura.importado_em)}{fatura.importado_por_nome ? ` por ${fatura.importado_por_nome}` : ""}{fatura.arquivo_nome ? ` · ${fatura.arquivo_nome}` : ""}
            {fatura.observacao ? ` · ${fatura.observacao}` : ""}
            {fatura.status === "cancelada" && fatura.motivo_cancelamento ? ` · Motivo do cancelamento: ${fatura.motivo_cancelamento}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {c.origemTitulos === "consistem"
              ? <>Títulos lidos agora do Consistem, inclusive os que já estão no borderô do cartão: {r.contagens.titulos} do cartão na janela de ±5 dias do vencimento.</>
              : <>
                <strong className="text-amber-800">Não foi possível consultar o Consistem ({c.avisoOrigem}).</strong> Títulos lidos do espelho do Contas a pagar
                {c.ultimaSincronizacao ? ` (atualizado em ${c.ultimaSincronizacao})` : ""}, que só tem os títulos com saldo: os que já entraram no borderô do cartão não aparecem.
                {" "}{r.contagens.titulos} do cartão na janela. Recarregue a página para tentar de novo.
              </>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" render={<a href={`${ROTA_CARTAO}/${fatura.id}/planilha`} />}><Download /> Baixar planilha (XLSX)</Button>
          {podeCancelar && <BotaoCancelarFatura id={fatura.id} />}
        </div>
      </div>

      {fatura.ciclo_id && (
        <p className="text-sm">
          Esta fatura pertence ao mês do cartão: <Link href={`${ROTA_CARTAO}/ciclo/${fatura.ciclo_id}`} className="font-medium text-elo hover:underline">abrir o mês (situação, fechamento e histórico)</Link>.
        </p>
      )}
      <PainelConciliacao resultado={r} outros={outros} linhas={c.linhas} tituloDaFatura={c.tituloDaFatura} podeOperar={podeOperar}
        faturaId={fatura.status === "importada" ? fatura.id : null} decisoesHistorico={c.decisoesHistorico} encargos={encargos} compras={compras} />
    </div>
  );
}

