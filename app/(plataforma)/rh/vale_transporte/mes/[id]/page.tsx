import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { rotuloMes } from "@/lib/modulos/rh/calendario";
import { codigosDoTitulo, contaPagadora } from "@/lib/modulos/rh/lancamento";
import { ROTA_VT, ROTULO_FORMA } from "@/lib/modulos/rh/vale-transporte/modulo";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerParametrosRh } from "../../../_consistem/dados";
import { PainelConsistem } from "../../../_consistem/painel";
import { lerItens, lerLancamentos, lerMes, ROTULO_STATUS } from "../../dados";
import { cancelarLancamento, lancarNoConsistem, resolverLancamento } from "../acoes";
import { GradeMes } from "./grade";
import { FluxoMes, PainelPix } from "./paineis";

export const metadata: Metadata = { title: "Vale-transporte do mês" };

const quando = (iso: string | null) => (iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "");

export default async function PaginaMes({ params }: PageProps<"/rh/vale_transporte/mes/[id]">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const podeOperar = temAcesso(sessao.acesso, "rh", "operador");
  const ehGestor = temAcesso(sessao.acesso, "rh", "gestor");
  const supabase = await criarClienteServidor();
  const [mes, itens, lancamentos, parametros] = await Promise.all([lerMes(supabase, id), lerItens(supabase, id), lerLancamentos(supabase, id), lerParametrosRh(supabase)]);
  if (!mes) notFound();

  const editavel = podeOperar && mes.status === "aberta" && !mes.importada;
  const aprovadoOuPago = mes.status === "aprovada" || mes.status === "paga";
  const pix = itens.filter((i) => i.forma_pagamento !== "fopag" && i.valor > 0);
  const temFopag = itens.some((i) => i.forma_pagamento === "fopag" && i.valor > 0);
  // Último lançamento de cada item (o ativo, se houver; senão o erro ou cancelado mais recente).
  const ultimo = new Map<string, (typeof lancamentos)[number]>();
  for (const l of lancamentos) {
    const atual = ultimo.get(l.item_id);
    if (!atual || atual.situacao === "erro" || atual.situacao === "cancelado") ultimo.set(l.item_id, l);
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" render={<Link href={`${ROTA_VT}/meses?ano=${mes.competencia.slice(0, 4)}`} />}><ArrowLeft /> Meses</Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-bold">VT de {rotuloMes(mes.competencia)} <Badge variant="outline" className="ml-2 align-middle">{ROTULO_STATUS[mes.status]}{mes.importada ? " (planilha)" : ""}</Badge></h2>
          <p className="text-sm text-muted-foreground">
            Pagamento {formatarData(mes.data_pagamento)} · fechar até {formatarData(mes.prazo_fechamento)} · {mes.dias_uteis_padrao} dias úteis
            {mes.enviada_em ? ` · enviado ${quando(mes.enviada_em)}${mes.enviada_por_nome ? ` por ${mes.enviada_por_nome}` : ""}` : ""}
            {mes.aprovada_em ? ` · aprovado ${quando(mes.aprovada_em)}${mes.aprovada_por_nome ? ` por ${mes.aprovada_por_nome}` : ""}` : ""}
            {mes.arquivo_bb_gerado_em ? ` · arquivo do BB gerado ${quando(mes.arquivo_bb_gerado_em)}` : ""}
          </p>
          {mes.reaberta_motivo && mes.status === "aberta" && <p className="text-sm text-amber-700">Reaberto em {quando(mes.reaberta_em)}: {mes.reaberta_motivo}</p>}
          {mes.importada && <p className="text-sm text-muted-foreground">Mês importado da planilha (histórico): só consulta.</p>}
        </div>
        <FluxoMes id={mes.id} status={mes.status} importada={mes.importada} podeOperar={podeOperar} ehGestor={ehGestor} temFopag={temFopag} />
      </div>

      <GradeMes mesId={mes.id} competencia={mes.competencia} editavel={editavel} diasPadrao={mes.dias_uteis_padrao} itens={itens} />

      {aprovadoOuPago && !mes.importada && (
        <>
          <section className="space-y-2">
            <h3 className="text-base font-bold">PIX</h3>
            <PainelPix id={mes.id} podeMarcar={podeOperar && mes.status === "aprovada"}
              linhas={pix.map((i) => ({ id: i.id, cod_fornecedor: i.cod_fornecedor, nome: i.nome, pagadora: contaPagadora(parametros.parametros, i.empregador, i.forma_pagamento) ?? ROTULO_FORMA[i.forma_pagamento], valor: i.valor, pix_pago_em: i.pix_pago_em }))} />
          </section>
          <section className="space-y-2">
            <h3 className="text-base font-bold">Contas a pagar no Consistem</h3>
            <PainelConsistem id={mes.id} ligado={parametros.vtLigado} podeLancar={podeOperar} parametrosHref={`${ROTA_VT}/parametros`}
              descricao="Um título por pessoa, contra o fornecedor (Nº), com vencimento no dia do pagamento e o portador da empregadora/forma."
              lancar={lancarNoConsistem} resolver={resolverLancamento} cancelar={ehGestor ? cancelarLancamento : undefined}
              linhas={itens.map((i) => {
                const l = ultimo.get(i.id);
                return { chave: i.id, cod_fornecedor: i.cod_fornecedor, nome: i.nome, valor: i.valor,
                  portador: codigosDoTitulo(parametros.parametros, "vt", i.empregador, i.forma_pagamento)?.codPortador ?? null,
                  lancamento: l ? { id: l.id, situacao: l.situacao, cod: l.cod_lancamento_erp, erro: l.erro } : null };
              })} />
          </section>
        </>
      )}
    </div>
  );
}
