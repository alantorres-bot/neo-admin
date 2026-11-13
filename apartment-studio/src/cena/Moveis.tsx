import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { itemCatalogo, opcoesDoMovel, slotsDoMovel } from "../catalogo/catalogo";
import { pecasDoMovel, type Peca } from "../catalogo/formas";
import { useApp } from "../estado/store";
import { conflitosDoMovel, encaixar } from "../modelo/moveis";
import type { Movel, Projeto } from "../modelo/tipos";
import { areaDeEspelho } from "./areaEspelho";
import { EspelhoReal } from "./Espelho";
import { luzesAcesas } from "./luz";
import { geometriaDaPeca, materialDaPeca, tamanhoReal } from "./materiais";
import { COR_SELECAO, M } from "./util";

const RAD = Math.PI / 180;
const ALTURA_CORTE = 100; // nos modos de parede recortada/oculta, some o que fica pendurado acima disso

const contornoGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const matSelecao = new THREE.LineBasicMaterial({ color: COR_SELECAO });
const matConflito = new THREE.LineBasicMaterial({ color: "#e0364f" });

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _escala = new THREE.Vector3();
const _matriz = new THREE.Matrix4();

/** Cópia da geometria da peça já no lugar dela dentro do móvel (posição, giro e tamanho aplicados). */
function geometriaNoLugar(p: Peca): THREE.BufferGeometry {
  const base = geometriaDaPeca(p);
  const g = base.index ? base.toNonIndexed() : base.clone();
  _pos.set(M(p.p[0]), M(p.p[1]), M(p.p[2]));
  _quat.setFromEuler(p.r ? _euler.set(p.r[0] * RAD, p.r[1] * RAD, p.r[2] * RAD) : _euler.set(0, 0, 0));
  if (tamanhoReal(p)) _escala.set(1, 1, 1);
  else _escala.set(M(p.s[0]), M(p.s[1]), p.g === "plano" ? 1 : M(p.s[2]));
  return g.applyMatrix4(_matriz.compose(_pos, _quat, _escala));
}

/**
 * As peças do móvel, juntas numa malha por material (um armário de 30 peças vira 3 ou 4 desenhos em vez de 30:
 * é o que deixa a cena leve no celular). Só refaz quando forma, medidas, opções ou cores mudam — não ao mover.
 */
const Pecas = memo(function Pecas({ movel, aceso }: { movel: Movel; aceso: boolean }) {
  const { catalogoId, largura, profundidade, altura, opcoes, cores, acabamentos } = movel;
  const { malhas, espelho } = useMemo(() => {
    const item = itemCatalogo(catalogoId);
    if (!item) return { malhas: [], espelho: null };
    const frentesEspelhadas: Peca[] = [];
    const slots = slotsDoMovel({ catalogoId, cores, acabamentos });
    const grupos = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; sombra: boolean; recebe: boolean }>();
    for (const p of pecasDoMovel(item.forma, { L: largura, P: profundidade, A: altura }, opcoesDoMovel({ catalogoId, opcoes }))) {
      const slot = slots[p.slot] ?? { cor: "#bdbdbd", acabamento: "liso" as const };
      const mat = materialDaPeca(p, slot.cor, slot.acabamento, aceso);
      const transparente = slot.acabamento === "vidro";
      if (slot.acabamento === "espelho" && p.g === "caixa" && !p.r) frentesEspelhadas.push(p);
      // vidro, figuras recortadas (remo) e cortina não fazem sombra: a cortina é tecido leve, deixa o sol passar
      const sombra = !transparente && p.g !== "plano" && p.g !== "onda";
      const chave = `${mat.uuid}|${sombra ? 1 : 0}`;
      let grupo = grupos.get(chave);
      if (!grupo) grupos.set(chave, (grupo = { mat, geos: [], sombra, recebe: !transparente }));
      grupo.geos.push(geometriaNoLugar(p));
    }
    const prontas = [...grupos.values()].map(({ mat, geos, sombra, recebe }) => {
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      return { mat, geo, sombra, recebe };
    });
    return { malhas: prontas, espelho: areaDeEspelho(frentesEspelhadas) };
  }, [catalogoId, largura, profundidade, altura, opcoes, cores, acabamentos, aceso]);
  useEffect(() => () => malhas.forEach((m) => m.geo.dispose()), [malhas]);

  return (
    <>
      {malhas.map(({ mat, geo, sombra, recebe }, i) => (
        <mesh key={i} geometry={geo} material={mat} castShadow={sombra} receiveShadow={recebe} />
      ))}
      {espelho && <EspelhoReal area={espelho} />}
    </>
  );
}, (a, b) =>
  a.aceso === b.aceso &&
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
  const aceso = useApp((s) => luzesAcesas(s.visao));

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
      <Pecas movel={movel} aceso={aceso} />
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
