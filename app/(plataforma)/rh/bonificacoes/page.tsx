import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_BONIFICACOES, ROTULO_STATUS } from "@/lib/modulos/rh/bonificacoes/modulo";
import { inicioDoMes, rotuloMes, somarMeses } from "@/lib/modulos/rh/calendario";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerSetores } from "../ponto/dados";
import { lerLotesDoMes } from "./dados";
import { AbrirLote, CopiarLink } from "./quadro";
import { COR_STATUS } from "./status";

export const metadata: Metadata = { title: "Bonificações" };

export default async function PaginaBonificacoes({ searchParams }: PageProps<"/rh/bonificacoes">) {
  const sessao = await exigirSessao();
  const podeOperar = temAcesso(sessao.acesso, "rh", "operador");
  const { mes } = await searchParams;
  const competencia = inicioDoMes(/^\d{4}-\d{2}$/.test(String(mes ?? "")) ? String(mes) : hojeEmCuiaba());
  const supabase = await criarClienteServidor();
  const [lotes, setores] = await Promise.all([lerLotesDoMes(supabase, competencia), lerSetores(supabase)]);
  const vigentes = lotes.filter((l) => l.status !== "cancelado");
  const semLote = setores.filter((s) => s.ativo && !vigentes.some((l) => l.setor_id === s.id));
  const link = (n: number) => `${ROTA_BONIFICACOES}?mes=${somarMeses(competencia, n).slice(0, 7)}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <Button variant="outline" size="sm" render={<Link href={link(-1)} />}>←</Button>
        <span className="text-base font-bold capitalize">{rotuloMes(competencia)}</span>
        <Button variant="outline" size="sm" render={<Link href={link(1)} />}>→</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Setor</TableHead><TableHead>Situação</TableHead><TableHead>Lançado por</TableHead><TableHead>Link</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {lotes.map((l) => (
            <TableRow key={l.id} className={l.status === "cancelado" ? "text-muted-foreground line-through" : ""}>
              <TableCell className="font-medium"><Link href={`${ROTA_BONIFICACOES}/lote/${l.id}`} className="text-elo hover:underline">{l.setor}</Link></TableCell>
              <TableCell><Badge variant="outline" className={COR_STATUS[l.status]}>{ROTULO_STATUS[l.status]}</Badge></TableCell>
              <TableCell>{l.preenchido_nome ?? ""}</TableCell>
              <TableCell>{podeOperar && (l.status === "enviado" || l.status === "devolvido") && <CopiarLink chave={l.chave} />}</TableCell>
            </TableRow>
          ))}
          {semLote.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.nome}</TableCell>
              <TableCell className="text-muted-foreground">Sem lote</TableCell>
              <TableCell />
              <TableCell>{podeOperar && <AbrirLote setorId={s.id} competencia={competencia} />}</TableCell>
            </TableRow>
          ))}
          {!lotes.length && !semLote.length && (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nenhum setor ativo. O gestor cadastra em RH &gt; Ponto &gt; Setores e líderes.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
