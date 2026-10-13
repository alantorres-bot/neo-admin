import { Abas } from "@/components/plataforma/abas";
import { abasFilial } from "@/lib/modulos/financeiro/filial/abas";
import type { EstagioKit } from "@/lib/modulos/financeiro/filial/arquivos";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// Como na Cobrança: as abas aparecem logo; os números chegam depois, dentro de <Suspense> no layout.

/** Quantos kits há em cada etapa de trabalho (recebida, implantada, pronta) e quantas remessas ainda têm NF a implantar. */
export async function contarKits(): Promise<{ porEstagio: Partial<Record<EstagioKit, number>>; remessasAbertas: number }> {
  const supabase = await criarClienteServidor();
  const [{ data }, { count }] = await Promise.all([
    supabase.from("rec_kits").select("estagio").in("estagio", ["recebida", "implantada", "pronta"]),
    supabase.from("rec_vw_remessas").select("id", { count: "exact", head: true }).gt("aguardando_implantacao", 0),
  ]);
  const porEstagio: Partial<Record<EstagioKit, number>> = {};
  for (const k of data ?? []) porEstagio[k.estagio as EstagioKit] = (porEstagio[k.estagio as EstagioKit] ?? 0) + 1;
  return { porEstagio, remessasAbertas: count ?? 0 };
}

export function AbasFilialSemNumeros({ filial }: { filial: boolean }) {
  return <Abas abas={abasFilial(filial).map((a) => ({ href: a.href, rotulo: a.rotulo }))} />;
}

export async function AbasFilialComNumeros({ filial }: { filial: boolean }) {
  const { porEstagio, remessasAbertas } = await contarKits();
  return (
    <Abas abas={abasFilial(filial).map((a) => ({
      href: a.href, rotulo: a.rotulo,
      contagem: a.estagio === null ? remessasAbertas : a.contar && a.estagio ? porEstagio[a.estagio] ?? 0 : undefined,
    }))} />
  );
}
