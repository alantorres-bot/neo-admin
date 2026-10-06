"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { desdobrarTitulo, encerrarParte, marcarNaAkf } from "./acoes";

export type LinhaAkf = {
  id: string;
  clienteId?: string;
  documento: string;
  cliente: string;
  unidade: "matriz" | "contagem";
  vencimento: string; // já formatado
  atraso: string;
  vencido: boolean;
  valor: string; // já formatado
  portador: string;
  naAkf: boolean;
  semBoleto: boolean;
  /** Valor do título no Consistem, em reais, e o vencimento em aaaa-mm-dd (para o formulário de antecipação parcial). */
  valorReais: number;
  vencimentoIso: string;
  /** Se o título tem parte antecipada: o que resta com a Neo (já formatado) e o que está na AKF. */
  restante: string | null;
  naAkfParcial: string | null;
  /** Linha que é uma PARTE antecipada de um título (antecipação parcial): o id da parte e o do título. */
  parteId?: string;
  tituloId?: string;
};

/** Botão "Encerrar parte" de uma linha da lista (motivo obrigatório, fica no histórico do título). */
function EncerrarParteLinha({ parteId }: { parteId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pendente, iniciar] = useTransition();

  function encerrar() {
    iniciar(async () => {
      const r = await encerrarParte({ id: parteId, motivo });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        setMotivo("");
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  if (!aberto) return <Button type="button" variant="outline" size="sm" onClick={() => setAberto(true)}>Encerrar parte</Button>;
  return (
    <div className="flex min-w-60 flex-col gap-2">
      <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (recompra, liquidação, erro…)" aria-label="Motivo do encerramento" maxLength={300} className="h-8" />
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pendente} onClick={encerrar}>{pendente ? "Salvando…" : "Encerrar"}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { setAberto(false); setMotivo(""); }}>Cancelar</Button>
      </div>
    </div>
  );
}

/** "Antecipar parte": o título continua inteiro no Consistem; a parte antecipada (valor e vencimento próprios) fica só aqui. */
function AnteciparParte({ linha }: { linha: LinhaAkf }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(linha.vencimentoIso);
  const [observacao, setObservacao] = useState("");
  const [pendente, iniciar] = useTransition();

  function salvar() {
    const numero = Number(valor.replace(/\./g, "").replace(",", "."));
    iniciar(async () => {
      const r = await desdobrarTitulo({ tituloId: linha.id, valor: Number.isFinite(numero) ? numero : 0, vencimento, dataOperacao: null, observacao });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        setValor("");
        setObservacao("");
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setAberto(!aberto)}>{aberto ? "Fechar" : "Antecipar parte"}</Button>
      {aberto && (
        <div className="flex min-w-72 flex-col gap-2 rounded-[3px] border border-grade bg-cabecalho p-2 font-normal">
          <label className="grid gap-1 text-xs">
            Valor antecipado (R$) — o título tem {linha.valor}
            <Input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" className="h-8" />
          </label>
          <label className="grid gap-1 text-xs">
            Vencimento da parte antecipada
            <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="h-8" />
          </label>
          <label className="grid gap-1 text-xs">
            Observação (opcional)
            <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={300} placeholder="ex.: borderô 8601" className="h-8" />
          </label>
          <Button type="button" size="sm" disabled={pendente} onClick={salvar}>{pendente ? "Salvando…" : "Registrar antecipação parcial"}</Button>
        </div>
      )}
    </div>
  );
}

/**
 * Lista de títulos da AKF com seleção. "Disponíveis" oferece "Marcar como na AKF"; as listas de títulos na AKF oferecem
 * "Retirar da AKF". Só marca à mão quem é operador; o portador 998 do Consistem marca sozinho na sincronização.
 */
export function TabelaAkf({ linhas, podeOperar, acao }: { linhas: LinhaAkf[]; podeOperar: boolean; acao: "marcar" | "retirar" }) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [observacao, setObservacao] = useState("");
  const [pendente, iniciar] = useTransition();

  function alternar(id: string) {
    setMarcadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function aplicar() {
    iniciar(async () => {
      const r = await marcarNaAkf({ ids: [...marcadas], cedido: acao === "marcar", observacao });
      if (r.ok) {
        toast.success(r.aviso);
        setMarcadas(new Set());
        setObservacao("");
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  // Em "marcar", só dá para marcar o que ainda não está na AKF (a busca de títulos traz também os que já estão).
  const selecionaveis = (acao === "retirar" ? linhas : linhas.filter((l) => !l.naAkf)).filter((l) => !l.parteId);
  const temPartes = linhas.some((l) => l.parteId);
  const todas = selecionaveis.length > 0 && marcadas.size === selecionaveis.length;
  return (
    <div className="space-y-3">
      {podeOperar && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pendente || marcadas.size === 0} onClick={aplicar}>
            {pendente ? "Salvando…" : acao === "marcar" ? `Marcar como na AKF (${marcadas.size})` : `Retirar da AKF (${marcadas.size})`}
          </Button>
          <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Observação (opcional), ex.: operação de 06/10" aria-label="Observação" maxLength={300} className="h-8 w-80" />
          <span className="text-xs text-muted-foreground">
            {acao === "marcar" ? "Use quando o portador ainda não mudou para 998 no Consistem." : "Use quando o título voltou para a Neo (recompra ou liquidação)."}
          </span>
        </div>
      )}
      <div className="overflow-x-auto rounded-[3px] border border-grade">
        <Table>
          <TableHeader>
            <TableRow>
              {podeOperar && (
                <TableHead className="w-8">
                  <input type="checkbox" className="size-4" aria-label="Marcar todos" checked={todas} onChange={() => setMarcadas(todas ? new Set() : new Set(selecionaveis.map((l) => l.id)))} />
                </TableHead>
              )}
              <TableHead>Documento</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Atraso</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Portador</TableHead>
              <TableHead>Situação</TableHead>
              {podeOperar && acao === "marcar" && <TableHead>Parcial</TableHead>}
              {podeOperar && temPartes && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.id}>
                {podeOperar && (
                  <TableCell>
                    {!l.parteId && (acao === "retirar" || !l.naAkf) && <input type="checkbox" className="size-4" aria-label={`Marcar ${l.documento}`} checked={marcadas.has(l.id)} onChange={() => alternar(l.id)} />}
                  </TableCell>
                )}
                <TableCell className="font-medium tabular-nums">
                  <Link href={`/financeiro/recebiveis/${l.tituloId ?? l.id}`} className="hover:underline">{l.documento}</Link>
                  {l.unidade === "contagem" && <Badge variant="outline" className="ml-1.5 align-middle">Contagem</Badge>}
                </TableCell>
                <TableCell className="max-w-72 truncate" title={l.cliente}>
                  {l.clienteId ? <Link href={`/financeiro/recebiveis/clientes/${l.clienteId}`} className="hover:underline">{l.cliente}</Link> : l.cliente}
                </TableCell>
                <TableCell className="tabular-nums">{l.vencimento}</TableCell>
                <TableCell className={l.vencido ? "font-medium text-red-700" : "text-muted-foreground"}>{l.atraso}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.restante ?? l.valor}
                  {l.restante && <span className="block text-[11px] font-normal text-muted-foreground">de {l.valor} · {l.naAkfParcial} na AKF</span>}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{l.portador}</TableCell>
                <TableCell className="space-x-1">
                  <Badge className={l.naAkf ? "bg-sky-100 text-sky-900" : l.vencido ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-900"}>{l.naAkf ? "Na AKF" : l.vencido ? "Vencido" : "Disponível"}</Badge>
                  {l.semBoleto && <Badge variant="outline" title="Operar 1 dia após o vencimento, sem emitir boleto">Sem boleto</Badge>}
                  {l.restante && <Badge className="bg-sky-100 text-sky-900" title="Parte do título já antecipada na AKF">Parcial na AKF</Badge>}
                  {l.parteId && <Badge className="bg-sky-100 text-sky-900" title="Parte de um título antecipado só em parte; o restante fica com a Neo">Parcial</Badge>}
                </TableCell>
                {podeOperar && acao === "marcar" && <TableCell className="align-top">{!l.naAkf && <AnteciparParte linha={l} />}</TableCell>}
                {podeOperar && temPartes && <TableCell className="align-top">{l.parteId && <EncerrarParteLinha parteId={l.parteId} />}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export type LinhaParte = {
  id: string;
  clienteId?: string;
  tituloId: string;
  documento: string;
  cliente: string;
  unidade: "matriz" | "contagem";
  valor: string;
  vencimento: string;
  vencida: boolean;
  dataOperacao: string;
  restante: string;
  observacao: string | null;
};

/** Antecipações parciais ativas: o que está na AKF de cada título que foi antecipado só em parte. */
export function ListaPartes({ partes, podeOperar }: { partes: LinhaParte[]; podeOperar: boolean }) {
  const router = useRouter();
  const [encerrando, setEncerrando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [pendente, iniciar] = useTransition();

  function encerrar(id: string) {
    iniciar(async () => {
      const r = await encerrarParte({ id, motivo });
      if (r.ok) {
        toast.success(r.aviso);
        setEncerrando(null);
        setMotivo("");
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  return (
    <div className="overflow-x-auto rounded-[3px] border border-grade">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Documento</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead className="text-right">Parte na AKF</TableHead>
            <TableHead>Vencimento da parte</TableHead>
            <TableHead>Operação</TableHead>
            <TableHead className="text-right">Resta com a Neo</TableHead>
            <TableHead>Observação</TableHead>
            {podeOperar && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {partes.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium tabular-nums">
                <Link href={`/financeiro/recebiveis/${p.tituloId}`} className="hover:underline">{p.documento}</Link>
                {p.unidade === "contagem" && <Badge variant="outline" className="ml-1.5 align-middle">Contagem</Badge>}
              </TableCell>
              <TableCell className="max-w-64 truncate" title={p.cliente}>
                {p.clienteId ? <Link href={`/financeiro/recebiveis/clientes/${p.clienteId}`} className="hover:underline">{p.cliente}</Link> : p.cliente}
              </TableCell>
              <TableCell className="text-right tabular-nums">{p.valor}</TableCell>
              <TableCell className={`tabular-nums ${p.vencida ? "font-medium text-red-700" : ""}`}>{p.vencimento}{p.vencida ? " (vencida)" : ""}</TableCell>
              <TableCell className="tabular-nums text-muted-foreground">{p.dataOperacao}</TableCell>
              <TableCell className="text-right tabular-nums">{p.restante}</TableCell>
              <TableCell className="max-w-48 truncate text-muted-foreground" title={p.observacao ?? undefined}>{p.observacao ?? "—"}</TableCell>
              {podeOperar && (
                <TableCell className="align-top">
                  {encerrando === p.id ? (
                    <div className="flex min-w-64 flex-col gap-2">
                      <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (recompra, liquidação, erro…)" aria-label="Motivo do encerramento" maxLength={300} className="h-8" />
                      <div className="flex gap-2">
                        <Button type="button" size="sm" disabled={pendente} onClick={() => encerrar(p.id)}>{pendente ? "Salvando…" : "Encerrar"}</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => { setEncerrando(null); setMotivo(""); }}>Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => { setEncerrando(p.id); setMotivo(""); }}>Encerrar parte</Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
