/**
 * Versões da decoração: fotografias nomeadas do projeto inteiro (planta, pintura, móveis e vistas), para
 * comparar opções — "com parede azul", "sofá do outro lado" — e voltar a qualquer uma. Funções puras;
 * quem guarda é estado/persistencia.ts (navegador) e estado/nuvem.ts (conta, na página publicada).
 */
import type { Projeto } from "./tipos";

export interface Versao {
  id: string;
  nome: string;
  criadaEm: string;
  /** Muda ao renomear: na junção entre aparelho e conta vale a cópia mais recente. */
  atualizadaEm: string;
  projeto: Projeto;
  /** Imagem pequena da cena no momento em que a versão foi salva (JPEG em data URL). */
  miniatura?: string;
}

/** Quantas versões cabem: acima disso a pessoa precisa excluir alguma (cada uma tem ≈ 30 a 50 KB). */
export const LIMITE_VERSOES = 30;
export const TAMANHO_NOME = 60;

const dois = (n: number) => String(n).padStart(2, "0");

/** "Versão 3 — 13/11 14h05": o número é o seguinte ao maior já usado. */
export function nomePadrao(existentes: Pick<Versao, "nome">[], agora: Date): string {
  const usados = existentes.map((v) => /^Versão (\d+)\b/.exec(v.nome)?.[1]).filter(Boolean).map(Number);
  const n = (usados.length ? Math.max(...usados) : 0) + 1;
  return `Versão ${n} — ${dois(agora.getDate())}/${dois(agora.getMonth() + 1)} ${dois(agora.getHours())}h${dois(agora.getMinutes())}`;
}

/** Nome limpo (sem espaços sobrando, no máximo 60 letras); vazio vira o nome padrão. */
export function nomeLimpo(nome: string | undefined, existentes: Pick<Versao, "nome">[], agora: Date): string {
  const limpo = (nome ?? "").replace(/\s+/g, " ").trim().slice(0, TAMANHO_NOME);
  return limpo || nomePadrao(existentes, agora);
}

/** A imagem importada pelo usuário (data URL, grande) não entra na versão; o marcador da planta original, sim. */
function semImagemEmbutida(projeto: Projeto): Projeto {
  const ref = projeto.planta.referencia;
  if (!ref || !ref.imagem.startsWith("data:")) return projeto;
  const { referencia: _fora, ...planta } = projeto.planta;
  return { ...projeto, planta };
}

/** Fotografa o projeto atual numa versão nova. `sufixo` torna o id único (aleatório fora dos testes). */
export function criarVersao(projeto: Projeto, nome: string | undefined, existentes: Pick<Versao, "nome">[], agora: Date, miniatura?: string, sufixo = Math.random().toString(36).slice(2, 7)): Versao {
  const instante = agora.toISOString();
  return {
    id: `v-${agora.getTime().toString(36)}-${sufixo}`,
    nome: nomeLimpo(nome, existentes, agora),
    criadaEm: instante,
    atualizadaEm: instante,
    // cópia profunda: a versão não muda quando o projeto continuar sendo editado
    projeto: JSON.parse(JSON.stringify(semImagemEmbutida(projeto))) as Projeto,
    ...(miniatura ? { miniatura } : {}),
  };
}

/** Cópia de uma versão com outro nome ("… (cópia)"), salva como versão nova. */
export function duplicarVersao(v: Versao, existentes: Pick<Versao, "nome">[], agora: Date, sufixo?: string): Versao {
  const nomes = new Set(existentes.map((x) => x.nome));
  let nome = `${v.nome} (cópia)`.slice(0, TAMANHO_NOME);
  for (let i = 2; nomes.has(nome); i++) nome = `${v.nome} (cópia ${i})`.slice(0, TAMANHO_NOME);
  return { ...criarVersao(v.projeto, nome, existentes, agora, v.miniatura, sufixo) };
}

export function renomearVersao(v: Versao, nome: string, agora: Date): Versao {
  const limpo = nome.replace(/\s+/g, " ").trim().slice(0, TAMANHO_NOME);
  return limpo && limpo !== v.nome ? { ...v, nome: limpo, atualizadaEm: agora.toISOString() } : v;
}

/** Mais recentes primeiro. */
export function ordenarVersoes(versoes: Versao[]): Versao[] {
  return [...versoes].sort((a, b) => (a.criadaEm < b.criadaEm ? 1 : a.criadaEm > b.criadaEm ? -1 : a.id < b.id ? 1 : -1));
}

/** Junta as versões do aparelho com as da conta: uma por id, valendo a alterada por último. */
export function juntarVersoes(...listas: Versao[][]): Versao[] {
  const porId = new Map<string, Versao>();
  for (const v of listas.flat()) {
    const atual = porId.get(v.id);
    if (!atual || v.atualizadaEm > atual.atualizadaEm) porId.set(v.id, v);
  }
  return ordenarVersoes([...porId.values()]);
}

/**
 * O projeto de uma versão pronto para voltar a ser o projeto em edição: cópia profunda (editar não mexe na
 * versão guardada), na base atual e marcado como alterado pelo usuário, para não ser trocado por uma base nova.
 * A imagem de planta importada, que a versão não guarda, é mantida do projeto atual.
 */
export function projetoDaVersao(v: Versao, atual: Projeto, base: string, agora: Date): Projeto {
  const copia = JSON.parse(JSON.stringify(v.projeto)) as Projeto;
  const referencia = copia.planta.referencia ?? atual.planta.referencia;
  return {
    ...copia,
    id: atual.id,
    base,
    alteradoPeloUsuario: true,
    atualizadoEm: agora.toISOString(),
    planta: { ...copia.planta, ...(referencia ? { referencia } : {}) },
  };
}

/** O que a versão guardada tem de igual ao projeto em edição? (para marcar "é a que está aberta") */
export function mesmaDecoracao(v: Versao, projeto: Projeto): boolean {
  const essencial = (p: Projeto) => JSON.stringify({ paredes: p.planta.paredes, aberturas: p.planta.aberturas, ambientes: p.planta.ambientes, vertices: p.planta.vertices, moveis: p.moveis });
  return essencial(v.projeto) === essencial(projeto);
}

/** Uma versão lida do armazenamento é válida? (dados antigos ou corrompidos são ignorados) */
export function versaoValida(x: unknown): x is Versao {
  const v = x as Versao | undefined;
  return !!v && typeof v.id === "string" && typeof v.nome === "string" && typeof v.criadaEm === "string" && !!v.projeto && v.projeto.versaoModelo === 2 && Array.isArray(v.projeto.moveis) && Array.isArray(v.projeto.planta?.paredes);
}
