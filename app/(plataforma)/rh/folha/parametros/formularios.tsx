"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { lerReais } from "@/lib/modulos/rh/folha/modulo";
import { ROTULO_FORMA_RUBRICA, type Rubrica } from "@/lib/modulos/rh/folha/recibos";
import { salvarParametro, salvarRubrica } from "../recibos-acoes";
import { SELECAO } from "../componentes-recibo";

/** Novo valor de parâmetro a partir de um mês (ex.: assiduidade da nova CCT). */
export function NovoParametro() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [chave, setChave] = useState("assiduidade_mensal");
  const [desde, setDesde] = useState("");
  const [valor, setValor] = useState("");
  const [pendente, iniciar] = useTransition();
  const salvar = () => iniciar(async () => {
    const r = await salvarParametro({ chave, desde, valor: lerReais(valor) });
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso); setAberto(false); router.refresh();
  });
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button size="sm" />}><Plus /> Novo valor</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Novo valor de parâmetro</DialogTitle><DialogDescription>Vale para os recibos a partir do mês informado; os meses anteriores continuam com o valor antigo.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1"><Label>Parâmetro</Label>
            <select value={chave} onChange={(e) => setChave(e.target.value)} className={SELECAO}><option value="assiduidade_mensal">Assiduidade mensal (CCT)</option><option value="salario_minimo">Salário mínimo (base da insalubridade)</option></select>
          </div>
          <div className="grid gap-1"><Label>A partir de</Label><Input type="month" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-8" /></div>
          <div className="grid gap-1"><Label>Valor (R$)</Label><Input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className="h-8" /></div>
        </div>
        <div className="flex justify-end"><Button onClick={salvar} disabled={pendente || !desde || !(lerReais(valor) > 0)}>Salvar</Button></div>
      </DialogContent>
    </Dialog>
  );
}

const FORMAS_EDITAVEIS = ["dias", "horas", "fracao_salario", "valor"] as const;

/** Inclui ou edita uma rubrica simples (as de assiduidade, insalubridade e noturno são fixas: dependem dos parâmetros). */
export function EditorRubrica({ rubrica }: { rubrica?: Rubrica & { ordem: number; ativo: boolean } }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [codigo, setCodigo] = useState(rubrica?.codigo ?? "");
  const [descricao, setDescricao] = useState(rubrica?.descricao ?? "");
  const [natureza, setNatureza] = useState<"provento" | "desconto">(rubrica?.natureza ?? "provento");
  const [forma, setForma] = useState<(typeof FORMAS_EDITAVEIS)[number]>((FORMAS_EDITAVEIS as readonly string[]).includes(rubrica?.forma ?? "") ? (rubrica!.forma as (typeof FORMAS_EDITAVEIS)[number]) : "valor");
  const [ordem, setOrdem] = useState(String(rubrica?.ordem ?? 40));
  const [ativo, setAtivo] = useState(rubrica?.ativo ?? true);
  const [pendente, iniciar] = useTransition();
  const salvar = () => iniciar(async () => {
    const r = await salvarRubrica({ codigo, descricao, natureza, forma, ordem: Number(ordem), ativo });
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso); setAberto(false); router.refresh();
  });
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button variant={rubrica ? "ghost" : "outline"} size="sm" />}>{rubrica ? <><Pencil /> Editar</> : <><Plus /> Nova rubrica</>}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{rubrica ? "Editar rubrica" : "Nova rubrica"}</DialogTitle><DialogDescription>A descrição é a que sai impressa no recibo.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1"><Label>Código</Label><Input value={codigo} readOnly={!!rubrica} onChange={(e) => setCodigo(e.target.value.toLowerCase())} placeholder="ex.: ajuda_custo" className="h-8" /></div>
          <div className="grid gap-1"><Label>Descrição no recibo</Label><Input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={60} className="h-8" /></div>
          <div className="grid gap-1"><Label>Tipo</Label><select value={natureza} onChange={(e) => setNatureza(e.target.value as "provento" | "desconto")} className={SELECAO}><option value="provento">Provento</option><option value="desconto">Desconto</option></select></div>
          <div className="grid gap-1"><Label>Cálculo</Label><select value={forma} onChange={(e) => setForma(e.target.value as (typeof FORMAS_EDITAVEIS)[number])} className={SELECAO}>{FORMAS_EDITAVEIS.map((f) => <option key={f} value={f}>{ROTULO_FORMA_RUBRICA[f]}</option>)}</select></div>
          <div className="grid w-28 gap-1"><Label>Ordem</Label><Input value={ordem} onChange={(e) => setOrdem(e.target.value)} inputMode="numeric" className="h-8" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="size-4" /> Ativa</label>
        </div>
        <div className="flex justify-end"><Button onClick={salvar} disabled={pendente}>Salvar</Button></div>
      </DialogContent>
    </Dialog>
  );
}
