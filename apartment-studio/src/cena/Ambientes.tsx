import { useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { FORCA_PLAFON } from "../catalogo/catalogo";
import { ambienteTemLuzDeTeto } from "../catalogo/luzes";
import { useApp } from "../estado/store";
import { centroide, pontosAmbiente } from "../modelo/geometria";
import type { Ambiente, MaterialPiso, Planta } from "../modelo/tipos";
import { luzesAcesas } from "./luz";
import { COR_SELECAO, M } from "./util";

const LADO_PISO = 60; // cm — porcelanato 60 × 60 (a planta não informa o formato; estimado)

const texturasPiso = new Map<MaterialPiso, THREE.CanvasTexture>();

/**
 * Texturas de piso em tons quase brancos (a cor do ambiente multiplica). As coordenadas de textura do piso
 * são a própria posição em metros, então `repeat` = 1 / tamanho real do desenho.
 */
function texturaPiso(material: MaterialPiso): THREE.CanvasTexture {
  const pronta = texturasPiso.get(material);
  if (pronta) return pronta;
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  let s = 11;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let larguraM = 2.4;
  let alturaM = 2.4;
  if (material === "madeira") {
    // réguas de 20 × 120 cm, com as emendas desencontradas: 8 réguas (1,6 m) × 2 comprimentos (2,4 m)
    c.width = 512;
    c.height = 768;
    larguraM = 1.6;
    alturaM = 2.4;
    const lw = c.width / 8;
    for (let i = 0; i < 8; i++) {
      const desloc = rnd() * c.height;
      for (let j = -1; j < 3; j++) {
        const y = j * (c.height / 2) + desloc;
        const v = 205 + Math.round(rnd() * 45);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(i * lw, y, lw, c.height / 2);
        // veios ao longo da régua
        for (let k = 0; k < 14; k++) {
          g.strokeStyle = `rgba(90,70,50,${0.05 + rnd() * 0.08})`;
          g.lineWidth = 0.6 + rnd();
          const x = i * lw + rnd() * lw;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + (rnd() - 0.5) * 5, y + c.height / 2);
          g.stroke();
        }
        g.fillStyle = "rgba(40,30,20,0.35)";
        g.fillRect(i * lw, y, lw, 1.5);
      }
      g.fillStyle = "rgba(40,30,20,0.3)";
      g.fillRect(i * lw, 0, 1.5, c.height);
    }
  } else if (material === "cimento") {
    c.width = c.height = 512;
    larguraM = alturaM = 3;
    g.fillStyle = "#f0f0f0";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 300; i++) {
      const x = rnd() * 512;
      const y = rnd() * 512;
      const r = 18 + rnd() * 80;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const v = rnd() > 0.5 ? 255 : 140;
      grad.addColorStop(0, `rgba(${v},${v},${v},${0.05 + rnd() * 0.08})`);
      grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  } else {
    // porcelanato: 4 × 4 peças quase brancas com junta fina
    const n = 4;
    const px = 128;
    c.width = c.height = n * px;
    larguraM = alturaM = (n * LADO_PISO) / 100;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = 244 + Math.round(rnd() * 10);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(i * px, j * px, px, px);
      }
    }
    g.strokeStyle = "rgba(60,60,60,0.28)";
    g.lineWidth = 1.5;
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * px, 0);
      g.lineTo(i * px, n * px);
      g.moveTo(0, i * px);
      g.lineTo(n * px, i * px);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.repeat.set(1 / larguraM, 1 / alturaM);
  texturasPiso.set(material, t);
  return t;
}

/** Brilho de cada piso: porcelanato polido reflete as janelas; madeira é acetinada; cimento, fosco. */
const BRILHO_PISO: Record<MaterialPiso, { roughness: number; envMapIntensity: number }> = {
  porcelanato: { roughness: 0.24, envMapIntensity: 1.2 },
  madeira: { roughness: 0.5, envMapIntensity: 1 },
  cimento: { roughness: 0.75, envMapIntensity: 0.8 },
};

/** Cor padrão de cada material, usada quando o ambiente não tem cor de piso própria. */
export const COR_PISO_PADRAO: Record<MaterialPiso, string> = { porcelanato: "#cfc6ba", madeira: "#c79f72", cimento: "#b4b2ae" };

const plafonGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.03, 32);

function AmbienteMesh({ planta, amb }: { planta: Planta; amb: Ambiente }) {
  const selecionado = useApp((s) => s.selecao?.tipo === "ambiente" && s.selecao.id === amb.id);
  const selecionar = useApp((s) => s.selecionar);
  const teto = useApp((s) => s.visao.teto);
  const camera = useApp((s) => s.visao.camera);
  const luz = useApp((s) => luzesAcesas(s.visao));
  // ambiente sem luminária de teto própria ganha um plafon no centro
  const plafon = useApp((s) => !amb.externo && !ambienteTemLuzDeTeto(s.projeto, amb));

  const dados = useMemo(() => {
    const pts = pontosAmbiente(planta, amb);
    const forma = (inverterY: boolean) =>
      new THREE.Shape(pts.map((p) => new THREE.Vector2(M(p.x), M(inverterY ? -p.y : p.y))));
    return {
      piso: new THREE.ShapeGeometry(forma(true)),
      teto: new THREE.ShapeGeometry(forma(false)),
      centro: centroide(pts),
    };
  }, [planta, amb]);

  const aoClicar = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 5) return; // foi arraste de câmera, não clique
    selecionar({ tipo: "ambiente", id: amb.id });
  };
  const pe = M(planta.peDireito.valor);
  const material: MaterialPiso = amb.pisoMaterial ?? "porcelanato";
  const comTeto = (teto || camera === "interna") && !amb.externo;

  return (
    <group>
      {/* piso: forma rotacionada −90° em X (y da planta vira z da cena) */}
      <mesh geometry={dados.piso} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow onClick={aoClicar}>
        <meshStandardMaterial
          key={material}
          map={texturaPiso(material)}
          color={amb.piso ?? COR_PISO_PADRAO[material]}
          {...BRILHO_PISO[material]}
          emissive={selecionado ? COR_SELECAO : "#000"}
          emissiveIntensity={selecionado ? 0.22 : 0}
        />
      </mesh>
      {/* teto: virado para baixo; visto de cima a face é descartada (efeito "casa de bonecas") */}
      {comTeto && (
        <mesh geometry={dados.teto} rotation={[Math.PI / 2, 0, 0]} position={[0, pe, 0]} castShadow={camera === "interna"} receiveShadow>
          <meshStandardMaterial color="#fbfaf7" roughness={0.95} side={THREE.FrontSide} />
        </mesh>
      )}
      {/* plafon no centro do ambiente; acende com o botão Luzes */}
      {plafon && comTeto && camera === "interna" && (
        <mesh geometry={plafonGeo} position={[M(dados.centro.x), pe - 0.015, M(dados.centro.y)]}>
          <meshStandardMaterial color={luz ? "#fffaf0" : "#ebe8e1"} emissive="#ffe9c4" emissiveIntensity={luz ? 2.4 : 0} roughness={0.5} />
        </mesh>
      )}
      {plafon && luz && <pointLight position={[M(dados.centro.x), pe - 0.4, M(dados.centro.y)]} color="#ffdfb5" intensity={FORCA_PLAFON} distance={7} decay={2} />}
    </group>
  );
}

export function Ambientes() {
  const planta = useApp((s) => s.projeto.planta);
  return (
    <group name="ambientes">
      {planta.ambientes.map((a) => (
        <AmbienteMesh key={a.id} planta={planta} amb={a} />
      ))}
    </group>
  );
}
