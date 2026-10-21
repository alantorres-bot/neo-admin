import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";
import { horas } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerParametros, lerPessoa } from "../../dados";
import { CancelarPagamento } from "./cancelar";

export const metadata: Metadata = { title: "Banco de horas — pessoa" };

export default async function PaginaPessoaBanco({ params }: PageProps<"/rh/banco_horas/pessoa/[id]">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const [p, par] = await Promise.all([lerPessoa(supabase, id), lerParametros(supabase)]);
  if (!p) notFound();
  const hoje = hojeEmCuiaba();
  const ehGestor = temAcesso(sessao.acesso, "rh", "gestor");
  const s = p.saldo;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm"><Link href={ROTA_BANCO_HORAS} className="text-elo hover:underline">← Saldos</Link></p>
        <h2 className="text-xl font-semibold">{s.nome}</h2>
        <p className="text-sm text-muted-foreground">
          Saldo desde {formatarData(par.inicio)}: <strong className={s.saldo_min < 0 ? "text-destructive" : ""}>{horas(s.saldo_min)}</strong>
          {" · "}Control iD: {horas(s.saldo_controlid_min) || "sem banco"}{s.saldo_em ? ` em ${formatarData(s.saldo_em)}` : ""}
          {s.vencido_min ? <> · <span className="text-destructive">vencido a pagar {horas(s.vencido_min)}</span></> : null}
        </p>
      </div>

      <section className="space-y-2">
        <h3 className="font-medium">Créditos (o mais antigo é consumido primeiro)</h3>
        <Table>
          <TableHeader><TableRow><TableHead>Dia</TableHead><TableHead className="text-right">Crédito</TableHead><TableHead className="text-right">Em aberto</TableHead><TableHead>Vence em</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
          <TableBody>
            {p.creditos.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhum crédito no período.</TableCell></TableRow>}
            {p.creditos.map((c) => (
              <TableRow key={c.data} className={c.restante === 0 ? "text-muted-foreground" : ""}>
                <TableCell className="tabular-nums">{formatarData(c.data)}</TableCell>
                <TableCell className="text-right tabular-nums">{horas(c.credito)}</TableCell>
                <TableCell className="text-right tabular-nums">{c.restante ? horas(c.restante) : ""}</TableCell>
                <TableCell className="tabular-nums">{formatarData(c.vencimento)}</TableCell>
                <TableCell>{c.restante === 0 ? "Compensado" : c.vencimento < hoje ? "Vencido: pagar na folha" : "Em aberto"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Movimentos do Control iD</h3>
        <Table>
          <TableHeader><TableRow><TableHead>Dia</TableHead><TableHead className="text-right">Crédito</TableHead><TableHead className="text-right">Débito</TableHead><TableHead>Conta?</TableHead></TableRow></TableHeader>
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

      {p.pagamentos.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-medium">Pagos na folha</h3>
          <Table>
            <TableHeader><TableRow><TableHead>Folha</TableHead><TableHead className="text-right">Horas</TableHead><TableHead>Observação</TableHead><TableHead>Situação</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {p.pagamentos.map((g) => (
                <TableRow key={g.id} className={g.cancelado_em ? "text-muted-foreground line-through" : ""}>
                  <TableCell>{formatarData(g.competencia).slice(3)}</TableCell>
                  <TableCell className="text-right tabular-nums">{horas(g.minutos)}</TableCell>
                  <TableCell>{g.observacao}</TableCell>
                  <TableCell>{g.cancelado_em ? `Cancelado: ${g.cancelado_motivo}` : "Pago"}</TableCell>
                  <TableCell>{ehGestor && !g.cancelado_em && <CancelarPagamento id={g.id} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}
