/**
 * Salvamento na página publicada (Artifact do Claude): usa o banco de dados da própria página
 * (capacidade `db`), que fica na conta do dono e vale em qualquer aparelho. Fora de uma página
 * publicada (npm run dev) `window.claude` não existe e tudo aqui devolve "indisponível".
 *
 * O projeto em edição é um documento só: `projetos/principal` = { app, base, atualizadoEm, projeto }.
 * Cada versão nomeada da decoração é um documento em `versoes/<id>`. Limite da plataforma: 256 KiB por
 * documento — por isso a imagem da planta importada pelo usuário (data URI) não vai junto.
 */
import type { Projeto } from "../modelo/tipos";
import { versaoValida, type Versao } from "../modelo/versoes";

interface Instantaneo {
  id?: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface Documento {
  get(): Promise<Instantaneo>;
  set(dados: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}
interface Colecao {
  get(): Promise<{ docs: Instantaneo[] }>;
}
interface Banco {
  doc(caminho: string): Documento;
  /** Só existe no banco de verdade (nos testes antigos o banco simulado tem apenas `doc`). */
  collection?(caminho: string): Colecao;
}

const DOC_PROJETO = "projetos/principal";
const LIMITE_BYTES = 230_000;

let promessa: Promise<Banco | null> | null = null;
let somenteLeitura = false;

/** O banco da página, ou null quando não há (app local, visitante sem acesso, falha ao carregar). */
export function banco(): Promise<Banco | null> {
  if (!promessa) {
    const claude = (globalThis as { claude?: { use?: (nome: string) => Promise<unknown> } }).claude;
    promessa =
      typeof claude?.use === "function"
        ? claude
            .use("db")
            .then((b) => (b as Banco | null) ?? null)
            .catch(() => null)
        : Promise.resolve(null);
  }
  return promessa;
}

function valido(p: unknown): p is Projeto {
  const x = p as Projeto | undefined;
  return !!x && x.versaoModelo === 2 && Array.isArray(x.moveis) && !!x.planta && Array.isArray(x.planta.paredes);
}

export async function carregarDaNuvem(): Promise<Projeto | undefined> {
  const db = await banco();
  if (!db) return undefined;
  const foto = await db.doc(DOC_PROJETO).get();
  if (!foto.exists) return undefined;
  const projeto = foto.data()?.projeto;
  // os dados são congelados pela plataforma: clona antes de usar como estado editável
  return valido(projeto) ? (JSON.parse(JSON.stringify(projeto)) as Projeto) : undefined;
}

/** Corpo do documento: JSON puro, sem `undefined` e sem imagem embutida. */
function corpo(projeto: Projeto): Record<string, unknown> {
  const ref = projeto.planta.referencia;
  const enxuto: Projeto = ref?.imagem.startsWith("data:") ? { ...projeto, planta: { ...projeto.planta, referencia: undefined } } : projeto;
  const json = JSON.stringify(enxuto);
  if (json.length > LIMITE_BYTES) throw Object.assign(new Error("Projeto grande demais para o banco da página"), { code: "invalid_argument" });
  return { app: "apartment-studio", base: projeto.base, atualizadoEm: projeto.atualizadoEm, projeto: JSON.parse(json) };
}

let gravando = false;
let pendente: Projeto | null = null;

/**
 * Grava o projeto no banco da página. Uma escrita por vez: se chegar outra enquanto grava,
 * só a mais recente é enviada em seguida. Devolve true quando ficou salvo lá.
 */
export async function salvarNaNuvem(projeto: Projeto): Promise<boolean> {
  const db = await banco();
  if (!db || somenteLeitura) return false;
  pendente = projeto;
  if (gravando) return true;
  gravando = true;
  try {
    while (pendente) {
      const atual = pendente;
      pendente = null;
      try {
        await db.doc(DOC_PROJETO).set(corpo(atual));
      } catch (e) {
        const codigo = (e as { code?: string })?.code;
        if (codigo === "unavailable") {
          // condição passageira: uma nova tentativa depois de uma pausa curta
          await new Promise((r) => setTimeout(r, 600 + Math.random() * 900));
          await db.doc(DOC_PROJETO).set(corpo(atual));
        } else {
          throw e;
        }
      }
    }
    return true;
  } catch (e) {
    const codigo = (e as { code?: string })?.code;
    // sem permissão de escrita ou acesso retirado: para de tentar nesta visita
    if (codigo === "invalid_argument" || codigo === "revoked" || codigo === "not_granted") somenteLeitura = true;
    console.warn("Não foi possível salvar no banco da página:", e);
    pendente = null;
    return false;
  } finally {
    gravando = false;
  }
}

/** Cópia de segurança do projeto (antes de adotar uma base nova). */
export async function salvarCopiaNaNuvem(projeto: Projeto): Promise<void> {
  const db = await banco();
  if (!db || somenteLeitura) return;
  await db.doc(`copias/${new Date().toISOString()}`).set(corpo(projeto));
}

// ------------------------------------------------------------------------------ versões da decoração
const COLECAO_VERSOES = "versoes";

/** Versões guardadas na conta (lista vazia fora da página publicada). */
export async function listarVersoesNaNuvem(): Promise<Versao[]> {
  const db = await banco();
  if (!db?.collection) return [];
  const foto = await db.collection(COLECAO_VERSOES).get();
  const versoes: Versao[] = [];
  for (const d of foto.docs) {
    const corpo = d.data()?.versao;
    // os dados chegam congelados: clona antes de entrar no estado do app
    if (versaoValida(corpo)) versoes.push(JSON.parse(JSON.stringify(corpo)) as Versao);
  }
  return versoes;
}

/** Guarda (ou atualiza) uma versão na conta. Devolve true quando ficou salva lá. */
export async function gravarVersaoNaNuvem(versao: Versao): Promise<boolean> {
  const db = await banco();
  if (!db || somenteLeitura) return false;
  const json = JSON.stringify(versao);
  if (json.length > LIMITE_BYTES) {
    // grande demais com a miniatura: tenta sem ela antes de desistir
    const { miniatura: _fora, ...semMiniatura } = versao;
    if (JSON.stringify(semMiniatura).length > LIMITE_BYTES) return false;
    return gravarVersaoNaNuvem(semMiniatura);
  }
  try {
    await db.doc(`${COLECAO_VERSOES}/${versao.id}`).set({ app: "apartment-studio", nome: versao.nome, criadaEm: versao.criadaEm, versao: JSON.parse(json) });
    return true;
  } catch (e) {
    const codigo = (e as { code?: string })?.code;
    if (codigo === "revoked" || codigo === "not_granted") somenteLeitura = true;
    console.warn("Não foi possível salvar a versão no banco da página:", e);
    return false;
  }
}

export async function apagarVersaoNaNuvem(id: string): Promise<void> {
  const db = await banco();
  if (!db || somenteLeitura) return;
  try {
    await db.doc(`${COLECAO_VERSOES}/${id}`).delete();
  } catch (e) {
    console.warn("Não foi possível apagar a versão no banco da página:", e);
  }
}
