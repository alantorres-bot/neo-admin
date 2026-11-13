import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useApp } from "../estado/store";
import { M } from "./util";

/**
 * Imagem da planta como "decalque" sob o modelo, em escala real (cm por pixel calibrado).
 * Também recebe os cliques da calibração (dois pontos sobre uma cota conhecida).
 */
export function Referencia() {
  const ref = useApp((s) => s.projeto.planta.referencia);
  const camera = useApp((s) => s.visao.camera);
  const calibrando = useApp((s) => s.calibracao.ativa);

  const textura = useMemo(() => {
    if (!ref) return null;
    const t = new THREE.TextureLoader().load(ref.imagem);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [ref?.imagem]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => textura?.dispose(), [textura]);

  if (!ref || !textura || (!ref.visivel && !calibrando) || camera === "interna") return null;

  const w = M(ref.larguraPx * ref.cmPorPx);
  const h = M(ref.alturaPx * ref.cmPorPx);

  const aoClicar = (e: ThreeEvent<MouseEvent>) => {
    const { calibracao, definirCalibracao } = useApp.getState();
    if (!calibracao.ativa) return;
    e.stopPropagation();
    const p = { x: e.point.x * 100, y: e.point.z * 100 };
    const pontos = [...calibracao.pontos, p].slice(-2);
    definirCalibracao({ pontos });
  };

  return (
    <group position={[M(ref.x) + w / 2, 0.012, M(ref.y) + h / 2]} rotation={[0, (-ref.rotacao * Math.PI) / 180, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={aoClicar} renderOrder={2}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={textura} transparent opacity={calibrando ? 1 : ref.opacidade} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function MarcadoresCalibracao() {
  const pontos = useApp((s) => s.calibracao.pontos);
  const ativa = useApp((s) => s.calibracao.ativa);
  if (!ativa) return null;
  return (
    <group>
      {pontos.map((p, i) => (
        <mesh key={i} position={[M(p.x), 0.05, M(p.y)]}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshBasicMaterial color="#ff3b5c" />
        </mesh>
      ))}
    </group>
  );
}
