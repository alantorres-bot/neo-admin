/**
 * Rótulos HTML sobre a cena (nomes, áreas, cotas) sem o <Html> do drei:
 * a camada DOM fica fora do Canvas e um projetor dentro do Canvas reposiciona os
 * elementos a cada quadro. Evita uma raiz React por rótulo (conflito com React 19).
 */
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useApp } from "../estado/store";
import { areaPoligono, centroide, comprimento, extremos, pontosAmbiente } from "../modelo/geometria";
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

  const paredes =
    camera === "superior"
      ? planta.paredes.flatMap((p) => {
          const [a, b] = extremos(planta, p);
          const L = comprimento(a, b);
          if (L < 60) return [];
          const va = planta.vertices.find((x) => x.id === p.a)!;
          const vb = planta.vertices.find((x) => x.id === p.b)!;
          return [{
            p,
            meio: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            L,
            estimada: va.origem === "estimada" || vb.origem === "estimada",
            cota: va.origem === "cota" && vb.origem === "cota",
          }];
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
      {paredes.map(({ p, meio, L, estimada, cota }) => (
        <span
          key={`cota-${p.id}-${meio.x}-${meio.y}`}
          ref={registrar(`cota-${p.id}`, [M(meio.x), 0.1, M(meio.y)])}
          className={`rotulo-cota ${estimada ? "estimada" : cota ? "real" : ""}`}
          onClick={() => selecionar({ tipo: "parede", id: p.id })}
        >
          {estimada ? "≈" : ""}
          {Math.round(L)}
        </span>
      ))}
    </div>
  );
}
