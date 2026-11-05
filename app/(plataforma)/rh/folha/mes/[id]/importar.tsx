"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rotuloMes } from "@/lib/modulos/rh/calendario";
import { aplicarRelacao, previaRelacao, type Previa } from "../importar";

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const SELECAO = "h-7 max-w-64 rounded-[3px] border border-input bg-white px-1 text-[12px]";

type Ligacoes = Record<string, string>;
type Arquivo = { arquivo: File; previa?: Previa; erro?: string; ligacoes: Ligacoes; gravado?: boolean };

/**
 * Importa a "Relação Geral dos Líquidos" (.xls do escritório). Aceita vários arquivos de uma vez (as empresas e o 13º): lê cada um,
 * mostra a prévia (o que muda, quem não casou, código com nome que não confere) e grava um por um.
 */
export function ImportarLiquidos({ mesId }: { mesId: string }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<Arquivo[]>([]);
  const [pendente, iniciar] = useTransition();

  const limpar = () => { setLista([]); if (entrada.current) entrada.current.value = ""; };
  const ler = (arquivos: File[]) => iniciar(async () => {
    const lidos: Arquivo[] = [];
    for (const f of arquivos) {
      const fd = new FormData(); fd.set("arquivo", f);
      const r = await previaRelacao(mesId, fd);
      lidos.push(r.ok ? { arquivo: f, previa: r.previa, ligacoes: {} } : { arquivo: f, erro: r.erro, ligacoes: {} });
    }
    // a mesma empresa e coluna duas vezes gravaria por cima: só o primeiro vale
    const vistos = new Map<string, string>();
    for (const a of lidos) {
      if (!a.previa) continue;
      const chave = `${a.previa.empregador}|${a.previa.coluna}`;
      const primeiro = vistos.get(chave);
      if (primeiro) { a.erro = `Arquivo repetido: ${a.previa.empregador} · ${a.previa.coluna} já vem em "${primeiro}".`; a.previa = undefined; }
      else vistos.set(chave, a.arquivo.name);
    }
    setLista(lidos);
  });
  const mudarLigacoes = (i: number, l: Ligacoes) => setLista((s) => s.map((a, k) => (k === i ? { ...a, ligacoes: l } : a)));

  const aGravar = lista.filter((a) => a.previa && !a.gravado);
  const gravar = () => iniciar(async () => {
    const atual = [...lista];
    for (let i = 0; i < atual.length; i++) {
      const a = atual[i];
      if (!a.previa || a.gravado) continue;
      const fd = new FormData(); fd.set("arquivo", a.arquivo); fd.set("ligacoes", JSON.stringify(a.ligacoes));
      const r = await aplicarRelacao(mesId, fd);
      if (!r.ok) {
        atual[i] = { ...a, erro: r.erro };
        setLista(atual);
        const feitos = atual.filter((x) => x.gravado).length;
        toast.error(`Parou em "${a.arquivo.name}": ${r.erro}${feitos ? ` (${feitos} arquivo(s) já gravado(s))` : ""}`);
        router.refresh();
        return;
      }
      atual[i] = { ...a, gravado: true };
      setLista([...atual]);
      toast.success(r.aviso);
    }
    setAberto(false); limpar();
    router.refresh();
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); if (!v) limpar(); }}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}><FileUp /> Importar do escritório</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar a Relação Geral dos Líquidos</DialogTitle>
          <DialogDescription>
            Os .xls do escritório: pode escolher vários de uma vez (as empresas e o 13º). Folha Mensal preenche o líquido, 13º o 13º e Férias as férias/acréscimos.
            Cada pessoa é casada pelo código do escritório e o nome tem de conferir; a soma de cada arquivo tem de bater com o Total da Empresa.
          </DialogDescription>
        </DialogHeader>
        <input ref={entrada} type="file" multiple accept=".xls,application/vnd.ms-excel" className="text-sm"
          onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) ler(fs); }} />
        {pendente && !lista.length && <p className="text-sm text-muted-foreground">Lendo os arquivos…</p>}
        {lista.map((a, i) => (
          <section key={`${a.arquivo.name}-${i}`} className="space-y-2 rounded-[3px] border border-grade p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              {a.gravado && <CheckCircle2 className="size-4 text-emerald-700" aria-label="Gravado" />}{a.arquivo.name}
            </p>
            {a.erro && <p role="alert" className="text-destructive">{a.erro}</p>}
            {a.previa && !a.gravado && <PreviaArquivo previa={a.previa} ligacoes={a.ligacoes} mudar={(l) => mudarLigacoes(i, l)} />}
          </section>
        ))}
        {lista.length > 0 && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={limpar} disabled={pendente}>Outros arquivos</Button>
            <Button onClick={gravar} disabled={pendente || !aGravar.length}>{pendente ? "Gravando…" : `Gravar ${aGravar.length} arquivo(s)`}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Prévia de um arquivo: resumo, valores que mudam, nome que não confere, sem cadastro, códigos repetidos e quem ficou fora. */
function PreviaArquivo({ previa, ligacoes, mudar }: { previa: Previa; ligacoes: Ligacoes; mudar: (l: Ligacoes) => void }) {
  const mudam = previa.casados.filter((c) => c.atualCentavos !== c.novoCentavos);
  const usados = new Set(Object.values(ligacoes));
  const ligar = (codigo: string, itemId: string) => { const n = { ...ligacoes }; if (itemId) n[codigo] = itemId; else delete n[codigo]; mudar(n); };
  const seletor = (codigo: string) => (
    <select aria-label={`Ligar o código ${codigo}`} value={ligacoes[codigo] ?? ""} className={SELECAO} onChange={(e) => ligar(codigo, e.target.value)}>
      <option value="">Deixar de fora</option>
      {previa.candidatos.filter((k) => !usados.has(k.item_id) || ligacoes[codigo] === k.item_id).map((k) => (
        <option key={k.item_id} value={k.item_id}>{k.nome}{k.matricula ? ` (cód. ${k.matricula})` : ""}</option>
      ))}
    </select>
  );
  const nLigados = Object.keys(ligacoes).length;
  return (
    <div className="space-y-3">
      <p>
        <strong>{previa.empregador}</strong> · {previa.calculo} → coluna <strong>{previa.coluna}</strong> · {rotuloMes(previa.competencia)} ·
        {" "}{previa.pessoas} pessoas · total {reais(previa.totalCentavos)} (soma conferida).
      </p>
      <p>{previa.casados.length} casadas pelo código e pelo nome{nLigados ? ` + ${nLigados} ligada(s) à mão` : ""}; <strong>{mudam.length}</strong> com valor diferente do que está na folha.</p>
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
      {previa.divergentes.length > 0 && (
        <div className="space-y-2 rounded-[3px] border border-destructive/50 p-3">
          <p className="font-medium text-destructive">
            {previa.divergentes.length} código(s) com nome que não confere: o código está na folha com outra pessoa. Não grava até você ligar à pessoa certa
            (e corrigir o código em Colaboradores, se for o caso):
          </p>
          <Table interativa={false}>
            <TableBody>
              {previa.divergentes.map((d) => (
                <TableRow key={d.codigo}>
                  <TableCell className="tabular-nums">{d.codigo}</TableCell>
                  <TableCell>{d.nome}<span className="block text-xs text-muted-foreground">na folha: {d.nomeFolha}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{reais(d.centavos)}</TableCell>
                  <TableCell>{seletor(d.codigo)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {previa.ambiguos.length > 0 && (
        <p role="alert" className="rounded-[3px] border border-destructive/50 p-3 text-destructive">
          Código do escritório repetido no cadastro (não grava em nenhuma das pessoas até corrigir em Colaboradores, ou ligue abaixo à pessoa certa):{" "}
          {previa.ambiguos.map((a) => `${a.codigo}: ${a.nomes.join(" e ")}`).join("; ")}.
        </p>
      )}
      {previa.semCadastro.length > 0 && (
        <div className="space-y-2 rounded-[3px] border border-amber-600/50 p-3">
          <p className="font-medium text-amber-800">{previa.semCadastro.length} pessoa(s) do arquivo sem código do escritório na folha. Ligue à pessoa certa (o código fica gravado no cadastro) ou deixe de fora:</p>
          <Table interativa={false}>
            <TableBody>
              {previa.semCadastro.map((p) => (
                <TableRow key={p.codigo}>
                  <TableCell className="tabular-nums">{p.codigo}</TableCell><TableCell>{p.nome}</TableCell><TableCell className="text-right tabular-nums">{reais(p.centavos)}</TableCell>
                  <TableCell>{seletor(p.codigo)}</TableCell>
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
    </div>
  );
}
