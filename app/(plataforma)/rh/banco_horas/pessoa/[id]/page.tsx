import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";
import { horas } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerParametros, lerPessoa } from "../../dados";

export const metadata: Metadata = { title: "Banco de horas — pessoa" };

export default async function PaginaPessoaBanco({ params }: PageProps<"/rh/banco_horas/pessoa/[id]">) {
  await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const [p, par] = await Promise.all([lerPessoa(supabase, id), lerParametros(supabase)]);
  if (!p) notFound();
  const hoje = hojeEmCuiaba();
  const s = p.saldo;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm"><Link href={`${ROTA_BANCO_HORAS}/saldos`} className="text-elo hover:underline">← Saldos</Link></p>
          <h2 className="text-xl font-semibold">{s.nome}</h2>
          <p className="text-sm text-muted-foreground">
            Saldo desde {formatarData(par.inicio)}: <strong className={s.saldo_min < 0 ? "text-destructive" : ""}>{horas(s.saldo_min)}</strong>
            {" · "}Control iD: {horas(s.saldo_controlid_min) || "sem banco"}{s.saldo_em ? ` em ${formatarData(s.saldo_em)}` : ""}
            {s.pagar_min ? <> · <span className="text-destructive">a empresa paga {horas(s.pagar_min)}</span></> : null}
            {s.descontar_min ? <> · <span className="text-destructive">descontar {horas(s.descontar_min)}</span></> : null}
          </p>
        </div>
        <Button variant="outline" render={<Link href={`/imprimir/rh/banco-horas/extrato/${s.pessoa_id}`} target="_blank" />}><Printer /> Extrato</Button>
      </div>

      <section className="space-y-2">
        <h3 className="font-medium">Horas em aberto (o mais antigo é acertado primeiro)</h3>
        <Table>
          <TableHeader><TableRow><TableHead>Dia</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Horas</TableHead><TableHead>Prazo</TableHead><TableHead>O que acontece</TableHead></TableRow></TableHeader>
          <TableBody>
            {p.aberto.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nada em aberto: o saldo está zerado.</TableCell></TableRow>}
            {p.aberto.map((a) => (
              <TableRow key={`${a.data}-${a.sinal}`}>
                <TableCell className="tabular-nums">{formatarData(a.data)}</TableCell>
                <TableCell>{a.sinal === 1 ? "A folgar (trabalhou a mais)" : "A repor (trabalhou a menos)"}</TableCell>
                <TableCell className="text-right tabular-nums">{horas(a.restante)}</TableCell>
                <TableCell className="tabular-nums">{formatarData(a.vencimento)}</TableCell>
                <TableCell>
                  {a.vencimento < hoje
                    ? (a.sinal === 1 ? "Venceu: a empresa paga no fechamento" : "Venceu: desconta no fechamento")
                    : (a.sinal === 1 ? "Se não folgar até o prazo, a empresa paga" : "Se não repor até o prazo, desconta")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Movimentos do Control iD</h3>
        <Table>
          <TableHeader><TableRow><TableHead>Dia</TableHead><TableHead className="text-right">A mais</TableHead><TableHead className="text-right">A menos</TableHead><TableHead>Conta?</TableHead></TableRow></TableHeader>
          <TableBody>
            {p.movimentos.map((m) => (
              <TableRow key={m.data} className={m.data < par.inicio ? "text-muted-foreground" : ""}>
                <TableCell className="tabular-nums">{formatarData(m.data)}</TableCell>
                <TableCell className="text-right tabular-nums">{m.positivo_min ? horas(m.positivo_min) : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{m.negativo_min ? horas(m.negativo_min) : ""}</TableCell>
                <TableCell>{m.data < par.inicio ? "Antes do início: ignorado" : "Sim"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {p.lancamentos.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-medium">Acertos na folha</h3>
          <Table>
            <TableHeader><TableRow><TableHead>Folha</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Horas</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
            <TableBody>
              {p.lancamentos.map((g) => (
                <TableRow key={g.id} className={g.cancelado_em ? "text-muted-foreground line-through" : ""}>
                  <TableCell>{formatarData(g.competencia).slice(3)}</TableCell>
                  <TableCell>{g.tipo === "pago" ? "Empresa pagou" : "Descontado"}</TableCell>
                  <TableCell className="text-right tabular-nums">{horas(g.minutos)}</TableCell>
                  <TableCell>{g.cancelado_em ? `Cancelado: ${g.cancelado_motivo}` : g.observacao}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}
