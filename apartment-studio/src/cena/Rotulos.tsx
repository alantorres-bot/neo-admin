/**
 * Rótulos HTML sobre a cena (nomes, áreas, cotas) sem o <Html> do drei:
 * a camada DOM fica fora do Canvas e um projetor dentro do Canvas reposiciona os
 * elementos a cada quadro. Evita uma raiz React por rótulo (conflito com React 19).
 */
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useApp } from "../estado/store";
import { areaPoligono, centroide, comprimento, conferirCotas, extremos, pontosAmbiente } from "../modelo/geometria";
import { M } from "./util";

const registro = new Map<string, { el: HTMLElement; pos: THREE.Vector3 }>();
const v = new THREE.Vector3();

export function ProjetorRotulos() {
  const { camera, size } = useThree();
  useFrame(() => {
    for (const { el, pos } of registro.values()) {
      v.copy(pos).project(camera);
      if (v.z > 1 || v.z < -1) {
        el.style.visibility = "hidden";
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.visibility = "visible";
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  });
  return null;
}

function registrar(id: string, pos: [number, number, number]) {
  return (el: HTMLElement | null) => {
    if (el) {
      el.style.visibility = "hidden";
      registro.set(id, { el, pos: new THREE.Vector3(...pos) });
    } else registro.delete(id);
  };
}

export function CamadaRotulos() {
  const planta = useApp((s) => s.projeto.planta);
  const cotas = useApp((s) => s.visao.cotas);
  const camera = useApp((s) => s.visao.camera);
  const selecionar = useApp((s) => s.selecionar);
  const selecaoParede = useApp((s) => (s.selecao?.tipo === "parede" ? s.selecao.id : null));
  if (!cotas || camera === "interna") return null;

  const ambientes = planta.ambientes.map((amb) => {
    const pts = pontosAmbiente(planta, amb);
    const c = centroide(pts);
    return {
      amb,
      c,
      area: areaPoligono(pts) / 10_000,
      estimada: pts.some((p) => "origem" in p && p.origem === "estimada"),
    };
  });

  const conferidas = camera === "superior" ? conferirCotas(planta) : [];
  // comprimento de eixo só da parede selecionada (as cotas da planta já cobrem o resto)
  const paredes =
    camera === "superior" && selecaoParede
      ? planta.paredes
          .filter((p) => p.id === selecaoParede)
          .map((p) => {
            const [a, b] = extremos(planta, p);
            return { p, meio: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, L: comprimento(a, b) };
          })
      : [];

  return (
    <div className="camada-rotulos">
      {ambientes.map(({ amb, c, area, estimada }) => (
        <div
          key={`amb-${amb.id}-${c.x}-${c.y}`}
          ref={registrar(`amb-${amb.id}`, [M(c.x), 0.05, M(c.y)])}
          className="rotulo-ambiente"
          onClick={() => selecionar({ tipo: "ambiente", id: amb.id })}
        >
          <strong>{amb.nome}</strong>
          <span>
            {estimada ? "≈ " : ""}
            {area.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} m²
          </span>
        </div>
      ))}
      {conferidas.map(({ cota, confere, modelo }) => (
        <span
          key={`cota-${cota.id}-${cota.rotulo.x}`}
          ref={registrar(`cota-${cota.id}`, [M(cota.rotulo.x), 0.1, M(cota.rotulo.y)])}
          className={`rotulo-cota ${cota.situacao === "a-confirmar" ? "duvida" : confere ? "real" : "erro"}`}
          title={`${cota.descricao}${cota.obs ? ` — ${cota.obs}` : ""}${!confere && Number.isFinite(modelo) ? ` (modelo: ${(modelo / 100).toFixed(2)})` : ""}`}
        >
          {cota.texto}
        </span>
      ))}
      {paredes.map(({ p, meio, L }) => (
        <span
          key={`eixo-${p.id}-${meio.x}-${meio.y}`}
          ref={registrar(`eixo-${p.id}`, [M(meio.x), 0.3, M(meio.y)])}
          className="rotulo-cota eixo"
          title="Comprimento pelo eixo da parede"
        >
          eixo {Math.round(L)}
        </span>
      ))}
    </div>
  );
}
