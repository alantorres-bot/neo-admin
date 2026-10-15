import { describe, expect, it } from "vitest";
import { areasComNivel, montarMenu, modulosComNivel, nivelAtinge, nivelNaArea, rotaDoModulo, temAcesso, temAcessoModulo, type Acesso } from "./permissoes";
import type { Aplicativo, Area, Modulo } from "./tipos";

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

  it("o painel da área vem primeiro; os demais módulos seguem a ordem do código", () => {
    const rh = [{ codigo: "rh", nome: "RH / SST", sensivel: true, ordem: 5 }];
    const mods = ["rh.colaboradores", "rh.folha", "rh.painel", "rh.vale_transporte"].map((codigo) => ({ codigo, area: "rh", nome: codigo, ativo: true }));
    expect(montarMenu(rh, mods, admin)[0].modulos.map((m) => m.codigo)).toEqual(["rh.painel", "rh.colaboradores", "rh.folha", "rh.vale_transporte"]);
  });

  it("admin_geral vê todas as áreas que têm módulo ativo", () => {
    expect(montarMenu(areas, modulos, admin).map((m) => m.area.codigo)).toEqual(["financeiro", "juridico"]);
  });

  it("menu lateral (incluirVazias) mostra também a área com acesso e sem módulo ativo; sem acesso continua fora", () => {
    const menu = montarMenu(areas, modulos, comum, [], { incluirVazias: true });
    expect(menu.map((m) => [m.area.codigo, m.modulos.length])).toEqual([["financeiro", 1], ["fiscal", 0]]);
    expect(montarMenu(areas, modulos, { adminGeral: false, niveis: {} }, [], { incluirVazias: true })).toEqual([]);
  });

  it("usuário sem nenhuma permissão não vê menu de área", () => {
    expect(montarMenu(areas, modulos, { adminGeral: false, niveis: {} })).toEqual([]);
    expect(montarMenu(areas, modulos, { adminGeral: false, niveis: { financeiro: "sem_acesso" } })).toEqual([]);
  });

  it("monta a rota do módulo", () => {
    expect(rotaDoModulo("contratos.rem_ret")).toBe("/contratos/rem_ret");
  });
});

describe("aplicativos externos no menu (super painel)", () => {
  const app = (codigo: string, area: string, ordem: number, ativo = true): Aplicativo => ({
    id: codigo, codigo, nome: codigo.toUpperCase(), descricao: null, area, url: `https://${codigo}.exemplo.app`, abrir: "embutido",
    icone: "factory", ordem, ativo,
  });
  const aplicativos = [app("b_fiscal", "fiscal", 20), app("a_fiscal", "fiscal", 10), app("desligado", "fiscal", 0, false), app("epi", "juridico", 1), app("caixa", "financeiro", 5)];

  it("entra depois dos módulos nativos da área, na ordem cadastrada, com rota /apps/<codigo>", () => {
    const menu = montarMenu(areas, modulos, comum, aplicativos);
    expect(menu.map((m) => m.area.codigo)).toEqual(["financeiro", "fiscal"]);
    expect(menu[0].modulos.map((m) => m.rota)).toEqual(["/financeiro/recebiveis", "/apps/caixa"]);
    expect(menu[0].modulos[1]).toMatchObject({ codigo: "app:caixa", nome: "CAIXA", externo: true, icone: "factory" });
    // fiscal: nenhum módulo nativo ativo, mas tem aplicativos: a área aparece só por eles
    expect(menu[1].modulos.map((m) => m.codigo)).toEqual(["app:a_fiscal", "app:b_fiscal"]);
  });

  it("não mostra app inativo nem app de área sem acesso", () => {
    const menu = montarMenu(areas, modulos, comum, aplicativos);
    const codigos = menu.flatMap((m) => m.modulos.map((x) => x.codigo));
    expect(codigos).not.toContain("app:desligado");
    expect(codigos).not.toContain("app:epi");
    expect(montarMenu(areas, modulos, admin, aplicativos).flatMap((m) => m.modulos.map((x) => x.codigo))).toContain("app:epi");
  });

  it("sem aplicativos o menu é o mesmo de antes", () => {
    expect(montarMenu(areas, modulos, comum, [])).toEqual(montarMenu(areas, modulos, comum));
  });
});

describe("usuário restrito à unidade (0152)", () => {
  const comFilial: Modulo[] = [...modulos, { codigo: "financeiro.filial", area: "financeiro", nome: "Faturamento Filial", ativo: true }];
  const restrito: Acesso = { adminGeral: false, niveis: {}, restrito: { unidade: "contagem", nivel: "operador" } };

  it("só o módulo da unidade, com o nível do Financeiro", () => {
    expect(temAcessoModulo(restrito, comFilial, "financeiro.filial", "operador")).toBe(true);
    expect(temAcessoModulo(restrito, comFilial, "financeiro.filial", "gestor")).toBe(false);
    expect(temAcessoModulo(restrito, comFilial, "financeiro.recebiveis")).toBe(true); // Fase E (0158): cobrança da filial
    expect(temAcessoModulo(restrito, comFilial, "juridico.processos")).toBe(false);
    expect(temAcesso(restrito, "financeiro")).toBe(false);
  });

  it("quem não é restrito: acesso ao módulo = acesso à área dele", () => {
    expect(temAcessoModulo(comum, comFilial, "financeiro.filial", "operador")).toBe(true);
    expect(temAcessoModulo(comum, comFilial, "juridico.processos")).toBe(false);
    expect(temAcessoModulo(comum, comFilial, "nao.existe")).toBe(false);
  });

  it("menu: só Financeiro, com Recebíveis e Faturamento Filial (os módulos da unidade que estão ativos)", () => {
    expect(montarMenu(areas, comFilial, restrito, [], { incluirVazias: true })).toEqual([
      { area: areas[1], modulos: [
        { codigo: "financeiro.recebiveis", nome: "Recebíveis", rota: "/financeiro/recebiveis" },
        { codigo: "financeiro.filial", nome: "Faturamento Filial", rota: "/financeiro/filial" },
      ] },
    ]);
    expect(montarMenu(areas, comFilial, { ...restrito, restrito: { unidade: "contagem", nivel: "sem_acesso" } })).toEqual([]);
  });
});
