import { useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { COR_PORTA_PADRAO } from "../catalogo/catalogo";
import type { Peca } from "../catalogo/formas";
import { useApp } from "../estado/store";
import { anguloParede, extremos } from "../modelo/geometria";
import type { Abertura, Planta } from "../modelo/tipos";
import { materialDaPeca, materialRealcado } from "./materiais";
import { COR_SELECAO, M } from "./util";

const ESP_FOLHA = 3.5; // cm
const MOLDURA = 4; // cm
const ANGULO_PORTA = (75 * Math.PI) / 180; // portas desenhadas entreabertas
const GUARNICAO = 6; // cm — largura da guarnição (alizar) em volta da porta
const ALTURA_MACANETA = 105; // cm

/**
 * Material de uma peça da porta (folha, batente ou guarnição) no acabamento dela: madeira com o veio ao longo
 * do comprimento da peça, ou pintura lisa. As portas do apartamento são de madeira (informação do Alan).
 */
function materialDaPorta(ab: Abertura, largura: number, altura: number, espessura: number) {
  const acabamento = ab.acabamento ?? "madeira";
  const cor = ab.cor ?? COR_PORTA_PADRAO[acabamento];
  const peca: Peca = { g: "caixa", p: [0, 0, 0], s: [largura, altura, espessura], slot: "porta" };
  return materialDaPeca(peca, cor, acabamento === "madeira" ? "madeira" : "liso");
}

function Vidro({ selecionado }: { selecionado: boolean }) {
  return (
    <meshPhysicalMaterial
      color={selecionado ? COR_SELECAO : "#d6e6ee"}
      transparent
      opacity={0.2}
      roughness={0.03}
      metalness={0}
      envMapIntensity={1.5}
      depthWrite={false}
    />
  );
}

/** Esquadria de alumínio branco. */
function Caixilho({ selecionado }: { selecionado: boolean }) {
  return <meshStandardMaterial color={selecionado ? COR_SELECAO : "#eceae6"} roughness={0.45} metalness={0.25} />;
}

function Cromado() {
  return <meshStandardMaterial color="#c9ccd0" roughness={0.15} metalness={1} envMapIntensity={1.8} />;
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
    // a folha gira na face interna do batente (3 cm para dentro do vão): fechada, encosta nos dois batentes sem fresta
    const xDobradica = naInicial ? -W / 2 + 3 : W / 2 - 3;
    const angulo = ab.aberta === undefined ? ANGULO_PORTA : (ab.aberta * Math.PI) / 180;
    const rot = naInicial ? -lado * angulo : lado * angulo;
    const inteira = h >= H - 0.01;
    // folha, batente e guarnição no mesmo acabamento (kit de porta); selecionada, a folha ganha só um realce
    const matFolha = materialDaPorta(ab, W - 6, h - 1, ESP_FOLHA);
    const matBatente = materialDaPorta(ab, 3, h, base.esp + 2);
    const matTravessa = materialDaPorta(ab, W, 3, base.esp + 2);
    const matGuarnicao = materialDaPorta(ab, GUARNICAO, h + GUARNICAO, 1.2);
    const matGuarnicaoTopo = materialDaPorta(ab, W, GUARNICAO, 1.2);
    // lado livre da folha (onde fica a maçaneta), no referencial da dobradiça
    const xLivre = naInicial ? W - 6 - 7 : -(W - 6 - 7); // a 7 cm da borda livre da folha
    conteudo = (
      <>
        {/* batentes (e a travessa de cima, com a parede inteira) */}
        {[-W / 2 + 1.5, W / 2 - 1.5].map((x, i) => (
          <mesh key={i} position={[M(x), M(h / 2), 0]} material={matBatente}>
            <boxGeometry args={[M(3), M(h), M(base.esp + 2)]} />
          </mesh>
        ))}
        {inteira && (
          <mesh position={[0, M(h - 1.5), 0]} material={matTravessa}>
            <boxGeometry args={[M(W), M(3), M(base.esp + 2)]} />
          </mesh>
        )}
        {/* guarnição em volta do vão, nas duas faces da parede */}
        {inteira &&
          [-1, 1].map((face) => (
            <group key={face} position={[0, 0, M(face * (base.esp / 2 + 0.6))]}>
              {[-(W + GUARNICAO) / 2, (W + GUARNICAO) / 2].map((x, i) => (
                <mesh key={i} position={[M(x), M((h + GUARNICAO) / 2), 0]} material={matGuarnicao}>
                  <boxGeometry args={[M(GUARNICAO), M(h + GUARNICAO), M(1.2)]} />
                </mesh>
              ))}
              <mesh position={[0, M(h + GUARNICAO / 2), 0]} material={matGuarnicaoTopo}>
                <boxGeometry args={[M(W), M(GUARNICAO), M(1.2)]} />
              </mesh>
            </group>
          ))}
        {/* folha articulada na dobradiça */}
        <group position={[M(xDobradica), 0, M((lado * base.esp) / 2)]} rotation={[0, rot, 0]}>
          <mesh position={[M(naInicial ? (W - 6) / 2 : -(W - 6) / 2), M(h / 2), 0]} material={selecionado ? materialRealcado(matFolha) : matFolha} castShadow receiveShadow>
            <boxGeometry args={[M(W - 6), M(h - 1), M(ESP_FOLHA)]} />
          </mesh>
          {/* maçaneta de alavanca dos dois lados */}
          {h > ALTURA_MACANETA &&
            [-1, 1].map((face) => (
              <group key={face} position={[M(xLivre), M(ALTURA_MACANETA), M(face * (ESP_FOLHA / 2 + 0.4))]}>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[M(2.6), M(2.6), M(0.8), 20]} />
                  <Cromado />
                </mesh>
                <mesh position={[0, 0, M(face * 2.2)]}>
                  <boxGeometry args={[M(1.6), M(1.6), M(4)]} />
                  <Cromado />
                </mesh>
                <mesh position={[M(naInicial ? -5 : 5), 0, M(face * 4)]}>
                  <boxGeometry args={[M(12), M(1.6), M(1.4)]} />
                  <Cromado />
                </mesh>
              </group>
            ))}
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
