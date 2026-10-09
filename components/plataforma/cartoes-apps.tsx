// Super painel: um cartão por módulo nativo e por aplicativo externo, agrupados por área (só o que o usuário pode ver).
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { MenuArea } from "@/lib/nucleo/permissoes";
import { iconeDoItem } from "./icones";

// Módulos nativos não têm descrição no banco; a dos principais fica aqui.
const DESCRICAO_PADRAO: Record<string, string> = {
  "financeiro.recebiveis": "Carteira, fila do dia, clientes e contatos.",
  "financeiro.cobranca": "Boletos, confirmações, régua de cobrança e baixas.",
  "financeiro.akf": "Títulos cedidos e antecipações na AKF.",
};

export function CartoesApps({ menu }: { menu: MenuArea[] }) {
  if (menu.length === 0) return null;
  return (
    <section aria-labelledby="titulo-aplicativos" className="space-y-4">
      <h2 id="titulo-aplicativos" className="font-condensada text-lg font-bold">Aplicativos</h2>
      {menu.map(({ area, modulos }) => (
        <div key={area.codigo} className="space-y-2">
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-gray-500">{area.nome}</h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {modulos.map((m) => {
              const Icone = iconeDoItem(area.codigo, m.codigo, m.icone);
              return (
                <li key={m.codigo}>
                  <Link
                    href={m.rota}
                    className="flex h-full flex-col gap-2 rounded-[3px] border border-grade bg-white p-3 transition-colors hover:border-marca hover:bg-cabecalho"
                  >
                    <span className="flex items-center justify-between">
                      <Icone className="size-6 text-marca" />
                      {m.externo && <ExternalLink className="size-3.5 text-gray-400" aria-label="Aplicativo externo" />}
                    </span>
                    <span className="font-condensada text-[15px] font-bold leading-tight">{m.nome}</span>
                    <span className="line-clamp-2 text-[12px] text-muted-foreground">
                      {m.descricao ?? DESCRICAO_PADRAO[m.codigo] ?? (m.externo ? "Aplicativo externo." : "Módulo do Neo Admin.")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
