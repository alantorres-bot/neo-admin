import { describe, expect, it } from "vitest";
import { areasComNivel, montarMenu, modulosComNivel, nivelAtinge, nivelNaArea, rotaDoModulo, temAcesso, type Acesso } from "./permissoes";
import type { Area, Modulo } from "./tipos";

const areas: Area[] = [
  { codigo: "juridico", nome: "Jurídico", sensivel: true, ordem: 4 },
  { codigo: "financeiro", nome: "Financeiro", sensivel: false, ordem: 1 },
  { codigo: "fiscal", nome: "Fiscal/Tributário", sensivel: false, ordem: 2 },
  { codigo: "administrativo", nome: "Administrativo geral", sensivel: false, ordem: 6 },
];
const modulos: Modulo[] = [
  { codigo: "financeiro.recebiveis", area: "financeiro", nome: "Recebíveis", ativo: true },
  { codigo: "financeiro.comissoes", area: "financeiro", nome: "Comissões", ativo: false },
  { codigo: "fiscal.parcelamentos", area: "fiscal", nome: "Parcelamentos", ativo: false },
  { codigo: "juridico.processos", area: "juridico", nome: "Processos e prazos", ativo: true },
  { codigo: "administrativo.pops", area: "administrativo", nome: "POPs", ativo: false },
];

const comum: Acesso = { adminGeral: false, niveis: { financeiro: "operador", fiscal: "gestor" } };
const admin: Acesso = { adminGeral: true, niveis: {} };

describe("níveis", () => {
  it("compara na ordem sem_acesso < consulta < operador < gestor < administrador", () => {
    expect(nivelAtinge("gestor", "operador")).toBe(true);
    expect(nivelAtinge("operador", "operador")).toBe(true);
    expect(nivelAtinge("consulta", "operador")).toBe(false);
    expect(nivelAtinge("sem_acesso", "consulta")).toBe(false);
  });

  it("área sem permissão é sem_acesso; admin_geral é administrador em tudo", () => {
    expect(nivelNaArea(comum, "juridico")).toBe("sem_acesso");
    expect(nivelNaArea(comum, "financeiro")).toBe("operador");
    expect(nivelNaArea(admin, "juridico")).toBe("administrador");
    expect(temAcesso(comum, "juridico")).toBe(false);
    expect(temAcesso(comum, "fiscal", "gestor")).toBe(true);
  });

  it("lista áreas e módulos por nível mínimo", () => {
    expect(areasComNivel(comum, areas, "operador").sort()).toEqual(["financeiro", "fiscal"]);
    expect(areasComNivel(comum, areas, "gestor")).toEqual(["fiscal"]);
    expect(modulosComNivel(comum, modulos, "gestor")).toEqual(["fiscal.parcelamentos"]);
  });
});

describe("menu lateral", () => {
  it("mostra só áreas permitidas com módulo ativo, na ordem das áreas", () => {
    const menu = montarMenu(areas, modulos, comum);
    // fiscal tem permissão, mas nenhum módulo ativo; jurídico tem módulo ativo, mas não há permissão
    expect(menu.map((m) => m.area.codigo)).toEqual(["financeiro"]);
    expect(menu[0].modulos).toEqual([{ codigo: "financeiro.recebiveis", nome: "Recebíveis", rota: "/financeiro/recebiveis" }]);
  });

  it("admin_geral vê todas as áreas que têm módulo ativo", () => {
    expect(montarMenu(areas, modulos, admin).map((m) => m.area.codigo)).toEqual(["financeiro", "juridico"]);
  });

  it("usuário sem nenhuma permissão não vê menu de área", () => {
    expect(montarMenu(areas, modulos, { adminGeral: false, niveis: {} })).toEqual([]);
    expect(montarMenu(areas, modulos, { adminGeral: false, niveis: { financeiro: "sem_acesso" } })).toEqual([]);
  });

  it("monta a rota do módulo", () => {
    expect(rotaDoModulo("contratos.rem_ret")).toBe("/contratos/rem_ret");
  });
});
