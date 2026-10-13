import { Abas } from "@/components/plataforma/abas";
import { ABAS_FILIAL } from "@/lib/modulos/financeiro/filial/abas";
import type { EstagioKit } from "@/lib/modulos/financeiro/filial/arquivos";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// Como na Cobrança: as abas aparecem logo; os números chegam depois, dentro de <Suspense> no layout.

/** Quantos kits há em cada etapa de trabalho (recebida, implantada, pronta). */
export async function contarKits(): Promise<Partial<Record<EstagioKit, number>>> {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("rec_kits").select("estagio").in("estagio", ["recebida", "implantada", "pronta"]);
  const contagens: Partial<Record<EstagioKit, number>> = {};
  for (const k of data ?? []) contagens[k.estagio as EstagioKit] = (contagens[k.estagio as EstagioKit] ?? 0) + 1;
  return contagens;
}

export function AbasFilialSemNumeros() {
  return <Abas abas={ABAS_FILIAL.map((a) => ({ href: a.href, rotulo: a.rotulo }))} />;
}

export async function AbasFilialComNumeros() {
  const contagens = await contarKits();
  return <Abas abas={ABAS_FILIAL.map((a) => ({ href: a.href, rotulo: a.rotulo, contagem: a.contar && a.estagio ? contagens[a.estagio] ?? 0 : undefined }))} />;
}
