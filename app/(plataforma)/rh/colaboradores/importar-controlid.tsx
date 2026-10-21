"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerCsv } from "@/lib/integracoes/importador/ler-arquivo";
import { lerCadastroControlId, type FuncionarioControlId } from "@/lib/modulos/rh/colaboradores/controlid";
import { gravarControlId, previaControlId, type PreviaControlId } from "./acoes";

const ROTULO_CAMPO: Record<string, string> = { id_rhid: "nº RHiD", cpf: "CPF", departamento: "departamento", funcao: "cargo", data_admissao: "admissão" };

/**
 * Importa o cadastro de funcionários do Control iD / RHiD (person_….csv). O arquivo é lido aqui no navegador e só nº RHiD, CPF,
 * nome, empresa, departamento, cargo e admissão vão ao servidor (senha, PIN, endereço etc. ficam de fora).
 */
export function ImportarControlId() {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<FuncionarioControlId[]>([]);
  const [ignorados, setIgnorados] = useState<string[]>([]);
  const [previa, setPrevia] = useState<PreviaControlId | null>(null);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  const limpar = () => { setItens([]); setPrevia(null); setErro(undefined); setIgnorados([]); if (entrada.current) entrada.current.value = ""; };
  const ler = (f: File) => iniciar(async () => {
    limpar();
    const [p] = lerCsv(await f.arrayBuffer(), { delimitador: ";" });
    const r = lerCadastroControlId(p.matriz);
    if (r.erro) { setErro(r.erro); return; }
    setItens(r.itens); setIgnorados(r.ignorados);
    const x = await previaControlId(r.itens);
    if (!x.ok) setErro(x.erro); else setPrevia(x.previa);
  });
  const gravar = () => iniciar(async () => {
    const r = await gravarControlId(itens);
    if (!r.ok) { setErro(r.erro); return; }
    toast.success(r.aviso, { duration: 10000 });
    setAberto(false); limpar();
    router.refresh();
  });

  const cs = previa?.casamentos ?? [];
  const casados = cs.filter((c) => c.colaborador);
  const completar = casados.filter((c) => Object.keys(c.completa).length);
  const parecidos = cs.filter((c) => c.como === "parecido");
  const novos = cs.filter((c) => c.como === "novo");
  const diferencas = cs.filter((c) => c.diferencas.length);

  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); if (!v) limpar(); }}>
      <DialogTrigger render={<Button variant="outline" />}><FileUp /> Importar do Control iD</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar o cadastro de funcionários do Control iD (RHiD)</DialogTitle>
          <DialogDescription>
            O arquivo person_….csv exportado do Control iD. Só completa o que está vazio (nº RHiD, CPF, departamento, cargo, admissão); nº de fornecedor e matrícula
            da folha nunca mudam. Quem não estiver no cadastro é incluído para completar. Senha, PIN, endereço e demais dados do arquivo não são enviados.
          </DialogDescription>
        </DialogHeader>
        <input ref={entrada} type="file" accept=".csv,text/csv" aria-label="Cadastro de funcionários do Control iD" onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); }} className="text-sm" />
        {pendente && !previa && <p className="text-sm text-muted-foreground">Lendo o arquivo…</p>}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        {previa && (
          <div className="space-y-3 text-sm">
            <p>
              {cs.length} funcionário(s) ativo(s) no Control iD: <strong>{casados.length}</strong> encontrados no cadastro ({completar.length} serão completados)
              e <strong>{novos.length}</strong> novo(s).{ignorados.length ? ` Ignorados: ${ignorados.join(", ")}.` : ""}
            </p>
            {completar.length > 0 && (
              <p className="text-muted-foreground">
                Completa: {Object.entries(completar.reduce<Record<string, number>>((t, c) => { for (const k of Object.keys(c.completa)) t[k] = (t[k] ?? 0) + 1; return t; }, {}))
                  .map(([k, n]) => `${n} ${ROTULO_CAMPO[k]}`).join(", ")}.
              </p>
            )}
            {parecidos.length > 0 && (
              <div className="rounded-[3px] border border-amber-600/50 p-3">
                <p className="font-medium text-amber-800">Ligados por nome parecido (confira se é a mesma pessoa):</p>
                <ul className="list-disc pl-5">{parecidos.map((c) => <li key={c.item.rhid}>{c.item.nome} → {c.colaborador!.nome}{c.colaborador!.cod_fornecedor ? ` (fornecedor ${c.colaborador!.cod_fornecedor})` : ""}</li>)}</ul>
              </div>
            )}
            {novos.length > 0 && (
              <div className="rounded-[3px] border border-sky-700/40 p-3">
                <p className="font-medium">Serão incluídos (sem nº de fornecedor e sem VT; ficam fora da folha até completar):</p>
                <ul className="list-disc pl-5">{novos.map((c) => <li key={c.item.rhid}>{c.item.nome} · {c.item.empregador}{c.item.departamento ? ` · ${c.item.departamento}` : ""}</li>)}</ul>
              </div>
            )}
            {diferencas.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">Diferenças entre o cadastro e o Control iD (não são alteradas; corrija onde estiver errado):</p>
                <Table>
                  <TableHeader><TableRow><TableHead>Funcionário</TableHead><TableHead>Diferença</TableHead></TableRow></TableHeader>
                  <TableBody>{diferencas.map((c) => <TableRow key={c.item.rhid}><TableCell>{c.colaborador!.nome}</TableCell><TableCell className="text-xs">{c.diferencas.join("; ")}</TableCell></TableRow>)}</TableBody>
                </Table>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={limpar} disabled={pendente}>Outro arquivo</Button>
              <Button onClick={gravar} disabled={pendente || (completar.length === 0 && novos.length === 0)}>{pendente ? "Gravando…" : "Gravar"}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
