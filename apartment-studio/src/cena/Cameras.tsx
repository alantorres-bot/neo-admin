import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useApp } from "../estado/store";
import { pontoDeVista, pontosAmbiente } from "../modelo/geometria";
import { enquadramento, M } from "./util";

const ALTURA_OLHOS = 1.6; // m

export function Cameras() {
  const modo = useApp((s) => s.visao.camera);
  if (modo === "superior") return <CameraSuperior />;
  if (modo === "interna") return <CameraInterna />;
  return <CameraPerspectiva />;
}

function CameraPerspectiva() {
  const planta = useApp((s) => s.projeto.planta);
  const e = enquadramento(planta);
  const d = e.raio * 2.1;
  return (
    <>
      <PerspectiveCamera makeDefault fov={45} position={[e.cx + d * 0.55, d * 0.85, e.cz + d * 0.85]} near={0.05} far={300} />
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
  const margem = 1.25;
  const zoom = Math.min(size.width / (e.larg * margem), size.height / (e.prof * margem));
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

/** Câmera na altura dos olhos: arrastar para olhar em volta, WASD/setas para andar. */
function CameraInterna() {
  const planta = useApp((s) => s.projeto.planta);
  const ambienteId = useApp((s) => s.visao.ambienteInterno);
  const camRef = useRef<THREE.PerspectiveCamera>(null);
  const olhar = useRef({ yaw: 0, pitch: -0.08 });
  const teclas = useRef(new Set<string>());
  const { gl } = useThree();

  // posiciona no fundo do ambiente, olhando para a maior profundidade (enquadramento de foto de imóvel)
  useEffect(() => {
    const amb = planta.ambientes.find((a) => a.id === ambienteId) ?? planta.ambientes[0];
    const cam = camRef.current;
    if (!amb || !cam) return;
    const pv = pontoDeVista(pontosAmbiente(planta, amb));
    cam.position.set(M(pv.x), ALTURA_OLHOS, M(pv.y));
    // olhar para (dx, dy) da planta: frente da câmera = (−sen yaw, −cos yaw)
    olhar.current.yaw = Math.atan2(-pv.dx, -pv.dy);
    olhar.current.pitch = -0.08;
  }, [ambienteId, planta]);

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
    };
    const up = () => (arrastando = false);
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      teclas.current.add(e.key.toLowerCase());
    };
    const ku = (e: KeyboardEvent) => teclas.current.delete(e.key.toLowerCase());
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, [gl]);

  useFrame((_, dt) => {
    const cam = camRef.current;
    if (!cam) return;
    const { yaw, pitch } = olhar.current;
    cam.rotation.set(pitch, yaw, 0, "YXZ");
    const t = teclas.current;
    const frente = (t.has("w") || t.has("arrowup") ? 1 : 0) - (t.has("s") || t.has("arrowdown") ? 1 : 0);
    const lado = (t.has("d") || t.has("arrowright") ? 1 : 0) - (t.has("a") || t.has("arrowleft") ? 1 : 0);
    if (frente || lado) {
      const v = 1.6 * Math.min(dt, 0.05);
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      cam.position.x += (fx * frente + -fz * lado) * v;
      cam.position.z += (fz * frente + fx * lado) * v;
    }
  });

  return <PerspectiveCamera ref={camRef} makeDefault fov={72} near={0.05} far={200} />;
}
