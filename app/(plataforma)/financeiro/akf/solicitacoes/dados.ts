// Leituras do fluxo "Solicitar antecipação" (Fase 2 do módulo AKF). Só leitura, com o cliente do usuário (a RLS vale).
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerPartes } from "@/lib/modulos/financeiro/akf/parcial";
import {
  ehStatusSolicitacao, MODULO_AKF, montarEmailSolicitacao, tratamentoDe, type ItemEmail, type StatusSolicitacao,
} from "@/lib/modulos/financeiro/akf/solicitacao";
import { emCentavos } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { FUSO } from "@/lib/nucleo/fila";
import { clienteSemBoleto, ESTAGIOS_ANTECIPAVEIS, PORTADOR_AKF } from "@/supabase/functions/_shared/akf";
import { escolherContato, type ContatoEscolha } from "@/supabase/functions/_shared/contatos";
import type { Unidade } from "@/supabase/functions/_shared/cobranca";

export const CHAVES_AKF = {
  semBoleto: "financeiro.akf.clientes_sem_boleto",
  observacaoSemBoleto: "financeiro.akf.observacao_sem_boleto",
  copia: "financeiro.akf.copia",
  contraparte: "financeiro.akf.contraparte_id",
} as const;

export type ParametrosAkf = {
  termosSemBoleto: string[];
  observacaoSemBoleto: string;
  copia: string[];
  contraparteId: string | null;
};

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);

export async function lerParametrosAkf(supabase: SupabaseClient): Promise<ParametrosAkf> {
  const { data, error } = await supabase.from("configuracoes").select("chave, valor").in("chave", Object.values(CHAVES_AKF));
  if (error) throw new Error(`Falha ao ler os parâmetros da AKF: ${error.message}`);
  const por = new Map((data ?? []).map((l) => [l.chave as string, l.valor as unknown]));
  const obs = por.get(CHAVES_AKF.observacaoSemBoleto);
  const contraparte = por.get(CHAVES_AKF.contraparte);
  return {
    termosSemBoleto: lista(por.get(CHAVES_AKF.semBoleto)),
    observacaoSemBoleto: typeof obs === "string" && obs.trim() !== "" ? obs : "Operar com 01 dia após o vencimento e não emitir boleto.",
    copia: lista(por.get(CHAVES_AKF.copia)),
    contraparteId: typeof contraparte === "string" && contraparte !== "" ? contraparte : null,
  };
}

export type DestinatarioAkf = { id: string; nome: string; email: string };

/** Contatos da contraparte AKF com a finalidade "akf" e e-mail (os destinatários do rascunho). */
export async function lerDestinatariosAkf(supabase: SupabaseClient, contraparteId: string | null): Promise<{ contraparteNome: string | null; destinatarios: DestinatarioAkf[] }> {
  if (!contraparteId) return { contraparteNome: null, destinatarios: [] };
  const [{ data: cp }, { data: contatos }] = await Promise.all([
    supabase.from("contrapartes").select("nome").eq("id", contraparteId).maybeSingle(),
    supabase.from("contatos").select("id, nome, email, whatsapp, telefone, finalidades, canal_preferido, ativo").eq("contraparte_id", contraparteId).order("nome"),
  ]);
  const todos = (contatos ?? []) as ContatoEscolha[];
  // Todos os contatos ativos com a finalidade "akf" e e-mail; sem nenhum com a finalidade, cai na regra do núcleo (um contato com e-mail).
  const comFinalidade = todos.filter((c) => c.ativo !== false && typeof c.email === "string" && c.email.trim() !== "" && c.finalidades.includes("akf"));
  const escolhidos = comFinalidade.length > 0 ? comFinalidade : [escolherContato(todos, "akf", "email")].filter((c): c is ContatoEscolha => c !== null);
  return { contraparteNome: (cp?.nome as string | undefined) ?? null, destinatarios: escolhidos.map((c) => ({ id: c.id, nome: c.nome, email: (c.email as string).trim() })) };
}

export type TituloParaSolicitar = {
  id: string;
  clienteId: string;
  documento: string;
  cliente: string;
  unidade: Unidade;
  vencimento: string; // aaaa-mm-dd
  valorTituloCentavos: number;
  /** O que resta com a Neo (título − partes antecipadas ativas). */
  restanteCentavos: number;
  semBoleto: boolean;
  /** Já está numa solicitação aberta: nº e situação. */
  solicitacao: { id: string; numero: number; status: StatusSolicitacao } | null;
};

type LinhaTitulo = { id: string; contraparte_id: string; documento: string; parcela: string; vencimento: string; valor: number | string; unidade: string };

/** Títulos disponíveis para antecipar (mesma regra da tela AKF), com o restante, o selo "sem boleto" e a solicitação aberta. */
export async function lerTitulosParaSolicitar(supabase: SupabaseClient, parametros: ParametrosAkf, unidade: Unidade | null): Promise<TituloParaSolicitar[]> {
  let consulta = supabase.from("rec_vw_titulos")
    .select("id, contraparte_id, documento, parcela, vencimento, valor, unidade")
    .eq("faixa", "a_vencer").eq("cedido", false).eq("contestado", false).in("estagio", [...ESTAGIOS_ANTECIPAVEIS])
    .or(`cod_portador.is.null,cod_portador.neq.${PORTADOR_AKF}`)
    .order("vencimento").order("documento").limit(1000);
  if (unidade) consulta = consulta.eq("unidade", unidade);
  const { data, error } = await consulta;
  if (error) throw new Error(`Falha ao ler os títulos disponíveis: ${error.message}`);
  const titulos = (data ?? []) as LinhaTitulo[];
  const ids = titulos.map((t) => t.id);
  const idsClientes = [...new Set(titulos.map((t) => t.contraparte_id))];

  const lerNomes = async () => {
    const nomes = new Map<string, string>();
    await Promise.all(Array.from({ length: Math.ceil(idsClientes.length / 100) }, (_, i) => idsClientes.slice(i * 100, (i + 1) * 100)).map(async (lote) => {
      const { data: cs } = await supabase.from("contrapartes").select("id, nome").in("id", lote);
      for (const c of cs ?? []) nomes.set(c.id as string, c.nome as string);
    }));
    return nomes;
  };
  const lerSolicitadas = async () => {
    const m = new Map<string, { id: string; numero: number; status: StatusSolicitacao }>();
    await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => ids.slice(i * 100, (i + 1) * 100)).map(async (lote) => {
      const { data: ss } = await supabase.from("akf_vw_titulos_solicitados").select("titulo_id, operacao_id, numero, status").in("titulo_id", lote);
      for (const s of ss ?? []) if (ehStatusSolicitacao(s.status as string)) m.set(s.titulo_id as string, { id: s.operacao_id as string, numero: Number(s.numero), status: s.status as StatusSolicitacao });
    }));
    return m;
  };
  const [nomes, partes, solicitadas] = await Promise.all([lerNomes(), lerPartes(supabase, ids), lerSolicitadas()]);

  return titulos.map((t) => {
    const cliente = nomes.get(t.contraparte_id) ?? "—";
    const parte = partes.get(t.id);
    return {
      id: t.id,
      clienteId: t.contraparte_id,
      documento: `${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`,
      cliente,
      unidade: t.unidade === "contagem" ? "contagem" : "matriz",
      vencimento: t.vencimento,
      valorTituloCentavos: emCentavos(t.valor),
      restanteCentavos: parte ? parte.restanteCentavos : emCentavos(t.valor),
      semBoleto: clienteSemBoleto(cliente, parametros.termosSemBoleto),
      solicitacao: solicitadas.get(t.id) ?? null,
    };
  });
}

export type ItemSolicitacao = ItemEmail & { id: string; tituloId: string; clienteId: string | null; valorTituloCentavos: number; ordem: number };

export type Solicitacao = {
  id: string;
  numero: number;
  data: string;
  status: StatusSolicitacao;
  observacao: string | null;
  assunto: string | null;
  corpo: string | null;
  mensagemId: string | null;
  rascunhoGmail: string | null;
  destinatario: string | null;
  cc: string | null;
  criadoEm: string;
  criadoPorNome: string | null;
  solicitadaEm: string | null;
  solicitadaPorNome: string | null;
  canceladaEm: string | null;
  canceladaPorNome: string | null;
  motivoCancelamento: string | null;
  itens: ItemSolicitacao[];
  totalCentavos: number;
};

export async function lerSolicitacao(supabase: SupabaseClient, id: string): Promise<Solicitacao | null> {
  const [{ data: o, error }, { data: itens, error: erroItens }] = await Promise.all([
    supabase.from("akf_vw_operacoes").select("*").eq("id", id).maybeSingle(),
    supabase.from("akf_operacao_titulos").select("id, titulo_id, contraparte_id, documento, cliente_nome, vencimento, valor_titulo, valor_restante, valor_solicitado, parcial, sem_boleto, observacao, ordem").eq("operacao_id", id).order("ordem"),
  ]);
  if (error) throw new Error(`Falha ao ler a solicitação: ${error.message}`);
  if (erroItens) throw new Error(`Falha ao ler os títulos da solicitação: ${erroItens.message}`);
  // Excluída da lista (0133) some das telas; continua no banco.
  if (!o || o.excluida_em || !ehStatusSolicitacao(o.status as string)) return null;
  const lista: ItemSolicitacao[] = (itens ?? []).map((i) => ({
    id: i.id as string, tituloId: i.titulo_id as string, clienteId: (i.contraparte_id as string | null) ?? null,
    documento: i.documento as string, cliente: i.cliente_nome as string, vencimento: i.vencimento as string,
    valorTituloCentavos: emCentavos(i.valor_titulo as number | string), valorRestanteCentavos: emCentavos(i.valor_restante as number | string),
    valorSolicitadoCentavos: emCentavos(i.valor_solicitado as number | string), parcial: !!i.parcial, semBoleto: !!i.sem_boleto,
    observacao: (i.observacao as string | null) ?? null, ordem: Number(i.ordem),
  }));
  return {
    id: o.id as string, numero: Number(o.numero), data: o.data as string, status: o.status as StatusSolicitacao,
    observacao: (o.observacao as string | null) ?? null, assunto: (o.assunto as string | null) ?? null, corpo: (o.corpo as string | null) ?? null,
    mensagemId: (o.mensagem_id as string | null) ?? null, rascunhoGmail: (o.rascunho_gmail as string | null) ?? null,
    destinatario: (o.destinatario as string | null) ?? null, cc: (o.cc as string | null) ?? null,
    criadoEm: o.criado_em as string, criadoPorNome: (o.criado_por_nome as string | null) ?? null,
    solicitadaEm: (o.solicitada_em as string | null) ?? null, solicitadaPorNome: (o.solicitada_por_nome as string | null) ?? null,
    canceladaEm: (o.cancelada_em as string | null) ?? null, canceladaPorNome: (o.cancelada_por_nome as string | null) ?? null,
    motivoCancelamento: (o.motivo_cancelamento as string | null) ?? null,
    itens: lista, totalCentavos: lista.reduce((s, i) => s + i.valorSolicitadoCentavos, 0),
  };
}

export type LinhaSolicitacao = {
  id: string; numero: number; data: string; status: StatusSolicitacao; itens: number; totalCentavos: number; parciais: number; semBoleto: number;
  criadoPorNome: string | null; solicitadaEm: string | null; rascunhoGmail: string | null;
};

export async function listarSolicitacoes(supabase: SupabaseClient, opcoes: { status: StatusSolicitacao | null; pagina: number; porPagina: number }): Promise<{ linhas: LinhaSolicitacao[]; total: number }> {
  let consulta = supabase.from("akf_vw_operacoes")
    .select("id, numero, data, status, itens, total, parciais, sem_boleto, criado_por_nome, solicitada_em, rascunho_gmail", { count: "exact" })
    .is("excluida_em", null)
    .order("numero", { ascending: false })
    .range((opcoes.pagina - 1) * opcoes.porPagina, opcoes.pagina * opcoes.porPagina - 1);
  if (opcoes.status) consulta = consulta.eq("status", opcoes.status);
  const { data, count, error } = await consulta;
  if (error) throw new Error(`Falha ao listar as solicitações: ${error.message}`);
  return {
    total: count ?? 0,
    linhas: (data ?? []).filter((l) => ehStatusSolicitacao(l.status as string)).map((l) => ({
      id: l.id as string, numero: Number(l.numero), data: l.data as string, status: l.status as StatusSolicitacao,
      itens: Number(l.itens), totalCentavos: emCentavos(l.total as number | string), parciais: Number(l.parciais), semBoleto: Number(l.sem_boleto),
      criadoPorNome: (l.criado_por_nome as string | null) ?? null, solicitadaEm: (l.solicitada_em as string | null) ?? null, rascunhoGmail: (l.rascunho_gmail as string | null) ?? null,
    })),
  };
}

/** Hora local em Cuiabá (0–23), para a saudação do e-mail. */
export function horaEmCuiaba(agora: Date = new Date()): number {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: FUSO, hour: "numeric", hour12: false }).format(agora));
  return Number.isFinite(h) ? h % 24 : agora.getHours();
}

export type EmailPronto = { assunto: string; corpo: string; para: DestinatarioAkf[]; cc: string[]; tratamento: string; contraparteNome: string | null };

/** O e-mail da solicitação como vai para o rascunho (a página mostra a prévia; a ação grava o mesmo texto). */
export async function montarEmailDaSolicitacao(supabase: SupabaseClient, sol: Solicitacao, agora: Date = new Date()): Promise<EmailPronto> {
  const parametros = await lerParametrosAkf(supabase);
  const { contraparteNome, destinatarios } = await lerDestinatariosAkf(supabase, parametros.contraparteId);
  const tratamento = tratamentoDe(destinatarios.map((d) => d.nome));
  const { assunto, corpo } = montarEmailSolicitacao({
    itens: sol.itens, data: sol.data, hora: horaEmCuiaba(agora), tratamento,
    observacaoSemBoleto: parametros.observacaoSemBoleto, observacaoGeral: sol.observacao,
  });
  return { assunto, corpo, para: destinatarios, cc: parametros.copia, tratamento, contraparteNome };
}

export { MODULO_AKF };
