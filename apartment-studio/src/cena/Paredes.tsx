import { useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useApp } from "../estado/store";
import { anguloParede, comprimento, extensoesParede, extremos, recortarTrechos, trechosParede } from "../modelo/geometria";
import type { Parede, Planta } from "../modelo/tipos";
import { COR_SELECAO, M } from "./util";

const ALTURA_RECORTE = 100; // cm — modo "dollhouse"
const ALTURA_OCULTA = 6; // cm — só o rodapé, para enxergar o desenho

// Topo das paredes escuro, como o corte de uma maquete: dá leitura da planta nas vistas de fora.
const matTopo = new THREE.MeshStandardMaterial({ color: "#4b4e53", roughness: 0.9 });
const lados = new Map<string, THREE.MeshStandardMaterial>();
function materiaisParede(cor: string): THREE.Material[] {
  let lado = lados.get(cor);
  if (!lado) {
    lado = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.92 });
    lados.set(cor, lado);
  }
  // ordem das faces da caixa: +x, −x, +y (topo), −y, +z, −z
  return [lado, lado, matTopo, lado, lado, lado];
}

function ParedeMesh({ planta, parede }: { planta: Planta; parede: Parede }) {
  const selecionada = useApp((s) => s.selecao?.tipo === "parede" && s.selecao.id === parede.id);
  const modo = useApp((s) => s.visao.paredes);
  const camera = useApp((s) => s.visao.camera);
  const selecionar = useApp((s) => s.selecionar);

  const geo = useMemo(() => {
    const [a, b] = extremos(planta, parede);
    const L = comprimento(a, b);
    const altura = parede.altura?.valor ?? planta.peDireito.valor;
    const esp = parede.espessura.valor;
    const aberturas = planta.aberturas.filter((ab) => ab.paredeId === parede.id);
    const [e0, e1] = extensoesParede(planta, parede);
    const trechos = trechosParede(L, altura, aberturas, e0, e1);
    return { a, ang: anguloParede(a, b), esp, trechos };
  }, [planta, parede]);

  // Na câmera interna as paredes ficam sempre inteiras.
  const modoEfetivo = camera === "interna" ? "inteiras" : modo;
  const trechos =
    modoEfetivo === "inteiras"
      ? geo.trechos
      : recortarTrechos(geo.trechos, modoEfetivo === "recortadas" ? ALTURA_RECORTE : ALTURA_OCULTA);

  // na vista de planta, paredes escuras como no desenho técnico
  const corBase = camera === "superior" ? (parede.tipo === "guarda-corpo" ? "#8a8d92" : "#4b4e53") : parede.tipo === "guarda-corpo" ? "#e9e6e0" : (parede.cor ?? "#f3f0ea");
  const cor = selecionada ? COR_SELECAO : corBase;

  const materiais = materiaisParede(cor);

  const aoClicar = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 5) return; // foi arraste de câmera, não clique
    selecionar({ tipo: "parede", id: parede.id });
  };

  return (
    <group position={[M(geo.a.x), 0, M(geo.a.y)]} rotation={[0, -geo.ang, 0]} onClick={aoClicar}>
      {trechos.map((t, i) => (
        <mesh
          key={i}
          position={[M((t.u0 + t.u1) / 2), M((t.v0 + t.v1) / 2), 0]}
          material={materiais}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[M(t.u1 - t.u0), M(t.v1 - t.v0), M(geo.esp)]} />
        </mesh>
      ))}
    </group>
  );
}

export function Paredes() {
  const planta = useApp((s) => s.projeto.planta);
  return (
    <group name="paredes">
      {planta.paredes.map((p) => (
        <ParedeMesh key={p.id} planta={planta} parede={p} />
      ))}
    </group>
  );
}
