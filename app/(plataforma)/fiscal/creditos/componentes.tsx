// Peças visuais do Fiscal Control (servem a componentes de servidor e de cliente: sem estado).
import Link from "next/link";
import { cn } from "@/lib/utils";

type Tom = "neutro" | "bom" | "atencao" | "grave" | "info";
const TOM: Record<Tom, string> = {
  neutro: "border-grade bg-cabecalho text-texto dark:text-foreground",
  bom: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100",
  atencao: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100",
  grave: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100",
  info: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100",
};
const ICONE: Record<Tom, string> = { neutro: "", bom: "✓ ", atencao: "! ", grave: "✕ ", info: "i " };

/** Selo de situação: cor + ícone + texto (nunca só cor). */
export function Selo({ tom = "neutro", children, className }: { tom?: Tom; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-[3px] border px-1.5 py-0.5 text-[11px] font-medium", TOM[tom], className)}>
      <span aria-hidden>{ICONE[tom]}</span>{children}
    </span>
  );
}

export const tomValidacao = (v: string): Tom => (v === "validado" ? "bom" : v === "rejeitado" || v === "contestado" ? "grave" : v === "em_analise" ? "info" : "atencao");
export const tomDisponibilidade = (v: string): Tom => (v === "disponivel" ? "bom" : v === "esgotado" || v === "arquivado" ? "neutro" : v === "pendente_validacao" ? "atencao" : "grave");
export const tomObrigacao = (s: string, atrasada: boolean): Tom =>
  s === "entregue_conferida" ? "bom" : s === "transmitida" ? "info" : s === "dispensada" || s === "retificada" ? "neutro" : atrasada ? "grave" : "atencao";
export const tomSeveridade = (s: string): Tom => (s === "critica" || s === "alta" ? "grave" : s === "media" ? "atencao" : "info");

export function Indicador({ rotulo, valor, detalhe, tom = "neutro", href }: { rotulo: string; valor: React.ReactNode; detalhe?: React.ReactNode; tom?: Tom; href?: string }) {
  const corpo = (
    <div className={cn("h-full rounded-[3px] border bg-card p-3", tom !== "neutro" && "border-l-4", tom === "grave" && "border-l-red-500", tom === "atencao" && "border-l-amber-500", tom === "bom" && "border-l-emerald-600", tom === "info" && "border-l-sky-600")}>
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="mt-0.5 font-condensada text-xl font-bold tabular-nums">{valor}</div>
      {detalhe && <div className="mt-0.5 text-xs text-muted-foreground">{detalhe}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{corpo}</Link> : corpo;
}

export function Vazio({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[3px] border border-dashed p-6 text-center">
      <p className="font-medium">{titulo}</p>
      {children && <div className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Secao({ titulo, acoes, children, descricao }: { titulo: string; acoes?: React.ReactNode; children: React.ReactNode; descricao?: React.ReactNode }) {
  return (
    <section className="rounded-[3px] border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-cabecalho px-3 py-2">
        <div>
          <h2 className="font-condensada text-[15px] font-bold">{titulo}</h2>
          {descricao && <p className="text-xs text-muted-foreground">{descricao}</p>}
        </div>
        {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Paginacao({ pagina, total, porPagina, href }: { pagina: number; total: number; porPagina: number; href: (p: number) => string }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return <p className="mt-2 text-xs text-muted-foreground">{total} registro(s).</p>;
  return (
    <nav aria-label="Páginas" className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground">{total} registros · página {pagina} de {paginas}</span>
      {pagina > 1 && <Link className="rounded-[3px] border px-2 py-0.5 hover:bg-muted" href={href(pagina - 1)}>Anterior</Link>}
      {pagina < paginas && <Link className="rounded-[3px] border px-2 py-0.5 hover:bg-muted" href={href(pagina + 1)}>Próxima</Link>}
    </nav>
  );
}
