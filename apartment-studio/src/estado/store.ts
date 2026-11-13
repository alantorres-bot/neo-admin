import { create } from "zustand";
import { criarMovel, itemCatalogo, novoId } from "../catalogo/catalogo";
import { centroide, pontosAmbiente, type Ponto } from "../modelo/geometria";
import { criarPlantaReal } from "../modelo/plantaReal";
import { BASE_ATUAL, criarProjetoBase } from "../modelo/projetoBase";
import type { Movel, Planta, Projeto, Selecao } from "../modelo/tipos";
import { carregarProjeto, salvarCopia, salvarProjeto } from "./persistencia";

export type ModoCamera = "perspectiva" | "superior" | "interna";
export type ModoParedes = "inteiras" | "recortadas" | "ocultas";
export type AbaPainel = "ambientes" | "moveis" | "estrutura" | "planta";

export interface Visao {
  camera: ModoCamera;
  paredes: ModoParedes;
  teto: boolean;
  cotas: boolean;
  moveis: boolean;
  luzArtificial: boolean;
  /** Hora do dia para a posição do sol (6–18). */
  horaSol: number;
  /** Ambiente onde a câmera interna é posicionada (quando não há vista escolhida). */
  ambienteInterno: string;
  /** Vista interna escolhida (projeto.vistas). */
  vistaId: string | null;
}

interface Passo {
  projeto: Projeto;
  rotulo: string;
}

interface EstadoApp {
  projeto: Projeto;
  passado: Passo[];
  futuro: Passo[];
  selecao: Selecao;
  visao: Visao;
  carregado: boolean;
  salvoEm: string | null;
  /** Existe um projeto-base mais novo do que o salvo neste navegador (e há alterações locais). */
  novaBase: boolean;
  painel: { aba: AbaPainel; aberto: boolean };
  /** Pontos clicados durante a calibração da imagem da planta (cm, no plano). */
  calibracao: { ativa: boolean; pontos: Ponto[] };

  inicializar: () => Promise<void>;
  alterarProjeto: (rotulo: string, fn: (p: Projeto) => Projeto) => void;
  alterarPlanta: (rotulo: string, fn: (p: Planta) => Planta) => void;
  alterarMovel: (id: string, rotulo: string, patch: Partial<Movel>) => void;
  adicionarMovel: (catalogoId: string) => void;
  duplicarMovel: (id: string) => void;
  removerMovel: (id: string) => void;
  /** Move durante o arraste, sem criar um passo no histórico a cada pixel. */
  moverMovelAoVivo: (id: string, x: number, y: number) => void;
  /** Fecha o arraste: registra um único passo com o estado anterior. */
  registrarPasso: (rotulo: string, antes: Projeto) => void;
  desfazer: () => void;
  refazer: () => void;
  selecionar: (s: Selecao) => void;
  definirVisao: (v: Partial<Visao>) => void;
  definirPainel: (p: Partial<EstadoApp["painel"]>) => void;
  definirCalibracao: (c: Partial<EstadoApp["calibracao"]>) => void;
  restaurarPlantaOriginal: () => void;
  adotarBase: () => Promise<void>;
}

const LIMITE_HISTORICO = 100;
/** Em tela estreita (celular) o painel começa recolhido e os rótulos desligados, para ver o apartamento inteiro. */
const telaLarga = typeof window === "undefined" || window.innerWidth > 760;

let ultimoPasso = { rotulo: "", instante: 0 };

const marcar = (p: Projeto): Projeto => ({ ...p, alteradoPeloUsuario: true, atualizadoEm: new Date().toISOString() });

export const useApp = create<EstadoApp>((set, get) => ({
  projeto: criarProjetoBase(),
  passado: [],
  futuro: [],
  selecao: null,
  visao: {
    camera: "perspectiva",
    paredes: "recortadas",
    teto: true,
    cotas: telaLarga,
    moveis: true,
    luzArtificial: false,
    horaSol: 10,
    ambienteInterno: "amb-sala",
    vistaId: "v-entrada",
  },
  carregado: false,
  salvoEm: null,
  novaBase: false,
  painel: { aba: "ambientes", aberto: telaLarga },
  calibracao: { ativa: false, pontos: [] },

  inicializar: async () => {
    try {
      const salvo = await carregarProjeto();
      if (salvo) {
        if (salvo.base === BASE_ATUAL) set({ projeto: salvo, salvoEm: salvo.atualizadoEm });
        // base nova e nada alterado aqui: adota a nova direto; com alterações locais, mantém e avisa
        else if (salvo.alteradoPeloUsuario) set({ projeto: salvo, salvoEm: salvo.atualizadoEm, novaBase: true });
      }
    } catch (e) {
      console.warn("Não foi possível ler o projeto salvo:", e);
    }
    set({ carregado: true });
  },

  alterarProjeto: (rotulo, fn) => {
    const { projeto, passado } = get();
    const novo = fn(projeto);
    if (novo === projeto) return;
    // a mesma alteração repetida em sequência (arrastar o seletor de cor, segurar a seta) vira um passo só
    const agora = Date.now();
    const repetido = rotulo === ultimoPasso.rotulo && agora - ultimoPasso.instante < 900 && passado.length > 0;
    ultimoPasso = { rotulo, instante: agora };
    set({
      projeto: marcar(novo),
      passado: repetido ? passado : [...passado, { projeto, rotulo }].slice(-LIMITE_HISTORICO),
      futuro: [],
    });
  },

  alterarPlanta: (rotulo, fn) =>
    get().alterarProjeto(rotulo, (p) => {
      const planta = fn(p.planta);
      return planta === p.planta ? p : { ...p, planta };
    }),

  alterarMovel: (id, rotulo, patch) =>
    get().alterarProjeto(rotulo, (p) => ({ ...p, moveis: p.moveis.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),

  adicionarMovel: (catalogoId) => {
    const { projeto, selecao, visao } = get();
    const item = itemCatalogo(catalogoId);
    if (!item) return;
    // posição: perto do móvel selecionado, ou no centro do ambiente selecionado / em uso
    let ponto: Ponto | null = null;
    if (selecao?.tipo === "movel") {
      const ref = projeto.moveis.find((m) => m.id === selecao.id);
      if (ref) ponto = { x: ref.x + 40, y: ref.y + 40 };
    }
    if (!ponto) {
      const idAmb = selecao?.tipo === "ambiente" ? selecao.id : visao.ambienteInterno;
      const amb = projeto.planta.ambientes.find((a) => a.id === idAmb) ?? projeto.planta.ambientes[0];
      ponto = amb ? centroide(pontosAmbiente(projeto.planta, amb)) : { x: 0, y: 0 };
    }
    const novo = criarMovel(catalogoId, Math.round(ponto.x), Math.round(ponto.y), { situacao: "comprar" });
    get().alterarProjeto(`Adicionar ${item.nome.toLowerCase()}`, (p) => ({ ...p, moveis: [...p.moveis, novo] }));
    set({ selecao: { tipo: "movel", id: novo.id } });
  },

  duplicarMovel: (id) => {
    const original = get().projeto.moveis.find((m) => m.id === id);
    if (!original) return;
    const copia: Movel = { ...original, id: novoId(), x: original.x + 25, y: original.y + 25, travado: false };
    get().alterarProjeto(`Duplicar ${original.nome.toLowerCase()}`, (p) => ({ ...p, moveis: [...p.moveis, copia] }));
    set({ selecao: { tipo: "movel", id: copia.id } });
  },

  removerMovel: (id) => {
    const alvo = get().projeto.moveis.find((m) => m.id === id);
    if (!alvo) return;
    get().alterarProjeto(`Excluir ${alvo.nome.toLowerCase()}`, (p) => ({ ...p, moveis: p.moveis.filter((m) => m.id !== id) }));
    set({ selecao: null });
  },

  moverMovelAoVivo: (id, x, y) => {
    const { projeto } = get();
    set({ projeto: { ...projeto, moveis: projeto.moveis.map((m) => (m.id === id ? { ...m, x, y } : m)) } });
  },

  registrarPasso: (rotulo, antes) => {
    const { projeto, passado } = get();
    if (antes === projeto) return;
    set({ projeto: marcar(projeto), passado: [...passado, { projeto: antes, rotulo }].slice(-LIMITE_HISTORICO), futuro: [] });
  },

  desfazer: () => {
    const { passado, futuro, projeto } = get();
    const ultimo = passado.at(-1);
    if (!ultimo) return;
    set({ projeto: ultimo.projeto, passado: passado.slice(0, -1), futuro: [{ projeto, rotulo: ultimo.rotulo }, ...futuro] });
  },

  refazer: () => {
    const { passado, futuro, projeto } = get();
    const prox = futuro[0];
    if (!prox) return;
    set({ projeto: prox.projeto, futuro: futuro.slice(1), passado: [...passado, { projeto, rotulo: prox.rotulo }] });
  },

  selecionar: (selecao) => set({ selecao }),
  definirVisao: (v) => set({ visao: { ...get().visao, ...v } }),
  definirPainel: (p) => set({ painel: { ...get().painel, ...p } }),
  definirCalibracao: (c) => set({ calibracao: { ...get().calibracao, ...c } }),

  restaurarPlantaOriginal: () => get().alterarPlanta("Restaurar planta original", () => criarPlantaReal()),

  adotarBase: async () => {
    try {
      await salvarCopia(get().projeto);
    } catch (e) {
      console.warn("Não foi possível guardar a cópia do projeto atual:", e);
    }
    set({ projeto: criarProjetoBase(), passado: [], futuro: [], selecao: null, novaBase: false });
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
