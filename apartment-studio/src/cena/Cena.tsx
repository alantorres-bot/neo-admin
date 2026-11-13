import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useApp } from "../estado/store";
import { useTema } from "../ui/tema";
import { Aberturas } from "./Aberturas";
import { Ambientes } from "./Ambientes";
import { Cameras } from "./Cameras";
import { Moveis } from "./Moveis";
import { Paredes } from "./Paredes";
import { MarcadoresCalibracao, Referencia } from "./Referencia";
import { ProjetorRotulos } from "./Rotulos";
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
    return new THREE.Vector3(e.cx + Math.cos(az) * r, Math.sin(alt) * r, e.cz - 10);
  }, [hora, e.cx, e.cz]);
  const alvo = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(e.cx, 0, e.cz);
    return o;
  }, [e.cx, e.cz]);
  const lado = e.raio + 3;
  const intensidade = hora < 7 || hora > 17 ? 1.0 : 1.55;
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

/** Iluminação ambiente suave (sala neutra gerada por código): dá reflexo a inox, vidro e espelho. */
function LuzAmbiente() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidar = useThree((s) => s.invalidate);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.5;
    invalidar();
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidar]);
  return null;
}

function Terreno() {
  const planta = useApp((s) => s.projeto.planta);
  const selecionar = useApp((s) => s.selecionar);
  const e = enquadramento(planta);
  const escuro = useTema() === "escuro";
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[e.cx, -0.01, e.cz]} receiveShadow onClick={(ev) => ev.delta <= 5 && selecionar(null)}>
      <planeGeometry args={[80, 80]} />
      <meshStandardMaterial color={escuro ? "#3a424d" : "#cdd0d0"} roughness={1} />
    </mesh>
  );
}

function Grade() {
  const planta = useApp((s) => s.projeto.planta);
  const e = enquadramento(planta);
  const escuro = useTema() === "escuro";
  // 1 quadrado = 1 m
  return <gridHelper key={escuro ? "e" : "c"} args={[40, 40, escuro ? "#56606c" : "#c9ced4", escuro ? "#454e59" : "#dde1e5"]} position={[e.cx, -0.005, e.cz]} />;
}

export function Cena() {
  const camera = useApp((s) => s.visao.camera);
  const escuro = useTema() === "escuro";
  const fundo = escuro ? (camera === "superior" ? "#20262e" : "#1d232b") : camera === "superior" ? "#eef0f2" : "#dfe6ec";
  return (
    <Canvas
      shadows
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 0.92;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
      onPointerMissed={(ev) => (ev as MouseEvent).button === 0 && useApp.getState().selecionar(null)}
    >
      <color attach="background" args={[fundo]} />
      <hemisphereLight args={["#eef4ff", "#cfc8bd", 0.5]} />
      <LuzAmbiente />
      <Sol />
      <Cameras />
      <Terreno />
      {camera === "superior" && <Grade />}
      <Ambientes />
      <Paredes />
      <Aberturas />
      <Moveis />
      <Referencia />
      <MarcadoresCalibracao />
      <ProjetorRotulos />
    </Canvas>
  );
}
