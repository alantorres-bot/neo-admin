import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarProjetoBase } from "../modelo/projetoBase";
import { LIMITE_VERSOES } from "../modelo/versoes";
import { useApp } from "./store";

const sofaX = () => useApp.getState().projeto.moveis.find((m) => m.id === "sala-sofa")!.x;
const mover = (x: number, rotulo: string) => useApp.getState().alterarMovel("sala-sofa", rotulo, { x });

describe("histórico e versões (estado do app)", () => {
  beforeEach(() => {
    // fora do navegador não há onde guardar: o app segue funcionando e só avisa no console
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useApp.setState({ projeto: criarProjetoBase(), passado: [], futuro: [], selecao: null, versoes: [], carregado: false });
  });

  it("voltar a um ponto do histórico desfaz tudo o que veio depois — e dá para refazer passo a passo", () => {
    const x0 = sofaX();
    mover(x0 + 10, "Passo 1");
    mover(x0 + 20, "Passo 2");
    mover(x0 + 30, "Passo 3");
    expect(useApp.getState().passado.map((p) => p.rotulo)).toEqual(["Passo 1", "Passo 2", "Passo 3"]);

    useApp.getState().voltarNoHistorico(1); // volta para antes do "Passo 2"
    expect(sofaX()).toBe(x0 + 10);
    expect(useApp.getState().passado.map((p) => p.rotulo)).toEqual(["Passo 1"]);
    expect(useApp.getState().futuro.map((p) => p.rotulo)).toEqual(["Passo 2", "Passo 3"]);

    useApp.getState().refazer();
    expect(sofaX()).toBe(x0 + 20);
    useApp.getState().refazer();
    expect(sofaX()).toBe(x0 + 30);
    expect(useApp.getState().futuro).toHaveLength(0);

    useApp.getState().voltarNoHistorico(0); // volta ao começo
    expect(sofaX()).toBe(x0);
    useApp.getState().voltarNoHistorico(7); // índice que não existe: nada acontece
    expect(sofaX()).toBe(x0);
  });

  it("salvar, mexer, abrir a versão: a decoração volta, e Ctrl+Z desfaz a abertura", () => {
    const x0 = sofaX();
    const id = useApp.getState().salvarVersao("  Como está hoje ")!;
    expect(useApp.getState().versoes.map((v) => v.nome)).toEqual(["Como está hoje"]);
    mover(x0 + 80, "Mover sofá");
    expect(sofaX()).toBe(x0 + 80);

    useApp.getState().abrirVersao(id);
    expect(sofaX()).toBe(x0);
    expect(useApp.getState().projeto.alteradoPeloUsuario).toBe(true);
    expect(useApp.getState().passado.at(-1)?.rotulo).toBe('Abrir a versão "Como está hoje"');

    useApp.getState().desfazer();
    expect(sofaX()).toBe(x0 + 80);
    // a versão guardada não mudou com as edições
    expect(useApp.getState().versoes[0].projeto.moveis.find((m) => m.id === "sala-sofa")!.x).toBe(x0);
  });

  it("duplicar, renomear e excluir", () => {
    const id = useApp.getState().salvarVersao("Opção A")!;
    useApp.getState().duplicarVersao(id);
    expect(useApp.getState().versoes.map((v) => v.nome).sort()).toEqual(["Opção A", "Opção A (cópia)"]);
    useApp.getState().renomearVersao(id, "Parede azul");
    expect(useApp.getState().versoes.find((v) => v.id === id)!.nome).toBe("Parede azul");
    useApp.getState().excluirVersao(id);
    expect(useApp.getState().versoes.map((v) => v.nome)).toEqual(["Opção A (cópia)"]);
    // ações sobre uma versão que não existe mais não fazem nada
    useApp.getState().abrirVersao(id);
    useApp.getState().renomearVersao(id, "x");
    expect(useApp.getState().versoes).toHaveLength(1);
  });

  it("sem nome, a versão ganha número, dia e hora; o limite de versões é respeitado", () => {
    useApp.getState().salvarVersao();
    expect(useApp.getState().versoes[0].nome).toMatch(/^Versão 1 — \d{2}\/\d{2} \d{2}h\d{2}$/);
    for (let i = 1; i < LIMITE_VERSOES; i++) expect(useApp.getState().salvarVersao(`V${i}`)).not.toBeNull();
    expect(useApp.getState().versoes).toHaveLength(LIMITE_VERSOES);
    expect(useApp.getState().salvarVersao("Uma a mais")).toBeNull();
    useApp.getState().duplicarVersao(useApp.getState().versoes[0].id);
    expect(useApp.getState().versoes).toHaveLength(LIMITE_VERSOES);
  });
});
