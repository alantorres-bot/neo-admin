// Inclusão de lançamento no Contas a Pagar do Consistem (PUT financeiro/v10/lancamentoContasPagar, operationId
// GerarLancamentoContaPagar). Única ESCRITA do Neo Admin no ERP: o título de encargos da fatura do cartão.
// Lógica PURA (sem Deno, sem Supabase) para ser testada com o Vitest do projeto e usada pela Edge Function crt-lancar-encargos.
//
// Regra de ouro: NUNCA repetir o envio sozinho. Se não dá para saber se o título foi criado (queda de rede, tempo esgotado,
// erro 5xx, resposta sem código), o resultado é "incerto" e uma pessoa confere no Consistem antes de qualquer nova tentativa.

export const ROTA_INCLUSAO_LANCAMENTO = "financeiro/v10/lancamentoContasPagar";
export const ROTA_INCLUSAO_FORNECEDOR = "cadastrosgerais/v10/fornecedor";

export type Enviar = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  text: () => Promise<string>;
}>;

export type ResultadoInclusao =
  | { tipo: "lancado"; codLancamento: string; /** O mesmo código (lançamento ou fornecedor). */ codigo: string; resposta: unknown }
  | { tipo: "erro"; mensagem: string; resposta: unknown }
  | { tipo: "incerto"; mensagem: string; resposta: unknown };

const CONFERIR = "confira no Consistem se o título foi criado antes de tentar de novo";

/** Interpreta a resposta da API: só "lancado" com código e "erro" quando é certo que nada foi criado (4xx). */
export function lerRespostaInclusao(status: number, corpo: string, campoCodigo = "codLancamento"): ResultadoInclusao {
  let json: unknown = null;
  try { json = corpo ? JSON.parse(corpo) : null; } catch { json = corpo.slice(0, 500); }
  if (status >= 200 && status < 300) {
    const obj = Array.isArray(json) ? json[0] : json;
    const cod = obj && typeof obj === "object" ? (obj as Record<string, unknown>)[campoCodigo] : undefined;
    const texto = cod === undefined || cod === null ? "" : String(cod).trim();
    if (/^\d{1,12}$/.test(texto)) return { tipo: "lancado", codLancamento: texto, codigo: texto, resposta: json };
    return { tipo: "incerto", mensagem: `O Consistem respondeu ${status} sem o código: ${CONFERIR}.`, resposta: json };
  }
  if (status === 401 || status === 403) {
    return { tipo: "erro", mensagem: `Acesso negado pelo Consistem (HTTP ${status}): o token da API (CSMEN050) precisa de permissão para esta inclusão.`, resposta: json };
  }
  if (status === 429) return { tipo: "erro", mensagem: "O Consistem recusou por excesso de requisições (HTTP 429). Tente de novo em instantes.", resposta: json };
  if (status >= 400 && status < 500) {
    const lista = Array.isArray(json) ? json : [json];
    const mensagens = lista.map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>).mensagem : typeof e === "string" ? e : null))
      .filter((m): m is string => typeof m === "string" && m.trim() !== "");
    return { tipo: "erro", mensagem: `O Consistem recusou (HTTP ${status})${mensagens.length ? `: ${mensagens.join("; ")}` : "."}`, resposta: json };
  }
  return { tipo: "incerto", mensagem: `O Consistem respondeu HTTP ${status}: ${CONFERIR}.`, resposta: json };
}

type Cfg = { baseUrl: string; token: string; empresa: string };

/** Envia o título UMA vez (sem repetir em erro ou demora) e interpreta a resposta. */
export function incluirLancamento(enviar: Enviar, cfg: Cfg, corpo: unknown, opcoes: { tempoMs?: number } = {}): Promise<ResultadoInclusao> {
  return incluir(enviar, cfg, ROTA_INCLUSAO_LANCAMENTO, "codLancamento", corpo, opcoes);
}

/** Cadastra o fornecedor UMA vez (PUT cadastrosgerais/v10/fornecedor); o código vem em `codFornecedor`. */
export function incluirFornecedor(enviar: Enviar, cfg: Cfg, corpo: unknown, opcoes: { tempoMs?: number } = {}): Promise<ResultadoInclusao> {
  return incluir(enviar, cfg, ROTA_INCLUSAO_FORNECEDOR, "codFornecedor", corpo, opcoes);
}

/** PUT único (sem repetir em erro ou demora) numa rota de inclusão do Consistem, lendo o código criado em `campoCodigo`. */
export async function incluir(enviar: Enviar, cfg: Cfg, rota: string, campoCodigo: string, corpo: unknown, opcoes: { tempoMs?: number } = {}): Promise<ResultadoInclusao> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/${rota}`;
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), opcoes.tempoMs ?? 60_000);
  try {
    const resp = await enviar(url, {
      method: "PUT",
      headers: { Authorization: cfg.token, empresa: cfg.empresa, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: controle.signal,
    });
    return lerRespostaInclusao(resp.status, await resp.text(), campoCodigo);
  } catch (e) {
    const motivo = e instanceof Error && e.name === "AbortError" ? "o Consistem não respondeu a tempo" : "falha de rede ao chamar o Consistem";
    return { tipo: "incerto", mensagem: `Sem resposta (${motivo}): ${CONFERIR}.`, resposta: null };
  } finally {
    clearTimeout(relogio);
  }
}

// ---------------------------------------------------------------- alteração do portador (cartão, migration 0162)
// PUT financeiro/v10/lancamentoContasPagar/{id} só com { codPortador }: troca o banco do título da fatura do cartão (filtro do
// borderô). Trocar o portador é idempotente: quem chama SEMPRE lê o detalhe depois e decide pelo que está no Consistem.

export type ResultadoAlteracao =
  | { tipo: "ok"; resposta: unknown }
  | { tipo: "erro"; mensagem: string; resposta: unknown }
  | { tipo: "incerto"; mensagem: string; resposta: unknown };

/** Envia a troca do portador UMA vez e interpreta a resposta (2xx = aceito; 4xx = recusado; 5xx/sem resposta = incerto). */
export async function alterarPortador(enviar: Enviar, cfg: Cfg, codLancamento: string, codPortador: number, opcoes: { tempoMs?: number } = {}): Promise<ResultadoAlteracao> {
  if (!/^\d{1,12}$/.test(codLancamento)) return { tipo: "erro", mensagem: `Código de lançamento inválido: ${codLancamento}.`, resposta: null };
  const r = await incluir(enviar, cfg, `${ROTA_INCLUSAO_LANCAMENTO}/${codLancamento}`, "codLancamento", { codPortador }, opcoes);
  // 2xx: aceito (com ou sem o código na resposta; a conferência é pelo detalhe lido depois).
  if (r.tipo === "lancado" || (r.tipo === "incerto" && /respondeu 2\d\d sem o código/.test(r.mensagem))) return { tipo: "ok", resposta: r.resposta };
  return r.tipo === "erro" ? r : { tipo: "incerto", mensagem: r.mensagem.replace(CONFERIR, "a troca é conferida pelo detalhe do título"), resposta: r.resposta };
}

/** Campos que mudam sozinhos numa alteração (data/usuário da alteração): fora da conferência. */
const VOLATEIS = /alterac|atualiz|usuario|hora|^data(Ult|Ultima)/i;

/**
 * Confere a troca pelo detalhe do lançamento lido antes e depois do PUT: o portador tem de ser o novo e TODO o resto igual
 * (valor, vencimento, fornecedor, documento, contas…). Diferença = o PUT mexeu em mais do que devia.
 */
export function conferirTroca(antes: Record<string, unknown>, depois: Record<string, unknown>, portadorNovo: number):
  { ok: true } | { ok: false; mensagem: string; diferencas: string[] } {
  const diferencas: string[] = [];
  for (const k of Object.keys(antes)) {
    if (k === "codPortador" || VOLATEIS.test(k)) continue;
    const a = JSON.stringify(antes[k] ?? null);
    const d = JSON.stringify(depois[k] ?? null);
    if (a !== d) diferencas.push(`${k}: ${a.slice(0, 80)} → ${d.slice(0, 80)}`);
  }
  if (Number(depois.codPortador) !== portadorNovo) {
    return { ok: false, mensagem: `O Consistem aceitou, mas o portador continua ${String(depois.codPortador ?? "vazio")} (esperado ${portadorNovo}).`, diferencas };
  }
  if (diferencas.length) {
    return { ok: false, mensagem: `O portador mudou, mas outros campos também mudaram no Consistem (corrija lá): ${diferencas.join("; ")}`, diferencas };
  }
  return { ok: true };
}
