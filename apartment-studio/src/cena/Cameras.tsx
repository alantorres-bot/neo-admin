import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useApp } from "../estado/store";
import { pontoDeVista, pontosAmbiente } from "../modelo/geometria";
import { andar } from "./andar";
import { enquadramento, M } from "./util";

const ALTURA_OLHOS = 1.6; // m

export function Cameras() {
  const modo = useApp((s) => s.visao.camera);
  if (modo === "superior") return <CameraSuperior />;
  if (modo === "interna") return <CameraInterna />;
  return <CameraPerspectiva />;
}

/** Largura ocupada pelos painéis laterais (desktop) — a cena enquadra a área livre. */
function areaLivre(largura: number) {
  return largura > 900 ? largura - 640 : largura;
}

function CameraPerspectiva() {
  const planta = useApp((s) => s.projeto.planta);
  const e = enquadramento(planta);
  const { size } = useThree();
  // em tela estreita (celular em pé) afasta mais para caber a largura do apartamento
  const proporcao = areaLivre(size.width) / Math.max(1, size.height);
  const d = e.raio * (proporcao < 0.9 ? 3.4 : 2.3);
  return (
    <>
      <PerspectiveCamera makeDefault fov={45} position={[e.cx + d * 0.3, d * 1.05, e.cz + d * 0.8]} near={0.05} far={300} />
      <OrbitControls
        makeDefault
        target={[e.cx, 0.6, e.cz]}
        enableDamping
        dampingFactor={0.12}
        maxPolarAngle={Math.PI / 2 - 0.02}
        minDistance={1.5}
        maxDistance={60}
      />
    </>
  );
}

function CameraSuperior() {
  const planta = useApp((s) => s.projeto.planta);
  const e = enquadramento(planta);
  const { size } = useThree();
  const zoom = Math.min(areaLivre(size.width) / (e.larg * 1.12), (size.height - 90) / (e.prof * 1.12));
  return (
    <>
      <OrthographicCamera makeDefault position={[e.cx, 40, e.cz + 0.0001]} zoom={zoom} near={0.1} far={200} />
      <OrbitControls
        makeDefault
        target={[e.cx, 0, e.cz]}
        enableRotate={false}
        screenSpacePanning
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </>
  );
}

/**
 * Câmera na altura dos olhos. Parte de uma vista salva (botões Sala, Cozinha, Suíte…) ou, sem vista,
 * do fundo do ambiente escolhido. Arrastar olha em volta; W A S D, setas ou os botões na tela andam.
 */
function CameraInterna() {
  const planta = useApp((s) => s.projeto.planta);
  const vistas = useApp((s) => s.projeto.vistas);
  const ambienteId = useApp((s) => s.visao.ambienteInterno);
  const vistaId = useApp((s) => s.visao.vistaId);
  const camRef = useRef<THREE.PerspectiveCamera>(null);
  const olhar = useRef({ yaw: 0, pitch: -0.08 });
  const teclas = useRef(new Set<string>());
  const gl = useThree((s) => s.gl);
  const invalidar = useThree((s) => s.invalidate);
  const tamanho = useThree((s) => s.size);
  // com a tela em pé (celular), abre o campo de visão vertical para não cortar as laterais do cômodo
  const proporcao = tamanho.width / Math.max(1, tamanho.height);
  const fov = proporcao >= 1.2 ? 72 : THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(40)) / proporcao)), 72, 98);

  useEffect(() => {
    const cam = camRef.current;
    if (!cam) return;
    const vista = vistaId ? vistas.find((v) => v.id === vistaId) : undefined;
    if (vista) {
      cam.position.set(M(vista.de.x), M(vista.de.altura), M(vista.de.y));
      const dx = vista.para.x - vista.de.x;
      const dz = vista.para.y - vista.de.y;
      // frente da câmera = (−sen yaw, −cos yaw)
      olhar.current.yaw = Math.atan2(-dx, -dz);
      olhar.current.pitch = Math.atan2(vista.para.altura - vista.de.altura, Math.hypot(dx, dz));
    } else {
      const amb = planta.ambientes.find((a) => a.id === ambienteId) ?? planta.ambientes[0];
      if (!amb) return;
      const pv = pontoDeVista(pontosAmbiente(planta, amb));
      cam.position.set(M(pv.x), ALTURA_OLHOS, M(pv.y));
      olhar.current.yaw = Math.atan2(-pv.dx, -pv.dy);
      olhar.current.pitch = -0.08;
    }
    invalidar();
    // a planta não entra nas dependências: editar um móvel não deve reposicionar a câmera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambienteId, vistaId]);

  useEffect(() => {
    const el = gl.domElement;
    let arrastando = false;
    let ultimo = { x: 0, y: 0 };
    const down = (e: PointerEvent) => {
      arrastando = true;
      ultimo = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!arrastando) return;
      olhar.current.yaw += (e.clientX - ultimo.x) * 0.004;
      olhar.current.pitch = THREE.MathUtils.clamp(olhar.current.pitch + (e.clientY - ultimo.y) * 0.004, -1.3, 1.3);
      ultimo = { x: e.clientX, y: e.clientY };
      invalidar();
    };
    const up = () => (arrastando = false);
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      teclas.current.add(e.key.toLowerCase());
      invalidar();
    };
    const ku = (e: KeyboardEvent) => teclas.current.delete(e.key.toLowerCase());
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      andar.frente = 0;
      andar.lado = 0;
    };
  }, [gl, invalidar]);

  useFrame((estado, dt) => {
    const cam = camRef.current;
    if (!cam) return;
    const { yaw, pitch } = olhar.current;
    cam.rotation.set(pitch, yaw, 0, "YXZ");
    const t = teclas.current;
    const frente = (t.has("w") || t.has("arrowup") ? 1 : 0) - (t.has("s") || t.has("arrowdown") ? 1 : 0) + andar.frente;
    const lado = (t.has("d") || t.has("arrowright") ? 1 : 0) - (t.has("a") || t.has("arrowleft") ? 1 : 0) + andar.lado;
    if (frente || lado) {
      const v = 1.6 * Math.min(dt, 0.05);
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      cam.position.x += (fx * frente + -fz * lado) * v;
      cam.position.z += (fz * frente + fx * lado) * v;
      estado.invalidate(); // segue andando enquanto a tecla/botão estiver apertado
    }
  });

  return <PerspectiveCamera ref={camRef} makeDefault fov={fov} near={0.05} far={200} />;
}
