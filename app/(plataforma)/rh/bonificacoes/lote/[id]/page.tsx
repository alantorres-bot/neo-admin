import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { brl } from "@/lib/modulos/financeiro/cartao/texto";
import { ROTA_BONIFICACOES, ROTULO_STATUS, valorBonificacao } from "@/lib/modulos/rh/bonificacoes/modulo";
import { rotuloMes } from "@/lib/modulos/rh/calendario";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerItens, lerLote } from "../../dados";
import { AcoesLote } from "../../quadro";
import { COR_STATUS } from "../../status";

export const metadata: Metadata = { title: "Bonificações — lote" };

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" }) : "");

export default async function PaginaLoteBonificacao({ params }: PageProps<"/rh/bonificacoes/lote/[id]">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const lote = await lerLote(supabase, id);
  if (!lote) notFound();
  const itens = await lerItens(supabase, id);
  const valores = itens.map((i) => (i.salario ? valorBonificacao(i.salario, i.pct) : null));
  const total = valores.reduce<number>((s, v) => s + (v ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm"><Link href={`${ROTA_BONIFICACOES}?mes=${lote.competencia.slice(0, 7)}`} className="text-elo hover:underline">← Bonificações</Link></p>
          <h2 className="text-xl font-semibold">
            {lote.setor} · <span className="capitalize">{rotuloMes(lote.competencia)}</span>{" "}
            <Badge variant="outline" className={COR_STATUS[lote.status]}>{ROTULO_STATUS[lote.status]}</Badge>
          </h2>
          <p className="text-sm text-muted-foreground">
            {[
              `Aberto em ${quando(lote.aberto_em)}`,
              lote.preenchido_em && `lançado pelo link por ${lote.preenchido_nome ?? "—"} em ${quando(lote.preenchido_em)}`,
              lote.aprovado_em && `aprovado em ${quando(lote.aprovado_em)}`,
            ].filter(Boolean).join(" · ")}
          </p>
          {lote.devolvido_motivo && lote.status === "devolvido" && <p className="text-sm text-destructive">Devolvido ao líder: {lote.devolvido_motivo}</p>}
          {lote.cancelado_motivo && <p className="text-sm text-destructive">Cancelado: {lote.cancelado_motivo}</p>}
        </div>
        <AcoesLote
          loteId={lote.id} chave={lote.chave} status={lote.status} faltamRecibos={itens.filter((i) => !i.recibo_id).length}
          podeOperar={temAcesso(sessao.acesso, "rh", "operador")} ehGestor={temAcesso(sessao.acesso, "rh", "gestor")}
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Funcionário</TableHead><TableHead>Função</TableHead><TableHead className="text-right">%</TableHead>
            <TableHead className="text-right">Salário</TableHead><TableHead className="text-right">Bonificação</TableHead><TableHead>Folha</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!itens.length && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">
              {lote.status === "enviado" || lote.status === "devolvido" ? "O líder ainda não lançou." : "O líder não marcou ninguém."}
            </TableCell></TableRow>
          )}
          {itens.map((i, n) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.nome}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{i.funcao}</TableCell>
              <TableCell className="text-right tabular-nums">{i.pct}%</TableCell>
              <TableCell className="text-right tabular-nums">{i.salario ? `R$ ${brl(Math.round(i.salario * 100))}` : <span className="text-destructive">sem salário: preencher antes de aprovar</span>}</TableCell>
              <TableCell className="text-right tabular-nums">{valores[n] === null ? "" : `R$ ${brl(valores[n])}`}</TableCell>
              <TableCell>{i.recibo_id ? "Recibo gravado" : ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {itens.length > 0 && <p className="text-right text-sm font-medium">Total do setor: R$ {brl(total)}</p>}
    </div>
  );
}
