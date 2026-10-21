import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";
import { horas } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerFechamento, ROTULO_FECHAMENTO } from "../../dados";
import { PassosFechamento } from "./passos";

export const metadata: Metadata = { title: "Banco de horas — fechamento" };

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" }) : "");

export default async function PaginaFechamentoBanco({ params }: PageProps<"/rh/banco_horas/fechamentos/[id]">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const lido = await lerFechamento(await criarClienteServidor(), id);
  if (!lido) notFound();
  const { fechamento: f, itens } = lido;
  const mes = formatarData(f.competencia).slice(3);
  const pagar = itens.filter((i) => i.pagar_min > 0);
  const descontar = itens.filter((i) => i.descontar_min > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm"><Link href={`${ROTA_BANCO_HORAS}/fechamentos`} className="text-elo hover:underline">← Fechamentos</Link></p>
          <h2 className="text-xl font-semibold">Fechamento do banco de horas — folha de {mes} <Badge variant="outline">{ROTULO_FECHAMENTO[f.status]}</Badge></h2>
          <p className="text-sm text-muted-foreground">
            {[`Emitido ${quando(f.emitido_em)} por ${f.emitido_por_nome}`, f.aprovado_em && `aprovado ${quando(f.aprovado_em)} por ${f.aprovado_por_nome ?? ""}`,
              f.enviado_em && `enviado ao escritório ${quando(f.enviado_em)}`, f.lancado_em && `lançado na folha ${quando(f.lancado_em)}`].filter(Boolean).join(" · ")}
          </p>
          {f.devolvido_motivo && f.status === "devolvido" && <p className="text-sm text-destructive">Devolvido: {f.devolvido_motivo}. Corrija e emita de novo.</p>}
          {f.cancelado_motivo && <p className="text-sm text-destructive">Cancelado: {f.cancelado_motivo}</p>}
        </div>
        <Button variant="outline" render={<Link href={`/imprimir/rh/banco-horas/fechamento/${f.id}`} target="_blank" />}><Printer /> Relatório</Button>
      </div>

      <PassosFechamento id={f.id} status={f.status} podeOperar={temAcesso(sessao.acesso, "rh", "operador")} ehGestor={temAcesso(sessao.acesso, "rh", "gestor")} />

      <section className="space-y-2">
        <h3 className="font-medium">A empresa paga (horas a mais vencidas): {horas(pagar.reduce((s, i) => s + i.pagar_min, 0))}</h3>
        <Table>
          <TableHeader><TableRow><TableHead>Funcionário</TableHead><TableHead>Setor</TableHead><TableHead className="text-right">Horas</TableHead><TableHead>Ciclos de origem</TableHead></TableRow></TableHeader>
          <TableBody>
            {pagar.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Ninguém.</TableCell></TableRow>}
            {pagar.map((i) => (
              <TableRow key={i.pessoa_id}><TableCell>{i.nome}</TableCell><TableCell>{i.setor}</TableCell><TableCell className="text-right tabular-nums">{horas(i.pagar_min)}</TableCell><TableCell>{i.ciclos}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="space-y-2">
        <h3 className="font-medium">Descontar na folha (horas a menos vencidas): {horas(descontar.reduce((s, i) => s + i.descontar_min, 0))}</h3>
        <Table>
          <TableHeader><TableRow><TableHead>Funcionário</TableHead><TableHead>Setor</TableHead><TableHead className="text-right">Horas</TableHead><TableHead>Ciclos de origem</TableHead></TableRow></TableHeader>
          <TableBody>
            {descontar.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Ninguém.</TableCell></TableRow>}
            {descontar.map((i) => (
              <TableRow key={i.pessoa_id}><TableCell>{i.nome}</TableCell><TableCell>{i.setor}</TableCell><TableCell className="text-right tabular-nums">{horas(i.descontar_min)}</TableCell><TableCell>{i.ciclos}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
