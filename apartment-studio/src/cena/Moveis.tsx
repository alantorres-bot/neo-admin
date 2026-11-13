import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { itemCatalogo, opcoesDoMovel, slotsDoMovel } from "../catalogo/catalogo";
import { pecasDoMovel } from "../catalogo/formas";
import { useApp } from "../estado/store";
import { conflitosDoMovel, encaixar } from "../modelo/moveis";
import type { Movel, Projeto } from "../modelo/tipos";
import { geometriaDaPeca, materialDaPeca, tamanhoReal } from "./materiais";
import { COR_SELECAO, M } from "./util";

const RAD = Math.PI / 180;
const ALTURA_CORTE = 100; // nos modos de parede recortada/oculta, some o que fica pendurado acima disso

const contornoGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const matSelecao = new THREE.LineBasicMaterial({ color: COR_SELECAO });
const matConflito = new THREE.LineBasicMaterial({ color: "#e0364f" });

/** As peças do móvel (só refaz quando forma, medidas, opções ou cores mudam — não ao mover). */
const Pecas = memo(function Pecas({ movel }: { movel: Movel }) {
  const { catalogoId, largura, profundidade, altura, opcoes, cores, acabamentos } = movel;
  const pecas = useMemo(() => {
    const item = itemCatalogo(catalogoId);
    if (!item) return [];
    const slots = slotsDoMovel({ catalogoId, cores, acabamentos });
    return pecasDoMovel(item.forma, { L: largura, P: profundidade, A: altura }, opcoesDoMovel({ catalogoId, opcoes })).map((p) => {
      const slot = slots[p.slot] ?? { cor: "#bdbdbd", acabamento: "liso" as const };
      return { p, geo: geometriaDaPeca(p), mat: materialDaPeca(p, slot.cor, slot.acabamento), transparente: slot.acabamento === "vidro" };
    });
  }, [catalogoId, largura, profundidade, altura, opcoes, cores, acabamentos]);

  return (
    <>
      {pecas.map(({ p, geo, mat, transparente }, i) => (
        <mesh
          key={i}
          geometry={geo}
          material={mat}
          position={[M(p.p[0]), M(p.p[1]), M(p.p[2])]}
          rotation={p.r ? [p.r[0] * RAD, p.r[1] * RAD, p.r[2] * RAD] : undefined}
          scale={tamanhoReal(p) ? undefined : [M(p.s[0]), M(p.s[1]), p.g === "plano" ? 1 : M(p.s[2])]}
          castShadow={!transparente && p.g !== "plano"}
          receiveShadow={!transparente}
        />
      ))}
    </>
  );
}, (a, b) =>
  a.movel.catalogoId === b.movel.catalogoId &&
  a.movel.largura === b.movel.largura &&
  a.movel.profundidade === b.movel.profundidade &&
  a.movel.altura === b.movel.altura &&
  a.movel.opcoes === b.movel.opcoes &&
  a.movel.cores === b.movel.cores &&
  a.movel.acabamentos === b.movel.acabamentos,
);

function MovelMesh({ movel }: { movel: Movel }) {
  const selecionado = useApp((s) => s.selecao?.tipo === "movel" && s.selecao.id === movel.id);
  const camera = useApp((s) => s.visao.camera);
  const controles = useThree((s) => s.controls) as { enabled: boolean } | null;
  const arrasto = useRef<{ dx: number; dy: number; antes: Projeto; moveu: boolean } | null>(null);

  const emConflito = useApp((s) => (selecionado ? conflitosDoMovel(s.projeto, movel).length > 0 : false));

  const noPlano = (e: ThreeEvent<PointerEvent>) => {
    const h = M(movel.elevacao);
    const d = e.ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    const t = (h - e.ray.origin.y) / d.y;
    if (t < 0) return null;
    return { x: (e.ray.origin.x + d.x * t) * 100, y: (e.ray.origin.z + d.z * t) * 100 };
  };

  const aoClicar = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 5) return;
    useApp.getState().selecionar({ tipo: "movel", id: movel.id });
  };

  // Arrastar só o móvel já selecionado: o primeiro toque seleciona, o segundo move (evita mover sem querer ao girar a câmera).
  const aoApertar = (e: ThreeEvent<PointerEvent>) => {
    if (!selecionado || movel.travado || camera === "interna" || e.button > 0) return;
    const p = noPlano(e);
    if (!p) return;
    e.stopPropagation();
    (e.target as unknown as Element).setPointerCapture(e.pointerId);
    arrasto.current = { dx: movel.x - p.x, dy: movel.y - p.y, antes: useApp.getState().projeto, moveu: false };
    if (controles) controles.enabled = false;
  };
  const aoMover = (e: ThreeEvent<PointerEvent>) => {
    const a = arrasto.current;
    if (!a) return;
    e.stopPropagation();
    const p = noPlano(e);
    if (!p) return;
    const estado = useApp.getState();
    const atual = estado.projeto.moveis.find((m) => m.id === movel.id);
    if (!atual) return;
    const alvo = encaixar(estado.projeto, atual, p.x + a.dx, p.y + a.dy);
    if (alvo.x !== atual.x || alvo.y !== atual.y) {
      a.moveu = true;
      estado.moverMovelAoVivo(movel.id, alvo.x, alvo.y);
    }
  };
  const aoSoltar = (e: ThreeEvent<PointerEvent>) => {
    const a = arrasto.current;
    if (!a) return;
    arrasto.current = null;
    e.stopPropagation();
    (e.target as unknown as Element).releasePointerCapture(e.pointerId);
    if (controles) controles.enabled = true;
    if (a.moveu) useApp.getState().registrarPasso(`Mover ${movel.nome.toLowerCase()}`, a.antes);
  };

  return (
    <group
      position={[M(movel.x), M(movel.elevacao), M(movel.y)]}
      rotation={[0, movel.rotacao * RAD, 0]}
      onClick={aoClicar}
      onPointerDown={aoApertar}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
      onPointerCancel={aoSoltar}
    >
      <Pecas movel={movel} />
      {selecionado && (
        <lineSegments
          geometry={contornoGeo}
          material={emConflito ? matConflito : matSelecao}
          position={[0, M(movel.altura) / 2, 0]}
          scale={[M(movel.largura) + 0.02, M(movel.altura) + 0.02, M(movel.profundidade) + 0.02]}
          renderOrder={5}
        />
      )}
    </group>
  );
}

export function Moveis() {
  const moveis = useApp((s) => s.projeto.moveis);
  const visivel = useApp((s) => s.visao.moveis);
  const cortar = useApp((s) => s.visao.camera !== "interna" && s.visao.paredes !== "inteiras");
  if (!visivel) return null;
  return (
    <group name="moveis">
      {moveis.map((m) => (cortar && m.elevacao >= ALTURA_CORTE ? null : <MovelMesh key={m.id} movel={m} />))}
    </group>
  );
}
