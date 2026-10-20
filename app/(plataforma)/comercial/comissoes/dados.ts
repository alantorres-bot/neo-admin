// Leitura do fechamento de comissões (tela, impressão e planilha). A RLS limita a quem tem o módulo.
import type { criarClienteServidor } from "@/lib/supabase/servidor";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;

export type LinhaFechamento = {
  id: string; cod_representante: string; cod_representante_venda: string | null; chave: string; origem: "titulo" | "credito" | "manual" | "antecipacao";
  cod_titulo: string | null; cod_cliente: string | null; nome_cliente: string | null; nota_fiscal: string | null; data_pagamento: string | null;
  tipo_baixa: string | null; tipo: "venda" | "locacao"; valor_base: number; percentual: number; valor_comissao: number; valor_consistem: number | null;
  incluida: boolean; motivo: string | null; observacao: string | null;
  cod_pedido: string | null; teto_chave: string | null; teto_valor: number | null;
};
export type RepresentanteFechamento = { cod_representante: string; nome: string; perc_venda: number; perc_locacao: number; recebe_de: string[]; ativo: boolean };
export type CreditoFechamento = {
  id: string; linha: number | null; data: string; cod_cliente: string; nome_cliente: string | null; valor: number; cod_titulo_z: string | null; cod_representante_sugerido: string | null;
  cod_pedido: string | null;
};
export type Fechamento = {
  id: string; competencia: string; status: "em_conferencia" | "fechado"; creditos_arquivo: string | null; creditos_importados_em: string | null;
  titulos_buscados_em: string | null; z_sem_credito: { cod_titulo: string; cod_cliente: string | null; cod_representante: string | null; data_pagamento: string | null; valor: number }[];
  fechado_em: string | null; historico: boolean; historico_arquivos: string[];
};

const centavos = (v: number | string | null) => Math.round(Number(v ?? 0) * 100);

/** Total das comissões incluídas, antecipações já pagas e saldo a pagar (em centavos). */
export function totaisDoRepresentante(linhas: Pick<LinhaFechamento, "incluida" | "origem" | "valor_comissao">[]) {
  const total = linhas.filter((l) => l.incluida && l.origem !== "antecipacao").reduce((s, l) => s + centavos(l.valor_comissao), 0);
  const antecipado = linhas.filter((l) => l.incluida && l.origem === "antecipacao").reduce((s, l) => s + centavos(l.valor_comissao), 0);
  return { total, antecipado, saldo: total - antecipado };
}

export type Reabertura = { id: string; motivo: string; fechado_em: string | null; reaberto_em: string; reaberto_por: { nome: string } | null };

export async function lerFechamento(supabase: Cliente, id: string) {
  const [{ data: f }, { data: reps }, { data: linhas }, { data: creditos }, { data: reaberturas }] = await Promise.all([
    supabase.from("fin_com_fechamentos").select("id, competencia, status, creditos_arquivo, creditos_importados_em, titulos_buscados_em, z_sem_credito, fechado_em, historico, historico_arquivos").eq("id", id).maybeSingle(),
    supabase.from("fin_com_representantes").select("cod_representante, nome, perc_venda, perc_locacao, recebe_de, ativo").order("cod_representante"),
    supabase.from("fin_com_linhas").select("*").eq("fechamento_id", id).order("data_pagamento", { nullsFirst: false }).order("cod_titulo"),
    supabase.from("fin_com_creditos").select("id, linha, data, cod_cliente, nome_cliente, valor, cod_titulo_z, cod_representante_sugerido, cod_pedido").eq("fechamento_id", id).order("data"),
    supabase.from("fin_com_reaberturas").select("id, motivo, fechado_em, reaberto_em, reaberto_por:perfis!fin_com_reaberturas_reaberto_por_fkey(nome)").eq("fechamento_id", id).order("reaberto_em"),
  ]);
  if (!f) return null;
  const todas = (linhas ?? []) as LinhaFechamento[];
  // Linha sem o nome do sacado (gravada antes de a busca trazer o nome): completa pelo cadastro do núcleo.
  const semNome = [...new Set(todas.filter((l) => !l.nome_cliente && l.cod_cliente).map((l) => l.cod_cliente as string))];
  if (semNome.length > 0) {
    const { data: cps } = await supabase.from("contrapartes").select("codigo_erp, nome").in("codigo_erp", semNome);
    const nome = new Map((cps ?? []).map((c) => [c.codigo_erp as string, c.nome as string]));
    for (const l of todas) if (!l.nome_cliente && l.cod_cliente) l.nome_cliente = nome.get(l.cod_cliente) ?? null;
  }
  const representantes = ((reps ?? []) as RepresentanteFechamento[]).map((r) => ({ ...r, perc_venda: Number(r.perc_venda), perc_locacao: Number(r.perc_locacao) }));
  const porRepresentante = representantes
    .map((r) => {
      const ls = todas.filter((l) => l.cod_representante === r.cod_representante);
      return { representante: r, linhas: ls, ...totaisDoRepresentante(ls) };
    })
    .filter((x) => x.representante.ativo || x.linhas.length > 0);
  return {
    fechamento: f as Fechamento, representantes, porRepresentante, creditos: (creditos ?? []) as CreditoFechamento[],
    reaberturas: (reaberturas ?? []) as unknown as Reabertura[],
  };
}

export const ROTULO_ORIGEM = { titulo: "Título", credito: "Adiantamento (CCCCI010)", manual: "Manual", antecipacao: "Antecipação de comissão" } as const;
export const ROTULO_BAIXA: Record<string, string> = {
  "1": "Normal", "2": "Parcial", "3": "Desconto", "4": "Dinheiro", "5": "Cheques", "6": "Cartório", "7": "Antecipação", "8": "Devolução de cliente",
  "9": "Depósito", "10": "Dev. de compras", "11": "Perdas",
};
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const rotuloCompetencia = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`;
