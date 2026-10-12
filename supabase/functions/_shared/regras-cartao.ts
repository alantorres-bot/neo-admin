// Regras "fornecedor → cartão" vindas do Neo Fiscal (função cartao-regras de lá): validação da resposta e plano de
// gravação no espelho crt_regras_fornecedor. Lógica pura (sem rede, sem banco), usada pela Edge Function
// crt-sincronizar-regras e testada em lib/modulos/financeiro/cartao/regras.test.ts.

export type RegraRecebida = { codFornecedor: string; cartao: string; parcelasPadrao: number; vigenciaIni: string; vigenciaFim: string | null };
export type RegraGravada = { id: string; cod_fornecedor: string; cartao: string; parcelas_padrao: number; vigencia_ini: string; vigencia_fim: string | null };

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Valida a resposta do Neo Fiscal ({ versao: 1, regras: [...] }). Devolve as regras ou o motivo da recusa. */
export function lerResposta(corpo: unknown): { ok: true; regras: RegraRecebida[] } | { ok: false; erro: string } {
  if (!corpo || typeof corpo !== "object") return { ok: false, erro: "Resposta vazia do Neo Fiscal." };
  const c = corpo as { versao?: unknown; regras?: unknown; erro?: unknown };
  if (typeof c.erro === "string") return { ok: false, erro: `Neo Fiscal: ${c.erro}` };
  if (c.versao !== 1) return { ok: false, erro: "Versão da resposta do Neo Fiscal desconhecida." };
  if (!Array.isArray(c.regras)) return { ok: false, erro: "A resposta do Neo Fiscal não traz as regras." };
  const regras: RegraRecebida[] = [];
  for (const r of c.regras as Record<string, unknown>[]) {
    const cod = r.codFornecedor === null || r.codFornecedor === undefined ? "" : String(r.codFornecedor).trim();
    const cartao = typeof r.cartao === "string" ? r.cartao.trim() : "";
    const ini = typeof r.vigenciaIni === "string" ? r.vigenciaIni.slice(0, 10) : "";
    const fim = typeof r.vigenciaFim === "string" ? r.vigenciaFim.slice(0, 10) : null;
    if (!cod || !cartao || !DATA.test(ini) || (fim !== null && !DATA.test(fim))) return { ok: false, erro: `Regra inválida na resposta (fornecedor ${cod || "?"}).` };
    regras.push({ codFornecedor: cod, cartao, parcelasPadrao: Math.max(1, Math.floor(Number(r.parcelasPadrao) || 1)), vigenciaIni: ini, vigenciaFim: fim });
  }
  return { ok: true, regras };
}

export type PlanoRegras = {
  inserir: Omit<RegraGravada, "id">[];
  atualizar: { id: string; campos: Partial<Omit<RegraGravada, "id">> }[];
  remover: string[];
};

/** Compara o que veio com o espelho, pela chave (fornecedor, início da vigência): insere, atualiza e remove o que sumiu lá. */
export function planejar(recebidas: readonly RegraRecebida[], gravadas: readonly RegraGravada[]): PlanoRegras {
  const chave = (cod: string, ini: string) => `${cod}|${ini}`;
  const porChave = new Map(gravadas.map((g) => [chave(g.cod_fornecedor, g.vigencia_ini), g]));
  const vistas = new Set<string>();
  const plano: PlanoRegras = { inserir: [], atualizar: [], remover: [] };
  for (const r of recebidas) {
    const k = chave(r.codFornecedor, r.vigenciaIni);
    if (vistas.has(k)) continue;
    vistas.add(k);
    const g = porChave.get(k);
    if (!g) {
      plano.inserir.push({ cod_fornecedor: r.codFornecedor, cartao: r.cartao, parcelas_padrao: r.parcelasPadrao, vigencia_ini: r.vigenciaIni, vigencia_fim: r.vigenciaFim });
      continue;
    }
    const campos: Partial<Omit<RegraGravada, "id">> = {};
    if (g.cartao !== r.cartao) campos.cartao = r.cartao;
    if (g.parcelas_padrao !== r.parcelasPadrao) campos.parcelas_padrao = r.parcelasPadrao;
    if ((g.vigencia_fim ?? null) !== r.vigenciaFim) campos.vigencia_fim = r.vigenciaFim;
    if (Object.keys(campos).length > 0) plano.atualizar.push({ id: g.id, campos });
  }
  for (const g of gravadas) if (!vistas.has(chave(g.cod_fornecedor, g.vigencia_ini))) plano.remover.push(g.id);
  return plano;
}
