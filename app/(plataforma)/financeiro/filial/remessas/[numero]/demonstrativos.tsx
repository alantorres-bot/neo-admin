"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { lerNomeArquivo } from "@/lib/modulos/financeiro/filial/arquivos";
import { anexarDocumentoKit } from "../../acoes";

const SELECAO = "h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]";
type Item = { indice: number; arquivo: File; kitId: string };

/**
 * Demonstrativos da remessa em lote (Fase F): cada fatura pode ter um ou mais. O arquivo vai para a NF pelo nome
 * ("DEMONSTRATIVO 2351.pdf", "NF 02351 - …"); o que não for reconhecido, a pessoa escolhe. Fecha sozinho a pendência
 * "Subir demonstrativos da remessa" quando todas as NFs tiverem pelo menos um.
 */
export function AnexarDemonstrativos({ kits }: { kits: { id: string; nota: string; cliente: string; temDemonstrativo: boolean }[] }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const proximo = useRef(0);
  const [itens, setItens] = useState<Item[]>([]);
  const [pendente, iniciar] = useTransition();
  const kitDaNota = new Map(kits.map((k) => [k.nota, k.id]));
  const faltam = kits.filter((k) => !k.temDemonstrativo).length;

  function escolher(lista: FileList | null) {
    const novos = [...(lista ?? [])].map((arquivo) => {
      const nota = lerNomeArquivo(arquivo.name).nota;
      return { indice: proximo.current++, arquivo, kitId: (nota && kitDaNota.get(nota)) || (kits.length === 1 ? kits[0].id : "") };
    });
    setItens((a) => [...a, ...novos]);
    if (entrada.current) entrada.current.value = "";
  }

  function anexar() {
    if (itens.some((i) => !i.kitId)) return toast.error("Escolha a NF de cada arquivo.");
    iniciar(async () => {
      let ok = 0;
      for (const i of itens) {
        const fd = new FormData();
        fd.set("kitId", i.kitId);
        fd.set("tipo", "demonstrativo");
        fd.set("arquivo", i.arquivo);
        const r = await anexarDocumentoKit(fd);
        if (r.ok) ok += 1;
        else toast.error(`${i.arquivo.name}: ${r.erro}`);
      }
      if (ok) toast.success(`${ok} ${ok === 1 ? "demonstrativo anexado" : "demonstrativos anexados"}.`);
      setItens([]);
      router.refresh();
    });
  }

  return (
    <section className="space-y-2 rounded-[3px] border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Demonstrativos de faturamento</h3>
          <p className="text-[13px] text-muted-foreground">
            {faltam > 0 ? `${faltam} ${faltam === 1 ? "NF ainda sem demonstrativo" : "NFs ainda sem demonstrativo"}.` : "Todas as NFs têm demonstrativo."} Cada NF pode ter mais de um.
          </p>
        </div>
        <input ref={entrada} type="file" multiple accept="application/pdf,image/*" aria-label="Demonstrativos" onChange={(e) => escolher(e.target.files)}
          className="text-[13px] file:mr-2 file:rounded-[3px] file:border file:border-input file:bg-white file:px-2 file:py-1" />
      </div>
      {itens.length > 0 && (
        <div className="space-y-1">
          {itens.map((i) => (
            <div key={i.indice} className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="max-w-72 truncate" title={i.arquivo.name}>{i.arquivo.name}</span>
              <select className={SELECAO} value={i.kitId} aria-label={`NF de ${i.arquivo.name}`}
                onChange={(e) => setItens((a) => a.map((x) => (x.indice === i.indice ? { ...x, kitId: e.target.value } : x)))}>
                <option value="">NF…</option>
                {kits.map((k) => <option key={k.id} value={k.id}>NF {Number(k.nota)} — {k.cliente}</option>)}
              </select>
              <Button size="sm" variant="ghost" onClick={() => setItens((a) => a.filter((x) => x.indice !== i.indice))}>Tirar</Button>
            </div>
          ))}
          <Button size="sm" onClick={anexar} disabled={pendente}>{pendente ? "Anexando…" : `Anexar ${itens.length} ${itens.length === 1 ? "demonstrativo" : "demonstrativos"}`}</Button>
        </div>
      )}
    </section>
  );
}
