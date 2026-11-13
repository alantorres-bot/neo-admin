import { useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useApp } from "../estado/store";
import { centroide, pontosAmbiente } from "../modelo/geometria";
import type { Ambiente, Planta } from "../modelo/tipos";
import { COR_SELECAO, M } from "./util";

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

  return (
    <group>
      {/* piso: forma rotacionada −90° em X (y da planta vira z da cena) */}
      <mesh geometry={dados.piso} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow onClick={aoClicar}>
        <meshStandardMaterial
          color={selecionado ? COR_SELECAO : (amb.piso ?? "#cfc6ba")}
          roughness={amb.tipo === "quarto" ? 0.6 : 0.35}
          emissive={selecionado ? COR_SELECAO : "#000"}
          emissiveIntensity={selecionado ? 0.15 : 0}
        />
      </mesh>
      {/* teto: virado para baixo; visto de cima a face é descartada (efeito "casa de bonecas") */}
      {(teto || camera === "interna") && !amb.externo && (
        <mesh geometry={dados.teto} rotation={[Math.PI / 2, 0, 0]} position={[0, pe, 0]}>
          <meshStandardMaterial color="#fbfaf7" roughness={0.95} side={THREE.FrontSide} />
        </mesh>
      )}
      {luz && !amb.externo && (
        <pointLight
          position={[M(dados.centro.x), pe - 0.25, M(dados.centro.y)]}
          color="#ffd9a8"
          intensity={6}
          distance={8}
          decay={2}
        />
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
