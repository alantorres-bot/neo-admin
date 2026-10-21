// Leituras do RH > Banco de horas (RLS: só a área RH). O cálculo vem das views rh_bh_saldos e rh_bh_aberto (migration 0519).
import type { SupabaseClient } from "@supabase/supabase-js";

type Cliente = SupabaseClient;
const um = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v);

export type Saldo = {
  pessoa_id: string; nome: string; setor_id: string | null; setor: string; colaborador_id: string | null;
  saldo_controlid_min: number | null; saldo_em: string | null; saldo_min: number;
  /** vencidos: a empresa paga (+) / descontar (−) no fechamento */
  pagar_min: number; descontar_min: number;
  /** vencendo no prazo do aviso: folgar (+) / repor (−) */
  folgar_min: number; repor_min: number;
  proximo_vencimento: string | null; limite_negativo_min: number;
};

const COLUNAS_SALDO = "pessoa_id, nome, setor_id, colaborador_id, saldo_controlid_min, saldo_em, saldo_min, pagar_min, descontar_min, folgar_min, repor_min, proximo_vencimento, limite_negativo_min";

export type Parametros = { inicio: string; validadeMeses: number; avisoDias: number; limiteNegativoMin: number };

export async function lerParametros(supabase: Cliente): Promise<Parametros> {
  const { data } = await supabase.from("configuracoes").select("chave, valor").like("chave", "rh.banco_horas.%");
  const v = Object.fromEntries((data ?? []).map((c) => [String(c.chave).replace("rh.banco_horas.", ""), c.valor as unknown]));
  return { inicio: String(v.inicio ?? "2026-04-26"), validadeMeses: Number(v.validade_meses ?? 6), avisoDias: Number(v.aviso_dias ?? 30), limiteNegativoMin: Number(v.limite_negativo_min ?? 600) };
}

async function nomesDosSetores(supabase: Cliente) {
  const { data } = await supabase.from("rh_pt_setores").select("id, nome");
  return new Map((data ?? []).map((s) => [s.id as string, s.nome as string]));
}

export async function lerSaldos(supabase: Cliente): Promise<Saldo[]> {
  const [{ data }, nomeSetor] = await Promise.all([supabase.from("rh_bh_saldos").select(COLUNAS_SALDO).order("nome"), nomesDosSetores(supabase)]);
  return (data ?? []).map((s) => ({ ...s, setor: nomeSetor.get(s.setor_id as string) ?? "" })) as Saldo[];
}

export type ItemAbertoBanco = { data: string; sinal: 1 | -1; restante: number; vencimento: string };

export async function lerPessoa(supabase: Cliente, id: string) {
  const [saldo, movimentos, aberto, lancamentos, nomeSetor] = await Promise.all([
    supabase.from("rh_bh_saldos").select(`${COLUNAS_SALDO}, cpf`).eq("pessoa_id", id).maybeSingle(),
    supabase.from("rh_bh_movimentos").select("data, positivo_min, negativo_min").eq("pessoa_id", id).or("positivo_min.gt.0,negativo_min.gt.0").order("data", { ascending: false }),
    supabase.from("rh_bh_aberto").select("data, sinal, restante, vencimento").eq("pessoa_id", id).order("data"),
    supabase.from("rh_bh_lancamentos_folha").select("id, tipo, minutos, competencia, observacao, cancelado_em, cancelado_motivo").eq("pessoa_id", id).order("competencia", { ascending: false }),
    nomesDosSetores(supabase),
  ]);
  if (!saldo.data) return null;
  return {
    saldo: { ...saldo.data, setor: nomeSetor.get(saldo.data.setor_id as string) ?? "" } as Saldo & { cpf: string },
    movimentos: (movimentos.data ?? []) as { data: string; positivo_min: number; negativo_min: number }[],
    aberto: (aberto.data ?? []) as ItemAbertoBanco[],
    lancamentos: (lancamentos.data ?? []) as { id: string; tipo: "pago" | "descontado"; minutos: number; competencia: string; observacao: string | null; cancelado_em: string | null; cancelado_motivo: string | null }[],
  };
}

export async function lerImportacoes(supabase: Cliente) {
  const { data } = await supabase.from("rh_bh_importacoes")
    .select("id, periodo_inicio, periodo_fim, arquivo_nome, pessoas, movimentos, importado_em, quem:perfis!rh_bh_importacoes_importado_por_fkey(nome)")
    .order("importado_em", { ascending: false }).limit(100);
  return (data ?? []).map(({ quem, ...i }) => ({ ...i, quem: um(quem as unknown as { nome: string } | null)?.nome ?? "" })) as {
    id: string; periodo_inicio: string; periodo_fim: string; arquivo_nome: string; pessoas: number; movimentos: number; importado_em: string; quem: string;
  }[];
}

export type StatusFechamento = "emitido" | "devolvido" | "aprovado" | "enviado" | "lancado" | "cancelado";
export const ROTULO_FECHAMENTO: Record<StatusFechamento, string> = {
  emitido: "Aguardando aprovação", devolvido: "Devolvido", aprovado: "Aprovado: enviar ao escritório", enviado: "Com o escritório", lancado: "Lançado na folha", cancelado: "Cancelado",
};

export type Fechamento = {
  id: string; competencia: string; status: StatusFechamento;
  emitido_em: string; emitido_por_nome: string; aprovado_em: string | null; aprovado_por_nome: string | null;
  devolvido_motivo: string | null; enviado_em: string | null; lancado_em: string | null; cancelado_motivo: string | null;
  pessoas: number; pagar_min: number; descontar_min: number;
};

const COLUNAS_FECH = "id, competencia, status, emitido_em, aprovado_em, devolvido_motivo, enviado_em, lancado_em, cancelado_motivo, emissor:perfis!rh_bh_fechamentos_emitido_por_fkey(nome), aprovador:perfis!rh_bh_fechamentos_aprovado_por_fkey(nome), itens:rh_bh_fechamento_itens(pagar_min, descontar_min)";

type LinhaFech = Omit<Fechamento, "emitido_por_nome" | "aprovado_por_nome" | "pessoas" | "pagar_min" | "descontar_min"> & {
  emissor: unknown; aprovador: unknown; itens: { pagar_min: number; descontar_min: number }[] | null;
};
const montarFech = ({ emissor, aprovador, itens, ...f }: LinhaFech): Fechamento => ({
  ...f, emitido_por_nome: um(emissor as { nome: string } | null)?.nome ?? "", aprovado_por_nome: um(aprovador as { nome: string } | null)?.nome ?? null,
  pessoas: (itens ?? []).length, pagar_min: (itens ?? []).reduce((s, i) => s + i.pagar_min, 0), descontar_min: (itens ?? []).reduce((s, i) => s + i.descontar_min, 0),
});

export async function lerFechamentos(supabase: Cliente): Promise<Fechamento[]> {
  const { data } = await supabase.from("rh_bh_fechamentos").select(COLUNAS_FECH).order("competencia", { ascending: false }).order("emitido_em", { ascending: false });
  return ((data ?? []) as unknown as LinhaFech[]).map(montarFech);
}

export type ItemFechamento = { pessoa_id: string; nome: string; cpf: string; setor: string | null; pagar_min: number; descontar_min: number; ciclos: string | null };

export async function lerFechamento(supabase: Cliente, id: string): Promise<{ fechamento: Fechamento; itens: ItemFechamento[] } | null> {
  const [{ data }, { data: itens }] = await Promise.all([
    supabase.from("rh_bh_fechamentos").select(COLUNAS_FECH).eq("id", id).maybeSingle(),
    supabase.from("rh_bh_fechamento_itens").select("pessoa_id, nome, cpf, setor, pagar_min, descontar_min, ciclos").eq("fechamento_id", id).order("nome"),
  ]);
  return data ? { fechamento: montarFech(data as unknown as LinhaFech), itens: (itens ?? []) as ItemFechamento[] } : null;
}
