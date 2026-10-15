// Leituras do Painel do RH (RLS de quem chama; nada é gravado aqui). As regras ficam em lib/modulos/rh/painel/painel.ts.
import { lerItens, lerMeses, totaisDoAno, type MesFolha, type TotaisMesFolha } from "@/app/(plataforma)/rh/folha/dados";
import type { SituacaoFechamento } from "@/lib/modulos/rh/painel/painel";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;
const COLUNAS_MES = "id, competencia, data_pagamento, status, conferida_em, aprovada_em, paga_em, reaberta_em, reaberta_motivo, arquivo_bb_gerado_em, conferida_por, aprovada_por";

export type PendenciaRh = { id: string; titulo: string; descricao: string | null; prazo: string | null; criticidade: string; link: string | null };

export type DadosPainel = {
  meses: MesFolha[];
  totais: Map<string, TotaisMesFolha>;
  fechamento: { mes: MesFolha; situacao: SituacaoFechamento } | null;
  destaque: { mes: MesFolha; totais: TotaisMesFolha | null; anterior: number | null } | null;
  colaboradores: { ativos: number; comVt: number };
  pendencias: PendenciaRh[];
};

async function totaisDe(supabase: Cliente, mes: MesFolha, cache: Map<string, TotaisMesFolha>) {
  return cache.get(mes.id) ?? (await totaisDoAno(supabase, [mes.id])).get(mes.id) ?? null;
}

export async function lerPainel(supabase: Cliente, ano: number): Promise<DadosPainel> {
  const [meses, abertos, emAprovacao, ultimaPaga, ativos, comVt, pend] = await Promise.all([
    lerMeses(supabase, ano),
    supabase.from("rh_fp_competencias").select(COLUNAS_MES).eq("status", "aberta").order("competencia").limit(1),
    supabase.from("rh_fp_competencias").select(COLUNAS_MES).in("status", ["conferida", "aprovada"]).order("competencia", { ascending: false }).limit(1),
    supabase.from("rh_fp_competencias").select(COLUNAS_MES).eq("status", "paga").order("competencia", { ascending: false }).limit(1),
    supabase.from("rh_colaboradores").select("id", { count: "exact", head: true }).eq("ativo", true),
    supabase.from("rh_colaboradores").select("id", { count: "exact", head: true }).eq("ativo", true).eq("recebe_vt", true),
    supabase.from("pendencias").select("id, titulo, descricao, prazo, criticidade, link").like("modulo", "rh.%").in("status", ["aberta", "em_andamento"])
      .order("prazo", { ascending: true, nullsFirst: false }).limit(8),
  ]);
  const totais = await totaisDoAno(supabase, meses.map((m) => m.id));

  // Fechamento em andamento: o mês aberto mais antigo, com o que já foi lançado nele.
  let fechamento: DadosPainel["fechamento"] = null;
  const aberto = (abertos.data?.[0] ?? null) as MesFolha | null;
  if (aberto) {
    const [itens, modelos, recorrentes] = await Promise.all([
      lerItens(supabase, aberto.id),
      supabase.from("rh_fp_recibo_modelos").select("colaborador_id", { count: "exact", head: true }).eq("ativo", true),
      supabase.from("rh_fp_recibos").select("id", { count: "exact", head: true }).eq("competencia", aberto.competencia).eq("tipo", "recorrente").is("cancelado_em", null),
    ]);
    fechamento = {
      mes: aberto,
      situacao: {
        empresas: [...new Set(itens.map((i) => i.empregador))].sort(),
        empresasComLiquido: [...new Set(itens.filter((i) => i.liquido > 0).map((i) => i.empregador))],
        modelosAtivos: modelos.count ?? 0,
        recorrentesGerados: recorrentes.count ?? 0,
        decimoLancado: itens.some((i) => i.decimo_terceiro > 0),
        status: aberto.status,
      },
    };
  }

  // Destaque: a folha aguardando aprovação (conferida) ou pagamento (aprovada); sem nenhuma, a última paga.
  let destaque: DadosPainel["destaque"] = null;
  const mesDestaque = ((emAprovacao.data?.[0] ?? ultimaPaga.data?.[0]) ?? null) as MesFolha | null;
  if (mesDestaque) {
    const anteriorComp = new Date(`${mesDestaque.competencia}T00:00:00Z`);
    anteriorComp.setUTCMonth(anteriorComp.getUTCMonth() - 1);
    const comp = anteriorComp.toISOString().slice(0, 10);
    const { data: ant } = await supabase.from("rh_fp_competencias").select(COLUNAS_MES).eq("competencia", comp).maybeSingle();
    const anterior = ant ? await totaisDe(supabase, ant as MesFolha, totais) : null;
    destaque = { mes: mesDestaque, totais: await totaisDe(supabase, mesDestaque, totais), anterior: anterior?.total ?? null };
  }

  return {
    meses, totais, fechamento, destaque,
    colaboradores: { ativos: ativos.count ?? 0, comVt: comVt.count ?? 0 },
    pendencias: (pend.data ?? []) as PendenciaRh[],
  };
}
