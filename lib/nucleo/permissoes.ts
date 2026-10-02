// Regras de acesso do lado da aplicação. Espelham tem_acesso_area()/nivel_area() do banco,
// mas servem só para decidir o que MOSTRAR (menu, botões). Quem protege os dados é a RLS.
import type { Area, Modulo, NivelAcesso } from "./tipos";

export const NIVEIS: readonly NivelAcesso[] = ["sem_acesso", "consulta", "operador", "gestor", "administrador"];

export const ROTULO_NIVEL: Record<NivelAcesso, string> = {
  sem_acesso: "Sem acesso",
  consulta: "Consulta",
  operador: "Operador",
  gestor: "Gestor",
  administrador: "Administrador",
};

export type Acesso = {
  adminGeral: boolean;
  niveis: Readonly<Record<string, NivelAcesso | undefined>>;
};

export function nivelAtinge(nivel: NivelAcesso, minimo: NivelAcesso): boolean {
  return NIVEIS.indexOf(nivel) >= NIVEIS.indexOf(minimo);
}

export function nivelNaArea(acesso: Acesso, area: string): NivelAcesso {
  if (acesso.adminGeral) return "administrador";
  return acesso.niveis[area] ?? "sem_acesso";
}

export function temAcesso(acesso: Acesso, area: string, minimo: NivelAcesso = "consulta"): boolean {
  return nivelAtinge(nivelNaArea(acesso, area), minimo);
}

export function temAcessoAlgumaArea(acesso: Acesso, areas: readonly Area[], minimo: NivelAcesso = "consulta"): boolean {
  return areas.some((a) => temAcesso(acesso, a.codigo, minimo));
}

/** Códigos das áreas em que o usuário tem pelo menos `minimo`. */
export function areasComNivel(acesso: Acesso, areas: readonly Area[], minimo: NivelAcesso): string[] {
  return areas.filter((a) => temAcesso(acesso, a.codigo, minimo)).map((a) => a.codigo);
}

/** Códigos dos módulos (ativos ou não) das áreas em que o usuário tem pelo menos `minimo`. */
export function modulosComNivel(acesso: Acesso, modulos: readonly Modulo[], minimo: NivelAcesso): string[] {
  return modulos.filter((m) => temAcesso(acesso, m.area, minimo)).map((m) => m.codigo);
}

/** 'financeiro.recebiveis' -> '/financeiro/recebiveis' */
export function rotaDoModulo(codigo: string): string {
  return "/" + codigo.replace(".", "/");
}

/** '/financeiro/recebiveis' -> 'financeiro.recebiveis' (a rota tem exatamente dois níveis) */
export function codigoDoModulo(area: string, modulo: string): string {
  return `${area}.${modulo}`;
}

export type MenuArea = {
  area: Area;
  modulos: { codigo: string; nome: string; rota: string }[];
};

/** Menu lateral: só áreas em que o usuário tem acesso e que possuem módulo ativo; só módulos ativos. */
export function montarMenu(areas: readonly Area[], modulos: readonly Modulo[], acesso: Acesso): MenuArea[] {
  return [...areas]
    .sort((a, b) => a.ordem - b.ordem)
    .filter((area) => temAcesso(acesso, area.codigo, "consulta"))
    .map((area) => ({
      area,
      modulos: modulos
        .filter((m) => m.area === area.codigo && m.ativo)
        .map((m) => ({ codigo: m.codigo, nome: m.nome, rota: rotaDoModulo(m.codigo) })),
    }))
    .filter((item) => item.modulos.length > 0);
}
