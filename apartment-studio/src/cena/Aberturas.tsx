import { useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useApp } from "../estado/store";
import { anguloParede, extremos } from "../modelo/geometria";
import type { Abertura, Planta } from "../modelo/tipos";
import { COR_SELECAO, M } from "./util";

const ESP_FOLHA = 3.5; // cm
const MOLDURA = 4; // cm
const ANGULO_PORTA = (75 * Math.PI) / 180; // portas desenhadas entreabertas

function Vidro({ selecionado }: { selecionado: boolean }) {
  return (
    <meshPhysicalMaterial
      color={selecionado ? COR_SELECAO : "#cfe3ee"}
      transparent
      opacity={0.28}
      roughness={0.05}
      metalness={0}
      depthWrite={false}
    />
  );
}

function Caixilho({ selecionado }: { selecionado: boolean }) {
  return <meshStandardMaterial color={selecionado ? COR_SELECAO : "#3a3d42"} roughness={0.4} metalness={0.6} />;
}

function AberturaMesh({ planta, ab }: { planta: Planta; ab: Abertura }) {
  const selecionado = useApp((s) => s.selecao?.tipo === "abertura" && s.selecao.id === ab.id);
  const selecionar = useApp((s) => s.selecionar);
  const camera = useApp((s) => s.visao.camera);
  const modoParedes = useApp((s) => s.visao.paredes);

  const base = useMemo(() => {
    const parede = planta.paredes.find((p) => p.id === ab.paredeId);
    if (!parede) return null;
    const [a, b] = extremos(planta, parede);
    return { a, ang: anguloParede(a, b), esp: parede.espessura.valor };
  }, [planta, ab.paredeId]);
  if (!base) return null;

  // Com paredes recortadas/ocultas, janelas e folhas acima do corte poluem a vista.
  const paredesInteiras = camera === "interna" || modoParedes === "inteiras";

  const W = ab.largura.valor;
  const H = ab.altura.valor;
  const P = ab.peitoril.valor;
  const aoClicar = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 5) return; // foi arraste de câmera, não clique
    selecionar({ tipo: "abertura", id: ab.id });
  };

  let conteudo: React.ReactNode = null;
  if (ab.tipo === "janela" && paredesInteiras) {
    conteudo = (
      <>
        <mesh position={[0, M(P + H / 2), 0]}>
          <boxGeometry args={[M(W - MOLDURA), M(H - MOLDURA), M(1)]} />
          <Vidro selecionado={selecionado} />
        </mesh>
        {/* moldura */}
        {[
          [0, P + MOLDURA / 2, W, MOLDURA],
          [0, P + H - MOLDURA / 2, W, MOLDURA],
          [-W / 2 + MOLDURA / 2, P + H / 2, MOLDURA, H],
          [W / 2 - MOLDURA / 2, P + H / 2, MOLDURA, H],
          [0, P + H / 2, MOLDURA / 2, H],
        ].map(([x, y, w, h], i) => (
          <mesh key={i} position={[M(x), M(y), 0]} castShadow>
            <boxGeometry args={[M(w), M(h), M(5)]} />
            <Caixilho selecionado={selecionado} />
          </mesh>
        ))}
        {/* peitoril de granito */}
        <mesh position={[0, M(P - 1), 0]} receiveShadow>
          <boxGeometry args={[M(W + 6), M(2), M(base.esp + 4)]} />
          <meshStandardMaterial color="#d8d4cc" roughness={0.3} />
        </mesh>
      </>
    );
  } else if (ab.tipo === "porta-correr") {
    const h = paredesInteiras ? H : Math.min(H, 100);
    conteudo = (
      <>
        {[-1, 1].map((lado) => (
          <group key={lado} position={[M((lado * W) / 4), M(h / 2), M(lado * 2.5)]}>
            <mesh>
              <boxGeometry args={[M(W / 2 + 4), M(h - MOLDURA), M(1)]} />
              <Vidro selecionado={selecionado} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[M((s * W) / 4 - (s * MOLDURA) / 2), 0, 0]}>
                <boxGeometry args={[M(MOLDURA), M(h), M(4)]} />
                <Caixilho selecionado={selecionado} />
              </mesh>
            ))}
          </group>
        ))}
        <mesh position={[0, M(0.5), 0]}>
          <boxGeometry args={[M(W), M(1), M(base.esp)]} />
          <Caixilho selecionado={selecionado} />
        </mesh>
      </>
    );
  } else if (ab.tipo === "porta") {
    const h = paredesInteiras ? H : Math.min(H, 100);
    const lado = ab.abrePara === "direita" ? -1 : 1; // lado da parede (eixo local z)
    const naInicial = ab.dobradica !== "fim";
    const xDobradica = naInicial ? -W / 2 : W / 2;
    const angulo = ab.aberta === undefined ? ANGULO_PORTA : (ab.aberta * Math.PI) / 180;
    const rot = naInicial ? -lado * angulo : lado * angulo;
    conteudo = (
      <>
        {/* batentes */}
        {[-W / 2 + 1.5, W / 2 - 1.5].map((x, i) => (
          <mesh key={i} position={[M(x), M(h / 2), 0]}>
            <boxGeometry args={[M(3), M(h), M(base.esp + 2)]} />
            <meshStandardMaterial color={selecionado ? COR_SELECAO : "#f7f5f0"} roughness={0.5} />
          </mesh>
        ))}
        {/* folha articulada na dobradiça */}
        <group position={[M(xDobradica), 0, M((lado * base.esp) / 2)]} rotation={[0, rot, 0]}>
          <mesh position={[M(naInicial ? (W - 6) / 2 : -(W - 6) / 2), M(h / 2), 0]} castShadow>
            <boxGeometry args={[M(W - 6), M(h - 1), M(ESP_FOLHA)]} />
            <meshStandardMaterial color={selecionado ? COR_SELECAO : "#d9c3a5"} roughness={0.55} />
          </mesh>
        </group>
      </>
    );
  }

  return (
    <group position={[M(base.a.x), 0, M(base.a.y)]} rotation={[0, -base.ang, 0]}>
      <group position={[M(ab.posicao.valor), 0, 0]} onClick={aoClicar}>
        {conteudo}
        {/* área clicável do vão (invisível) */}
        <mesh position={[0, M(P + H / 2), 0]}>
          <boxGeometry args={[M(W), M(H), M(base.esp + 1)]} />
          <meshBasicMaterial color={COR_SELECAO} transparent opacity={selecionado ? 0.18 : 0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

export function Aberturas() {
  const planta = useApp((s) => s.projeto.planta);
  return (
    <group name="aberturas">
      {planta.aberturas.map((ab) => (
        <AberturaMesh key={ab.id} planta={planta} ab={ab} />
      ))}
    </group>
  );
}
