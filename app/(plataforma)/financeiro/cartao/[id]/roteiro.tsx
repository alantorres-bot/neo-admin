// Quadro "Fechamento passo a passo" no topo da conciliação ao vivo (regra 65 de docs/modulos/financeiro-cartao.md).
import type { Passo } from "@/lib/modulos/financeiro/cartao/roteiro";

const MARCA: Record<Passo["estado"], string> = { feito: "✓", atual: "→", pendente: "", nao_se_aplica: "—" };
const COR: Record<Passo["estado"], string> = {
  feito: "border-emerald-300 bg-emerald-50 text-emerald-800",
  atual: "border-sky-400 bg-sky-50 font-medium",
  pendente: "border-grade bg-card",
  nao_se_aplica: "border-grade bg-card text-muted-foreground",
};

export function QuadroRoteiro({ passos }: { passos: Passo[] }) {
  const atual = passos.find((p) => p.estado === "atual");
  return (
    <section className="space-y-2 rounded-[3px] border border-grade p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold">Fechamento passo a passo</h2>
        <p className="text-xs text-muted-foreground">Primeiro resolver o que já existe no Consistem, depois criar o que falta.</p>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {passos.map((p) => (
          <li key={p.numero} className={`rounded-[3px] border p-2 text-xs ${COR[p.estado]}`} title={p.detalhe}>
            <p className="text-sm">
              <span className="mr-1 inline-block w-4 text-center font-bold">{MARCA[p.estado] || p.numero}</span>
              {p.numero}. {p.titulo}
            </p>
            <p className="mt-0.5 line-clamp-3">{p.detalhe}</p>
          </li>
        ))}
      </ol>
      {atual && <p className="text-sm"><strong>Agora: {atual.numero}. {atual.titulo}.</strong> {atual.detalhe}</p>}
    </section>
  );
}
