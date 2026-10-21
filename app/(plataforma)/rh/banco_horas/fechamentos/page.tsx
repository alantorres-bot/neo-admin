import type { Metadata } from "next";
import Link from "next/link";
import { Ajuda } from "@/components/plataforma/ajuda";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AJUDA, REGRA_EM_UMA_FRASE } from "@/lib/modulos/rh/banco-horas/ajuda";
import { ROTA_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";
import { horas } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerFechamentos, lerSaldos, ROTULO_FECHAMENTO } from "../dados";
import { EmitirFechamento } from "./emitir";

export const metadata: Metadata = { title: "Banco de horas — fechamento do mês" };

/** Mês sugerido: o ciclo que já fechou (depois do dia 25, o do mês; antes, o do mês anterior). */
function mesSugerido(hoje: string): string {
  const [a, m, d] = hoje.split("-").map(Number);
  const x = new Date(Date.UTC(a, d > 25 ? m - 1 : m - 2, 1));
  return x.toISOString().slice(0, 7);
}

export default async function PaginaFechamentosBanco() {
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const [fechamentos, saldos] = await Promise.all([lerFechamentos(supabase), lerSaldos(supabase)]);
  const vencidos = saldos.filter((s) => s.pagar_min > 0 || s.descontar_min > 0);
  return (
    <div className="space-y-4">
      <Ajuda titulo={AJUDA.fechamentos.titulo} passos={AJUDA.fechamentos.passos} regra={REGRA_EM_UMA_FRASE} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {vencidos.length
            ? `Hoje há ${vencidos.length} pessoa(s) com horas vencidas: ${horas(vencidos.reduce((s, x) => s + x.pagar_min, 0))} a empresa paga e ${horas(vencidos.reduce((s, x) => s + x.descontar_min, 0))} a descontar.`
            : "Hoje ninguém tem horas vencidas para acertar na folha."}
        </p>
        {temAcesso(sessao.acesso, "rh", "operador") && <EmitirFechamento sugestao={mesSugerido(hojeEmCuiaba())} />}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Folha de</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Pessoas</TableHead>
            <TableHead className="text-right">Empresa paga</TableHead><TableHead className="text-right">Descontar</TableHead><TableHead>Emitido</TableHead><TableHead>Aprovado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fechamentos.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nenhum fechamento emitido.</TableCell></TableRow>}
          {fechamentos.map((f) => (
            <TableRow key={f.id} className={f.status === "cancelado" || f.status === "devolvido" ? "text-muted-foreground" : ""}>
              <TableCell className="font-medium"><Link href={`${ROTA_BANCO_HORAS}/fechamentos/${f.id}`} className="text-elo hover:underline">{formatarData(f.competencia).slice(3)}</Link></TableCell>
              <TableCell><Badge variant="outline">{ROTULO_FECHAMENTO[f.status]}</Badge></TableCell>
              <TableCell className="text-right tabular-nums">{f.pessoas}</TableCell>
              <TableCell className="text-right tabular-nums">{horas(f.pagar_min)}</TableCell>
              <TableCell className="text-right tabular-nums">{horas(f.descontar_min)}</TableCell>
              <TableCell>{formatarData(f.emitido_em.slice(0, 10))} · {f.emitido_por_nome}</TableCell>
              <TableCell>{f.aprovado_em ? `${formatarData(f.aprovado_em.slice(0, 10))} · ${f.aprovado_por_nome ?? ""}` : ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
