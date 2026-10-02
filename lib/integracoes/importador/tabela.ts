// Núcleo do importador genérico: transforma uma matriz de células em tabela e aplica o mapeamento
// "coluna do arquivo -> campo de destino". Sem regra de módulo: valores seguem como texto bruto
// (datas e números do Consistem são interpretados pelo módulo que consome a importação).

export type Matriz = string[][];

export type Tabela = {
  colunas: string[];
  linhas: string[][];
  /** índice (base 0) da linha da matriz usada como cabeçalho */
  linhaCabecalho: number;
};

export type CampoDestino = {
  chave: string;
  rotulo: string;
  obrigatorio?: boolean;
  /** outros nomes com que a coluna costuma aparecer nos relatórios */
  apelidos?: string[];
};

/** Formato guardado em importacao_modelos.mapeamento e copiado em importacoes.mapeamento. */
export type ModeloMapeamento = {
  versao: 1;
  linhaCabecalho: number;
  /** coluna do arquivo -> chave do campo de destino; colunas ausentes são ignoradas */
  colunas: Record<string, string>;
};

export const normalizarTexto = (texto: string): string =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** 'Data de Vencimento' -> 'data_de_vencimento' */
export function chaveDoCampo(rotulo: string): string {
  return rotulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Lê a lista de campos de destino digitada, um por linha. Terminar com `*` marca como obrigatório.
 * Usado enquanto o módulo ainda não define os próprios campos (Fase 0).
 */
export function lerCamposDestino(texto: string): CampoDestino[] {
  const campos: CampoDestino[] = [];
  const usadas = new Set<string>();
  for (const linha of texto.split(/\r?\n/)) {
    const obrigatorio = linha.trim().endsWith("*");
    const rotulo = linha.trim().replace(/\*+$/, "").trim();
    const chave = chaveDoCampo(rotulo);
    if (!chave || usadas.has(chave)) continue;
    usadas.add(chave);
    campos.push({ chave, rotulo, obrigatorio });
  }
  return campos;
}

const pareceNumero =(celula: string): boolean => /^[\d.,\s%R$()-]+$/.test(celula.trim()) && /\d/.test(celula);

/**
 * Relatórios do Consistem costumam ter linhas de título antes do cabeçalho. O cabeçalho é a primeira
 * linha, entre as 30 primeiras, que preenche boa parte das colunas e é majoritariamente texto.
 */
export function detectarLinhaCabecalho(matriz: Matriz): number {
  const janela = matriz.slice(0, 30);
  const preenchidas = janela.map((linha) => linha.filter((c) => c.trim() !== "").length);
  const maximo = Math.max(0, ...preenchidas);
  if (maximo < 2) return 0;
  const minimo = Math.max(2, Math.ceil(maximo * 0.6));
  for (let i = 0; i < janela.length; i++) {
    if (preenchidas[i] < minimo) continue;
    const celulas = janela[i].filter((c) => c.trim() !== "");
    const numericas = celulas.filter(pareceNumero).length;
    if (numericas <= celulas.length / 2) return i;
  }
  return 0;
}

/** Cabeçalhos vazios viram "Coluna N"; repetidos ganham sufixo "(2)", "(3)". */
export function nomesDeColunas(cabecalho: readonly string[]): string[] {
  const vistos = new Map<string, number>();
  return cabecalho.map((bruto, i) => {
    const base = bruto.trim() === "" ? `Coluna ${i + 1}` : bruto.trim();
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

export function extrairTabela(matriz: Matriz, linhaCabecalho: number): Tabela {
  const cabecalho = matriz[linhaCabecalho] ?? [];
  const largura = Math.max(cabecalho.length, ...matriz.slice(linhaCabecalho + 1, linhaCabecalho + 200).map((l) => l.length), 0);
  const colunas = nomesDeColunas(Array.from({ length: largura }, (_, i) => cabecalho[i] ?? ""));
  const linhas = matriz
    .slice(linhaCabecalho + 1)
    .filter((linha) => linha.some((c) => c.trim() !== ""))
    .map((linha) => colunas.map((_, i) => (linha[i] ?? "").trim()));
  return { colunas, linhas, linhaCabecalho };
}

/** Sugere o campo de destino de cada coluna comparando nomes sem acento/pontuação. Um campo por coluna. */
export function sugerirMapeamento(colunas: readonly string[], campos: readonly CampoDestino[]): Record<string, string> {
  const mapa: Record<string, string> = {};
  const usados = new Set<string>();
  for (const coluna of colunas) {
    const alvo = normalizarTexto(coluna);
    const campo = campos.find(
      (c) =>
        !usados.has(c.chave) &&
        [c.chave, c.rotulo, ...(c.apelidos ?? [])].some((nome) => normalizarTexto(nome) === alvo),
    );
    if (campo) {
      mapa[coluna] = campo.chave;
      usados.add(campo.chave);
    }
  }
  return mapa;
}

/**
 * Reaproveita um modelo salvo num arquivo novo: mantém só as colunas que existem no arquivo
 * e informa as que o modelo esperava e não vieram (o relatório pode ter mudado de layout).
 */
export function reaproveitarModelo(modelo: ModeloMapeamento, colunas: readonly string[]) {
  const existentes = new Set(colunas);
  const aplicado: Record<string, string> = {};
  const ausentes: string[] = [];
  for (const [coluna, campo] of Object.entries(modelo.colunas)) {
    if (existentes.has(coluna)) aplicado[coluna] = campo;
    else ausentes.push(coluna);
  }
  return { colunas: aplicado, ausentes };
}

export type ProblemaMapeamento = { tipo: "obrigatorio_sem_coluna" | "campo_duplicado"; campo: string; mensagem: string };

export function validarMapeamento(mapeamento: Readonly<Record<string, string>>, campos: readonly CampoDestino[]): ProblemaMapeamento[] {
  const problemas: ProblemaMapeamento[] = [];
  const contagem = new Map<string, number>();
  for (const campo of Object.values(mapeamento)) contagem.set(campo, (contagem.get(campo) ?? 0) + 1);
  for (const campo of campos) {
    if (campo.obrigatorio && !contagem.has(campo.chave)) {
      problemas.push({ tipo: "obrigatorio_sem_coluna", campo: campo.chave, mensagem: `O campo "${campo.rotulo}" é obrigatório e nenhuma coluna foi ligada a ele.` });
    }
    if ((contagem.get(campo.chave) ?? 0) > 1) {
      problemas.push({ tipo: "campo_duplicado", campo: campo.chave, mensagem: `Mais de uma coluna está ligada a "${campo.rotulo}".` });
    }
  }
  return problemas;
}

/** Aplica o mapeamento: cada linha vira { campo: texto }, só com as colunas mapeadas. */
export function aplicarMapeamento(tabela: Tabela, mapeamento: Readonly<Record<string, string>>): Record<string, string>[] {
  const ligacoes = tabela.colunas
    .map((coluna, indice) => ({ indice, campo: mapeamento[coluna] }))
    .filter((l): l is { indice: number; campo: string } => Boolean(l.campo));
  return tabela.linhas.map((linha) => {
    const registro: Record<string, string> = {};
    for (const { indice, campo } of ligacoes) registro[campo] = linha[indice] ?? "";
    return registro;
  });
}

export function criarModelo(mapeamento: Record<string, string>, linhaCabecalho: number): ModeloMapeamento {
  return { versao: 1, linhaCabecalho, colunas: mapeamento };
}

/** Valida um jsonb vindo do banco antes de usar como modelo. */
export function lerModelo(valor: unknown): ModeloMapeamento | null {
  if (typeof valor !== "object" || valor === null) return null;
  const v = valor as Record<string, unknown>;
  if (v.versao !== 1 || typeof v.linhaCabecalho !== "number" || typeof v.colunas !== "object" || v.colunas === null) return null;
  const colunas: Record<string, string> = {};
  for (const [k, campo] of Object.entries(v.colunas)) {
    if (typeof campo !== "string") return null;
    colunas[k] = campo;
  }
  return { versao: 1, linhaCabecalho: v.linhaCabecalho, colunas };
}
