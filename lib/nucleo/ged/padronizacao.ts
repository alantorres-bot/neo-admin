// GED — tela de padronização de nomes (5.12): filtros, rótulos e mensagens. As regras de análise e de nome estão em
// supabase/functions/_shared/ged.ts (analisarDocumento, montarNomePadrao, validarNomeEditado).

export const ROTA_PADRONIZACAO = "/documentos/padronizacao";
export const FUNCAO_ANALISE_GED = "nucleo-ged-analisar";
export const LIMITE_LISTA = 200;

export const SITUACOES_ANALISE = {
  sugerida: "Sugerida", sem_texto: "Sem texto", nao_suportado: "Formato não lido", erro: "Erro",
  aprovada: "Aprovada", editada: "Editada", rejeitada: "Rejeitada",
} as const;
export type SituacaoAnalise = keyof typeof SITUACOES_ANALISE;
export const CONFIANCAS = { alta: "Alta", media: "Média", baixa: "Baixa" } as const;
export type Confianca = keyof typeof CONFIANCAS;

export type FiltrosPadronizacao = { finalidade: "elaboracao" | "dossie_cliente" | null; tipo: string | null; cliente: string; situacao: SituacaoAnalise | null; confianca: Confianca | null };

const um = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "");
/** Filtros da URL: só valores conhecidos; o resto é ignorado. */
export function lerFiltros(p: Record<string, unknown>, tipos: readonly string[]): FiltrosPadronizacao {
  const finalidade = um(p.raiz);
  const tipo = um(p.tipo);
  const situacao = um(p.situacao);
  const confianca = um(p.confianca);
  return {
    finalidade: finalidade === "elaboracao" || finalidade === "dossie_cliente" ? finalidade : null,
    tipo: tipos.includes(tipo) ? tipo : null,
    cliente: um(p.cliente).trim().slice(0, 80),
    situacao: Object.hasOwn(SITUACOES_ANALISE, situacao) ? (situacao as SituacaoAnalise) : null,
    confianca: Object.hasOwn(CONFIANCAS, confianca) ? (confianca as Confianca) : null,
  };
}

/** Padrão `ilike` do filtro de cliente, com `%` e `_` do usuário escapados; nulo com menos de 2 letras. */
export const padraoCliente = (t: string) => (t.length >= 2 ? `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null);

export type ResultadoAnalise = { analisados: number; sugerida: number; sem_texto: number; nao_suportado: number; erro: number; pendentes: number };
/** Resposta da Edge Function: só contagens; qualquer outra coisa é rejeitada. */
export function lerResultadoAnalise(d: unknown): ResultadoAnalise | null {
  const r = d as Record<string, unknown> | null;
  const campos = ["analisados", "sugerida", "sem_texto", "nao_suportado", "erro", "pendentes"] as const;
  if (!r || !campos.every((c) => Number.isInteger(r[c]) && (r[c] as number) >= 0)) return null;
  return Object.fromEntries(campos.map((c) => [c, r[c]])) as ResultadoAnalise;
}
export function resumoAnalise(r: ResultadoAnalise): string {
  if (r.analisados === 0) return "Nenhum documento novo para analisar.";
  const partes = [`${r.sugerida} com sugestão pelo conteúdo`, r.sem_texto && `${r.sem_texto} sem texto`, r.nao_suportado && `${r.nao_suportado} em formato não lido`,
    r.erro && `${r.erro} com erro`, r.pendentes && `${r.pendentes} ficaram para a próxima`].filter(Boolean);
  return `${r.analisados} analisado(s): ${partes.join(", ")}.`;
}

const MENSAGENS: Record<string, string> = {
  sem_permissao: "Só o administrador geral usa a padronização.",
  nao_encontrada: "Análise não encontrada.",
  sem_sugestao: "Não há nome sugerido para aprovar.",
  nome_invalido: "Nome inválido: vazio ou com mais de 150 caracteres (os caracteres / \\ : * ? \" < > | são retirados).",
  motivo_obrigatorio: "Informe o motivo da rejeição.",
  decisao_invalida: "Decisão inválida.",
  desconectado: "O Google Drive do GED não está conectado.",
  invalid_grant: "A autorização do Drive deixou de valer. Reconecte em Configurações > Google Drive.",
  pedido_invalido: "Pedido inválido.",
};
export function mensagemPadronizacao(codigoOuErro: unknown): string {
  const c = typeof codigoOuErro === "string" ? (/ged:([a-z_]+)/.exec(codigoOuErro)?.[1] ?? codigoOuErro) : null;
  return c && Object.hasOwn(MENSAGENS, c) ? MENSAGENS[c] : "Não foi possível concluir agora. Tente de novo.";
}
