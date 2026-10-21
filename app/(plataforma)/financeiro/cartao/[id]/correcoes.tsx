"use client";

// Avisos dos títulos conciliados e as correções no Consistem (trocar cartão, acertar vencimento, trocar conta de fluxo), o botão
// "Não é desta fatura" das divergências e a lista das correções do mês. Regras 68 a 71 de docs/modulos/financeiro-cartao.md.
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ContaFluxo } from "@/lib/modulos/financeiro/cartao/listas";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { corrigirNoConsistem, naoEhDestaFatura } from "../acoes";
import type { CorrecaoLinha, QuadroCorrecoes } from "../dados";
import { SeletorContaFluxo } from "../listas";

type Tipo = "cartao" | "vencimento" | "conta_fluxo";
const ROTULO: Record<Tipo, string> = { cartao: "Trocar cartão", vencimento: "Acertar vencimento", conta_fluxo: "Trocar conta de fluxo" };
const CAMPO: Record<string, string> = {
  complementoHistorico: "Complemento", dataVencimento: "Vencimento", codPortador: "Banco (portador)", codHistorico: "Histórico",
  grupoContaFluxoCaixa: "Grupo do fluxo", contaFluxoCaixa: "Conta do fluxo",
};
const mostrar = (k: string, v: unknown) => (v === undefined || v === null || v === "" ? "—" : k === "dataVencimento" ? formatarData(String(v)) : String(v));

/** Avisos de um título conciliado e os botões de correção (operador, mês em conciliação, chave ligada). */
export function AvisosDoTitulo({ cod, correcoes, faturaId, podeCorrigir, contas, vencimentoFatura }: {
  cod: string; correcoes: QuadroCorrecoes; faturaId: string | null; podeCorrigir: boolean; contas: readonly ContaFluxo[]; vencimentoFatura: string;
}) {
  const avisos = correcoes.avisos[cod] ?? [];
  if (avisos.length === 0) return null;
  const corrige = podeCorrigir && faturaId !== null && correcoes.ligado && correcoes.mesAberto;
  const cartao = correcoes.trocarCartao[cod];
  const fluxo = correcoes.fluxo[cod];
  return (
    <div className="space-y-1">
      {avisos.map((a) => <p key={a.tipo} className="text-xs font-medium text-amber-800">{a.texto}</p>)}
      {corrige && (
        <div className="flex flex-wrap gap-1">
          {avisos.some((a) => a.tipo === "cartao") && (cartao?.ok
            ? <DialogoCorrigir faturaId={faturaId!} cod={cod} tipo="cartao" alteracao={cartao.alteracao} />
            : <p className="text-xs text-muted-foreground">{cartao?.erro}</p>)}
          {avisos.some((a) => a.tipo === "vencimento") && <DialogoCorrigir faturaId={faturaId!} cod={cod} tipo="vencimento" alteracao={{ dataVencimento: vencimentoFatura }} />}
          {avisos.some((a) => a.tipo === "fluxo_inativo") && fluxo && <DialogoCorrigir faturaId={faturaId!} cod={cod} tipo="conta_fluxo" contas={contas} fluxo={fluxo} />}
        </div>
      )}
    </div>
  );
}

function DialogoCorrigir({ faturaId, cod, tipo, alteracao, contas = [], fluxo }: {
  faturaId: string; cod: string; tipo: Tipo; alteracao?: Record<string, string | number>; contas?: readonly ContaFluxo[];
  fluxo?: QuadroCorrecoes["fluxo"][string];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [conta, setConta] = useState<{ grupo: number; conta: number } | null>(fluxo?.sugerida ?? null);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const novo = tipo === "conta_fluxo" ? (conta ? { grupoContaFluxoCaixa: conta.grupo, contaFluxoCaixa: conta.conta } : null) : alteracao ?? null;
  function confirmar() {
    iniciar(async () => {
      const r = await corrigirNoConsistem({ faturaId, titulo: cod, tipo, conta: tipo === "conta_fluxo" ? conta : null });
      if (r.ok) { toast.success(r.aviso); setAberto(false); router.refresh(); } else { setErro(r.erro); router.refresh(); }
    });
  }
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => { setErro(undefined); setAberto(true); }}>{ROTULO[tipo]}</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v && !pendente) setAberto(false); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{ROTULO[tipo]} no Consistem — lançamento {cod}</DialogTitle>
              <DialogDescription>O painel lê o título, altera só os campos abaixo, lê de novo e confere que nada mais mudou. Tudo fica registrado.</DialogDescription>
            </DialogHeader>
            {tipo === "conta_fluxo" && (
              <label className="block space-y-1 text-sm">
                <span className="block font-medium">Conta de fluxo ativa (hoje {fluxo ? `${fluxo.atual.grupo}/${fluxo.atual.conta}, inativa` : "—"})</span>
                <SeletorContaFluxo contas={contas.filter((c) => c.ativa)} grupo={conta?.grupo} item={conta?.conta} aoMudar={(g, i) => setConta(g && i ? { grupo: g, conta: i } : null)} />
              </label>
            )}
            {novo && (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                {Object.entries(novo).map(([k, v]) => (<Fragment key={k}><dt className="text-muted-foreground">{CAMPO[k] ?? k}</dt><dd className={k === "complementoHistorico" ? "font-mono text-xs" : "tabular-nums"}>{mostrar(k, v)}</dd></Fragment>))}
              </dl>
            )}
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
              <Button onClick={confirmar} disabled={pendente || !novo}>{pendente ? "Corrigindo…" : "Corrigir no Consistem"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** "Não é desta fatura": observação de um clique num título sem linha (libera a trava do Lançar). */
export function BotaoNaoEhDestaFatura({ faturaId, titulo }: { faturaId: string; titulo: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <Button size="xs" variant="outline" disabled={pendente} onClick={() => iniciar(async () => {
      const r = await naoEhDestaFatura({ faturaId, titulo });
      if (r.ok) { toast.success("Registrado: não é desta fatura."); router.refresh(); } else toast.error(r.erro);
    })}>{pendente ? "Registrando…" : "Não é desta fatura"}</Button>
  );
}

const SITUACAO: Record<CorrecaoLinha["situacao"], string> = { reservado: "Reservada", enviando: "Sem resposta", corrigido: "Corrigido", erro: "Não corrigido" };

/** Correções no Consistem do mês (prova): o que mudou, antes → depois, quem e o erro. */
export function ListaCorrecoes({ historico }: { historico: CorrecaoLinha[] }) {
  if (historico.length === 0) return null;
  return (
    <section className="space-y-2 rounded-[3px] border border-grade bg-card p-3">
      <h3 className="text-sm font-bold">Correções no Consistem</h3>
      <Table>
        <TableHeader><TableRow><TableHead>Lançamento</TableHead><TableHead>Correção</TableHead><TableHead>Antes → depois</TableHead><TableHead>Situação</TableHead><TableHead>Quem</TableHead></TableRow></TableHeader>
        <TableBody>
          {historico.map((h) => (
            <TableRow key={h.id}>
              <TableCell className="tabular-nums">{h.cod_lancamento}{h.num_documento ? ` (${h.num_documento})` : ""}</TableCell>
              <TableCell>{ROTULO[h.tipo]}</TableCell>
              <TableCell className="text-xs">
                {Object.entries(h.alteracao).map(([k, v]) => <span key={k} className="block">{CAMPO[k] ?? k}: {mostrar(k, h.antes?.[k])} → {mostrar(k, v)}</span>)}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={h.situacao === "corrigido" ? "border-emerald-400 text-emerald-800" : h.situacao === "erro" ? "border-red-300 text-red-800" : "border-amber-400 text-amber-800"}>{SITUACAO[h.situacao]}</Badge>
                {h.erro && <span className="block text-xs text-red-800">{h.erro}</span>}
              </TableCell>
              <TableCell className="text-xs">{h.criado_por_nome ?? "—"} · {new Date(h.criado_em).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/** Logo depois de casar com um título de outro cartão ("É este"): a prévia do "Trocar cartão" para corrigir agora ou depois. */
export function DialogoTrocarCartaoAgora({ faturaId, cod, alteracao, aoFechar }: { faturaId: string; cod: string; alteracao: Record<string, string | number>; aoFechar: () => void }) {
  const router = useRouter();
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  function corrigir() {
    iniciar(async () => {
      const r = await corrigirNoConsistem({ faturaId, titulo: cod, tipo: "cartao", conta: null });
      if (r.ok) { toast.success(r.aviso); aoFechar(); router.refresh(); } else { setErro(r.erro); router.refresh(); }
    });
  }
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !pendente) aoFechar(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Casado. Trocar o cartão do título {cod} no Consistem?</DialogTitle>
          <DialogDescription>O título cita outro cartão. O painel pode corrigir agora (lê, altera só estes campos, lê de novo e confere) ou você deixa para depois, na aba Conciliados.</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {Object.entries(alteracao).map(([k, v]) => (<Fragment key={k}><dt className="text-muted-foreground">{CAMPO[k] ?? k}</dt><dd className={k === "complementoHistorico" ? "font-mono text-xs" : "tabular-nums"}>{mostrar(k, v)}</dd></Fragment>))}
        </dl>
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={aoFechar} disabled={pendente}>Depois</Button>
          <Button onClick={corrigir} disabled={pendente}>{pendente ? "Corrigindo…" : "Corrigir agora"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
