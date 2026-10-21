"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ROTA_PONTO } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData } from "@/lib/nucleo/fila";
import { gravarImportacao, previaImportacao, type Previa } from "../acoes";

const SELECAO = "h-8 w-full rounded-[3px] border border-input bg-white px-2 text-sm";

/** Importa o relatório "Inconsistências" do Control iD (PDF original): lê, mostra a prévia e grava o lote do setor. */
export function ImportarRelatorio({ setores }: { setores: { id: string; nome: string }[] }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [setor, setSetor] = useState(setores.length === 1 ? setores[0].id : "");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  const limpar = () => { setArquivo(null); setPrevia(null); setErro(undefined); if (entrada.current) entrada.current.value = ""; };
  const ler = (f: File) => iniciar(async () => {
    setArquivo(f); setErro(undefined); setPrevia(null);
    const fd = new FormData(); fd.set("arquivo", f);
    const r = await previaImportacao(fd);
    if (!r.ok) setErro(r.erro); else setPrevia(r.previa);
  });
  const gravar = () => iniciar(async () => {
    if (!arquivo) return;
    const fd = new FormData(); fd.set("arquivo", arquivo); fd.set("setor", setor);
    const r = await gravarImportacao(fd);
    if (!r.ok) { setErro(r.erro); return; }
    toast.success(r.aviso);
    setAberto(false); limpar();
    router.push(`${ROTA_PONTO}/lote/${r.id}`);
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); if (!v) limpar(); }}>
      <DialogTrigger render={<Button disabled={setores.length === 0} />}><FileUp /> Importar relatório</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar inconsistências do Control iD</DialogTitle>
          <DialogDescription>
            O PDF do relatório &quot;Inconsistências&quot; salvo direto do Control iD (relatorio_….PDF). O reimpresso pelo &quot;Microsoft Print to PDF&quot; não serve: perde o texto.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="setorPonto">Setor</Label>
          <select id="setorPonto" value={setor} onChange={(e) => setSetor(e.target.value)} className={SELECAO}>
            <option value="">Escolha…</option>
            {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>
        <input ref={entrada} type="file" accept=".pdf,application/pdf" aria-label="PDF do relatório" onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); }} className="text-sm" />
        {pendente && !previa && <p className="text-sm text-muted-foreground">Lendo o PDF…</p>}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        {previa && (
          <div className="space-y-2 text-sm">
            <p>
              Período <strong>{formatarData(previa.inicio)} a {formatarData(previa.fim)}</strong> · {previa.pessoas} pessoa(s) · <strong>{previa.ocorrencias}</strong> ocorrência(s).
            </p>
            {previa.semCadastro.length > 0 && (
              <p className="text-amber-800">
                Sem cadastro em Colaboradores (entram assim mesmo; vincule depois na quinzena): {previa.semCadastro.join(", ")}.
              </p>
            )}
            {previa.avisos.map((a) => <p key={a} className="text-amber-800">{a}</p>)}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={limpar} disabled={pendente}>Outro arquivo</Button>
              <Button onClick={gravar} disabled={pendente || !setor}>{pendente ? "Gravando…" : "Gravar"}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
