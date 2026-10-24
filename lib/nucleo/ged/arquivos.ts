// GED — arquivos temporários e sugestão de versão de negócio (docs/modulos/administrativo-ged.md, 5.2.7 e 5.6.3–5.6.4).
// A sugestão de substituição nunca é aplicada sozinha: uma pessoa declara "este arquivo substitui aquele".

/** Padrões padrão de `administrativo.ged.ignorar_padroes`: começa com `~$` ou `~WRL`, ou termina em `.tmp`. */
export const IGNORAR_PADROES_PADRAO = ["^~\\$", "^~wrl", "\\.tmp$"];

/** Arquivo temporário ou de sistema: fica `ignorado` e não aparece na busca. */
export function ehArquivoTemporario(nome: string, padroes: readonly string[] = IGNORAR_PADROES_PADRAO): boolean {
  return padroes.some((p) => new RegExp(p, "i").test(nome.trim()));
}

const MARCA_VERSAO = /\s*(?:\bv\s*(\d+)|\brev\.?\s*(\d+)|\((\d+)\))\s*$/i;

/** Nome sem extensão e sem a marca de versão final (`V2`, `Rev03`, `(1)`), com a versão encontrada (0 = sem marca). */
export function separarVersao(nome: string): { base: string; extensao: string; versao: number } {
  const ponto = nome.lastIndexOf(".");
  const extensao = ponto > 0 ? nome.slice(ponto + 1).toLowerCase() : "";
  let base = ponto > 0 ? nome.slice(0, ponto) : nome;
  const m = MARCA_VERSAO.exec(base);
  const versao = m ? Number(m[1] ?? m[2] ?? m[3]) : 0;
  if (m) base = base.slice(0, m.index);
  return { base: base.trim().toLowerCase(), extensao, versao };
}

export type ArquivoVersionavel = { id: string; nome: string; raizId: string; pastaId: string };
export type SugestaoSubstituicao = { substitutoId: string; substituidoId: string };

/**
 * Sugere substituições entre arquivos da mesma pasta (e, por consequência, da mesma raiz) com o mesmo nome-base e a mesma
 * extensão, que diferem só pela marca de versão. O de versão maior substitui o de versão menor mais próxima.
 * Arquivos de raízes diferentes nunca são comparados (5.6.4).
 */
export function sugerirSubstituicoes(arquivos: readonly ArquivoVersionavel[]): SugestaoSubstituicao[] {
  const grupos = new Map<string, { id: string; versao: number }[]>();
  for (const a of arquivos) {
    const { base, extensao, versao } = separarVersao(a.nome);
    const chave = JSON.stringify([a.raizId, a.pastaId, base, extensao]);
    grupos.set(chave, [...(grupos.get(chave) ?? []), { id: a.id, versao }]);
  }
  const sugestoes: SugestaoSubstituicao[] = [];
  for (const grupo of grupos.values()) {
    const ordenado = [...grupo].sort((a, b) => a.versao - b.versao);
    for (let i = 1; i < ordenado.length; i++) {
      // Mesma versão (ex.: duas cópias sem marca) não é sugestão: não dá para saber qual substitui qual.
      if (ordenado[i].versao !== ordenado[i - 1].versao) {
        sugestoes.push({ substitutoId: ordenado[i].id, substituidoId: ordenado[i - 1].id });
      }
    }
  }
  return sugestoes;
}
