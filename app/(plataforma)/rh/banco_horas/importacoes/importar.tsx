"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerCsv } from "@/lib/integracoes/importador/ler-arquivo";
import { lerBancoHoras, type BancoLido } from "@/lib/modulos/rh/banco-horas/leitor-csv";
import { ROTA_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";
import { formatarData } from "@/lib/nucleo/fila";
import { importarBancoHoras } from "../acoes";

type Lido = BancoLido & { arquivo: string };

/** Dias entre o fim de um arquivo e o início do seguinte que nenhum arquivo cobre (só avisa). */
function buracos(lidos: readonly Lido[]): string[] {
  const ordem = [...lidos].sort((a, b) => a.inicio!.localeCompare(b.inicio!));
  const saida: string[] = [];
  let ate = ordem[0]?.fim ?? null;
  for (const l of ordem.slice(1)) {
    const seguinte = new Date(Date.parse(`${ate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    if (ate && l.inicio! > seguinte) saida.push(`${formatarData(seguinte)} a ${formatarData(new Date(Date.parse(`${l.inicio}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10))}`);
    if (!ate || l.fim! > ate) ate = l.fim;
  }
  return saida;
}

/** Lê um ou vários CSVs do Control iD no navegador, mostra a prévia e grava um por um (do mais antigo ao mais novo). */
export function ImportarCsv({ inicioConta }: { inicioConta: string }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [lidos, setLidos] = useState<Lido[]>([]);
  const [erros, setErros] = useState<string[]>([]);
  const [pendente, iniciar] = useTransition();

  const limpar = () => { setLidos([]); setErros([]); if (entrada.current) entrada.current.value = ""; };
  const ler = async (arquivos: File[]) => {
    limpar();
    const ok: Lido[] = [];
    const ruins: string[] = [];
    for (const f of arquivos) {
      if (f.size > 15 * 1024 * 1024) { ruins.push(`${f.name}: passa de 15 MB.`); continue; }
      const [p] = lerCsv(await f.arrayBuffer(), { delimitador: ";" });
      const r = lerBancoHoras(p.matriz);
      if (!r.inicio || r.pessoas.length === 0) ruins.push(`${f.name}: ${r.avisos.join(" ") || "sem linhas de banco de horas."}`);
      else ok.push({ ...r, arquivo: f.name });
    }
    setLidos(ok.sort((a, b) => a.inicio!.localeCompare(b.inicio!)));
    setErros(ruins);
  };
  const gravar = () => iniciar(async () => {
    for (const l of lidos) {
      const r = await importarBancoHoras({ arquivo: l.arquivo, inicio: l.inicio!, fim: l.fim!, pessoas: l.pessoas });
      if (!r.ok) { setErros([`${l.arquivo}: ${r.erro}`]); router.refresh(); return; }
      toast.success(r.aviso ?? `${l.arquivo} importado.`);
    }
    setAberto(false); limpar();
    router.push(`${ROTA_BANCO_HORAS}/saldos`);
  });

  const vazios = lidos.length ? buracos(lidos) : [];
  const inicio = lidos[0]?.inicio;
  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); if (!v) limpar(); }}>
      <DialogTrigger render={<Button />}><FileUp /> Importar CSV</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar banco de horas do Control iD</DialogTitle>
          <DialogDescription>Um ou vários CSVs de banco de horas (Id;Nome;CPF;…;Banco Negativo;Banco Positivo;Saldo Banco). O PIS não é guardado.</DialogDescription>
        </DialogHeader>
        <input ref={entrada} type="file" multiple accept=".csv,text/csv" aria-label="CSVs do banco de horas"
          onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) void ler(fs); }} className="text-sm" />
        {erros.map((e) => <p key={e} role="alert" className="text-sm text-destructive">{e}</p>)}
        {lidos.length > 0 && (
          <div className="space-y-2 text-sm">
            <Table interativa={false}>
              <TableHeader><TableRow><TableHead>Arquivo</TableHead><TableHead>Período</TableHead><TableHead className="text-right">Pessoas</TableHead><TableHead className="text-right">Dias com movimento</TableHead></TableRow></TableHeader>
              <TableBody>
                {lidos.map((l) => (
                  <TableRow key={l.arquivo}>
                    <TableCell>{l.arquivo}{l.avisos.length ? <span className="block text-xs text-amber-800">{l.avisos.join(" ")}</span> : null}</TableCell>
                    <TableCell className="tabular-nums">{formatarData(l.inicio)} a {formatarData(l.fim)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.pessoas.length}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.pessoas.reduce((s, p) => s + p.movimentos.length, 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {vazios.length > 0 && <p className="text-amber-800">Período sem arquivo (os créditos desses dias ficam de fora): {vazios.join("; ")}.</p>}
            {inicio && inicio > inicioConta && <p className="text-amber-800">Os arquivos começam depois do início da conta ({formatarData(inicioConta)}): falta o período até {formatarData(inicio)}.</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={limpar} disabled={pendente}>Outros arquivos</Button>
              <Button onClick={gravar} disabled={pendente}>{pendente ? "Gravando…" : `Gravar ${lidos.length} arquivo(s)`}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
