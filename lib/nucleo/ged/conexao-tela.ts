// GED — tela de conexão com o Google Drive (Configurações > Google Drive). Regras puras da tela: retorno do OAuth por códigos
// fixos, situação da conexão, mensagens da desconexão. Nada aqui recebe ou exibe token, segredo_id ou google_sub.
// Fluxo e segurança: supabase/functions/_shared/ged.ts (tratarConexao/tratarDesconexao) e migration 0801.

import type { CodigoErroConexao } from "@/supabase/functions/_shared/ged";

/** Destino interno fixo da volta do OAuth (o mesmo aceito pelo check de ged_conexao_estados). */
export const ROTA_CONEXAO_GED = "/configuracoes/documentos";
export const FUNCAO_CONEXAO_GED = "nucleo-ged-conectar";

/** Linha devolvida por ged_situacao_conexao() — a projeção autorizada, sem campos protegidos. */
export type SituacaoConexaoGed = {
  email: string;
  escopos: string[];
  conectado_em: string;
  desconectado_em: string | null;
  revogacao_remota: "ok" | "falhou" | "nao_tentada" | null;
  ultimo_erro: CodigoErroConexao | null;
  ultimo_erro_em: string | null;
  situacao: "conectada" | "com_erro" | "desconectada";
};

const MENSAGEM_ERRO: Record<CodigoErroConexao, string> = {
  recusado: "A autorização foi recusada no Google.",
  conta_divergente: "A conta usada no Google não é a conta configurada para o GED (ou já há outra conta conectada: desconecte antes).",
  escopo_divergente: "A permissão concedida não é a esperada (somente leitura do Drive). Conecte de novo e aceite apenas o acesso pedido.",
  identidade_invalida: "Não foi possível confirmar a identidade da conta Google. Conecte de novo.",
  token_ausente: "O Google não devolveu a autorização permanente. Conecte de novo.",
  http: "O Google não respondeu como esperado. Tente de novo em alguns minutos.",
  invalid_grant: "A autorização do Drive deixou de valer (revogada ou expirada). Conecte de novo.",
};

export type Aviso = { tipo: "sucesso" | "erro" | "aviso"; mensagem: string };

/** Lê o retorno do OAuth (?ged=conectado|recusado|erro&codigo=…). Só códigos conhecidos; qualquer outro texto vira genérico. */
export function lerRetornoGed(ged: string | null, codigo: string | null): Aviso | null {
  if (ged === "conectado") return { tipo: "sucesso", mensagem: "Google Drive conectado." };
  if (ged !== "recusado" && ged !== "erro") return null;
  const conhecida = codigo && Object.hasOwn(MENSAGEM_ERRO, codigo) ? MENSAGEM_ERRO[codigo as CodigoErroConexao] : null;
  return { tipo: "erro", mensagem: conhecida ?? "Não foi possível conectar o Google Drive." };
}

/** Situação para a tela. Sem linha = nunca conectada. */
export function descreverSituacao(s: SituacaoConexaoGed | null): { estado: "desconectada" | "conectada" | "com_erro"; rotulo: string; detalhe: string | null } {
  if (!s || s.situacao === "desconectada") {
    const rev = s?.revogacao_remota === "falhou" ? "A revogação no Google falhou na última desconexão: revogue o acesso manualmente em myaccount.google.com." : null;
    return { estado: "desconectada", rotulo: "Desconectado", detalhe: rev };
  }
  if (s.situacao === "com_erro") {
    return { estado: "com_erro", rotulo: "Com erro", detalhe: s.ultimo_erro ? MENSAGEM_ERRO[s.ultimo_erro] : "A conexão precisa ser refeita." };
  }
  return { estado: "conectada", rotulo: "Conectado", detalhe: null };
}

/** URL da Edge Function para a ida ao Google. O state vem do banco (64 hex); qualquer outra coisa é recusada. */
export function urlInicioConexaoGed(supabaseUrl: string | undefined, state: unknown): string | null {
  if (typeof state !== "string" || !/^[0-9a-f]{64}$/.test(state)) return null;
  const base = (supabaseUrl ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+$/.test(base)) return null;
  return `${base}/functions/v1/${FUNCAO_CONEXAO_GED}?state=${state}`;
}

/** Erro do banco ao iniciar: as mensagens levantadas pelas nossas funções (P0001) são seguras e em português. */
export function mensagemErroInicio(e: { code?: string; message: string }): string {
  return e.code === "P0001" && !e.message.startsWith("ged:") ? e.message : "Não foi possível iniciar a conexão. Tente de novo.";
}

/**
 * Trava contra ação duplicada (clique duplo antes de a tela atualizar o estado "pendente"): enquanto uma ação roda, as
 * seguintes são ignoradas. Devolve false quando a chamada foi ignorada.
 */
export function criarTrava() {
  let ocupada = false;
  return async (acao: () => Promise<void>): Promise<boolean> => {
    if (ocupada) return false;
    ocupada = true;
    try {
      await acao();
      return true;
    } finally {
      ocupada = false;
    }
  };
}

/**
 * Conta dedicada do GED (administrativo.ged.conta), como o banco a compara (minúsculas, sem espaços). Só do domínio do grupo:
 * o id_token é conferido com hd = neoformas.com.br, então qualquer outro domínio nunca conectaria.
 */
export function validarContaGed(texto: unknown): { ok: true; conta: string } | { ok: false; erro: string } {
  const conta = typeof texto === "string" ? texto.trim().toLowerCase() : "";
  if (!conta) return { ok: false, erro: "Informe o e-mail da conta dedicada do GED." };
  if (conta.length > 254 || !/^[a-z0-9._%+-]+@neoformas\.com\.br$/.test(conta)) {
    return { ok: false, erro: "Use um e-mail @neoformas.com.br válido." };
  }
  return { ok: true, conta };
}

/** Resultado da desconexão, conforme o que a Edge Function informou sobre a revogação no Google. */
export function mensagemDesconexao(revogacao: unknown): Aviso {
  if (revogacao === "ok") return { tipo: "sucesso", mensagem: "Google Drive desconectado e acesso revogado no Google." };
  if (revogacao === "falhou") {
    return { tipo: "aviso", mensagem: "Google Drive desconectado aqui, mas a revogação no Google falhou. Revogue o acesso manualmente em myaccount.google.com." };
  }
  return { tipo: "sucesso", mensagem: "Google Drive desconectado. A revogação no Google não foi feita (desligada ou sem conexão ativa)." };
}
