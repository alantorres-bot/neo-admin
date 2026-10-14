"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CAMPOS_LANCAMENTO, ROTULO_CAMPO_LANCAMENTO, type CodigosLancamento } from "@/lib/modulos/rh/vale-transporte/lancamento";
import { buscarModelo, salvarParametros, type Modelo } from "./acoes";

/** Códigos do título do VT no Consistem, preenchidos à mão ou copiados de um VT já lançado (modelo), e a chave liga/desliga. */
export function FormParametros({ inicial, ligado, empresas, editavel }: { inicial: Record<string, unknown> | null; ligado: boolean; empresas: { id: string; nome: string }[]; editavel: boolean }) {
  const router = useRouter();
  const [codigos, setCodigos] = useState<Record<string, string>>(Object.fromEntries(CAMPOS_LANCAMENTO.map((k) => [k, inicial?.[k] != null ? String(inicial[k]) : ""])));
  const [liga, setLiga] = useState(ligado);
  const [empresaId, setEmpresaId] = useState(empresas[0]?.id ?? "");
  const [codLancamento, setCodLancamento] = useState("");
  const [codFornecedor, setCodFornecedor] = useState("660");
  const [modelo, setModelo] = useState<Modelo>();
  const [pendente, iniciar] = useTransition();

  const buscar = (porLancamento: boolean) => iniciar(async () => {
    const r = await buscarModelo({ empresaId, ...(porLancamento ? { codLancamento } : { codFornecedor }) });
    if (!r.ok) { toast.error(r.erro); return; }
    setModelo(r.modelo);
    const achados = r.modelo.codigos as Partial<CodigosLancamento>;
    setCodigos((c) => ({ ...c, ...Object.fromEntries(Object.entries(achados).map(([k, v]) => [k, String(v)])) }));
    const faltam = CAMPOS_LANCAMENTO.filter((k) => achados[k] === undefined);
    toast.success(faltam.length ? `Códigos copiados; faltou: ${faltam.map((k) => ROTULO_CAMPO_LANCAMENTO[k]).join(", ")}.` : "Códigos copiados do modelo. Confira e salve.");
  });
  const salvar = () => iniciar(async () => {
    const r = await salvarParametros({ codigos, ligado: liga });
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success("Parâmetros salvos.");
    router.refresh();
  });

  return (
    <div className="space-y-5">
      {editavel && (
        <fieldset className="space-y-3 rounded-[3px] border border-grade p-3">
          <legend className="px-1 text-sm font-medium">Copiar de um VT já lançado no Consistem (só leitura)</legend>
          <div className="flex flex-wrap items-end gap-3">
            {empresas.length > 1 && (
              <div className="grid gap-1">
                <Label htmlFor="empresa" className="text-xs">Empresa</Label>
                <select id="empresa" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]">
                  {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
            )}
            <div className="grid gap-1">
              <Label htmlFor="codFornecedor" className="text-xs">Último título do fornecedor (Nº)</Label>
              <div className="flex gap-2">
                <Input id="codFornecedor" value={codFornecedor} onChange={(e) => setCodFornecedor(e.target.value)} inputMode="numeric" className="h-8 w-24" />
                <Button variant="outline" size="sm" disabled={pendente || !codFornecedor} onClick={() => buscar(false)}><Search /> Buscar</Button>
              </div>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="codLancamento" className="text-xs">ou o código do lançamento</Label>
              <div className="flex gap-2">
                <Input id="codLancamento" value={codLancamento} onChange={(e) => setCodLancamento(e.target.value)} inputMode="numeric" className="h-8 w-28" />
                <Button variant="outline" size="sm" disabled={pendente || !codLancamento} onClick={() => buscar(true)}><Search /> Buscar</Button>
              </div>
            </div>
          </div>
          {pendente && <p className="text-xs text-muted-foreground">Consultando o Consistem… a busca por fornecedor lê os títulos dos últimos 120 dias e pode levar até um minuto.</p>}
          {modelo && (
            <div className="space-y-1 text-sm">
              <p>Modelo: {modelo.resumo}</p>
              {modelo.outros.length > 1 && (
                <p className="text-xs text-muted-foreground">Outros títulos do fornecedor: {modelo.outros.slice(1).map((o) => `${o.codLancamento} (${o.emissao ?? "?"}, ${o.complemento})`).join("; ")}</p>
              )}
            </div>
          )}
        </fieldset>
      )}
      <fieldset disabled={!editavel} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CAMPOS_LANCAMENTO.map((k) => (
            <div key={k} className="grid gap-1">
              <Label htmlFor={k} className="text-xs">{ROTULO_CAMPO_LANCAMENTO[k]}</Label>
              <Input id={k} value={codigos[k]} onChange={(e) => setCodigos((c) => ({ ...c, [k]: e.target.value }))} inputMode="numeric" className="h-8" autoComplete="off" />
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={liga} onChange={(e) => setLiga(e.target.checked)} className="size-4" />
          Lançar no Consistem ligado (mostra o botão “Lançar no Consistem” no mês aprovado)
        </label>
        {editavel && <Button onClick={salvar} disabled={pendente}>Salvar parâmetros</Button>}
      </fieldset>
    </div>
  );
}
