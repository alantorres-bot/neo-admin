import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { registrarDesenhista, type TamanhoImagem } from "./exportar";

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Desenha a vista atual num tamanho maior que o da tela, para exportar. A cena é redimensionada por um
 * instante (a tela continua mostrando o mesmo tamanho), desenhada e devolvida ao normal.
 */
export function Exportador() {
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    let ocupado = false;
    const desenhar = async ({ largura, altura }: TamanhoImagem): Promise<Blob> => {
      if (ocupado) throw new Error("Já há uma imagem sendo gerada.");
      ocupado = true;
      const antes = get();
      const tamanho = { ...antes.size };
      const dpr = antes.viewport.dpr;
      const tela = gl.domElement;
      const estilo = { largura: tela.style.width, altura: tela.style.height };
      try {
        antes.setDpr(1);
        antes.setSize(largura, altura, tamanho.top, tamanho.left);
        // o redimensionamento aumentou o canvas na página: volta ao tamanho visível enquanto a imagem grande é desenhada
        tela.style.width = estilo.largura;
        tela.style.height = estilo.altura;
        // câmera e acabamento da imagem acompanham o novo tamanho no próximo ciclo do React
        await esperar(80);
        get().advance(performance.now());
        get().advance(performance.now()); // o segundo quadro já tem o sombreamento no tamanho novo
        return await new Promise<Blob>((ok, falha) => tela.toBlob((b) => (b ? ok(b) : falha(new Error("O navegador não devolveu a imagem."))), "image/jpeg", 0.92));
      } finally {
        const agora = get();
        agora.setDpr(dpr);
        agora.setSize(tamanho.width, tamanho.height, tamanho.top, tamanho.left);
        tela.style.width = estilo.largura;
        tela.style.height = estilo.altura;
        await esperar(60);
        get().invalidate();
        ocupado = false;
      }
    };
    registrarDesenhista(desenhar, gl.capabilities.maxTextureSize);
    return () => registrarDesenhista(null);
  }, [get, gl]);

  return null;
}
