import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useApp } from "../estado/store";
import { anguloParede, extremos } from "../modelo/geometria";
import type { Parede, Planta } from "../modelo/tipos";
import { construirParede } from "./geometriaParede";
import { materialDaParede } from "./materiais";
import { COR_SELECAO, M } from "./util";

const ALTURA_RECORTE = 100; // cm — modo "dollhouse"
const ALTURA_OCULTA = 6; // cm — só o traçado, para enxergar o desenho

/**
 * Uma parede = uma malha, com um grupo de faces por material (pintura de cada lado, topo, rodapé).
 * A geometria sai de geometriaParede.ts, em cm; a malha é reduzida para metros.
 */
function ParedeMesh({ planta, parede }: { planta: Planta; parede: Parede }) {
  const selecionada = useApp((s) => s.selecao?.tipo === "parede" && s.selecao.id === parede.id);
  const modo = useApp((s) => s.visao.paredes);
  const camera = useApp((s) => s.visao.camera);
  const selecionar = useApp((s) => s.selecionar);

  // Na câmera interna as paredes ficam sempre inteiras.
  const modoEfetivo = camera === "interna" ? "inteiras" : modo;
  const alturaMaxima = modoEfetivo === "inteiras" ? undefined : modoEfetivo === "recortadas" ? ALTURA_RECORTE : ALTURA_OCULTA;

  const { geo, chaves, a, ang } = useMemo(() => {
    const [pa, pb] = extremos(planta, parede);
    const grupos = construirParede(planta, parede, { alturaMaxima });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(grupos.flatMap((x) => x.posicoes), 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(grupos.flatMap((x) => x.normais), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(grupos.flatMap((x) => x.uvs), 2));
    let inicio = 0;
    grupos.forEach((x, i) => {
      const n = x.posicoes.length / 3;
      g.addGroup(inicio, n, i);
      inicio += n;
    });
    return { geo: g, chaves: grupos.map((x) => x.chave), a: pa, ang: anguloParede(pa, pb) };
  }, [planta, parede, alturaMaxima]);
  useEffect(() => () => geo.dispose(), [geo]);

  // na vista de planta, paredes escuras como no desenho técnico (a selecionada fica azul, para achar no desenho)
  const estado = camera === "superior" ? "planta" : selecionada ? "selecionada" : "normal";
  const corPlanta = selecionada ? COR_SELECAO : parede.tipo === "guarda-corpo" ? "#8a8d92" : undefined;
  const materiais = chaves.map((c) => materialDaParede(c, estado, corPlanta));

  const aoClicar = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 5) return; // foi arraste de câmera, não clique
    selecionar({ tipo: "parede", id: parede.id });
  };

  return (
    <mesh geometry={geo} material={materiais} position={[M(a.x), 0, M(a.y)]} rotation={[0, -ang, 0]} scale={0.01} castShadow receiveShadow onClick={aoClicar} />
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
