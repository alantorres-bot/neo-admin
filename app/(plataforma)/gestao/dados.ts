// Leitura da Central de Gestão: tudo pelas funções do banco (migration 0092), com a sessão de quem consulta (a RLS vale).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Motivo, NivelDestaque } from "@/lib/nucleo/gestao/destaque";
import { filtrosParaBanco, type FiltrosCentral, type Visao } from "@/lib/nucleo/gestao/filtros";
import type { Criticidade, StatusPendencia } from "@/lib/nucleo/tipos";

/** Linha de `central_pendencias`. */
export type LinhaCentral = {
  id: string; modulo: string; modulo_nome: string; area: string; area_nome: string; titulo: string; descricao: string | null;
  prazo: string | null; prioridade: Criticidade; status: StatusPendencia; responsavel_id: string | null; responsavel_nome: string | null;
  contraparte_nome: string | null; link: string | null; origem: "modulo" | "manual"; categoria: string | null;
  criado_em: string; criado_por_nome: string | null; movimentado_em: string; concluido_em: string | null;
  bloqueada: boolean; bloqueada_em: string | null; bloqueio_motivo: string | null;
  aguarda_gestor: boolean; aguarda_gestor_em: string | null; aguarda_gestor_motivo: string | null;
  impacto: "financeiro" | "fiscal" | "operacional" | null; impacto_fundamento: string | null;
  precisa_distribuir: boolean; atrasada: boolean; vence_hoje: boolean;
  destaque: NivelDestaque; peso: number; motivos: Motivo[]; calculado_em: string;
};

export type Resumo = {
  em_aberto: number; atrasadas: number; vencem_hoje: number; intervir: number; aguarda_gestor: number; bloqueadas: number; distribuir: number;
};

export type LinhaEquipe = {
  responsavel_id: string; nome: string; areas: string; abertas: number; atrasadas: number; vencem_hoje: number;
  bloqueadas: number; aguarda_gestor: number; ultima_movimentacao: string | null;
};

export type LinhaArea = {
  area: string; area_nome: string; modulo: string; modulo_nome: string; abertas: number; atrasadas: number; intervir: number;
  avaliar: number; bloqueadas: number; aguarda_gestor: number; distribuir: number;
};

const ITENS_POR_PAGINA_PADRAO = 50;
const LIMITE_INTERVENCAO = 50;


export async function lerCentral(
  supabase: SupabaseClient, visao: Visao, filtros: FiltrosCentral, pagina: number,
): Promise<{
  resumo: Resumo; intervencao: LinhaCentral[]; fila: LinhaCentral[]; total: number; porPagina: number; equipe: LinhaEquipe[] | null;
  areas: LinhaArea[] | null;
}> {
  const banco = filtrosParaBanco(filtros);
  const semRecorte = { ...banco };
  delete semRecorte.recorte; delete semRecorte.destaque; delete semRecorte.situacao;

  const parametros = await supabase.rpc("central_parametros");
  if (parametros.error) throw new Error(`Falha ao ler os parâmetros da Central: ${parametros.error.message}`);
  const porPagina = Number((parametros.data as Record<string, unknown> | null)?.itens_por_pagina) || ITENS_POR_PAGINA_PADRAO;
  const inicio = (pagina - 1) * porPagina;

  const [resumo, intervencao, fila, equipe, areas] = await Promise.all([
    supabase.rpc("central_resumo", { p_visao: visao, p_filtros: banco }).single(),
    // Ordem da Central: maior destaque primeiro, depois o prazo (sem prazo por último) e a criação mais antiga.
    supabase.rpc("central_pendencias", { p_visao: visao, p_filtros: { ...semRecorte, recorte: "intervir" } })
      .order("peso", { ascending: false }).order("prazo", { ascending: true, nullsFirst: false }).order("criado_em")
      .limit(LIMITE_INTERVENCAO),
    supabase.rpc("central_pendencias", { p_visao: visao, p_filtros: banco }, { count: "exact" })
      .order("peso", { ascending: false }).order("prazo", { ascending: true, nullsFirst: false }).order("criado_em")
      .range(inicio, inicio + porPagina - 1),
    visao === "gestao" ? supabase.rpc("central_equipe", { p_filtros: banco }) : Promise.resolve(null),
    visao === "gestao" ? supabase.rpc("central_por_area", { p_visao: visao, p_filtros: banco }) : Promise.resolve(null),
  ]);
  for (const r of [resumo, intervencao, fila, equipe, areas]) {
    if (r?.error) throw new Error(`Falha ao ler a Central de Gestão: ${r.error.message}`);
  }

  return {
    resumo: resumo.data as Resumo,
    intervencao: (intervencao.data ?? []) as LinhaCentral[],
    fila: (fila.data ?? []) as LinhaCentral[],
    total: fila.count ?? 0,
    porPagina,
    equipe: equipe ? ((equipe.data ?? []) as LinhaEquipe[]) : null,
    areas: areas ? ((areas.data ?? []) as LinhaArea[]) : null,
  };
}

/** Uma pendência visível a quem consulta (qualquer status), ou null. */
export async function lerPendencia(supabase: SupabaseClient, id: string): Promise<LinhaCentral | null> {
  const { data, error } = await supabase.rpc("central_pendencias", { p_visao: "gestao", p_filtros: { id } }).maybeSingle();
  if (error) throw new Error(`Falha ao ler a pendência: ${error.message}`);
  return (data as LinhaCentral | null) ?? null;
}
