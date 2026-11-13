import { useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useApp } from "../estado/store";
import { centroide, pontosAmbiente } from "../modelo/geometria";
import type { Ambiente, Planta } from "../modelo/tipos";
import { COR_SELECAO, M } from "./util";

const LADO_PISO = 60; // cm — porcelanato 60 × 60 (a planta não informa o formato; estimado)

/** Porcelanato: 4 × 4 peças quase brancas com junta fina; a cor vem do ambiente (multiplica a textura). */
let texturaPiso: THREE.CanvasTexture | null = null;
function porcelanato(): THREE.CanvasTexture {
  if (texturaPiso) return texturaPiso;
  const n = 4;
  const px = 128;
  const c = document.createElement("canvas");
  c.width = c.height = n * px;
  const g = c.getContext("2d")!;
  let s = 11;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  // as coordenadas de textura do piso são a própria posição em metros
  t.repeat.set(100 / (n * LADO_PISO), 100 / (n * LADO_PISO));
  texturaPiso = t;
  return t;
}

const plafonGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.03, 32);

function AmbienteMesh({ planta, amb }: { planta: Planta; amb: Ambiente }) {
  const selecionado = useApp((s) => s.selecao?.tipo === "ambiente" && s.selecao.id === amb.id);
  const selecionar = useApp((s) => s.selecionar);
  const teto = useApp((s) => s.visao.teto);
  const camera = useApp((s) => s.visao.camera);
  const luz = useApp((s) => s.visao.luzArtificial);

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
  const comTeto = (teto || camera === "interna") && !amb.externo;

  return (
    <group>
      {/* piso: forma rotacionada −90° em X (y da planta vira z da cena) */}
      <mesh geometry={dados.piso} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow onClick={aoClicar}>
        <meshStandardMaterial
          map={porcelanato()}
          color={selecionado ? COR_SELECAO : (amb.piso ?? "#cfc6ba")}
          roughness={0.32}
          emissive={selecionado ? COR_SELECAO : "#000"}
          emissiveIntensity={selecionado ? 0.15 : 0}
        />
      </mesh>
      {/* teto: virado para baixo; visto de cima a face é descartada (efeito "casa de bonecas") */}
      {comTeto && (
        <mesh geometry={dados.teto} rotation={[Math.PI / 2, 0, 0]} position={[0, pe, 0]}>
          <meshStandardMaterial color="#fbfaf7" roughness={0.95} side={THREE.FrontSide} />
        </mesh>
      )}
      {/* plafon no centro do ambiente; acende com o botão Luzes */}
      {comTeto && camera === "interna" && (
        <mesh geometry={plafonGeo} position={[M(dados.centro.x), pe - 0.015, M(dados.centro.y)]}>
          <meshStandardMaterial color="#fffaf0" emissive="#ffe9c4" emissiveIntensity={luz ? 1.6 : 0.05} roughness={0.4} />
        </mesh>
      )}
      {luz && !amb.externo && (
        <pointLight position={[M(dados.centro.x), pe - 0.3, M(dados.centro.y)]} color="#ffdfb5" intensity={9} distance={7} decay={1.8} />
      )}
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
