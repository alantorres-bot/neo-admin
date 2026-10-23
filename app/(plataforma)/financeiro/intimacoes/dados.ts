import { type Cartorios, type StatusIntimacao } from "@/lib/modulos/financeiro/intimacoes/intimacoes";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;

export type Intimacao = {
  id: string; chave: string; origem: "cartorio" | "cenprot"; status: StatusIntimacao; empresa_id: string | null; empresa_nome: string | null;
  cartorio: string; protocolo: string | null; data_protocolo: string | null; localizador: string | null; link_intimacao: string | null;
  credor_documento: string | null; credor_nome: string | null; devedor_documento: string | null; especie: string | null;
  numero_titulo: string | null; valor_titulo: string | number | null; vencimento_titulo: string | null;
  data_limite: string | null; valor_custas: string | number | null; valor_total_cartorio: string | number | null; dados_portal_em: string | null;
  dados_informados_em: string | null; cod_lancamento: string | null;
  titulo: { codLancamento: string; numDocumento: string; vencimento: string | null; valorCentavos: number; saldoCentavos: number } | null;
  nova_data_vencimento: string | null; proposto_por_nome: string | null; proposto_em: string | null; aprovado_por_nome: string | null; aprovado_em: string | null;
  vencimento_alterado_em: string | null; adiantamento_confirmado_por_nome: string | null; adiantamento_confirmado_em: string | null;
  adiantamento_referencia: string | null; nf_numero: string | null; nf_registrada_em: string | null; consignacao_referencia: string | null;
  consignacao_em: string | null; motivo: string | null; mesclada_com: string | null; emails: number; criado_em: string;
};

export async function listarIntimacoes(supabase: Cliente, status: readonly StatusIntimacao[]): Promise<Intimacao[]> {
  const { data, error } = await supabase.from("fin_int_vw_intimacoes").select("*").in("status", status as StatusIntimacao[])
    .order("criado_em", { ascending: false }).limit(500);
  if (error) throw new Error(`Não foi possível ler as intimações: ${error.message}`);
  return (data ?? []) as Intimacao[];
}

export async function lerIntimacao(supabase: Cliente, id: string) {
  const [{ data: i }, { data: emails }, { data: envios }, { data: empresas }, { data: cfg }, { data: juntaveis }] = await Promise.all([
    supabase.from("fin_int_vw_intimacoes").select("*").eq("id", id).maybeSingle(),
    supabase.from("fin_intimacao_origens").select("message_id, fin_intimacao_emails(remetente, assunto, recebido_em, caixa, tipo)").eq("intimacao_id", id),
    supabase.from("fin_intimacao_vencimentos").select("id, situacao, alteracao, ja_estava, erro, antes, depois, criado_em, concluido_em").eq("intimacao_id", id).order("criado_em"),
    supabase.from("empresas").select("id, nome_curto").eq("ativa", true).order("nome_curto"),
    supabase.from("configuracoes").select("chave, valor").in("chave", ["financeiro.intimacoes.cartorios", "financeiro.intimacoes.alterar_vencimento_no_erp"]),
    // Apontamentos (sem localizador) a que uma intimação do 4º Ofício pode ser juntada.
    supabase.from("fin_intimacoes").select("id, protocolo, credor_nome, numero_titulo, status").eq("origem", "cenprot").is("localizador", null)
      .not("status", "in", "(concluida,descartada)").order("criado_em", { ascending: false }).limit(100),
  ]);
  if (!i) return null;
  const valor = (c: string) => cfg?.find((x) => x.chave === c)?.valor;
  return {
    intimacao: i as Intimacao,
    emails: (emails ?? []).map((e) => ({ messageId: e.message_id as string, ...(e.fin_intimacao_emails as unknown as { remetente: string; assunto: string; recebido_em: string; caixa: string; tipo: string }) })),
    envios: envios ?? [],
    empresas: empresas ?? [],
    cartorios: (valor("financeiro.intimacoes.cartorios") ?? {}) as Cartorios,
    alterarLigado: valor("financeiro.intimacoes.alterar_vencimento_no_erp") === true,
    juntaveis: juntaveis ?? [],
  };
}
