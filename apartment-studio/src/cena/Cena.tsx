import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useApp } from "../estado/store";
import { useTema } from "../ui/tema";
import { Aberturas } from "./Aberturas";
import { Ambientes } from "./Ambientes";
import { Cameras } from "./Cameras";
import { Ceu } from "./Ceu";
import { condicaoDeLuz, misturar } from "./luz";
import { LuzDasJanelas, LuzesDaCasa } from "./Luzes";
import { luzDoDiaNosTecidos } from "./materiais";
import { Moveis } from "./Moveis";
import { Paredes } from "./Paredes";
import { Realismo } from "./PosProcesso";
import { MarcadoresCalibracao, Referencia } from "./Referencia";
import { ProjetorRotulos } from "./Rotulos";
import { enquadramento } from "./util";

/** Exposição da "câmera": vale com e sem o acabamento realista. */
export const EXPOSICAO = 0.92;

/** Hora usada para iluminar: na vista de planta (desenho técnico) vale sempre o meio-dia. */
function useLuz() {
  const hora = useApp((s) => (s.visao.camera === "superior" ? 12 : s.visao.horaSol));
  return useMemo(() => condicaoDeLuz(hora), [hora]);
}

/** Sol (com sombra) e luar fraco. Por dentro, o teto faz sombra: o sol só entra pelas janelas e pela varanda. */
function Sol() {
  // na vista de planta, sombras longas atrapalham a leitura: desliga
  const sombras = useApp((s) => s.visao.camera !== "superior");
  const planta = useApp((s) => s.projeto.planta);
  const luz = useLuz();
  const e = enquadramento(planta);
  const [dx, dy, dz] = luz.sol.direcao;
  const r = 25;
  const alvo = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(e.cx, 0, e.cz);
    return o;
  }, [e.cx, e.cz]);
  const lado = e.raio + 3;
  return (
    <>
      <primitive object={alvo} />
      <directionalLight
        position={[e.cx + dx * r, dy * r, e.cz + dz * r]}
        target={alvo}
        intensity={luz.sol.intensidade}
        color={luz.sol.cor}
        castShadow={sombras && luz.sol.intensidade > 0.02}
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
      {luz.lua > 0.01 && <directionalLight position={[e.cx - 7, 22, e.cz - 5]} target={alvo} intensity={luz.lua} color="#9db2ff" />}
    </>
  );
}

/** Luz difusa do céu: mais forte por dentro, onde o teto barra o sol direto. */
function LuzDifusa() {
  const interna = useApp((s) => s.visao.camera === "interna");
  const realismo = useApp((s) => s.visao.realismo);
  const luz = useLuz();
  const scene = useThree((s) => s.scene);
  const invalidar = useThree((s) => s.invalidate);
  // por dentro o teto barra o sol: com o acabamento realista a claridade vem das janelas (LuzDasJanelas)
  // e a difusa fica baixa, para haver contraste; sem ele, a difusa sobe para o ambiente não ficar escuro
  const fator = !interna ? 1 : realismo ? 0.9 : 1.6;
  const reflexo = luz.difusa.reflexo * (!interna ? 1 : realismo ? 0.6 : 1.3);
  useEffect(() => {
    scene.environmentIntensity = reflexo;
    luzDoDiaNosTecidos(luz.dia);
    invalidar();
  }, [scene, reflexo, luz.dia, invalidar]);
  return <hemisphereLight args={[luz.difusa.cor, "#cfc8bd", luz.difusa.intensidade * fator]} />;
}

/** Sala neutra gerada por código, usada como reflexo em inox, vidro, pedra e piso. */
function Reflexos() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidar = useThree((s) => s.invalidate);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
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
  const interna = useApp((s) => s.visao.camera === "interna");
  const e = enquadramento(planta);
  const escuro = useTema() === "escuro";
  // por dentro, o que se vê pelas janelas é o céu (o apartamento não fica no chão)
  if (interna) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[e.cx, -0.01, e.cz]} receiveShadow onClick={(ev) => ev.delta <= 5 && selecionar(null)}>
      <planeGeometry args={[80, 80]} />
      <meshStandardMaterial color={escuro ? "#3a424d" : "#c2c6c8"} roughness={1} />
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
  const realismo = useApp((s) => s.visao.realismo);
  const escuro = useTema() === "escuro";
  const luz = useLuz();
  const fundoTema = escuro ? (camera === "superior" ? "#20262e" : "#1d232b") : camera === "superior" ? "#eef0f2" : "#dfe6ec";
  // à noite o fundo escurece, para as luzes da casa aparecerem
  const fundo = misturar("#10151f", fundoTema, luz.dia);
  return (
    <Canvas
      shadows
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onCreated={(estado) => {
        const { gl } = estado;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = EXPOSICAO;
        gl.outputColorSpace = THREE.SRGBColorSpace;
        // medição de desempenho nos testes (só com ?teste na URL — ver main.tsx)
        // (um "getter": a câmera ativa muda quando se troca de vista)
        if ("__estudio" in window) Object.defineProperty(window, "__cena", { configurable: true, get: () => estado.get() });
      }}
      onPointerMissed={(ev) => (ev as MouseEvent).button === 0 && useApp.getState().selecionar(null)}
    >
      <color attach="background" args={[fundo]} />
      <Ceu />
      <Reflexos />
      <LuzDifusa />
      <Sol />
      <LuzesDaCasa />
      <LuzDasJanelas />
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
      {realismo && <Realismo />}
    </Canvas>
  );
}
