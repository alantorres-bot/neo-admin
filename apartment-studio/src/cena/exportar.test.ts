import { describe, expect, it } from "vitest";
import { limiteDeImagem, nomeDoArquivo, qualidadesDisponiveis, registrarDesenhista, tamanhoDaImagem } from "./exportar";

describe("exportar imagem", () => {
  const tela = { largura: 1440, altura: 848 };

  it("formatos fixos: o lado maior vale o pedido e o outro acompanha a proporção", () => {
    expect(tamanhoDaImagem("paisagem", 1920, tela)).toEqual({ largura: 1920, altura: 1080 });
    expect(tamanhoDaImagem("paisagem", 3840, tela)).toEqual({ largura: 3840, altura: 2160 });
    expect(tamanhoDaImagem("quadrada", 2560, tela)).toEqual({ largura: 2560, altura: 2560 });
    expect(tamanhoDaImagem("retrato", 1920, tela)).toEqual({ largura: 1080, altura: 1920 });
  });

  it("'como na tela' mantém a proporção do que está sendo visto, em pé ou deitado", () => {
    const deitado = tamanhoDaImagem("tela", 2560, tela);
    expect(deitado.largura).toBe(2560);
    expect(deitado.largura / deitado.altura).toBeCloseTo(1440 / 848, 2);
    const emPe = tamanhoDaImagem("tela", 2560, { largura: 390, altura: 780 });
    expect(emPe).toEqual({ largura: 1280, altura: 2560 });
  });

  it("não passa do que o aparelho consegue desenhar, e os lados são sempre pares", () => {
    expect(tamanhoDaImagem("paisagem", 3840, tela, 2048)).toEqual({ largura: 2048, altura: 1152 });
    const t = tamanhoDaImagem("tela", 1921, { largura: 1001, altura: 777 });
    expect(t.largura % 2).toBe(0);
    expect(t.altura % 2).toBe(0);
  });

  it("em celular a qualidade máxima (4K) não é oferecida; em computador, sim — respeitando o limite da placa", () => {
    expect(qualidadesDisponiveis(true).map((q) => q.lado)).toEqual([1920, 2560]);
    expect(qualidadesDisponiveis(false).map((q) => q.lado)).toEqual([1920, 2560, 3840]);
    expect(limiteDeImagem(true)).toBe(2560);
    // placa que só desenha até 2048: nenhuma qualidade passa disso
    registrarDesenhista(null, 2048);
    expect(limiteDeImagem(false)).toBe(2048);
    expect(qualidadesDisponiveis(false).map((q) => q.lado)).toEqual([1920]);
    expect(tamanhoDaImagem("paisagem", 3840, tela, limiteDeImagem(false))).toEqual({ largura: 2048, altura: 1152 });
    registrarDesenhista(null, 4096);
  });

  it("nome do arquivo sem acento nem espaço, com a vista e a data", () => {
    expect(nomeDoArquivo("Suíte", new Date(2026, 10, 13, 14, 5))).toBe("apartamento-suite-2026-11-13-14h05.jpg");
    expect(nomeDoArquivo("Guarda-roupa", new Date(2026, 0, 2, 9, 30))).toBe("apartamento-guarda-roupa-2026-01-02-09h30.jpg");
    expect(nomeDoArquivo(undefined, new Date(2026, 10, 13, 14, 5))).toBe("apartamento-vista-2026-11-13-14h05.jpg");
    expect(nomeDoArquivo("3D — paredes baixas", new Date(2026, 10, 13, 8, 0))).toBe("apartamento-3d-paredes-baixas-2026-11-13-08h00.jpg");
  });
});
