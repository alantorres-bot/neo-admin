import { describe, expect, it } from "vitest";
import { criarPlantaReal } from "../modelo/plantaReal";
import { CATALOGO, COR_PORTA_PADRAO } from "./catalogo";

const canais = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const claridade = (hex: string) => {
  const [r, g, b] = canais(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

describe("portas do apartamento", () => {
  it("são de madeira, um pouco mais escura que os armários de madeira da cozinha (informação do Alan)", () => {
    const armario = CATALOGO.find((i) => i.id === "aereo-madeira")!.slots.frente;
    expect(armario.acabamento).toBe("madeira");
    const razao = claridade(COR_PORTA_PADRAO.madeira) / claridade(armario.cor);
    expect(razao).toBeLessThan(0.93); // mais escura…
    expect(razao).toBeGreaterThan(0.75); // …mas só um pouco
    // continua sendo um tom quente de madeira: vermelho > verde > azul
    const [r, g, b] = canais(COR_PORTA_PADRAO.madeira);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("todas as portas da planta usam o padrão (nenhuma com cor ou acabamento próprio)", () => {
    const portas = criarPlantaReal().aberturas.filter((a) => a.tipo === "porta");
    expect(portas.map((a) => a.id).sort()).toEqual(["pt-banheiro", "pt-entrada", "pt-quarto1", "pt-quarto2"]);
    expect(portas.every((a) => a.cor === undefined && a.acabamento === undefined)).toBe(true);
  });
});
