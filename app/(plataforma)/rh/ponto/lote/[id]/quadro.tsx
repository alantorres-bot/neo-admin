"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useLinhasVisiveis } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { ModoEmail } from "@/lib/modulos/rh/ponto/email";
import { horas, ROTULO_TIPO, type StatusLote } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData } from "@/lib/nucleo/fila";
import { desconectarGmail, iniciarConexaoGmail } from "@/app/(plataforma)/financeiro/filial/acoes";
import type { Ocorrencia } from "../../dados";
import { anexarAtestado, cancelarLote, criarRascunhoLider, devolverAoLider, linkDoAnexo, marcarAjustado, vincularColaborador } from "../../acoes";

type Arquivo = { caminho: string; nome: string };

function abrirAnexo(caminho: string) {
  void linkDoAnexo(caminho).then((r) => (r.ok ? window.open(r.url, "_blank", "noopener") : toast.error(r.erro)));
}

/** Diálogo com motivo obrigatório (devolver ao líder, cancelar). */
function ComMotivo({ rotulo, titulo, descricao, aoConfirmar, variante = "outline" }: {
  rotulo: string; titulo: string; descricao: string; aoConfirmar: (motivo: string) => Promise<{ ok: boolean; erro?: string }>; variante?: "outline" | "destructive";
}) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); setErro(undefined); }}>
      <DialogTrigger render={<Button variant={variante} size="sm" />}>{rotulo}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{titulo}</DialogTitle><DialogDescription>{descricao}</DialogDescription></DialogHeader>
        <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} aria-label="Motivo" placeholder="Motivo" />
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex justify-end">
          <Button onClick={() => iniciar(async () => { const r = await aoConfirmar(motivo); if (r.ok) setAberto(false); else setErro(r.erro); })} disabled={pendente || motivo.trim().length < 5}>
            {pendente ? "Salvando…" : "Confirmar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AcoesLote({ loteId, status, vencido, gmail, pdf, podeOperar, ehGestor }: {
  loteId: string; status: StatusLote; vencido: boolean; gmail: string | null; pdf: Arquivo | null; podeOperar: boolean; ehGestor: boolean;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();

  const rascunho = (modo: ModoEmail) => iniciar(async () => {
    const r = await criarRascunhoLider(loteId, modo);
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso ?? "Rascunho criado no seu Gmail. Confira e envie por lá.");
    window.open(r.url, "_blank", "noopener");
    router.refresh();
  });
  const conectar = () => iniciar(async () => {
    const r = await iniciarConexaoGmail(window.location.href);
    if (r.ok) window.location.href = r.url; else toast.error(r.erro);
  });

  const modoEmail: ModoEmail | null = status === "importado" ? "envio" : status === "devolvido" ? "devolucao" : status === "enviado" && vencido ? "lembrete" : null;
  const rotuloEmail = { envio: "E-mail ao líder", devolucao: "E-mail da devolução", lembrete: "Lembrete ao líder" };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {pdf && <Button variant="outline" size="sm" onClick={() => abrirAnexo(pdf.caminho)}><Paperclip /> PDF do Control iD</Button>}
        {podeOperar && modoEmail && gmail && (
          <Button size="sm" onClick={() => rascunho(modoEmail)} disabled={pendente}><Mail /> {pendente ? "Criando rascunho…" : rotuloEmail[modoEmail]}</Button>
        )}
        {podeOperar && status === "devolvido" && vencido && gmail && (
          <Button size="sm" variant="outline" onClick={() => rascunho("lembrete")} disabled={pendente}>Lembrete ao líder</Button>
        )}
        {podeOperar && status === "justificado" && (
          <ComMotivo rotulo="Devolver ao líder" titulo="Devolver ao líder" descricao="O líder corrige e envia de novo. Em seguida, crie o e-mail da devolução."
            aoConfirmar={async (m) => { const r = await devolverAoLider(loteId, m); if (r.ok) { toast.success("Devolvido ao líder."); router.refresh(); } return r; }} />
        )}
        {ehGestor && !["concluido", "cancelado"].includes(status) && (
          <ComMotivo rotulo="Cancelar" variante="destructive" titulo="Cancelar a quinzena" descricao="Nada é apagado: o lote fica cancelado com o motivo, e as pendências são encerradas. Depois dá para importar de novo."
            aoConfirmar={async (m) => { const r = await cancelarLote(loteId, m); if (r.ok) { toast.success("Quinzena cancelada."); router.refresh(); } return r; }} />
        )}
      </div>
      {podeOperar && modoEmail && (
        gmail ? (
          <p className="text-xs text-muted-foreground">
            O rascunho vai para o seu Gmail ({gmail}); confira e envie por lá.{" "}
            <button type="button" className="underline" onClick={() => iniciar(async () => { const r = await desconectarGmail(); if (r.ok) router.refresh(); })}>desconectar</button>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            Para criar o e-mail ao líder, autorize o seu Gmail uma vez (só cria rascunhos; quem envia é você).
            <Button size="sm" variant="outline" onClick={conectar} disabled={pendente}>Conectar meu Gmail</Button>
          </p>
        )
      )}
    </div>
  );
}

type Linha = Ocorrencia & { acao: string; atestados: Arquivo[]; ajustadoTexto: string };

export function GradeOcorrencias({ loteId, status, podeOperar, colaboradores, ocorrencias }: {
  loteId: string; status: StatusLote; podeOperar: boolean; colaboradores: { id: string; nome: string }[]; ocorrencias: Linha[];
}) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [pendente, iniciar] = useTransition();
  const { visivel, aoFiltrar } = useLinhasVisiveis();
  const podeAjustar = podeOperar && status === "justificado";
  const podeVincular = podeOperar && !["concluido", "cancelado"].includes(status);

  const selecionaveis = ocorrencias.filter((o) => visivel(o.id));
  const todas = selecionaveis.length > 0 && selecionaveis.every((o) => marcadas.has(o.id));
  const alternar = (id: string) => setMarcadas((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const alternarTodas = () => setMarcadas((a) => { const n = new Set(a); for (const o of selecionaveis) if (todas) n.delete(o.id); else n.add(o.id); return n; });

  const ajustar = (ajustado: boolean) => iniciar(async () => {
    const ids = ocorrencias.filter((o) => marcadas.has(o.id) && !!o.ajustado_em !== ajustado).map((o) => o.id);
    if (!ids.length) { toast.error(ajustado ? "As selecionadas já estão marcadas." : "Nenhuma selecionada está marcada."); return; }
    const r = await marcarAjustado(loteId, ids, ajustado);
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso ?? "Feito.");
    setMarcadas(new Set());
    router.refresh();
  });
  const vincular = (ocorrencia: string, colaborador: string) => iniciar(async () => {
    const r = await vincularColaborador(ocorrencia, colaborador || null);
    if (!r.ok) toast.error(r.erro); else router.refresh();
  });
  const anexar = (ocorrencia: string, arquivo: File) => iniciar(async () => {
    const fd = new FormData(); fd.set("ocorrencia", ocorrencia); fd.set("arquivo", arquivo);
    const r = await anexarAtestado(fd);
    if (!r.ok) toast.error(r.erro); else { toast.success(r.aviso ?? "Anexado."); router.refresh(); }
  });

  return (
    <div className="space-y-3">
      {podeAjustar && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => ajustar(true)} disabled={pendente || marcadas.size === 0}>Ajustado no Control iD ({marcadas.size})</Button>
          <Button size="sm" variant="ghost" onClick={() => ajustar(false)} disabled={pendente || marcadas.size === 0}>Desmarcar</Button>
          <span className="text-xs text-muted-foreground">Quando todas estiverem ajustadas, a quinzena fica concluída.</span>
        </div>
      )}
      <div className="overflow-x-auto rounded-[3px] border border-grade">
        <Table aoFiltrar={aoFiltrar}>
          <TableHeader>
            <TableRow>
              {podeAjustar && <TableHead className="w-8"><input type="checkbox" className="size-4" aria-label="Marcar todas" checked={todas} onChange={alternarTodas} /></TableHead>}
              <TableHead>Funcionário</TableHead><TableHead>Dia</TableHead><TableHead>Previsto</TableHead><TableHead>Marcações</TableHead>
              <TableHead className="text-right">Falta/atraso</TableHead><TableHead className="text-right">Extras</TableHead><TableHead className="text-right">Saldo banco</TableHead>
              <TableHead>Justificativa do líder</TableHead><TableHead>Ação sugerida</TableHead><TableHead>Documento</TableHead><TableHead>Ajustado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ocorrencias.map((o) => (
              <TableRow key={o.id} className={o.ajustado_em ? "text-muted-foreground" : ""}>
                {podeAjustar && <TableCell><input type="checkbox" className="size-4" aria-label={`Marcar ${o.nome} ${formatarData(o.data)}`} checked={marcadas.has(o.id)} onChange={() => alternar(o.id)} /></TableCell>}
                <TableCell>
                  <div className="font-medium">{o.nome}</div>
                  <div className="text-xs text-muted-foreground">{o.cargo}</div>
                  {!o.colaborador_id && (
                    podeVincular ? (
                      <select aria-label={`Vincular ${o.nome} ao cadastro`} defaultValue="" disabled={pendente} onChange={(e) => vincular(o.id, e.target.value)}
                        className="mt-1 h-7 max-w-56 rounded-[3px] border border-amber-600 bg-white px-1 text-[12px] text-amber-800">
                        <option value="">Sem cadastro: vincular…</option>
                        {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    ) : <span className="text-xs text-amber-800">Sem cadastro</span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums whitespace-nowrap">{formatarData(o.data)} {o.dia_semana}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{o.previsto}</TableCell>
                <TableCell className="tabular-nums text-xs whitespace-nowrap">{o.falta ? <strong>FALTA</strong> : o.marcacoes.filter(Boolean).join(" · ")}</TableCell>
                <TableCell className="text-right tabular-nums">{horas(o.falta_atraso_min)}</TableCell>
                <TableCell className="text-right tabular-nums">{o.extras_min ? horas(o.extras_min) : ""}</TableCell>
                <TableCell className={`text-right tabular-nums ${(o.banco_saldo_min ?? 0) < 0 ? "text-destructive" : ""}`}>{horas(o.banco_saldo_min)}</TableCell>
                <TableCell className="max-w-72 text-sm">
                  {o.tipo ? ROTULO_TIPO[o.tipo] : <span className="text-muted-foreground">—</span>}
                  {o.horario && <span className="tabular-nums"> · {o.horario}</span>}
                  {o.observacao && <div className="text-xs text-muted-foreground">{o.observacao}</div>}
                </TableCell>
                <TableCell className="max-w-64 text-sm">{o.acao}</TableCell>
                <TableCell className="text-xs">
                  {o.atestados.map((a) => <button key={a.caminho} type="button" className="block text-elo underline" onClick={() => abrirAnexo(a.caminho)}>{a.nome}</button>)}
                  {podeOperar && (o.tipo === "justificada" || o.atestados.length > 0) && !["concluido", "cancelado"].includes(status) && (
                    <label className="cursor-pointer text-elo underline">
                      Anexar
                      <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) anexar(o.id, f); e.target.value = ""; }} />
                    </label>
                  )}
                </TableCell>
                <TableCell className="text-xs">{o.ajustadoTexto}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
