// Inclusão de lançamento no Contas a Pagar do Consistem (PUT financeiro/v10/lancamentoContasPagar, operationId
// GerarLancamentoContaPagar). Única ESCRITA do Neo Admin no ERP: o título de encargos da fatura do cartão.
// Lógica PURA (sem Deno, sem Supabase) para ser testada com o Vitest do projeto e usada pela Edge Function crt-lancar-encargos.
//
// Regra de ouro: NUNCA repetir o envio sozinho. Se não dá para saber se o título foi criado (queda de rede, tempo esgotado,
// erro 5xx, resposta sem código), o resultado é "incerto" e uma pessoa confere no Consistem antes de qualquer nova tentativa.

export const ROTA_INCLUSAO_LANCAMENTO = "financeiro/v10/lancamentoContasPagar";

export type Enviar = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  text: () => Promise<string>;
}>;

export type ResultadoInclusao =
  | { tipo: "lancado"; codLancamento: string; resposta: unknown }
  | { tipo: "erro"; mensagem: string; resposta: unknown }
  | { tipo: "incerto"; mensagem: string; resposta: unknown };

const CONFERIR = "confira no Consistem se o título foi criado antes de tentar de novo";

/** Interpreta a resposta da API: só "lancado" com código e "erro" quando é certo que nada foi criado (4xx). */
export function lerRespostaInclusao(status: number, corpo: string): ResultadoInclusao {
  let json: unknown = null;
  try { json = corpo ? JSON.parse(corpo) : null; } catch { json = corpo.slice(0, 500); }
  if (status >= 200 && status < 300) {
    const obj = Array.isArray(json) ? json[0] : json;
    const cod = obj && typeof obj === "object" ? (obj as Record<string, unknown>).codLancamento : undefined;
    const texto = cod === undefined || cod === null ? "" : String(cod).trim();
    if (/^\d{1,12}$/.test(texto)) return { tipo: "lancado", codLancamento: texto, resposta: json };
    return { tipo: "incerto", mensagem: `O Consistem respondeu ${status} sem o código do lançamento: ${CONFERIR}.`, resposta: json };
  }
  if (status === 401 || status === 403) {
    return { tipo: "erro", mensagem: `Acesso negado pelo Consistem (HTTP ${status}): o token da API (CSMEN050) precisa de permissão para incluir lançamentos.`, resposta: json };
  }
  if (status === 429) return { tipo: "erro", mensagem: "O Consistem recusou por excesso de requisições (HTTP 429). Tente de novo em instantes.", resposta: json };
  if (status >= 400 && status < 500) {
    const lista = Array.isArray(json) ? json : [json];
    const mensagens = lista.map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>).mensagem : typeof e === "string" ? e : null))
      .filter((m): m is string => typeof m === "string" && m.trim() !== "");
    return { tipo: "erro", mensagem: `O Consistem recusou o título (HTTP ${status})${mensagens.length ? `: ${mensagens.join("; ")}` : "."}`, resposta: json };
  }
  return { tipo: "incerto", mensagem: `O Consistem respondeu HTTP ${status}: ${CONFERIR}.`, resposta: json };
}

/** Envia o título UMA vez (sem repetir em erro ou demora) e interpreta a resposta. */
export async function incluirLancamento(
  enviar: Enviar,
  cfg: { baseUrl: string; token: string; empresa: string },
  corpo: unknown,
  opcoes: { tempoMs?: number } = {},
): Promise<ResultadoInclusao> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/${ROTA_INCLUSAO_LANCAMENTO}`;
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), opcoes.tempoMs ?? 60_000);
  try {
    const resp = await enviar(url, {
      method: "PUT",
      headers: { Authorization: cfg.token, empresa: cfg.empresa, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: controle.signal,
    });
    return lerRespostaInclusao(resp.status, await resp.text());
  } catch (e) {
    const motivo = e instanceof Error && e.name === "AbortError" ? "o Consistem não respondeu a tempo" : "falha de rede ao chamar o Consistem";
    return { tipo: "incerto", mensagem: `Sem resposta (${motivo}): ${CONFERIR}.`, resposta: null };
  } finally {
    clearTimeout(relogio);
  }
}
