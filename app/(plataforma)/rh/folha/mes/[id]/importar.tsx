"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rotuloMes } from "@/lib/modulos/rh/calendario";
import { aplicarRelacao, previaRelacao, type Previa } from "../importar";

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const SELECAO = "h-7 max-w-64 rounded-[3px] border border-input bg-white px-1 text-[12px]";

/** Importa a "Relação Geral dos Líquidos" (.xls do escritório): lê, mostra a prévia (o que muda e quem não casou) e grava. */
export function ImportarLiquidos({ mesId }: { mesId: string }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [ligacoes, setLigacoes] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  const limpar = () => { setArquivo(null); setPrevia(null); setLigacoes({}); setErro(undefined); if (entrada.current) entrada.current.value = ""; };
  const ler = (f: File) => iniciar(async () => {
    setArquivo(f); setErro(undefined); setPrevia(null); setLigacoes({});
    const fd = new FormData(); fd.set("arquivo", f);
    const r = await previaRelacao(mesId, fd);
    if (!r.ok) setErro(r.erro); else setPrevia(r.previa);
  });
  const aplicar = () => iniciar(async () => {
    if (!arquivo) return;
    const fd = new FormData(); fd.set("arquivo", arquivo); fd.set("ligacoes", JSON.stringify(ligacoes));
    const r = await aplicarRelacao(mesId, fd);
    if (!r.ok) { setErro(r.erro); return; }
    toast.success(r.aviso);
    setAberto(false); limpar();
    router.refresh();
  });

  const mudam = previa?.casados.filter((c) => c.atualCentavos !== c.novoCentavos) ?? [];
  const usados = new Set(Object.values(ligacoes));
  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); if (!v) limpar(); }}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}><FileUp /> Importar do escritório</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar a Relação Geral dos Líquidos</DialogTitle>
          <DialogDescription>
            O .xls do escritório, um por empresa e por cálculo: Folha Mensal preenche o líquido, 13º o 13º e Férias as férias/acréscimos. Cada pessoa é casada pelo código do escritório; a soma tem de bater com o Total da Empresa.
          </DialogDescription>
        </DialogHeader>
        <input ref={entrada} type="file" accept=".xls,application/vnd.ms-excel" onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); }} className="text-sm" />
        {pendente && !previa && <p className="text-sm text-muted-foreground">Lendo o arquivo…</p>}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        {previa && (
          <div className="space-y-3 text-sm">
            <p>
              <strong>{previa.empregador}</strong> · {previa.calculo} → coluna <strong>{previa.coluna}</strong> · {rotuloMes(previa.competencia)} ·
              {" "}{previa.pessoas} pessoas · total {reais(previa.totalCentavos)} (soma conferida).
            </p>
            <p>{previa.casados.length} casadas pelo código do escritório; <strong>{mudam.length}</strong> com valor diferente do que está na folha.</p>
            {mudam.length > 0 && (
              <Table>
                <TableHeader><TableRow><TableHead>Funcionário</TableHead><TableHead>Cód. escritório</TableHead><TableHead className="text-right">Na folha hoje</TableHead><TableHead className="text-right">Do escritório</TableHead></TableRow></TableHeader>
                <TableBody>
                  {mudam.map((c) => (
                    <TableRow key={c.item_id}>
                      <TableCell>{c.nome}</TableCell><TableCell className="tabular-nums">{c.codigo}</TableCell>
                      <TableCell className="text-right tabular-nums">{reais(c.atualCentavos)}</TableCell><TableCell className="text-right font-medium tabular-nums">{reais(c.novoCentavos)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {previa.semCadastro.length > 0 && (
              <div className="space-y-2 rounded-[3px] border border-amber-600/50 p-3">
                <p className="font-medium text-amber-800">{previa.semCadastro.length} pessoa(s) do arquivo sem código do escritório na folha. Ligue à pessoa certa (o código fica gravado no cadastro) ou deixe de fora:</p>
                <Table interativa={false}>
                  <TableBody>
                    {previa.semCadastro.map((p) => (
                      <TableRow key={p.codigo}>
                        <TableCell className="tabular-nums">{p.codigo}</TableCell><TableCell>{p.nome}</TableCell><TableCell className="text-right tabular-nums">{reais(p.centavos)}</TableCell>
                        <TableCell>
                          <select aria-label={`Ligar o código ${p.codigo}`} value={ligacoes[p.codigo] ?? ""} className={SELECAO}
                            onChange={(e) => setLigacoes((l) => { const n = { ...l }; if (e.target.value) n[p.codigo] = e.target.value; else delete n[p.codigo]; return n; })}>
                            <option value="">Deixar de fora</option>
                            {previa.candidatos.filter((k) => !usados.has(k.item_id) || ligacoes[p.codigo] === k.item_id).map((k) => (
                              <option key={k.item_id} value={k.item_id}>{k.nome}{k.matricula ? ` (cód. ${k.matricula})` : ""}</option>
                            ))}
                          </select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {previa.foraDoRelatorio.length > 0 && (
              <p className="text-amber-800">
                Na folha com {previa.coluna.toLowerCase()} e fora deste arquivo (ficam como estão): {previa.foraDoRelatorio.map((f) => `${f.nome} (${reais(f.atualCentavos)})`).join(", ")}.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={limpar} disabled={pendente}>Outro arquivo</Button>
              <Button onClick={aplicar} disabled={pendente}>{pendente ? "Gravando…" : `Gravar ${previa.casados.length + Object.keys(ligacoes).length} valor(es)`}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
