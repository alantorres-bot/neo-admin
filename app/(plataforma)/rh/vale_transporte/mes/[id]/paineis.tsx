"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, Printer, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ROTA_VT } from "@/lib/modulos/rh/vale-transporte/modulo";
import { aprovarMes, enviarMes, marcarPaga, marcarPix, reabrirMes, type Resultado } from "../acoes";
import type { StatusMes } from "../../dados";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function useAcao() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const rodar = (acao: () => Promise<Resultado>, sucesso: string, depois?: () => void) => iniciar(async () => {
    const r = await acao();
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso ?? sucesso);
    depois?.();
    router.refresh();
  });
  return { pendente, rodar };
}

/** Botões do fluxo do mês: enviar (operador), aprovar e reabrir (gestor), arquivo do BB (gestor), imprimir e marcar pago. */
export function FluxoMes({ id, status, importada, podeOperar, ehGestor, temFopag }: { id: string; status: StatusMes; importada: boolean; podeOperar: boolean; ehGestor: boolean; temFopag: boolean }) {
  const { pendente, rodar } = useAcao();
  const [motivo, setMotivo] = useState("");
  const [reabrindo, setReabrindo] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" render={<a href={`/imprimir/rh/vale-transporte/${id}`} target="_blank" rel="noreferrer" />}><Printer /> Relatório</Button>
      {!importada && status === "aberta" && podeOperar && (
        <Button size="sm" disabled={pendente} onClick={() => rodar(() => enviarMes(id), "Enviado para aprovação.")}><Send /> Enviar para aprovação</Button>
      )}
      {!importada && status === "enviada" && ehGestor && (
        <Button size="sm" disabled={pendente} onClick={() => rodar(() => aprovarMes(id), "Mês aprovado.")}><CheckCircle2 /> Aprovar</Button>
      )}
      {(status === "aprovada" || status === "paga") && ehGestor && temFopag && (
        <Button variant="outline" size="sm" render={<a href={`${ROTA_VT}/mes/${id}/arquivo-bb`} />}><FileSpreadsheet /> Arquivo do BB</Button>
      )}
      {!importada && status === "aprovada" && podeOperar && (
        <Button variant="outline" size="sm" disabled={pendente} onClick={() => rodar(() => marcarPaga(id), "Mês marcado como pago.")}><CheckCircle2 /> Marcar mês como pago</Button>
      )}
      {!importada && status !== "aberta" && ehGestor && (
        <Dialog open={reabrindo} onOpenChange={setReabrindo}>
          <DialogTrigger render={<Button variant="ghost" size="sm" />}><Undo2 /> Reabrir</DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Reabrir o mês</DialogTitle>
              <DialogDescription>Volta para “aberto”: a aprovação, o arquivo do BB e a marcação de pago são desfeitos. Não reabre se já houver título no Consistem.</DialogDescription>
            </DialogHeader>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={300} placeholder="Motivo" />
            <div className="flex justify-end">
              <Button disabled={pendente || motivo.trim().length < 3} onClick={() => rodar(() => reabrirMes(id, motivo), "Mês reaberto.", () => { setReabrindo(false); setMotivo(""); })}>Reabrir</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** pagadora = conta pagadora dos Parâmetros (empregadora × PIX) ou a forma gravada no mês. */
export type LinhaPix = { id: string; cod_fornecedor: string; nome: string; pagadora: string; valor: number; pix_pago_em: string | null };

/** PIX do mês (pagos à mão): marcar pago depois de aprovado. */
export function PainelPix({ id, linhas, podeMarcar }: { id: string; linhas: LinhaPix[]; podeMarcar: boolean }) {
  const { pendente, rodar } = useAcao();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const alternar = (k: string) => setMarcados((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  if (!linhas.length) return <p className="text-sm text-muted-foreground">Nenhum PIX neste mês.</p>;
  const total = linhas.reduce((s, l) => s + Math.round(l.valor * 100), 0) / 100;
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>{podeMarcar && <TableHead className="w-8" />}<TableHead>Nº</TableHead><TableHead>Funcionário</TableHead><TableHead>Pagadora</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Situação</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((l) => (
            <TableRow key={l.id}>
              {podeMarcar && <TableCell><input type="checkbox" aria-label={`Marcar ${l.nome}`} checked={marcados.has(l.id)} onChange={() => alternar(l.id)} className="size-4" /></TableCell>}
              <TableCell className="tabular-nums">{l.cod_fornecedor}</TableCell>
              <TableCell>{l.nome}</TableCell>
              <TableCell>{l.pagadora}</TableCell>
              <TableCell className="text-right tabular-nums">{reais(l.valor)}</TableCell>
              <TableCell>{l.pix_pago_em ? <Badge variant="outline" className="border-marca text-marca">Pago</Badge> : <Badge variant="outline">A pagar</Badge>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Total PIX: <strong>{reais(total)}</strong></span>
        {podeMarcar && (
          <>
            <Button size="sm" variant="outline" disabled={pendente || !marcados.size} onClick={() => rodar(() => marcarPix(id, [...marcados], true), "PIX marcados como pagos.", () => setMarcados(new Set()))}>Marcar como pago</Button>
            <Button size="sm" variant="ghost" disabled={pendente || !marcados.size} onClick={() => rodar(() => marcarPix(id, [...marcados], false), "Marcação desfeita.", () => setMarcados(new Set()))}>Desfazer</Button>
          </>
        )}
      </div>
    </div>
  );
}
