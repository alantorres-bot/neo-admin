import { useCallback, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, ToneMapping } from "@react-three/postprocessing";

/** O que usamos do passe de sombreamento (a biblioteca não publica os tipos). */
interface PasseSombreamento {
  autoDetectTransparency: boolean;
  configuration: { transparencyAware: boolean };
}
import { ToneMappingMode } from "postprocessing";
import { useApp } from "../estado/store";
import { registrarQuadro } from "./desempenho";
import { luzesAcesas } from "./luz";

/**
 * Acabamento realista da imagem: sombreamento dos cantos e encontros (oclusão de ambiente), brilho suave
 * em volta das luzes acesas e curva de tons de foto. Fica desligado na vista de planta, que é um desenho técnico,
 * e pode ser desligado pelo botão "Realista" quando o aparelho for fraco.
 */
function PosProcesso() {
  const camera = useApp((s) => s.visao.camera);
  const acesas = useApp((s) => luzesAcesas(s.visao));
  // Os vidros são quase invisíveis: não vale redesenhar a cena duas vezes só para o sombreamento contorná-los.
  const semTransparencia = useCallback((passe: unknown) => {
    const p = passe as PasseSombreamento | null;
    if (!p) return;
    p.autoDetectTransparency = false;
    p.configuration.transparencyAware = false;
  }, []);
  if (camera === "superior") return null;
  const interna = camera === "interna";
  return (
    <EffectComposer multisampling={4} enableNormalPass={false} frameBufferType={THREE.HalfFloatType}>
      {/* por dentro os encontros estão perto da câmera: raio menor e mais definido */}
      <N8AO aoRadius={interna ? 0.55 : 0.9} distanceFalloff={interna ? 0.6 : 0.8} intensity={interna ? 2.6 : 2.2} quality="medium" halfRes depthAwareUpsampling ref={semTransparencia} />
      <Bloom mipmapBlur luminanceThreshold={1.05} luminanceSmoothing={0.15} intensity={acesas ? 0.38 : 0.18} radius={0.7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

/** Acabamento realista + o vigia que o desliga em aparelho lento. Fora da vista de planta. */
export function Realismo() {
  const planta = useApp((s) => s.visao.camera === "superior");
  if (planta) return null;
  return (
    <>
      <PosProcesso />
      <VigiaDeDesempenho />
    </>
  );
}

let jaAliviou = false;

/**
 * Se o aparelho não dá conta do modo realista enquanto a pessoa mexe na cena, desliga-o e avisa.
 * Roda depois do desenho do quadro (prioridade 2; o desenho é a 1), quando já se sabe se outro quadro foi pedido.
 * Só pode existir junto do compositor: uma assinatura de prioridade positiva desliga o desenho automático da cena.
 */
function VigiaDeDesempenho() {
  const amostras = useRef<number[]>([]);
  const ultimo = useRef(0);
  const emSequencia = useRef(false);
  useFrame((estado) => {
    const agora = performance.now();
    const r = registrarQuadro(amostras.current, ultimo.current ? agora - ultimo.current : Infinity, emSequencia.current);
    ultimo.current = agora;
    amostras.current = r.amostras;
    emSequencia.current = estado.internal.frames > 1; // já há outro quadro pedido: a cena está em movimento
    // só uma vez por visita: se a pessoa religar o modo realista, a escolha dela vale
    if (r.lento && !jaAliviou) {
      jaAliviou = true;
      useApp.getState().definirVisao({ realismo: false });
      useApp.setState({ avisoLento: true });
    }
  }, 2);
  return null;
}
