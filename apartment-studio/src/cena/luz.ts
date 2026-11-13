/**
 * Condições de luz conforme a hora do dia (funções puras, testadas em luz.test.ts).
 * O norte da planta ainda não foi informado: o sol percorre um arco de leste (x+) a oeste (x−)
 * passando pelo lado da varanda — por isso entra pela porta de correr e pelas janelas dos quartos.
 */
import type { Visao } from "../estado/store";

export const HORA_MIN = 6;
export const HORA_MAX = 22;
const NASCER = 6;
const POR = 18;
const ELEVACAO_MAX = 62; // graus, ao meio-dia
/** Força do sol a pino, na escala da cena (as demais luzes são calibradas em relação a ela). */
export const SOL_PLENO = 1.55;

const limitar = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const suave = (a: number, b: number, v: number) => {
  const t = limitar((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const entre = (a: number, b: number, t: number) => a + (b - a) * t;

/** Mistura duas cores "#rrggbb" (t = 0 → a, t = 1 → b). */
export function misturar(a: string, b: string, t: number): string {
  const n = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const canal = (i: number) =>
    Math.round(entre(n(a, i), n(b, i), limitar(t, 0, 1)))
      .toString(16)
      .padStart(2, "0");
  return `#${canal(0)}${canal(1)}${canal(2)}`;
}

/** Altura do sol acima do horizonte, em graus (negativa depois do pôr do sol). */
export function elevacaoSol(hora: number): number {
  if (hora <= POR) return ELEVACAO_MAX * Math.sin(Math.PI * limitar((hora - NASCER) / (POR - NASCER), 0, 1));
  return -(hora - POR) * 12;
}

export interface CondicaoLuz {
  /** 0 = noite fechada, 1 = dia claro. */
  dia: number;
  /** Abaixo disso as luzes da casa acendem sozinhas. */
  noite: boolean;
  sol: {
    intensidade: number;
    cor: string;
    /** Direção de onde vem a luz (vetor unitário, y para cima; x e z da cena). */
    direcao: [number, number, number];
  };
  /** Luar fraco, só para dar leitura às formas à noite. */
  lua: number;
  /** Luz difusa do céu (hemisfério) e reflexos do ambiente. */
  difusa: { intensidade: number; cor: string; reflexo: number };
  ceu: { topo: string; horizonte: string; baixo: string };
}

export function condicaoDeLuz(hora: number): CondicaoLuz {
  const h = limitar(hora, HORA_MIN, HORA_MAX);
  const elev = elevacaoSol(h);
  const dia = suave(-6, 10, elev);
  const direto = suave(0, 14, elev);
  // perto do horizonte a luz e o céu ficam quentes
  const quente = dia * (1 - suave(4, 28, Math.abs(elev)));

  const t = limitar((h - NASCER) / (POR - NASCER), 0, 1);
  const el = (Math.max(elev, 3) * Math.PI) / 180;
  const direcao: [number, number, number] = [Math.cos(el) * Math.cos(Math.PI * t), Math.sin(el), -Math.cos(el) * Math.sin(Math.PI * t)];

  return {
    dia,
    noite: dia < 0.3,
    sol: { intensidade: SOL_PLENO * direto, cor: misturar("#fff4e6", "#ff9e5e", 1 - suave(0, 28, elev)), direcao },
    lua: 0.16 * (1 - dia),
    difusa: {
      // à noite sobra um resto de luz rebatida, para os cantos não ficarem pretos
      intensidade: entre(0.08, 0.5, dia),
      cor: misturar("#2c3554", misturar("#eef4ff", "#ffe3c4", quente), dia),
      reflexo: entre(0.08, 0.5, dia),
    },
    ceu: {
      topo: misturar("#070b18", misturar("#7fa9d8", "#56689a", quente), dia),
      horizonte: misturar("#141b30", misturar("#dbe7f1", "#f4b98a", quente), dia),
      baixo: misturar("#0d1220", misturar("#c3ccd2", "#b99c8e", quente), dia),
    },
  };
}

/** As luzes da casa estão acesas? O botão "Luzes" acende de dia; à noite acendem sozinhas. */
export function luzesAcesas(visao: Pick<Visao, "luzArtificial" | "horaSol">): boolean {
  return visao.luzArtificial || condicaoDeLuz(visao.horaSol).noite;
}

/** Texto do relógio da barra: "☀ 10h", "☾ 20h30". */
export function rotuloHora(hora: number): string {
  const h = Math.floor(hora);
  const min = Math.round((hora - h) * 60);
  return `${condicaoDeLuz(hora).noite ? "☾" : "☀"} ${String(h).padStart(2, "0")}h${min ? String(min).padStart(2, "0") : ""}`;
}
