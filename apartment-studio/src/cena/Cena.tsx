import { useMemo } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { useApp } from "../estado/store";
import { Aberturas } from "./Aberturas";
import { Ambientes } from "./Ambientes";
import { Cameras } from "./Cameras";
import { ProjetorRotulos } from "./Rotulos";
import { Paredes } from "./Paredes";
import { MarcadoresCalibracao, Referencia } from "./Referencia";
import { enquadramento } from "./util";

/** Sol em arco leste→oeste conforme a hora (6h–18h). Norte da planta ainda não informado. */
function Sol() {
  // na vista de planta, sombras longas atrapalham a leitura: desliga
  const sombras = useApp((s) => s.visao.camera !== "superior");
  const planta = useApp((s) => s.projeto.planta);
  const hora = useApp((s) => s.visao.horaSol);
  const e = enquadramento(planta);
  const pos = useMemo(() => {
    const t = THREE.MathUtils.clamp((hora - 6) / 12, 0, 1); // 0 = nascente, 1 = poente
    const az = Math.PI * t;
    const alt = Math.sin(Math.PI * t) * 1.1 + 0.15;
    const r = 25;
    return new THREE.Vector3(e.cx + Math.cos(az) * r, Math.sin(alt) * r, e.cz + 10);
  }, [hora, e.cx, e.cz]);
  const alvo = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(e.cx, 0, e.cz);
    return o;
  }, [e.cx, e.cz]);
  const lado = e.raio + 3;
  const intensidade = hora < 7 || hora > 17 ? 1.4 : 2.6;
  const cor = hora < 8 || hora > 16 ? "#ffd4a3" : "#fff6e8";
  return (
    <>
      <primitive object={alvo} />
      <directionalLight
        position={pos}
        target={alvo}
        intensity={intensidade}
        color={cor}
        castShadow={sombras}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-lado}
        shadow-camera-right={lado}
        shadow-camera-top={lado}
        shadow-camera-bottom={-lado}
        shadow-camera-near={1}
        shadow-camera-far={70}
      />
    </>
  );
}

function Terreno() {
  const planta = useApp((s) => s.projeto.planta);
  const selecionar = useApp((s) => s.selecionar);
  const e = enquadramento(planta);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[e.cx, -0.01, e.cz]} receiveShadow onClick={() => selecionar(null)}>
      <planeGeometry args={[80, 80]} />
      <meshStandardMaterial color="#d7d9d6" roughness={1} />
    </mesh>
  );
}

function Grade() {
  const planta = useApp((s) => s.projeto.planta);
  const e = enquadramento(planta);
  // 1 quadrado = 1 m
  return <gridHelper args={[40, 40, "#c9ced4", "#dde1e5"]} position={[e.cx, -0.005, e.cz]} />;
}

export function Cena() {
  const camera = useApp((s) => s.visao.camera);
  const fundo = camera === "superior" ? "#eef0f2" : "#dfe6ec";
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
      onPointerMissed={() => useApp.getState().selecionar(null)}
    >
      <color attach="background" args={[fundo]} />
      <hemisphereLight args={["#eaf2ff", "#9c8f80", 0.9]} />
      <ambientLight intensity={0.25} />
      <Sol />
      <Cameras />
      <Terreno />
      {camera === "superior" && <Grade />}
      <Ambientes />
      <Paredes />
      <Aberturas />
      <Referencia />
      <MarcadoresCalibracao />
      <ProjetorRotulos />
    </Canvas>
  );
}
