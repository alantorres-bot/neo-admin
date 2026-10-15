"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { lerReais } from "@/lib/modulos/rh/folha/modulo";
import { parametrosVigentes, type Rubrica, type Vigencia } from "@/lib/modulos/rh/folha/recibos";
import { salvarModelo } from "../recibos-acoes";
import { EditorLinhas, linhaVazia, paraEntrada, PreviaRecibo, SELECAO, type LinhaEditavel } from "../componentes-recibo";
import type { Modelo, PessoaRecibo } from "../dados";

const paraTexto = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR", { maximumFractionDigits: 4 }));

/** Cria ou edita o modelo do recibo recorrente de uma pessoa (gerado ao abrir a folha do mês). */
export function EditorModelo({ modelo, pessoas, rubricas, vigencias, competencia }: { modelo?: Modelo; pessoas: PessoaRecibo[]; rubricas: Rubrica[]; vigencias: Vigencia[]; competencia: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const [pessoaId, setPessoaId] = useState(modelo?.colaborador_id ?? "");
  const [ativo, setAtivo] = useState(modelo?.ativo ?? true);
  const [linhas, setLinhas] = useState<LinhaEditavel[]>(modelo?.linhas.map((l) => ({
    rubrica: l.rubrica, referencia: paraTexto(Number(l.referencia)), valor: l.valor ? Number(l.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "", descricao: "",
  })) ?? [linhaVazia()]);
  const [erro, setErro] = useState<string>();
  const catalogo = useMemo(() => new Map(rubricas.map((r) => [r.codigo, r])), [rubricas]);
  const pessoa = pessoas.find((p) => p.id === pessoaId);
  const entrada = paraEntrada(linhas.filter((l) => l.rubrica), catalogo);

  const salvar = () => iniciar(async () => {
    if (!pessoaId) { setErro("Escolha a pessoa."); return; }
    if (!entrada.ok) { setErro(entrada.erro); return; }
    const r = await salvarModelo({
      colaboradorId: pessoaId, ativo,
      linhas: linhas.filter((l) => l.rubrica).map((l, i) => ({ rubrica: l.rubrica, referencia: entrada.linhas[i].referencia, valor: catalogo.get(l.rubrica)?.forma === "valor" ? (lerReais(l.valor) || null) : null })),
    });
    if (!r.ok) { setErro(r.erro); return; }
    toast.success(r.aviso); setAberto(false); router.refresh();
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); setErro(undefined); }}>
      <DialogTrigger render={<Button variant={modelo ? "ghost" : "default"} size="sm" />}>{modelo ? <><Pencil /> Editar</> : <><Plus /> Novo modelo</>}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{modelo ? "Editar recibo recorrente" : "Novo recibo recorrente"}</DialogTitle>
          <DialogDescription>As linhas que o recibo da pessoa terá todo mês. Rubricas de valor digitado (ex.: reembolso IRRF) podem ficar sem valor: o RH completa no mês.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1"><Label>Funcionário</Label>
          <select value={pessoaId} disabled={!!modelo} onChange={(e) => setPessoaId(e.target.value)} className={SELECAO}>
            <option value="">Escolha…</option>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.cod_fornecedor})</option>)}
          </select>
        </div>
        {pessoa && !pessoa.salario && <p className="text-sm text-amber-700">Esta pessoa ainda não tem salário no cadastro: grave um recibo dela uma vez (ou edite o cadastro) para o recorrente poder ser gerado.</p>}
        <EditorLinhas linhas={linhas} mudar={setLinhas} rubricas={rubricas} comDescricao={false} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="size-4" /> Ativo (gera todo mês)</label>
        {pessoa?.salario && entrada.ok && entrada.linhas.length > 0 && (
          <PreviaRecibo titulo="Como fica neste mês" linhas={entrada.linhas} pessoa={{ salario: pessoa.salario, insalubridade_pct: pessoa.insalubridade_pct, adicional_noturno_pct: pessoa.adicional_noturno_pct }} parametros={parametrosVigentes(vigencias, competencia)} />
        )}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex justify-end"><Button onClick={salvar} disabled={pendente}>{pendente ? "Salvando…" : "Salvar modelo"}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
