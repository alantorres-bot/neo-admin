// Ícones do menu e dos cartões (sem "use client": servem a componentes de servidor e de cliente).
import {
  BellRing, Calculator, ChartColumn, ClipboardList, Factory, FileSignature, FileText, HardHat, Package, Scale, ShieldCheck, Truck,
  Users, Wallet, Wrench, type LucideIcon,
} from "lucide-react";
import type { IconeApp } from "@/lib/nucleo/aplicativos";

export const ICONE_DA_AREA: Record<string, LucideIcon> = {
  financeiro: Wallet,
  fiscal: FileText,
  contratos: FileSignature,
  juridico: Scale,
  rh: ShieldCheck,
  administrativo: ClipboardList,
  producao: Factory,
};

// Módulos que têm ícone próprio (os demais usam o da área); assim Cobrança e Recebíveis, ambos do Financeiro, não ficam iguais.
const ICONE_DO_MODULO: Record<string, LucideIcon> = { "financeiro.cobranca": BellRing };

// Ícones que o cadastro de aplicativos aceita (lista em lib/nucleo/aplicativos.ts).
const ICONE_DO_APP: Record<IconeApp, LucideIcon> = {
  "file-text": FileText, "hard-hat": HardHat, "shield-check": ShieldCheck, factory: Factory, package: Package, truck: Truck,
  wrench: Wrench, "clipboard-list": ClipboardList, wallet: Wallet, calculator: Calculator, "chart-column": ChartColumn, users: Users,
};

/** Ícone de um item do menu: o cadastrado no app, o próprio do módulo, ou o da área. */
export function iconeDoItem(area: string, codigo: string, icone?: string | null): LucideIcon {
  if (icone && icone in ICONE_DO_APP) return ICONE_DO_APP[icone as IconeApp];
  return ICONE_DO_MODULO[codigo] ?? ICONE_DA_AREA[area] ?? ClipboardList;
}
