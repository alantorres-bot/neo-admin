"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, Printer, Send, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ROTA_VT, ROTULO_FORMA, type FormaPagamento } from "@/lib/modulos/rh/vale-transporte/modulo";
import { aprovarMes, enviarMes, lancarNoConsistem, marcarPaga, marcarPix, reabrirMes, resolverLancamento, type Resultado } from "../acoes";
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

export type LinhaPix = { id: string; cod_fornecedor: string; nome: string; forma_pagamento: FormaPagamento; valor: number; pix_pago_em: string | null };

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
              <TableCell>{ROTULO_FORMA[l.forma_pagamento]}</TableCell>
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

export type LinhaConsistem = { item_id: string; cod_fornecedor: string; nome: string; valor: number; lancamento: { id: string; situacao: string; cod: string | null; erro: string | null } | null };

/** Títulos do mês no Consistem: o que falta lançar, o que já foi (código), erros e respostas incertas a resolver. */
export function PainelConsistem({ id, linhas, ligado, codigosOk, podeLancar }: { id: string; linhas: LinhaConsistem[]; ligado: boolean; codigosOk: boolean; podeLancar: boolean }) {
  const { pendente, rodar } = useAcao();
  const [confirmando, setConfirmando] = useState(false);
  const [resolvendo, setResolvendo] = useState<string | null>(null);
  const [cod, setCod] = useState("");
  const [motivo, setMotivo] = useState("");
  const aLancar = linhas.filter((l) => l.valor > 0 && (!l.lancamento || l.lancamento.situacao === "erro"));
  const totalCentavos = aLancar.reduce((s, l) => s + Math.round(l.valor * 100), 0);
  const SITUACAO: Record<string, string> = { reservado: "Reservado", enviando: "Sem resposta — conferir no Consistem", lancado: "Lançado", erro: "Erro" };
  return (
    <div className="space-y-3">
      {!ligado || !codigosOk ? (
        <p className="rounded-[3px] border border-grade bg-cabecalho p-3 text-sm text-muted-foreground">
          O lançamento no Consistem está {codigosOk ? "desligado" : "sem os códigos do título"}. O gestor configura em <a href={`${ROTA_VT}/parametros`} className="text-elo hover:underline">Parâmetros</a>.
        </p>
      ) : podeLancar && aLancar.length > 0 && (
        <Dialog open={confirmando} onOpenChange={setConfirmando}>
          <DialogTrigger render={<Button size="sm" />}><Upload /> Lançar {aLancar.length} título(s) no Consistem</DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Lançar no Consistem</DialogTitle>
              <DialogDescription>Um título por pessoa, contra o fornecedor (Nº), com vencimento no dia do pagamento. Cada título é enviado uma única vez.</DialogDescription>
            </DialogHeader>
            <p className="text-sm">{aLancar.length} título(s) · total <strong>{reais(totalCentavos / 100)}</strong></p>
            <div className="flex justify-end">
              <Button disabled={pendente} onClick={() => rodar(() => lancarNoConsistem(id, { quantidade: aLancar.length, totalCentavos }), "Títulos lançados.", () => setConfirmando(false))}>
                {pendente ? "Lançando…" : "Confirmar e lançar"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <Table>
        <TableHeader>
          <TableRow><TableHead>Nº</TableHead><TableHead>Funcionário</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Situação</TableHead><TableHead>Código no Consistem</TableHead><TableHead /></TableRow>
        </TableHeader>
        <TableBody>
          {linhas.filter((l) => l.valor > 0 || l.lancamento).map((l) => (
            <TableRow key={l.item_id}>
              <TableCell className="tabular-nums">{l.cod_fornecedor}</TableCell>
              <TableCell>{l.nome}</TableCell>
              <TableCell className="text-right tabular-nums">{reais(l.valor)}</TableCell>
              <TableCell className={l.lancamento?.situacao === "erro" || l.lancamento?.situacao === "enviando" ? "text-destructive" : ""}>
                {l.lancamento ? SITUACAO[l.lancamento.situacao] : "A lançar"}{l.lancamento?.erro ? ` — ${l.lancamento.erro}` : ""}
              </TableCell>
              <TableCell className="tabular-nums">{l.lancamento?.cod ?? ""}</TableCell>
              <TableCell>
                {podeLancar && l.lancamento && (l.lancamento.situacao === "enviando" || l.lancamento.situacao === "reservado") && (
                  <Button variant="ghost" size="sm" onClick={() => { setResolvendo(l.lancamento!.id); setCod(""); setMotivo(""); }}>Resolver</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={!!resolvendo} onOpenChange={(v) => { if (!v) setResolvendo(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolver título sem resposta</DialogTitle>
            <DialogDescription>Confira no Consistem. Se o título foi criado, informe o código do lançamento; se não foi, deixe o código vazio.</DialogDescription>
          </DialogHeader>
          <Input value={cod} onChange={(e) => setCod(e.target.value)} inputMode="numeric" placeholder="Código do lançamento (vazio = não foi criado)" />
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="O que foi conferido" />
          <div className="flex justify-end">
            <Button disabled={pendente || motivo.trim().length < 3} onClick={() => rodar(() => resolverLancamento(resolvendo!, cod, motivo), "Título resolvido.", () => setResolvendo(null))}>Gravar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
