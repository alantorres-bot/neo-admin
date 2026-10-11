"use client";

// Trilho por área com submenu, como no Consistem: o trilho mostra as áreas (Financeiro, Fiscal…); clicar numa área abre um
// painel ao lado com os módulos dela. Escolher um módulo abre a tela e fecha o painel; Esc, clique fora ou clicar de novo
// na mesma área também fecham. No celular, o trilho é a barra inferior e o painel sobe como uma folha acima dela.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ClipboardList, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MenuArea } from "@/lib/nucleo/permissoes";
import { ICONE_DA_AREA, iconeDoItem } from "./icones";

/** Rótulo curto da área no trilho (o nome completo vai no título e no painel). */
const ROTULO_CURTO: Record<string, string> = {
  financeiro: "Financeiro", fiscal: "Fiscal", contratos: "Contratos", juridico: "Jurídico", rh: "RH", administrativo: "Admin.", producao: "Produção",
};

const CLASSE_ITEM = "flex w-[72px] shrink-0 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] leading-tight transition-colors md:w-full md:justify-start";

export function AreasDoTrilho({ menu, caminho }: { menu: MenuArea[]; caminho: string }) {
  // O painel aberto fica preso à tela em que foi aberto: mudou de tela (inclusive pelo "voltar"), fecha sozinho.
  const [estado, setEstado] = useState<{ area: string; caminho: string } | null>(null);
  const aberta = estado && estado.caminho === caminho ? estado.area : null;
  const setAberta = (valor: string | null | ((atual: string | null) => string | null)) =>
    setEstado(() => {
      const proxima = typeof valor === "function" ? valor(aberta) : valor;
      return proxima ? { area: proxima, caminho } : null;
    });
  const raiz = useRef<HTMLDivElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const naRota = (rota: string) => caminho === rota || caminho.startsWith(rota + "/");
  const areaAtual = menu.find(({ modulos }) => modulos.some((m) => naRota(m.rota)))?.area.codigo ?? null;

  // Esc e clique fora fecham; ao abrir, foco no primeiro item do painel.
  useEffect(() => {
    if (!aberta) return;
    painel.current?.querySelector<HTMLElement>("a")?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setEstado(null); };
    const clique = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setEstado(null); };
    document.addEventListener("keydown", tecla);
    document.addEventListener("mousedown", clique);
    return () => {
      document.removeEventListener("keydown", tecla);
      document.removeEventListener("mousedown", clique);
    };
  }, [aberta]);

  const areaAberta = menu.find(({ area }) => area.codigo === aberta) ?? null;

  return (
    <div ref={raiz} className="contents">
      {menu.map(({ area }) => {
        const Icone = ICONE_DA_AREA[area.codigo] ?? ClipboardList;
        const destacada = aberta === area.codigo || (aberta === null && areaAtual === area.codigo);
        return (
          <button
            key={area.codigo}
            type="button"
            title={area.nome}
            aria-expanded={aberta === area.codigo}
            aria-controls="submenu-area"
            onClick={() => setAberta((atual) => (atual === area.codigo ? null : area.codigo))}
            className={cn(CLASSE_ITEM, destacada ? "bg-marca text-white" : "text-gray-300 hover:bg-trilho-claro hover:text-white")}
          >
            <Icone className="size-5" />
            <span className="max-w-full truncate">{ROTULO_CURTO[area.codigo] ?? area.nome}</span>
          </button>
        );
      })}

      {areaAberta && (
        <div
          id="submenu-area"
          ref={painel}
          role="menu"
          aria-label={areaAberta.area.nome}
          className="fixed inset-x-0 bottom-14 z-50 max-h-[60svh] overflow-y-auto rounded-t-[6px] border-t border-white/10 bg-trilho-claro text-gray-100 shadow-2xl md:inset-x-auto md:bottom-0 md:left-[68px] md:top-0 md:max-h-none md:w-60 md:rounded-none md:border-l md:border-t-0"
        >
          <div className="flex h-11 items-center justify-between border-b border-white/10 px-3">
            <span className="font-condensada text-[14px] font-bold text-white">{areaAberta.area.nome}</span>
            <button type="button" onClick={() => setAberta(null)} title="Fechar" className="rounded-[3px] p-1 text-gray-300 hover:bg-white/10 hover:text-white">
              <X className="size-4" />
            </button>
          </div>
          {areaAberta.modulos.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-gray-400">Nenhum módulo ainda.</p>
          ) : (
            <ul className="py-1">
              {areaAberta.modulos.map((m) => {
                const Icone = iconeDoItem(areaAberta.area.codigo, m.codigo, m.icone);
                const atual = naRota(m.rota);
                return (
                  <li key={m.codigo}>
                    <Link
                      href={m.rota}
                      role="menuitem"
                      onClick={() => setAberta(null)}
                      title={m.externo ? `${m.nome} (aplicativo externo)` : m.nome}
                      aria-current={atual ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2 text-[13px] outline-none focus-visible:bg-white/10",
                        atual ? "bg-marca text-white" : "text-gray-200 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      <Icone className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{m.nome}</span>
                      {m.externo && <ArrowUpRight className="size-3.5 shrink-0 opacity-60" aria-label="aplicativo externo" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
