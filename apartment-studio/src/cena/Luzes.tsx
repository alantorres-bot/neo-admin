import { useMemo } from "react";
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { luzesDoMovel, type LuzMovel } from "../catalogo/luzes";
import { useApp } from "../estado/store";
import { anguloParede, extremos, ladoInternoDaAbertura } from "../modelo/geometria";
import type { Movel } from "../modelo/tipos";
import { condicaoDeLuz, luzesAcesas, misturar } from "./luz";
import { M } from "./util";

const RAD = Math.PI / 180;

// As fitas usam luz de área (retângulo que ilumina para um lado): precisa desta tabela, carregada uma vez.
let tabelasProntas = false;
function prepararLuzDeArea() {
  if (tabelasProntas) return;
  RectAreaLightUniformsLib.init();
  tabelasProntas = true;
}

/** Giro da luz de área (que ilumina para −z) para apontar para baixo, para cima ou para a frente do móvel. */
const GIRO: Record<LuzMovel["direcao"], [number, number, number]> = {
  baixo: [-Math.PI / 2, 0, 0],
  cima: [Math.PI / 2, 0, 0],
  frente: [0, Math.PI, 0],
};

function LuzesDoMovel({ movel }: { movel: Movel }) {
  const { catalogoId, largura, profundidade, altura, opcoes } = movel;
  const luzes = useMemo(() => luzesDoMovel({ catalogoId, largura, profundidade, altura, opcoes }), [catalogoId, largura, profundidade, altura, opcoes]);
  if (luzes.length === 0) return null;
  return (
    <group position={[M(movel.x), M(movel.elevacao), M(movel.y)]} rotation={[0, movel.rotacao * RAD, 0]}>
      {luzes.map((l, i) =>
        l.tipo === "fita" ? (
          <rectAreaLight
            key={i}
            position={[M(l.p[0]), M(l.p[1]), M(l.p[2])]}
            rotation={GIRO[l.direcao]}
            width={M(l.tamanho[0])}
            height={M(l.tamanho[1])}
            color={l.cor}
            intensity={l.intensidade}
          />
        ) : (
          <pointLight key={i} position={[M(l.p[0]), M(l.p[1]), M(l.p[2])]} color={l.cor} intensity={l.intensidade} distance={M(l.alcance)} decay={2} />
        ),
      )}
    </group>
  );
}

/** Luzes dos móveis (plafons, pendentes, abajures, fitas de LED): acendem com o botão Luzes ou à noite. */
export function LuzesDaCasa() {
  const acesas = useApp((s) => luzesAcesas(s.visao));
  const moveis = useApp((s) => s.projeto.moveis);
  const visiveis = useApp((s) => s.visao.moveis);
  if (!acesas || !visiveis) return null;
  prepararLuzDeArea();
  return (
    <group name="luzes">
      {moveis.map((m) => (
        <LuzesDoMovel key={m.id} movel={m} />
      ))}
    </group>
  );
}

/** Cor "apagada" de uma peça de LED: o difusor branco, sem brilho. */
export const COR_LED_APAGADO = new THREE.Color("#e9e6df");

/**
 * Claridade do dia entrando pelas janelas e pela porta da varanda (só na vista por dentro): uma luz de área
 * em cada vão, voltada para dentro. Não faz sombra — o sol direto, esse sim com sombra, vem de Cena.tsx.
 */
export function LuzDasJanelas() {
  const ativa = useApp((s) => s.visao.camera === "interna" && s.visao.realismo);
  const hora = useApp((s) => s.visao.horaSol);
  const planta = useApp((s) => s.projeto.planta);
  const vaos = useMemo(
    () =>
      planta.aberturas.flatMap((ab) => {
        if (ab.tipo !== "janela" && ab.tipo !== "porta-correr") return [];
        const parede = planta.paredes.find((p) => p.id === ab.paredeId);
        const lado = ladoInternoDaAbertura(planta, ab);
        if (!parede || !lado) return [];
        const [a, b] = extremos(planta, parede);
        const s = lado === "direita" ? 1 : -1;
        return [{ id: ab.id, a, ang: anguloParede(a, b), u: ab.posicao.valor, y: ab.peitoril.valor + ab.altura.valor / 2, z: s * (parede.espessura.valor / 2 + 4), giro: s > 0 ? Math.PI : 0, w: ab.largura.valor, h: ab.altura.valor }];
      }),
    [planta],
  );
  const luz = condicaoDeLuz(hora);
  if (!ativa || luz.dia < 0.05) return null;
  prepararLuzDeArea();
  const cor = misturar("#ffffff", luz.difusa.cor, 0.6);
  return (
    <group name="luz-das-janelas">
      {vaos.map((v) => (
        <group key={v.id} position={[M(v.a.x), 0, M(v.a.y)]} rotation={[0, -v.ang, 0]}>
          <rectAreaLight position={[M(v.u), M(v.y), M(v.z)]} rotation={[0, v.giro, 0]} width={M(v.w)} height={M(v.h)} color={cor} intensity={CLARIDADE_JANELA * luz.dia} />
        </group>
      ))}
    </group>
  );
}

/** Brilho do céu visto por um vão, na escala da cena. */
const CLARIDADE_JANELA = 1.5;
