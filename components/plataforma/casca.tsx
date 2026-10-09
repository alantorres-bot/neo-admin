"use client";

// Moldura no visual do ERP Consistem (a mesma do Vigilância Fiscal): trilho escuro de ícones à esquerda, barra vermelha no
// topo com a "aba" da tela atual e trilha de navegação em vermelho. O trilho tem 68 px no computador; abaixo de `md`
// (celular) ele vira uma barra inferior que rola na horizontal.
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, House, LogOut, Settings, UserRound, type LucideIcon } from "lucide-react";
import { sair } from "@/app/(auth)/login/acoes";
import { cn } from "@/lib/utils";
import type { MenuArea } from "@/lib/nucleo/permissoes";
import { iconeDoItem } from "./icones";

type Usuario = { nome: string; email: string; adminGeral: boolean };

const CLASSE_ITEM = "flex w-[72px] shrink-0 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] leading-tight transition-colors md:w-full md:justify-start";

function ItemTrilho({ href, icone: Icone, rotulo, titulo, ativo }: { href: string; icone: LucideIcon; rotulo: string; titulo?: string; ativo: boolean }) {
  return (
    <Link
      href={href}
      title={titulo ?? rotulo}
      aria-current={ativo ? "page" : undefined}
      className={cn(CLASSE_ITEM, ativo ? "bg-marca text-white" : "text-gray-300 hover:bg-trilho-claro hover:text-white")}
    >
      <Icone className="size-5" />
      <span className="max-w-full truncate">{rotulo}</span>
    </Link>
  );
}

type Atual = { icone: LucideIcon; rotulo: string; trilha: string[] };

function descobrirAtual(caminho: string, menu: MenuArea[]): Atual {
  for (const { area, modulos } of menu) {
    const m = modulos.find((x) => caminho === x.rota || caminho.startsWith(x.rota + "/"));
    if (m) return { icone: iconeDoItem(area.codigo, m.codigo, m.icone), rotulo: m.nome, trilha: [area.nome, m.nome] };
  }
  if (caminho.startsWith("/configuracoes")) return { icone: Settings, rotulo: "Configurações", trilha: ["Configurações"] };
  if (caminho.startsWith("/conta")) return { icone: UserRound, rotulo: "Minha conta", trilha: ["Minha conta"] };
  return { icone: House, rotulo: "Início", trilha: ["Início"] };
}

/**
 * Tabelas em cartões no celular: nas telas com `<Table className="cartoes">`, cada linha vira um cartão "rótulo: valor"
 * (CSS em globals.css). Os rótulos vêm do cabeçalho da própria tabela: este componente copia o texto de cada `<th>` para o
 * `data-label` das células, na primeira pintura e sempre que a lista muda.
 */
function TabelasEmCartoes() {
  useEffect(() => {
    const rotular = () => {
      document.querySelectorAll<HTMLTableElement>("table.cartoes").forEach((tabela) => {
        const cabecalhos = [...tabela.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
        tabela.querySelectorAll("tbody tr").forEach((tr) => {
          let coluna = 0;
          for (const celula of tr.children) {
            if (celula.getAttribute("data-label") === null) celula.setAttribute("data-label", cabecalhos[coluna] ?? "");
            coluna += Number(celula.getAttribute("colspan") ?? 1);
          }
        });
      });
    };
    rotular();
    const observador = new MutationObserver(rotular);
    observador.observe(document.body, { childList: true, subtree: true });
    return () => observador.disconnect();
  }, []);
  return null;
}

export function Casca({
  menu, usuario, mostrarConfiguracoes, children,
}: { menu: MenuArea[]; usuario: Usuario; mostrarConfiguracoes: boolean; children: React.ReactNode }) {
  const caminho = usePathname();
  const ativo = (rota: string) => caminho === rota || caminho.startsWith(rota + "/");
  const atual = descobrirAtual(caminho, menu);
  const AtualIcone = atual.icone;

  return (
    <div className="flex min-h-svh bg-white">
      {/* Trilho de ícones, como o do ERP */}
      <TabelasEmCartoes />
      <aside className="fixed inset-x-0 bottom-0 z-40 flex h-14 w-full flex-row border-t border-white/10 bg-trilho text-gray-200 md:sticky md:inset-x-auto md:bottom-auto md:top-0 md:h-svh md:w-[68px] md:shrink-0 md:flex-col md:border-t-0">
        <Link href="/inicio" title="Neo Admin — Grupo Neo Formas" className="hidden h-11 shrink-0 items-center justify-center border-b border-white/10 font-condensada text-[15px] font-bold text-white md:flex">
          Neo
        </Link>
        <nav aria-label="Principal" className="flex flex-1 flex-row overflow-x-auto [scrollbar-width:none] md:flex-col md:overflow-y-auto md:py-1 [&::-webkit-scrollbar]:hidden">
          <ItemTrilho href="/inicio" icone={House} rotulo="Início" ativo={ativo("/inicio")} />
          {menu.map(({ area, modulos }) => (
            <div key={area.codigo} className="flex border-l border-white/10 md:mt-1 md:block md:border-l-0 md:border-t md:pt-1">
              {modulos.map((m) => (
                <ItemTrilho key={m.codigo} href={m.rota} icone={iconeDoItem(area.codigo, m.codigo, m.icone)} rotulo={m.nome} titulo={`${area.nome} › ${m.nome}${m.externo ? " (aplicativo externo)" : ""}`} ativo={ativo(m.rota)} />
              ))}
            </div>
          ))}
        </nav>
        <div className="flex shrink-0 border-l border-white/10 md:block md:border-l-0 md:border-t">
          {mostrarConfiguracoes && <ItemTrilho href="/configuracoes" icone={Settings} rotulo="Config." titulo="Configurações" ativo={ativo("/configuracoes")} />}
          <ItemTrilho href="/conta" icone={UserRound} rotulo="Conta" titulo="Minha conta" ativo={ativo("/conta")} />
          <form action={sair} className="shrink-0 md:w-full">
            <button type="submit" title={`Sair (${usuario.email})`} className={cn(CLASSE_ITEM, "w-[72px] text-gray-300 hover:bg-trilho-claro hover:text-white md:w-full")}>
              <LogOut className="size-5" />
              Sair
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra vermelha com a "aba" da tela atual */}
        <header className="flex h-11 shrink-0 items-center gap-3 bg-marca px-3 text-white">
          <Link href="/inicio" title="Início" className="rounded-[3px] p-1 hover:bg-white/15">
            <House className="size-5" />
          </Link>
          <div className="flex min-w-0 items-center gap-2 rounded-full bg-white px-4 py-1 text-[12px] text-texto shadow-sm">
            <AtualIcone className="size-3.5 shrink-0 text-gray-500" />
            <span className="truncate">{atual.rotulo}</span>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-3 text-[11px]">
            <span className="hidden font-condensada font-bold sm:inline">Neo Admin · Grupo Neo Formas</span>
            <span className="hidden truncate text-white/85 md:inline" title={usuario.email}>
              {usuario.nome}{usuario.adminGeral ? " · administrador geral" : ""}
            </span>
          </div>
        </header>

        {/* Trilha de navegação, como a das rotinas do ERP */}
        <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-grade-clara px-3 py-1.5 text-[12px] text-gray-500 md:px-5">
          <span className="text-gray-400">…</span>
          {atual.trilha.map((parte, i) => {
            const ultimo = i === atual.trilha.length - 1;
            return (
              <span key={parte} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3 text-marca" />}
                <span className={ultimo ? "font-bold text-marca" : undefined}>{parte}</span>
              </span>
            );
          })}
        </div>

        <main className="min-w-0 flex-1 bg-white p-3 pb-20 text-texto sm:p-4 sm:pb-20 md:p-5 md:pb-5">{children}</main>
      </div>
    </div>
  );
}
