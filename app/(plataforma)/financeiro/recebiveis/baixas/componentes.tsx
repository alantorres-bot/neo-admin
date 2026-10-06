"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { baixarComEvidencia, baixarManual } from "./acoes";

export type LinhaEvidencia = { id: string; rotulo: string; detalhe: string; /** motivo para conferir antes de marcar; sem aviso = vem marcado */ aviso: string | null };

/** Lista dos títulos com evidência do Consistem: marque e confirme. Nada é baixado sem este clique. */
export function BaixaComEvidencia({ linhas, podeOperar }: { linhas: LinhaEvidencia[]; podeOperar: boolean }) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(linhas.filter((l) => !l.aviso).map((l) => l.id)));
  const [pendente, iniciar] = useTransition();

  function alternar(id: string) {
    setMarcadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function confirmar() {
    iniciar(async () => {
      const r = await baixarComEvidencia([...marcadas]);
      if (r.ok) {
        toast.success(r.aviso);
        setMarcadas(new Set());
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  const todas = marcadas.size === linhas.length;
  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border">
        {linhas.map((l) => (
          <li key={l.id}>
            <label className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <input type="checkbox" className="size-4" checked={marcadas.has(l.id)} disabled={!podeOperar} onChange={() => alternar(l.id)} />
              <span className="min-w-60 font-medium">{l.rotulo}</span>
              <span className="text-muted-foreground">{l.detalhe}</span>
              {l.aviso && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">{l.aviso}</span>}
            </label>
          </li>
        ))}
      </ul>
      {podeOperar && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pendente || marcadas.size === 0} onClick={confirmar}>
            {pendente ? "Dando baixa…" : `Dar baixa nos marcados (${marcadas.size})`}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={pendente} onClick={() => setMarcadas(todas ? new Set() : new Set(linhas.map((l) => l.id)))}>
            {todas ? "Desmarcar todos" : "Marcar todos"}
          </Button>
          <span className="text-xs text-muted-foreground">Tudo ou nada: se um título não puder ser baixado, nenhum é.</span>
        </div>
      )}
    </div>
  );
}

export type LinhaManual = { id: string; rotulo: string; detalhe: string; valorTitulo: number; emissao: string | null };

/** Um título sem evidência: a pessoa confere no Consistem e informa pago (data e valor) ou cancelado (motivo). */
export function BaixaManual({ linha, hoje, rotuloBotao = "Resolver" }: { linha: LinhaManual; hoje: string; rotuloBotao?: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [resultado, setResultado] = useState<"pago" | "cancelado">("pago");
  const [data, setData] = useState("");
  const [valor, setValor] = useState(String(linha.valorTitulo).replace(".", ","));
  const [observacao, setObservacao] = useState("");
  const [pendente, iniciar] = useTransition();

  function salvar() {
    const numero = Number(valor.replace(/\./g, "").replace(",", "."));
    iniciar(async () => {
      const r = await baixarManual({
        id: linha.id, resultado, data: resultado === "pago" ? data || null : null, valor: resultado === "pago" && Number.isFinite(numero) ? numero : null, observacao,
      });
      if (r.ok) {
        toast.success(r.aviso);
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-60 font-medium">{linha.rotulo}</span>
        <span className="text-muted-foreground">{linha.detalhe}</span>
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setAberto(!aberto)}>
          {aberto ? "Fechar" : rotuloBotao}
        </Button>
      </div>
      {aberto && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
          <label className="grid gap-1 text-xs">
            Resultado
            <select value={resultado} onChange={(e) => setResultado(e.target.value as "pago" | "cancelado")} className="h-8 rounded-lg border bg-background px-2 text-sm">
              <option value="pago">Pago</option>
              <option value="cancelado">Cancelado (sem pagamento)</option>
            </select>
          </label>
          {resultado === "pago" && (
            <>
              <label className="grid gap-1 text-xs">
                Data do pagamento
                <Input type="date" value={data} min={linha.emissao ?? undefined} max={hoje} onChange={(e) => setData(e.target.value)} className="h-8 w-40" />
              </label>
              <label className="grid gap-1 text-xs">
                Valor pago (R$)
                <Input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className="h-8 w-36" />
              </label>
            </>
          )}
          <label className="grid flex-1 gap-1 text-xs">
            {resultado === "cancelado" ? "Motivo do cancelamento (obrigatório)" : "Observação (obrigatória se o valor difere do título)"}
            <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} className="h-8 min-w-60" />
          </label>
          <Button type="button" disabled={pendente} onClick={salvar}>
            {pendente ? "Salvando…" : resultado === "pago" ? "Dar baixa" : "Cancelar o título"}
          </Button>
        </div>
      )}
    </li>
  );
}
