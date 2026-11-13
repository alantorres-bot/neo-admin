import { create } from "zustand";
import { criarPlantaReal, criarProjetoReal } from "../modelo/plantaReal";
import type { Planta, Projeto, Selecao } from "../modelo/tipos";
import type { Ponto } from "../modelo/geometria";
import { carregarProjeto, salvarProjeto } from "./persistencia";

export type ModoCamera = "perspectiva" | "superior" | "interna";
export type ModoParedes = "inteiras" | "recortadas" | "ocultas";

export interface Visao {
  camera: ModoCamera;
  paredes: ModoParedes;
  teto: boolean;
  cotas: boolean;
  luzArtificial: boolean;
  /** Hora do dia para a posição do sol (6–18). */
  horaSol: number;
  /** Ambiente onde a câmera interna é posicionada. */
  ambienteInterno: string;
}

interface EstadoApp {
  projeto: Projeto;
  passado: { projeto: Projeto; rotulo: string }[];
  futuro: { projeto: Projeto; rotulo: string }[];
  selecao: Selecao;
  visao: Visao;
  carregado: boolean;
  salvoEm: string | null;
  /** Pontos clicados durante a calibração da imagem da planta (cm, no plano). */
  calibracao: { ativa: boolean; pontos: Ponto[] };

  inicializar: () => Promise<void>;
  alterarPlanta: (rotulo: string, fn: (p: Planta) => Planta) => void;
  desfazer: () => void;
  refazer: () => void;
  selecionar: (s: Selecao) => void;
  definirVisao: (v: Partial<Visao>) => void;
  definirCalibracao: (c: Partial<EstadoApp["calibracao"]>) => void;
  restaurarPlantaOriginal: () => void;
}

const LIMITE_HISTORICO = 100;

export const useApp = create<EstadoApp>((set, get) => ({
  projeto: criarProjetoReal(),
  passado: [],
  futuro: [],
  selecao: null,
  visao: {
    camera: "perspectiva",
    paredes: "inteiras",
    teto: true,
    cotas: true,
    luzArtificial: false,
    horaSol: 10,
    ambienteInterno: "amb-sala",
  },
  carregado: false,
  salvoEm: null,
  calibracao: { ativa: false, pontos: [] },

  inicializar: async () => {
    try {
      const salvo = await carregarProjeto();
      // projetos salvos com a planta provisória (antes de receber a planta real) são substituídos
      if (salvo && !salvo.planta.provisoria) set({ projeto: salvo, salvoEm: salvo.atualizadoEm });
    } catch (e) {
      console.warn("Não foi possível ler o projeto salvo:", e);
    }
    set({ carregado: true });
  },

  alterarPlanta: (rotulo, fn) => {
    const { projeto, passado } = get();
    const planta = fn(projeto.planta);
    if (planta === projeto.planta) return;
    const novo: Projeto = { ...projeto, planta, atualizadoEm: new Date().toISOString() };
    set({
      projeto: novo,
      passado: [...passado, { projeto, rotulo }].slice(-LIMITE_HISTORICO),
      futuro: [],
    });
  },

  desfazer: () => {
    const { passado, futuro, projeto } = get();
    const ultimo = passado.at(-1);
    if (!ultimo) return;
    set({
      projeto: ultimo.projeto,
      passado: passado.slice(0, -1),
      futuro: [{ projeto, rotulo: ultimo.rotulo }, ...futuro],
    });
  },

  refazer: () => {
    const { passado, futuro, projeto } = get();
    const prox = futuro[0];
    if (!prox) return;
    set({
      projeto: prox.projeto,
      futuro: futuro.slice(1),
      passado: [...passado, { projeto, rotulo: prox.rotulo }],
    });
  },

  selecionar: (selecao) => set({ selecao }),
  definirVisao: (v) => set({ visao: { ...get().visao, ...v } }),
  definirCalibracao: (c) => set({ calibracao: { ...get().calibracao, ...c } }),

  restaurarPlantaOriginal: () => {
    get().alterarPlanta("Restaurar planta original", () => criarPlantaReal());
  },
}));

// Salvamento automático (IndexedDB), 600 ms após a última alteração.
let temporizador: ReturnType<typeof setTimeout> | undefined;
useApp.subscribe((estado, anterior) => {
  if (!estado.carregado || estado.projeto === anterior.projeto) return;
  clearTimeout(temporizador);
  temporizador = setTimeout(async () => {
    try {
      await salvarProjeto(useApp.getState().projeto);
      useApp.setState({ salvoEm: new Date().toISOString() });
    } catch (e) {
      console.error("Falha ao salvar o projeto:", e);
    }
  }, 600);
});
