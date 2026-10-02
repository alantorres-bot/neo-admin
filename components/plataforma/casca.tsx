"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ClipboardList, FileSignature, FileText, House, LogOut, Menu, Scale, Settings, ShieldCheck, UserRound, Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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

function Item({ href, icone: Icone, children, ativo }: { href: string; icone?: LucideIcon; children: React.ReactNode; ativo: boolean }) {
  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        ativo ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {Icone && <Icone className="size-4 shrink-0" />}
      <span className="truncate">{children}</span>
    </Link>
  );
}

function Navegacao({ menu, usuario, mostrarConfiguracoes }: { menu: MenuArea[]; usuario: Usuario; mostrarConfiguracoes: boolean }) {
  const caminho = usePathname();
  const ativo = (rota: string) => caminho === rota || caminho.startsWith(rota + "/");

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-4">
        <Link href="/inicio" className="text-lg font-semibold tracking-tight">
          Neo Admin
        </Link>
        <p className="text-xs text-muted-foreground">Grupo Neo Formas</p>
      </div>

      <nav aria-label="Principal" className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        <Item href="/inicio" icone={House} ativo={ativo("/inicio")}>
          Início
        </Item>

        {menu.map(({ area, modulos }) => (
          <div key={area.codigo} className="space-y-1">
            <p className="flex items-center gap-1.5 px-2.5 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {(() => {
                const Icone = ICONE_DA_AREA[area.codigo] ?? ClipboardList;
                return <Icone className="size-3.5" />;
              })()}
              {area.nome}
            </p>
            {modulos.map((m) => (
              <Item key={m.codigo} href={m.rota} ativo={ativo(m.rota)}>
                {m.nome}
              </Item>
            ))}
          </div>
        ))}

        {mostrarConfiguracoes && (
          <div className="space-y-1 border-t pt-3">
            <Item href="/configuracoes" icone={Settings} ativo={ativo("/configuracoes")}>
              Configurações
            </Item>
          </div>
        )}
      </nav>

      <div className="border-t p-3">
        <div className="mb-2 min-w-0 px-1">
          <p className="truncate text-sm font-medium">{usuario.nome}</p>
          <p className="truncate text-xs text-muted-foreground">{usuario.adminGeral ? "Administrador geral" : usuario.email}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" render={<Link href="/conta" />}>
            <UserRound /> Minha conta
          </Button>
          <form action={sair}>
            <Button type="submit" variant="ghost" size="sm" aria-label="Sair">
              <LogOut /> Sair
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function Casca({
  menu, usuario, mostrarConfiguracoes, children,
}: { menu: MenuArea[]; usuario: Usuario; mostrarConfiguracoes: boolean; children: React.ReactNode }) {
  const caminho = usePathname();
  const [aberto, setAberto] = useState(false);
  // Fecha a gaveta ao navegar (ajuste de estado durante a renderização, sem efeito).
  const [caminhoVisto, setCaminhoVisto] = useState(caminho);
  if (caminho !== caminhoVisto) {
    setCaminhoVisto(caminho);
    setAberto(false);
  }

  const navegacao = <Navegacao menu={menu} usuario={usuario} mostrarConfiguracoes={mostrarConfiguracoes} />;

  return (
    <div className="min-h-svh md:grid md:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-svh border-r bg-card md:block">{navegacao}</aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur md:hidden">
          <Sheet open={aberto} onOpenChange={setAberto}>
            <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Abrir menu" />}>
              <Menu />
            </SheetTrigger>
            <SheetContent side="left" className="p-0" showCloseButton={false}>
              <SheetHeader className="sr-only">
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              {navegacao}
            </SheetContent>
          </Sheet>
          <span className="font-semibold">Neo Admin</span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
