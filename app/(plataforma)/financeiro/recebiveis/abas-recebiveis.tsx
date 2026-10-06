import Link from "next/link";

export type AbaRecebiveis = "carteira" | "tarefas" | "clientes" | "baixas";

const ABAS: { chave: AbaRecebiveis; rotulo: string; href: string }[] = [
  { chave: "carteira", rotulo: "Carteira", href: "/financeiro/recebiveis" },
  { chave: "tarefas", rotulo: "Tarefas", href: "/financeiro/recebiveis/tarefas" },
  { chave: "clientes", rotulo: "Clientes e contatos", href: "/financeiro/recebiveis/clientes" },
  { chave: "baixas", rotulo: "Baixas a conferir", href: "/financeiro/recebiveis/baixas" },
];

/**
 * Barra de seções do contas a receber (Carteira, Tarefas, Clientes e contatos, Baixas a conferir). A aba ativa vem da página que a
 * desenha; o número ao lado do rótulo só aparece onde a página já o calculou.
 */
export function RecebiveisAbas({ ativa, contagens = {} }: { ativa: AbaRecebiveis; contagens?: Partial<Record<AbaRecebiveis, number>> }) {
  return (
    <nav aria-label="Seções do contas a receber" className="flex gap-1 overflow-x-auto border-b">
      {ABAS.map((a) => {
        const n = contagens[a.chave];
        return (
          <Link
            key={a.chave}
            href={a.href}
            aria-current={a.chave === ativa ? "page" : undefined}
            className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${a.chave === ativa ? "border-marca font-bold text-texto" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {a.rotulo}
            {n !== undefined && n > 0 && <span className="rounded-[3px] bg-cabecalho px-1.5 text-[11px] font-bold tabular-nums text-texto ring-1 ring-grade">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
