// Dados do Consolidado Anual (tela, Excel e impressão usam a mesma leitura).
import type { LinhaBanco } from "@/lib/modulos/fiscal/creditos/apuracao";
import { consolidarPor, totalGeral } from "@/lib/modulos/fiscal/creditos/consolidado";
import { centavos } from "@/lib/modulos/fiscal/creditos/formatos";
import type { Cliente, Filtros } from "../dados";

export async function lerConsolidado(supabase: Cliente, f: Pick<Filtros, "ano" | "empresa" | "estab" | "tributo">) {
  const [{ data: ap, error }, { data: creditos }, { data: dezembro }, { data: divs }, { data: alertas }] = await Promise.all([
    supabase.rpc("fis_apuracao", { p_inicio: `${f.ano - 1}-01-01`, p_fim: `${f.ano}-12-01`, p_empresa: f.empresa || null, p_estabelecimento: f.estab || null, p_tributo: f.tributo || null }),
    supabase.from("fis_creditos_saldos").select("tributo_id, estabelecimento_id, empresa_id, validacao, valor_original, arquivado"),
    supabase.from("fis_periodos").select("estabelecimento_id, tributo_id, empresa_id, status, snapshot").eq("competencia", `${f.ano - 1}-12-01`),
    supabase.from("fis_divergencias").select("tributo_id, estabelecimento_id, empresa_id, valor_diferenca").in("status", ["aberta", "em_analise"]),
    supabase.rpc("fis_verificar", { p_empresa: f.empresa || null, p_ano: null }),
  ]);
  if (error) throw new Error(`Consolidado: ${error.message}`);
  const linhas = (ap ?? []) as LinhaBanco[];
  const noFiltro = <T extends { empresa_id: string | null; estabelecimento_id: string | null; tributo_id: string | null }>(x: T) =>
    (!f.empresa || x.empresa_id === f.empresa) && (!f.estab || x.estabelecimento_id === f.estab) && (!f.tributo || x.tributo_id === f.tributo);
  const porTributo = consolidarPor(linhas, f.ano, (l) => l.tributo_id);
  const porEstab = consolidarPor(linhas, f.ano, (l) => `${l.estabelecimento_id}|${l.tributo_id}`);
  const extras = (tributo: string, estab?: string) => {
    const m = <T extends { tributo_id: string | null; estabelecimento_id: string | null }>(x: T) => x.tributo_id === tributo && (!estab || x.estabelecimento_id === estab);
    const cs = (creditos ?? []).filter(noFiltro).filter(m).filter((c) => !c.arquivado);
    const dez = (dezembro ?? []).filter(noFiltro).filter(m);
    type Alerta = { regra: string; tributo_id: string | null; estabelecimento_id: string | null; empresa_id: string | null };
    const al = ((alertas ?? []) as Alerta[]).filter(noFiltro).filter(m);
    return {
      pendenteValidacao: cs.filter((c) => c.validacao === "pendente" || c.validacao === "em_analise").reduce((s, c) => s + centavos(c.valor_original), 0),
      docIncompleta: new Set(al.filter((a) => a.regra === "R03_SEM_DOCUMENTO" || a.regra === "R07_DOCUMENTACAO_PENDENTE").map((a) => JSON.stringify(a))).size,
      divergencias: (divs ?? []).filter(noFiltro).filter(m).length,
      fechadoDezembro: dez.length > 0 && dez.every((p) => p.status === "fechado") ? dez.reduce((s, p) => s + centavos(String((p.snapshot as { saldo_final?: number } | null)?.saldo_final ?? 0)), 0) : null,
    };
  };
  return { porTributo, porEstab, total: totalGeral(porTributo, "atual"), totalAnterior: totalGeral(porTributo, "anterior"), extras };
}
