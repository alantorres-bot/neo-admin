"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CampoFicha, FichaImplantacao } from "@/lib/modulos/financeiro/filial/implantacao";
import { conferirClientesErp } from "../../acoes";

export type BlocoImplantacao = {
  kitId: string;
  nota: string;
  cliente: string;
  semBoletoFactoring: boolean;
  /** Títulos já no Consistem (implantada quando houver algum). */
  titulos: string[];
  divergencias: string[];
  ficha: FichaImplantacao;
};

function BotaoCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button type="button" className="no-print ml-1 inline-flex items-center rounded-[3px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={`Copiar ${texto}`} title={`Copiar ${texto}`}
      onClick={async () => {
        await navigator.clipboard.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1200);
      }}>
      {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Campo({ c }: { c: CampoFicha }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-2 py-0.5 text-[13px]">
      <span className="text-muted-foreground">{c.rotulo}</span>
      <span className={c.fixo ? "" : "font-semibold tabular-nums"}>
        {c.valor}
        {c.copiar && <BotaoCopiar texto={c.copiar} />}
        {c.detalhe && <span className="ml-2 font-normal text-muted-foreground">{c.detalhe}</span>}
      </span>
    </div>
  );
}

/**
 * Relatório de implantação da remessa: um bloco por NF na ordem da CCFT040, com o que se digita em cada aba, botão de copiar
 * nos campos variáveis e o estado (implantada quando o título chega do Consistem). Imprime só os blocos (CSS de impressão).
 */
export function RelatorioImplantacao({ blocos, rotina, podeOperar }: { blocos: BlocoImplantacao[]; rotina: string; podeOperar: boolean }) {
  const router = useRouter();
  const [soFaltam, setSoFaltam] = useState(true);
  const [pendente, iniciar] = useTransition();
  const visiveis = blocos.filter((b) => !soFaltam || b.titulos.length === 0);
  const semCodigo = blocos.filter((b) => b.titulos.length === 0 && b.ficha.alertas.some((a) => /Cliente|CNPJ/.test(a))).map((b) => b.kitId);

  function conferir() {
    iniciar(async () => {
      const r = await conferirClientesErp(semCodigo);
      if (!r.ok) return void toast.error(r.erro);
      toast.success(`${r.encontrados} ${r.encontrados === 1 ? "cliente encontrado" : "clientes encontrados"} no Consistem${r.naoCadastrados ? `; ${r.naoCadastrados} não cadastrado(s)` : ""}.`);
      router.refresh();
    });
  }

  return (
    <section id="relatorio-implantacao" className="space-y-3">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #relatorio-implantacao, #relatorio-implantacao * { visibility: visible; }
          #relatorio-implantacao { position: absolute; left: 0; top: 0; width: 100%; }
          #relatorio-implantacao .no-print { display: none !important; }
          #relatorio-implantacao article { break-inside: avoid; border-color: #999; }
        }
      `}</style>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Implantar no Consistem</h2>
          <p className="text-[13px] text-muted-foreground">{rotina} · um bloco por NF, na ordem da rotina. A NF fica &quot;implantada&quot; sozinha quando o título chega.</p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[13px]">
            <input type="checkbox" className="size-4" checked={soFaltam} onChange={(e) => setSoFaltam(e.target.checked)} /> só as que faltam implantar
          </label>
          {podeOperar && semCodigo.length > 0 && (
            <Button size="sm" variant="outline" onClick={conferir} disabled={pendente}>{pendente ? "Conferindo…" : "Conferir clientes no Consistem"}</Button>
          )}
          <Button size="sm" variant="outline" onClick={() => window.print()}>Imprimir / PDF</Button>
        </div>
      </div>

      {visiveis.length === 0 && <p className="text-[13px] text-muted-foreground">Todas as NFs desta remessa já estão implantadas.</p>}
      {visiveis.map((b) => (
        <article key={b.kitId} className="rounded-[3px] border p-3">
          <header className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">NF {Number(b.nota)} — {b.cliente}</h3>
            {b.semBoletoFactoring && <Badge variant="outline">Sem boleto de factoring</Badge>}
            {b.titulos.length > 0
              ? <Badge variant="secondary">implantada ✓ ({b.titulos.join(", ")})</Badge>
              : <Badge variant="outline">a implantar</Badge>}
          </header>
          {b.ficha.alertas.map((a) => <p key={a} role="alert" className="mb-1 text-[13px] font-medium text-destructive">{a}</p>)}
          {b.divergencias.map((d) => <p key={d} className="mb-1 text-[13px] text-destructive">{d}</p>)}
          <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
            {b.ficha.secoes.map((s) => (
              <div key={s.titulo}>
                <h4 className="mb-0.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{s.titulo}</h4>
                {s.campos.map((c) => <Campo key={c.rotulo + c.valor} c={c} />)}
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
