// Antecipação parcial na AKF (migration 0113): o Consistem não desdobra o título, então o desdobramento vive só no Neo Admin.
// Leitura do que está na AKF e do que resta com a Neo, por título. Tudo com o cliente do usuário (a RLS vale).
import type { SupabaseClient } from "@supabase/supabase-js";

export type ParteDoTitulo = {
  /** Valor do título no Consistem, em centavos. */
  tituloCentavos: number;
  /** Soma das partes antecipadas ativas, em centavos. */
  akfCentavos: number;
  /** O que resta com a Neo (título − partes), em centavos. */
  restanteCentavos: number;
  partes: number;
};

const emCentavos = (v: number | string) => Math.round(Number(v) * 100);

/** Partes ativas de cada título pedido. Título sem parte ativa (ou inteiro na AKF) não aparece no mapa. */
export async function lerPartes(supabase: SupabaseClient, ids: readonly string[]): Promise<Map<string, ParteDoTitulo>> {
  const mapa = new Map<string, ParteDoTitulo>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 100) {
    const { data, error } = await supabase.from("akf_vw_valor_restante").select("titulo_id, valor_titulo, valor_akf, valor_restante, partes").in("titulo_id", unicos.slice(i, i + 100));
    if (error) throw new Error(`Falha ao ler as antecipações parciais: ${error.message}`);
    for (const d of data ?? []) {
      mapa.set(d.titulo_id as string, {
        tituloCentavos: emCentavos(d.valor_titulo as number | string), akfCentavos: emCentavos(d.valor_akf as number | string),
        restanteCentavos: emCentavos(d.valor_restante as number | string), partes: Number(d.partes),
      });
    }
  }
  return mapa;
}

/** Todas as partes ativas (a view é pequena: só títulos com parte antecipada), para totais da carteira AKF. */
export async function lerTodasAsPartes(supabase: SupabaseClient): Promise<Map<string, ParteDoTitulo>> {
  const mapa = new Map<string, ParteDoTitulo>();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from("akf_vw_valor_restante").select("titulo_id, valor_titulo, valor_akf, valor_restante, partes").order("titulo_id").range(de, de + 999);
    if (error) throw new Error(`Falha ao ler as antecipações parciais: ${error.message}`);
    for (const d of data ?? []) {
      mapa.set(d.titulo_id as string, {
        tituloCentavos: emCentavos(d.valor_titulo as number | string), akfCentavos: emCentavos(d.valor_akf as number | string),
        restanteCentavos: emCentavos(d.valor_restante as number | string), partes: Number(d.partes),
      });
    }
    if (!data || data.length < 1000) break;
  }
  return mapa;
}
