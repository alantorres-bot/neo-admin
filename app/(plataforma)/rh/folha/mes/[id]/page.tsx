import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { rotuloMes } from "@/lib/modulos/rh/calendario";
import { ROTA_FOLHA } from "@/lib/modulos/rh/folha/modulo";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerImportacoes, lerItens, lerMes, ROTULO_STATUS } from "../../dados";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ImportarLiquidos } from "./importar";
import { GradeFolha } from "./grade";
import { FluxoFolha, PixFolha } from "./paineis";

export const metadata: Metadata = { title: "Folha do mês" };

const quando = (iso: string | null) => (iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "");

export default async function PaginaMesFolha({ params }: PageProps<"/rh/folha/mes/[id]">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const podeOperar = temAcesso(sessao.acesso, "rh", "operador");
  const ehGestor = temAcesso(sessao.acesso, "rh", "gestor");
  const supabase = await criarClienteServidor();
  const [mes, itens, importacoes] = await Promise.all([lerMes(supabase, id), lerItens(supabase, id), lerImportacoes(supabase, id)]);
  if (!mes) notFound();
  const pix = itens.filter((i) => i.forma_pagamento !== "fopag" && i.valor > 0);
  const temFopag = itens.some((i) => i.forma_pagamento === "fopag" && i.valor > 0);

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" render={<Link href={`${ROTA_FOLHA}/meses?ano=${mes.competencia.slice(0, 4)}`} />}><ArrowLeft /> Meses</Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-bold">Folha de {rotuloMes(mes.competencia)} <Badge variant="outline" className="ml-2 align-middle">{ROTULO_STATUS[mes.status]}</Badge></h2>
          <p className="text-sm text-muted-foreground">
            Pagamento até {formatarData(mes.data_pagamento)}
            {mes.conferida_em ? ` · conferida ${quando(mes.conferida_em)}${mes.conferida_por_nome ? ` por ${mes.conferida_por_nome}` : ""}` : ""}
            {mes.aprovada_em ? ` · aprovada ${quando(mes.aprovada_em)}${mes.aprovada_por_nome ? ` por ${mes.aprovada_por_nome}` : ""}` : ""}
            {mes.arquivo_bb_gerado_em ? ` · arquivo do BB gerado ${quando(mes.arquivo_bb_gerado_em)}` : ""}
          </p>
          {mes.reaberta_motivo && mes.status === "aberta" && <p className="text-sm text-amber-700">Reaberta em {quando(mes.reaberta_em)}: {mes.reaberta_motivo}</p>}
        </div>
        <FluxoFolha id={mes.id} status={mes.status} podeOperar={podeOperar} ehGestor={ehGestor} temFopag={temFopag} />
      </div>

      {podeOperar && mes.status === "aberta" && (
        <div className="flex flex-wrap items-center gap-3">
          <ImportarLiquidos mesId={mes.id} />
          <span className="text-xs text-muted-foreground">Relação Geral dos Líquidos (.xls) do escritório: um arquivo por empresa e por cálculo (Folha Mensal, 13º, Férias).</span>
        </div>
      )}

      <GradeFolha mesId={mes.id} editavel={podeOperar && mes.status === "aberta"} itens={itens} />

      {importacoes.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-base font-bold">Importações do escritório</h3>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Quando</TableHead><TableHead>Empresa</TableHead><TableHead>Cálculo</TableHead><TableHead className="text-right">Pessoas</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Gravadas</TableHead><TableHead>De fora</TableHead><TableHead>Por</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {importacoes.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="tabular-nums">{quando(i.importado_em)}</TableCell><TableCell>{i.empregador}</TableCell><TableCell>{i.calculo}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.pessoas}</TableCell><TableCell className="text-right tabular-nums">{i.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.aplicadas}{i.ligadas ? ` (${i.ligadas} ligada${i.ligadas > 1 ? "s" : ""} à mão)` : ""}</TableCell>
                  <TableCell className="text-xs">{i.sem_cadastro.length ? i.sem_cadastro.map((s) => `${s.codigo} ${s.nome}`).join(", ") : "—"}</TableCell>
                  <TableCell>{i.importado_por_nome ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {(mes.status === "aprovada" || mes.status === "paga") && (
        <section className="space-y-2">
          <h3 className="text-base font-bold">PIX</h3>
          <PixFolha id={mes.id} podeMarcar={podeOperar && mes.status === "aprovada"}
            linhas={pix.map((i) => ({ id: i.id, cod_fornecedor: i.cod_fornecedor, nome: i.nome, empregador: i.empregador, forma_pagamento: i.forma_pagamento, valor: i.valor, pix_pago_em: i.pix_pago_em }))} />
        </section>
      )}
    </div>
  );
}
