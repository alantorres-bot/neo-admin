/** Imagem pequena da cena como está na tela (JPEG em data URL), para identificar uma versão na lista. */
export function capturarMiniatura(largura = 320, altura = 200): string | undefined {
  try {
    const cena = document.querySelector<HTMLCanvasElement>(".palco canvas");
    if (!cena || cena.width === 0 || cena.height === 0) return undefined;
    const t = document.createElement("canvas");
    t.width = largura;
    t.height = altura;
    const g = t.getContext("2d");
    if (!g) return undefined;
    // recorta o centro da cena na proporção da miniatura
    const escala = Math.max(largura / cena.width, altura / cena.height);
    const w = largura / escala;
    const h = altura / escala;
    g.drawImage(cena, (cena.width - w) / 2, (cena.height - h) / 2, w, h, 0, 0, largura, altura);
    return t.toDataURL("image/jpeg", 0.62);
  } catch {
    return undefined;
  }
}
