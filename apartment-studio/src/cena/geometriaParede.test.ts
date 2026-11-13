import { describe, expect, it } from "vitest";
import { acabamentoDaFaixa, comprimentoParede, coresDoAmbiente, definirAcabamento, extensoesParede, faixasDaFace, pintarAmbiente } from "../modelo/geometria";
import { COR_AZULEJO, criarPlantaReal } from "../modelo/plantaReal";
import { ALTURA_RODAPE, areaDoGrupo, CHAVE_RODAPE, CHAVE_TOPO, chaveAcabamento, construirParede } from "./geometriaParede";

const AZUL = "#1c2444";

describe("faces da parede por ambiente", () => {
  const planta = criarPlantaReal();
  const parede = (id: string) => planta.paredes.find((p) => p.id === id)!;

  it("a divisória cozinha/sala tem uma faixa só de cada lado", () => {
    const p = parede("p-coz-sala");
    const L = comprimentoParede(planta, p);
    for (const lado of ["direita", "esquerda"] as const) {
      const fs = faixasDaFace(planta, p, lado);
      expect(fs).toHaveLength(1);
      expect(fs[0].u0).toBe(0);
      expect(fs[0].u1).toBeCloseTo(L, 5);
    }
    expect(faixasDaFace(planta, p, "esquerda")[0].ambiente?.id).toBe("amb-sala");
    expect(faixasDaFace(planta, p, "direita")[0].ambiente?.id).toBe("amb-cozinha");
  });

  it("a parede do fundo dá para a cozinha num trecho e para o jantar no outro; as faixas cobrem a parede sem buraco", () => {
    const p = parede("p-fundo-jantar");
    const fs = faixasDaFace(planta, p, "esquerda");
    expect(fs.map((f) => f.ambiente?.id)).toEqual(["amb-cozinha", "amb-jantar"]);
    expect(fs[0].u0).toBe(0);
    expect(fs[0].u1).toBe(fs[1].u0);
    expect(fs[1].u1).toBeCloseTo(comprimentoParede(planta, p), 5);
    // a fronteira fica no alinhamento da divisória da cozinha (x ≈ 163,5 → u ≈ 158,5), com precisão de milímetros
    expect(fs[0].u1).toBeGreaterThan(150);
    expect(fs[0].u1).toBeLessThan(170);
    // do lado de fora não há ambiente
    expect(faixasDaFace(planta, p, "direita").map((f) => f.ambiente)).toEqual([undefined]);
  });

  it("acabamento: próprio do ambiente > da face inteira > cor da parede > padrão", () => {
    let p = parede("p-coz-sala");
    expect(acabamentoDaFaixa(p, "esquerda", "amb-sala")).toEqual({ cor: "#f3f0ea", revestimento: "pintura" });
    p = definirAcabamento(p, "esquerda", "amb-sala", { cor: AZUL });
    expect(acabamentoDaFaixa(p, "esquerda", "amb-sala")).toEqual({ cor: AZUL, revestimento: "pintura" });
    // o outro lado (cozinha) não muda
    expect(acabamentoDaFaixa(p, "direita", "amb-cozinha").cor).toBe("#f3f0ea");
    // trocar de novo substitui, não acumula
    p = definirAcabamento(p, "esquerda", "amb-sala", { cor: "#7d8a74", revestimento: "tijolinho" });
    expect(p.acabamentos).toHaveLength(1);
    expect(acabamentoDaFaixa(p, "esquerda", "amb-sala")).toEqual({ cor: "#7d8a74", revestimento: "tijolinho" });
    // voltar ao padrão remove o registro
    p = definirAcabamento(p, "esquerda", "amb-sala", null);
    expect(p.acabamentos).toBeUndefined();
  });

  it("pintar o ambiente inteiro alcança todas as paredes dele e só o lado dele", () => {
    const pintada = pintarAmbiente(planta, "amb-sala", { cor: AZUL });
    const p = pintada.paredes.find((x) => x.id === "p-coz-sala")!;
    expect(acabamentoDaFaixa(p, "esquerda", "amb-sala").cor).toBe(AZUL);
    expect(acabamentoDaFaixa(p, "direita", "amb-cozinha").cor).toBe("#f3f0ea");
    const comSala = pintada.paredes.filter((x) => x.acabamentos?.some((a) => a.ambiente === "amb-sala")).map((x) => x.id).sort();
    expect(comSala).toEqual(["p-coz-sala", "p-sala-q2", "p-sala-varanda"]);
    // desfazer devolve a planta como era (só o azulejo do banheiro continua)
    expect(pintarAmbiente(pintada, "amb-sala", null)).toEqual(planta);
    expect(coresDoAmbiente(pintada, "amb-sala")).toEqual([AZUL]);
    expect(coresDoAmbiente(planta, "amb-sala")).toEqual(["#f3f0ea"]);
  });

  it("trocar só a cor de um ambiente mantém o revestimento que ele já tem", () => {
    const verde = pintarAmbiente(planta, "amb-banheiro", { cor: "#7d8a74" });
    const p = verde.paredes.find((x) => x.id === "p-banho-ext")!;
    expect(acabamentoDaFaixa(p, "direita", "amb-banheiro")).toEqual({ cor: "#7d8a74", revestimento: "azulejo" });
    // e trocar só o revestimento mantém a cor
    const cimento = pintarAmbiente(verde, "amb-banheiro", { revestimento: "cimento" });
    expect(acabamentoDaFaixa(cimento.paredes.find((x) => x.id === "p-banho-ext")!, "direita", "amb-banheiro")).toEqual({ cor: "#7d8a74", revestimento: "cimento" });
  });
});

describe("geometria da parede", () => {
  const planta = criarPlantaReal();
  const parede = (id: string) => planta.paredes.find((p) => p.id === id)!;
  const pe = planta.peDireito.valor;

  it("o banheiro sai azulejado em todas as faces de dentro, e só nelas", () => {
    const azulejo = chaveAcabamento("azulejo", COR_AZULEJO);
    const comAzulejo = planta.paredes.filter((p) => construirParede(planta, p).some((g) => g.chave === azulejo)).map((p) => p.id).sort();
    expect(comAzulejo).toEqual(["p-banho-corredor", "p-banho-ext", "p-fundo-banho", "p-hall-banho", "p-shaft-banho"]);
    // na parede entre o banheiro e o corredor, o azulejo fica só do lado do banheiro
    const g = construirParede(planta, parede("p-banho-corredor")).find((x) => x.chave === azulejo)!;
    expect(areaDoGrupo(g, [0, 0, 1])).toBeGreaterThan(5);
    expect(areaDoGrupo(g, [0, 0, -1])).toBe(0);
  });

  it("parede cheia: cada face lateral mede comprimento (com os cantos) × pé-direito", () => {
    const p = parede("p-coz-sala");
    const [e0, e1] = extensoesParede(planta, p);
    const esperado = ((comprimentoParede(planta, p) + e0 + e1) * pe) / 10_000;
    const grupos = construirParede(planta, p);
    const pintura = grupos.find((g) => g.chave === chaveAcabamento("pintura", "#f3f0ea"))!;
    expect(areaDoGrupo(pintura, [0, 0, 1])).toBeCloseTo(esperado, 4);
    expect(areaDoGrupo(pintura, [0, 0, -1])).toBeCloseTo(esperado, 4);
  });

  it("parede com janela: a face perde exatamente a área do vão", () => {
    const p = parede("p-topo-q1");
    const j = planta.aberturas.find((a) => a.id === "j-quarto1")!;
    const [e0, e1] = extensoesParede(planta, p);
    const cheia = ((comprimentoParede(planta, p) + e0 + e1) * pe) / 10_000;
    const vao = (j.largura.valor * j.altura.valor) / 10_000;
    const todos = construirParede(planta, p);
    const soma = (n: [number, number, number]) => todos.filter((g) => g.chave !== CHAVE_RODAPE).reduce((s, g) => s + areaDoGrupo(g, n), 0);
    expect(soma([0, 0, 1])).toBeCloseTo(cheia - vao, 4);
    expect(soma([0, 0, -1])).toBeCloseTo(cheia - vao, 4);
  });

  it("pintar um lado cria um material só para aquela face", () => {
    const p = definirAcabamento(parede("p-coz-sala"), "esquerda", "amb-sala", { cor: AZUL });
    const grupos = construirParede({ ...planta, paredes: planta.paredes.map((x) => (x.id === p.id ? p : x)) }, p);
    const azul = grupos.find((g) => g.chave === chaveAcabamento("pintura", AZUL))!;
    expect(azul).toBeDefined();
    expect(areaDoGrupo(azul, [0, 0, -1])).toBeGreaterThan(5); // a face da sala inteira
    expect(areaDoGrupo(azul, [0, 0, 1])).toBe(0); // nada do lado da cozinha
  });

  it("rodapé só do lado de dentro, com 7 cm, e não no banheiro", () => {
    const externa = construirParede(planta, parede("p-coz-esq")).find((g) => g.chave === CHAVE_RODAPE)!;
    expect(areaDoGrupo(externa, [0, 0, -1])).toBeGreaterThan(0); // lado da cozinha
    expect(areaDoGrupo(externa, [0, 0, 1])).toBe(0); // lado de fora
    expect(Math.max(...externa.posicoes.filter((_, i) => i % 3 === 1))).toBe(ALTURA_RODAPE);
    // parede entre o banheiro e o corredor: rodapé só no corredor
    const banho = construirParede(planta, parede("p-banho-corredor")).find((g) => g.chave === CHAVE_RODAPE)!;
    expect(areaDoGrupo(banho, [0, 0, 1])).toBe(0);
    expect(areaDoGrupo(banho, [0, 0, -1])).toBeGreaterThan(0);
    // paredes só do banheiro e o guarda-corpo não têm rodapé
    expect(construirParede(planta, parede("p-banho-ext")).some((g) => g.chave === CHAVE_RODAPE)).toBe(false);
    expect(construirParede(planta, parede("p-var-guarda")).some((g) => g.chave === CHAVE_RODAPE)).toBe(false);
  });

  it("paredes baixas: corta em 1 m, com topo escuro e sem o que fica acima", () => {
    const grupos = construirParede(planta, parede("p-topo-q1"), { alturaMaxima: 100 });
    const ys = grupos.flatMap((g) => g.posicoes.filter((_, i) => i % 3 === 1));
    expect(Math.max(...ys)).toBe(100);
    expect(grupos.some((g) => g.chave === CHAVE_TOPO)).toBe(true);
    // modo "ocultas" (6 cm): sem rodapé, só o traçado
    expect(construirParede(planta, parede("p-topo-q1"), { alturaMaxima: 6 }).some((g) => g.chave === CHAVE_RODAPE)).toBe(false);
  });

  it("toda parede do projeto gera triângulos completos e normais unitárias", () => {
    for (const p of planta.paredes) {
      for (const g of construirParede(planta, p)) {
        expect(g.posicoes.length % 9, `${p.id} ${g.chave}`).toBe(0);
        expect(g.normais.length).toBe(g.posicoes.length);
        expect(g.uvs.length).toBe((g.posicoes.length / 3) * 2);
        expect(g.posicoes.every(Number.isFinite), `${p.id} ${g.chave}`).toBe(true);
      }
    }
  });
});
