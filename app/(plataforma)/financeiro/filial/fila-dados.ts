// Carga da fila única do Faturamento Filial: todas as NFs em andamento (e, se pedido, as enviadas), com o estágio da fila,
// as tarefas de cada lado, a urgência e o nº da remessa. Só leitura, com a sessão do usuário (a RLS vale).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ORDEM_URGENCIA, proximaAcao, situacaoDaNota, urgenciaDaNota, type EstagioFila, type Papel, type Situacao, type Urgencia,
} from "@/lib/modulos/financeiro/filial/estagios";
import { lerParcelasInformadas, type ParcelaInformada } from "@/lib/modulos/financeiro/filial/remessa";
import { emCentavos } from "@/lib/modulos/financeiro/recebiveis/carteira";

export type LinhaFila = {
  id: string;
  nota: string;
  cliente: string;
  obra: string | null;
  remessas: number[];
  situacao: Situacao;
  urgencia: Urgencia | null;
  vencimento: string | null;
  valorCentavos: number;
  acao: { rotulo: string; minha: boolean };
  semBoletoFactoring: boolean;
  cedido: boolean;
  notaEnviada: boolean;
  parcelasNota: ParcelaInformada[];
  docs: { nota: boolean; demonstrativo: boolean; comodato: boolean; boleto: boolean; carta: boolean | null };
};

/** Quais NFs: as em andamento, as enviadas ou todas (inclusive canceladas). `ids` restringe a um conjunto (ex.: as de uma remessa). */
export type EstagiosFila = "abertas" | "enviadas" | "todas";

const ESTAGIOS_BANCO: Record<EstagiosFila, string[]> = {
  abertas: ["recebida", "implantada", "pronta"],
  enviadas: ["enviada"],
  todas: ["recebida", "implantada", "pronta", "enviada", "cancelada"],
};

export async function carregarFila(supabase: SupabaseClient, opcoes: { papel: Papel; hoje: string; estagios: EstagiosFila; ids?: string[] }): Promise<LinhaFila[]> {
  const soEnviadas = opcoes.estagios === "enviadas";
  let consulta = supabase.from("rec_vw_kits")
    .select("id, nota_fiscal, cliente_nome, obra, estagio, aceita_boleto_factoring, parcelas, valor_total, primeiro_vencimento, cedido, boletos, notas, demonstrativos, comodatos, cartas, exige_carta, enviado_em")
    .in("estagio", ESTAGIOS_BANCO[opcoes.estagios]);
  if (opcoes.ids) consulta = consulta.in("id", opcoes.ids.length ? opcoes.ids : ["00000000-0000-0000-0000-000000000000"]);
  const [{ data: kits, error }, { data: remessas }] = await Promise.all([
    consulta.order(soEnviadas ? "enviado_em" : "nota_fiscal", { ascending: !soEnviadas }).limit(soEnviadas ? 200 : 1000),
    supabase.from("rec_remessa_kits").select("kit_id, rec_remessas(numero)").limit(10000),
  ]);
  if (error) throw new Error(`Falha ao ler a fila: ${error.message}`);
  const ids = (kits ?? []).map((k) => k.id as string);
  const extras: { id: string; parcelas_informadas: unknown; nota_enviada_em: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from("rec_kits").select("id, parcelas_informadas, nota_enviada_em").in("id", ids.slice(i, i + 150));
    extras.push(...((data ?? []) as typeof extras));
  }
  const extraDe = new Map(extras.map((e) => [e.id, e]));
  const remessasDe = new Map<string, number[]>();
  for (const r of remessas ?? []) {
    const n = ((Array.isArray(r.rec_remessas) ? r.rec_remessas[0] : r.rec_remessas) as { numero?: number } | null)?.numero;
    if (n) remessasDe.set(r.kit_id as string, [...(remessasDe.get(r.kit_id as string) ?? []), n].sort((a, b) => a - b));
  }

  const linhas = (kits ?? []).map((k): LinhaFila => {
    const e = extraDe.get(k.id as string);
    const informadas = lerParcelasInformadas(e?.parcelas_informadas);
    const situacao = situacaoDaNota({
      estagio: k.estagio, notas: k.notas, demonstrativos: k.demonstrativos, cartas: k.cartas, exigeCarta: !!k.exige_carta,
      parcelas: k.parcelas ?? 0, boletos: k.boletos ?? 0, notaEnviada: !!e?.nota_enviada_em,
    });
    const vencimento = (k.primeiro_vencimento as string | null) ?? informadas[0]?.vencimento ?? null;
    const urgencia = urgenciaDaNota(situacao.estagio, vencimento, opcoes.hoje);
    return {
      id: k.id as string, nota: k.nota_fiscal as string, cliente: k.cliente_nome as string, obra: (k.obra as string | null) ?? null,
      remessas: remessasDe.get(k.id as string) ?? [], situacao, urgencia, vencimento,
      valorCentavos: k.valor_total != null ? emCentavos(k.valor_total) : informadas.reduce((s, p) => s + p.valorCentavos, 0),
      acao: proximaAcao(situacao, opcoes.papel, urgencia),
      semBoletoFactoring: !k.aceita_boleto_factoring, cedido: !!k.cedido, notaEnviada: !!e?.nota_enviada_em, parcelasNota: informadas,
      docs: {
        nota: k.notas > 0, demonstrativo: k.demonstrativos > 0, comodato: k.comodatos > 0,
        boleto: (k.parcelas ?? 0) > 0 && (k.boletos ?? 0) >= (k.parcelas ?? 0), carta: k.exige_carta ? k.cartas > 0 : null,
      },
    };
  });
  // Mais urgente primeiro; depois o vencimento mais próximo.
  return linhas.sort((a, b) =>
    (ORDEM_URGENCIA[a.urgencia ?? "sem_data"] - ORDEM_URGENCIA[b.urgencia ?? "sem_data"])
    || (a.vencimento ?? "9999").localeCompare(b.vencimento ?? "9999") || a.nota.localeCompare(b.nota));
}

export type FiltroVer = "minhas" | "todas" | "enviadas" | "criticas" | EstagioFila;
