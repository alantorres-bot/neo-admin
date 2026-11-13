import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useApp } from "../estado/store";
import { condicaoDeLuz } from "./luz";
import { enquadramento } from "./util";

const LARGURA = 2048;
const ALTURA = 1024;
/** Quanto os prédios do horizonte descem abaixo da linha do horizonte, em pontos da textura (≈ 3°). */
const BASE_DOS_PREDIOS = 18;

/**
 * Céu visto pelas janelas (só na vista por dentro): degradê conforme a hora e uma linha de prédios ao longe,
 * com janelas acesas à noite. É um cenário genérico — a vista real do apartamento não é conhecida.
 */
function pintarCeu(g: CanvasRenderingContext2D, topo: string, horizonte: string, baixo: string, dia: number) {
  const meio = ALTURA / 2;
  const ceu = g.createLinearGradient(0, 0, 0, meio);
  ceu.addColorStop(0, topo);
  ceu.addColorStop(0.75, horizonte);
  ceu.addColorStop(1, horizonte);
  g.fillStyle = ceu;
  g.fillRect(0, 0, LARGURA, meio);
  // abaixo do horizonte: névoa que escurece um pouco para baixo
  const chao = g.createLinearGradient(0, meio, 0, ALTURA);
  chao.addColorStop(0, horizonte);
  chao.addColorStop(0.12, baixo);
  chao.addColorStop(1, baixo);
  g.fillStyle = chao;
  g.fillRect(0, meio, LARGURA, meio);

  // prédios ao longe: blocos de alturas variadas em torno do horizonte, em dois planos
  let s = 4242;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const noite = 1 - dia;
  for (const plano of [0, 1]) {
    let x = 0;
    while (x < LARGURA) {
      // prédios distantes: baixos no horizonte (até ≈ 6° de altura) e pouco contrastados
      const w = 10 + rnd() * 26;
      const h = (plano === 0 ? 5 : 9) + rnd() * (plano === 0 ? 14 : 26);
      const tom = plano === 0 ? 0.9 : 0.78;
      const c = new THREE.Color(horizonte).lerp(new THREE.Color(baixo), 0.5).multiplyScalar(tom - noite * 0.25);
      g.fillStyle = `#${c.getHexString()}`;
      const y0 = meio - h + (plano === 0 ? 2 : 12);
      // só uma faixa no horizonte: abaixo dela fica a névoa (não se sabe o andar nem o que há embaixo)
      g.fillRect(x, y0, w, meio + BASE_DOS_PREDIOS - y0);
      if (noite > 0.5) {
        // janelas acesas
        g.fillStyle = "rgba(255, 214, 150, 0.85)";
        for (let wy = y0 + 3; wy < meio + BASE_DOS_PREDIOS - 3; wy += 5) {
          for (let wx = x + 2; wx < x + w - 2; wx += 4.5) if (rnd() > 0.7) g.fillRect(wx, wy, 1.6, 2);
        }
      }
      x += w + rnd() * 10;
    }
  }
}

export function Ceu() {
  const interna = useApp((s) => s.visao.camera === "interna");
  const hora = useApp((s) => s.visao.horaSol);
  const planta = useApp((s) => s.projeto.planta);
  const e = enquadramento(planta);
  const textura = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = LARGURA;
    c.height = ALTURA;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }, []);
  useEffect(() => {
    const { ceu, dia } = condicaoDeLuz(hora);
    pintarCeu((textura.image as HTMLCanvasElement).getContext("2d")!, ceu.topo, ceu.horizonte, ceu.baixo, dia);
    textura.needsUpdate = true;
  }, [hora, textura]);
  useEffect(() => () => textura.dispose(), [textura]);
  if (!interna) return null;
  return (
    <mesh position={[e.cx, 1.5, e.cz]} scale={[-1, 1, 1]} renderOrder={-10}>
      <sphereGeometry args={[150, 48, 24]} />
      <meshBasicMaterial map={textura} side={THREE.BackSide} depthWrite={false} fog={false} toneMapped={false} />
    </mesh>
  );
}
