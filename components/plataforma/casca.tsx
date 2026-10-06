"use client";

// Moldura no visual do ERP Consistem (a mesma do Vigilância Fiscal): trilho escuro de ícones à esquerda, barra vermelha no
// topo com a "aba" da tela atual e trilha de navegação em vermelho. O trilho tem 68 px e serve também no celular.
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight, ClipboardList, FileSignature, FileText, House, LogOut, Scale, Settings, ShieldCheck, UserRound, Wallet,
  type LucideIcon,
} from "lucide-react";
import { sair } from "@/app/(auth)/login/acoes";
import { cn } from "@/lib/utils";
import type { MenuArea } from "@/lib/nucleo/permissoes";

const ICONE_DA_AREA: Record<string, LucideIcon> = {
  financeiro: Wallet,
  fiscal: FileText,
  contratos: FileSignature,
  juridico: Scale,
  rh: ShieldCheck,
  administrativo: ClipboardList,
};

type Usuario = { nome: string; email: string; adminGeral: boolean };

const CLASSE_ITEM = "flex w-full flex-col items-center gap-0.5 px-1 py-2 text-[10px] leading-tight transition-colors";

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
    if (m) return { icone: ICONE_DA_AREA[area.codigo] ?? ClipboardList, rotulo: m.nome, trilha: [area.nome, m.nome] };
  }
  if (caminho.startsWith("/configuracoes")) return { icone: Settings, rotulo: "Configurações", trilha: ["Configurações"] };
  if (caminho.startsWith("/conta")) return { icone: UserRound, rotulo: "Minha conta", trilha: ["Minha conta"] };
  return { icone: House, rotulo: "Início", trilha: ["Início"] };
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
      <aside className="sticky top-0 flex h-svh w-[68px] shrink-0 flex-col bg-trilho text-gray-200">
        <Link href="/inicio" title="Neo Admin — Grupo Neo Formas" className="flex h-11 shrink-0 items-center justify-center border-b border-white/10 font-condensada text-[15px] font-bold text-white">
          Neo
        </Link>
        <nav aria-label="Principal" className="flex-1 overflow-y-auto py-1">
          <ItemTrilho href="/inicio" icone={House} rotulo="Início" ativo={ativo("/inicio")} />
          {menu.map(({ area, modulos }) => (
            <div key={area.codigo} className="mt-1 border-t border-white/10 pt-1">
              {modulos.map((m) => (
                <ItemTrilho key={m.codigo} href={m.rota} icone={ICONE_DA_AREA[area.codigo] ?? ClipboardList} rotulo={m.nome} titulo={`${area.nome} › ${m.nome}`} ativo={ativo(m.rota)} />
              ))}
            </div>
          ))}
        </nav>
        <div className="shrink-0 border-t border-white/10">
          {mostrarConfiguracoes && <ItemTrilho href="/configuracoes" icone={Settings} rotulo="Config." titulo="Configurações" ativo={ativo("/configuracoes")} />}
          <ItemTrilho href="/conta" icone={UserRound} rotulo="Conta" titulo="Minha conta" ativo={ativo("/conta")} />
          <form action={sair}>
            <button type="submit" title={`Sair (${usuario.email})`} className={cn(CLASSE_ITEM, "text-gray-300 hover:bg-trilho-claro hover:text-white")}>
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
        <div className="flex items-center gap-1 border-b border-grade-clara px-5 py-1.5 text-[12px] text-gray-500">
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

        <main className="min-w-0 flex-1 bg-white p-4 text-texto md:p-5">{children}</main>
      </div>
    </div>
  );
}
