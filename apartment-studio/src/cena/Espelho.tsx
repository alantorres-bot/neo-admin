import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { useApp } from "../estado/store";
import { haParedeEntre } from "../modelo/geometria";
import type { AreaEspelho } from "./areaEspelho";
import { M } from "./util";

/** Até que distância da câmera o espelho reflete de verdade (m); mais longe, fica o acabamento simples. */
const ALCANCE = 5;
const _centro = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _camera = new THREE.Vector3();
const matEmenda = new THREE.MeshStandardMaterial({ color: "#7c8186", roughness: 0.6 });

/**
 * Espelho que reflete o ambiente: a cena é desenhada mais uma vez, do ponto de vista do reflexo, só quando
 * a câmera está por dentro, perto, de frente para ele e sem parede no meio. Fora disso (ou com "Realista"
 * desligado) aparece o acabamento simples que fica logo atrás.
 */
export function EspelhoReal({ area }: { area: AreaEspelho }) {
  const interna = useApp((s) => s.visao.camera === "interna");
  const realismo = useApp((s) => s.visao.realismo);
  const w = area.x1 - area.x0;
  const h = area.y1 - area.y0;
  const espelho = useMemo(() => {
    // o lado maior do reflexo tem 1024 pontos (640 no celular); o menor acompanha a proporção do espelho
    const maior = typeof window !== "undefined" && window.innerWidth < 760 ? 640 : 1024;
    const menor = Math.max(192, Math.round((maior * Math.min(w, h)) / Math.max(w, h)));
    const r = new Reflector(new THREE.PlaneGeometry(M(w), M(h)), {
      clipBias: 0.003,
      textureWidth: w >= h ? maior : menor,
      textureHeight: w >= h ? menor : maior,
      // neutro, um pouco abaixo de 0,5: espelho de verdade devolve ≈ 90% da luz
      color: new THREE.Color().setRGB(0.47, 0.475, 0.48),
      multisample: 2,
    });
    r.visible = false;
    // conta quantas vezes o reflexo foi desenhado (os testes conferem que só o espelho à vista custa um desenho)
    const desenhar = r.onBeforeRender;
    r.onBeforeRender = function (...args) {
      this.userData.reflexos = ((this.userData.reflexos as number | undefined) ?? 0) + 1;
      desenhar.apply(this, args);
    };
    return r;
  }, [w, h]);
  useEffect(
    () => () => {
      espelho.geometry.dispose();
      espelho.dispose();
    },
    [espelho],
  );
  const grupo = useRef<THREE.Group>(null);

  useFrame(({ camera, invalidate }) => {
    let ativo = false;
    if (interna && realismo && grupo.current) {
      grupo.current.getWorldPosition(_centro);
      grupo.current.getWorldDirection(_normal); // +z do móvel = para onde o espelho olha
      camera.getWorldPosition(_camera); // (atualiza a matriz antes: a câmera pode ter acabado de mudar de lugar)
      const olho = { x: _camera.x * 100, y: _camera.z * 100 };
      // 12 cm à frente do espelho, para o ponto não cair em cima do eixo da parede em que ele está pendurado
      const alvo = { x: (_centro.x + _normal.x * 0.12) * 100, y: (_centro.z + _normal.z * 0.12) * 100 };
      _camera.sub(_centro);
      // perto, de frente e sem parede no meio (um espelho atrás da parede não precisa refletir nada)
      ativo = _camera.length() < ALCANCE && _camera.dot(_normal) > 0.05 && !haParedeEntre(useApp.getState().projeto.planta, olho, alvo);
    }
    if (espelho.visible !== ativo) {
      espelho.visible = ativo;
      invalidate(); // a cena só redesenha sob demanda: pede mais um quadro, já com o reflexo
    }
  });

  return (
    <group ref={grupo} position={[M((area.x0 + area.x1) / 2), M((area.y0 + area.y1) / 2), M(area.z + 0.15)]}>
      <primitive object={espelho} />
      {area.emendas.map((x) => (
        <mesh key={x} position={[M(x - (area.x0 + area.x1) / 2), 0, M(0.1)]} material={matEmenda}>
          <boxGeometry args={[M(0.3), M(h), M(0.1)]} />
        </mesh>
      ))}
    </group>
  );
}
