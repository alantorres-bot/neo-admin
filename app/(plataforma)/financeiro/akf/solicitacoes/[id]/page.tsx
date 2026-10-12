import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_AKF, ROTULO_STATUS_SOLICITACAO, type StatusSolicitacao } from "@/lib/modulos/financeiro/akf/solicitacao";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerSolicitacao, montarEmailDaSolicitacao } from "../dados";
import { corpoSolicitacaoParaHtml } from "@/supabase/functions/_shared/akf-email";
import { BotaoCancelar, BotaoRascunhoGmail } from "./componentes";

export const metadata: Metadata = { title: "Solicitação de antecipação" };

const COR_STATUS: Record<StatusSolicitacao, "default" | "secondary" | "outline" | "destructive"> = { rascunho: "outline", solicitada: "default", cancelada: "destructive" };
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default async function PaginaSolicitacao({ params }: PageProps<"/financeiro/akf/solicitacoes/[id]">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === "financeiro.akf");
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const sol = await lerSolicitacao(supabase, id);
  if (!sol) notFound();

  // Em montagem: o e-mail é gerado agora (prévia do que vai para o rascunho). Depois: o texto gravado na hora do rascunho.
  const emailPrevia = sol.status === "rascunho" ? await montarEmailDaSolicitacao(supabase, sol) : null;
  const assunto = sol.status === "rascunho" ? emailPrevia!.assunto : sol.assunto;
  const corpo = sol.status === "rascunho" ? emailPrevia!.corpo : sol.corpo;
  const para = sol.status === "rascunho" ? emailPrevia!.para.map((d) => `${d.nome} <${d.email}>`).join(", ") : (sol.destinatario ?? "—");
  const cc = sol.status === "rascunho" ? emailPrevia!.cc.join(", ") : (sol.cc ?? "");
  const semDestinatario = sol.status === "rascunho" && emailPrevia!.para.length === 0;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href={`${ROTA_AKF}/solicitacoes`} />}><ArrowLeft /> Todas as solicitações</Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            Solicitação de antecipação nº {sol.numero}
            <Badge variant={COR_STATUS[sol.status]}>{ROTULO_STATUS_SOLICITACAO[sol.status]}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            Data {formatarData(sol.data)} · montada por {sol.criadoPorNome ?? "—"} em {quando(sol.criadoEm)}
            {sol.solicitadaEm && <> · rascunho no Gmail criado por {sol.solicitadaPorNome ?? "—"} em {quando(sol.solicitadaEm)}</>}
            {sol.canceladaEm && <> · cancelada por {sol.canceladaPorNome ?? "—"} em {quando(sol.canceladaEm)}</>}
          </p>
          {sol.motivoCancelamento && <p className="mt-1 text-sm"><strong>Motivo do cancelamento:</strong> {sol.motivoCancelamento}</p>}
        </div>
        {podeOperar && sol.status !== "cancelada" && (
          <div className="flex flex-wrap gap-2">
            {sol.status === "rascunho" && <BotaoRascunhoGmail id={sol.id} desativado={semDestinatario} />}
            {sol.status === "solicitada" && sol.rascunhoGmail && (
              <Button variant="outline" render={<a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noreferrer" />}>Abrir rascunhos do Gmail</Button>
            )}
            <BotaoCancelar id={sol.id} numero={sol.numero} />
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader><CardDescription>Total solicitado</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(sol.totalCentavos)}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{sol.itens.length} {sol.itens.length === 1 ? "título" : "títulos"}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Antecipações parciais</CardDescription><CardTitle className="text-xl tabular-nums">{sol.itens.filter((i) => i.parcial).length}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">valor menor que o que resta com a Neo</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader><CardDescription>Sem boleto de factoring</CardDescription><CardTitle className="text-xl tabular-nums">{sol.itens.filter((i) => i.semBoleto).length}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">operar 01 dia após o vencimento, sem boleto</CardContent>
        </Card>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-bold">Títulos</h2>
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Valor do título</TableHead>
                <TableHead className="text-right">Valor solicitado</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Observação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sol.itens.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium tabular-nums"><Link href={`/financeiro/recebiveis/${i.tituloId}`} className="hover:underline">{i.documento}</Link></TableCell>
                  <TableCell className="max-w-72 truncate" title={i.cliente}>{i.clienteId ? <Link href={`/financeiro/recebiveis/clientes/${i.clienteId}`} className="hover:underline">{i.cliente}</Link> : i.cliente}</TableCell>
                  <TableCell className="tabular-nums">{formatarData(i.vencimento)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatarMoeda(i.valorTituloCentavos)}
                    {i.valorRestanteCentavos !== i.valorTituloCentavos && <span className="block text-[11px]">restava {formatarMoeda(i.valorRestanteCentavos)}</span>}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(i.valorSolicitadoCentavos)}</TableCell>
                  <TableCell className="space-x-1">
                    {i.parcial && <Badge className="bg-amber-100 text-amber-900">Parcial</Badge>}
                    {i.semBoleto && <Badge variant="outline">Sem boleto</Badge>}
                    {!i.parcial && !i.semBoleto && <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground" title={i.observacao ?? undefined}>{i.observacao ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold">E-mail {sol.status === "rascunho" ? "(prévia do rascunho)" : "(como foi para o rascunho)"}</h2>
        {semDestinatario && <p className="text-sm text-destructive">Nenhum contato da AKF com e-mail e finalidade &quot;AKF&quot;. Cadastre em Configurações &gt; Contrapartes &gt; AKF Securitizadora.</p>}
        <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="font-medium text-muted-foreground">Para</dt><dd>{para || "—"}</dd>
          <dt className="font-medium text-muted-foreground">Cc</dt><dd>{cc || "—"}</dd>
          <dt className="font-medium text-muted-foreground">Assunto</dt><dd>{assunto ?? "—"}</dd>
        </dl>
        {/* Mesmo HTML que vai para o Gmail (todo o texto é escapado em corpoSolicitacaoParaHtml). */}
        <div className="overflow-x-auto rounded-[3px] border border-grade bg-white p-4" dangerouslySetInnerHTML={{ __html: corpo ? corpoSolicitacaoParaHtml(corpo) : "—" }} />
        <p className="text-xs text-muted-foreground">
          {sol.status === "rascunho"
            ? "A saudação (bom dia/boa tarde) é a da hora em que o rascunho for criado. O e-mail termina em “Atenciosamente,”; a assinatura é a do Gmail. Nada é enviado pelo Neo Admin: o rascunho fica na caixa autorizada para conferir, anexar as NFs se precisar e enviar."
            : "Texto gravado no momento em que o rascunho foi criado."}
        </p>
      </section>
    </div>
  );
}
