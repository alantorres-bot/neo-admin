import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import type { criarClienteServidor } from "@/lib/supabase/servidor";
import { ESTAGIOS_COBRAVEIS, planejarCobrancas, type GrupoCobranca, type TituloCobranca } from "@/supabase/functions/_shared/cobranca";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;

export type ContatoCobranca = { id: string; nome: string; funcao: string | null; whatsapp: string | null; email: string | null; finalidades: string[] };

export const CONFIG_INICIO_REGUA = "financeiro.recebiveis.regua_a_partir_de";
const MODULO = "financeiro.recebiveis";

type Linha = {
  id: string; documento: string; parcela: string; vencimento: string; valor: number | string; estagio: string; cedido: boolean; contestado: boolean;
  regua_pausada_ate: string | null; rec_contratos: { multa_pct: number | string; juros_mes_pct: number | string } | { multa_pct: number | string; juros_mes_pct: number | string }[] | null;
};

export type DadosCobranca = {
  nomeCliente: string;
  codigoErp: string | null;
  hoje: string;
  corte: string | null;
  grupos: GrupoCobranca[];
  contatos: ContatoCobranca[];
  /** Contato para WhatsApp (nome na saudação). */
  contatoWhatsapp: ContatoCobranca | null;
  /** Contato para o e-mail (precisa ter e-mail). */
  contatoEmail: ContatoCobranca | null;
  /** Vencidos antes da data de corte: ficam fora da régua. */
  foraDaRegua: { quantidade: number; totalCentavos: number };
};

/**
 * Lê do banco, com a sessão de quem chama (a RLS vale), o que a régua cobraria deste cliente hoje: as mesmas regras puras
 * que a Edge Function usa. Títulos com "Possível baixa" em aberto não entram (saíram da lista do Consistem).
 */
export async function carregarCobranca(supabase: Cliente, clienteId: string): Promise<DadosCobranca | null> {
  const { data: cliente } = await supabase.from("contrapartes").select("nome, codigo_erp").eq("id", clienteId).maybeSingle();
  if (!cliente) return null;
  const hoje = hojeEmCuiaba();

  const [{ data: cfg }, { data: linhasBrutas }, { data: contatosBrutos }, { data: baixas }] = await Promise.all([
    supabase.from("configuracoes").select("valor").eq("chave", CONFIG_INICIO_REGUA).maybeSingle(),
    supabase.from("rec_titulos")
      .select("id, documento, parcela, vencimento, valor, estagio, cedido, contestado, regua_pausada_ate, rec_contratos(multa_pct, juros_mes_pct)")
      .eq("contraparte_id", clienteId).in("estagio", [...ESTAGIOS_COBRAVEIS]).lt("vencimento", hoje).order("vencimento").limit(500),
    supabase.from("contatos").select("id, nome, funcao, whatsapp, email, finalidades").eq("contraparte_id", clienteId).eq("ativo", true).order("nome"),
    supabase.from("pendencias").select("referencia_id").eq("modulo", MODULO).eq("referencia_tabela", "rec_titulos").like("titulo", "Possível baixa:%").in("status", ["aberta", "em_andamento"]).limit(500),
  ]);
  const corte = typeof cfg?.valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cfg.valor) ? cfg.valor : null;
  const linhas = (linhasBrutas ?? []) as Linha[];
  const contatos = (contatosBrutos ?? []) as ContatoCobranca[];
  const excluidos = new Set((baixas ?? []).map((p) => p.referencia_id as string));

  const titulos: TituloCobranca[] = linhas.map((l) => {
    const contrato = Array.isArray(l.rec_contratos) ? l.rec_contratos[0] : l.rec_contratos;
    return {
      id: l.id, contraparteId: clienteId, nomeCliente: cliente.nome as string, documento: l.documento, parcela: l.parcela, vencimento: l.vencimento,
      valorCentavos: Math.round(Number(l.valor) * 100), estagio: l.estagio, cedido: l.cedido, contestado: l.contestado, reguaPausadaAte: l.regua_pausada_ate,
      multaPct: contrato ? Number(contrato.multa_pct) : undefined, jurosMesPct: contrato ? Number(contrato.juros_mes_pct) : undefined,
    };
  });
  const grupos = corte ? planejarCobrancas(titulos, hoje, corte, excluidos) : [];
  const antigos = corte ? titulos.filter((t) => t.vencimento < corte && !t.cedido && !t.contestado) : [];

  const contatoWhatsapp = contatos.find((c) => c.finalidades.includes("cobranca") && c.whatsapp) ?? contatos.find((c) => c.whatsapp) ?? contatos[0] ?? null;
  const contatoEmail = contatos.find((c) => c.finalidades.includes("cobranca") && c.email) ?? contatos.find((c) => c.finalidades.includes("boleto") && c.email) ?? contatos.find((c) => c.email) ?? null;

  return {
    nomeCliente: cliente.nome as string,
    codigoErp: (cliente.codigo_erp as string | null) ?? null,
    hoje,
    corte,
    grupos,
    contatos,
    contatoWhatsapp,
    contatoEmail,
    foraDaRegua: { quantidade: antigos.length, totalCentavos: antigos.reduce((s, t) => s + t.valorCentavos, 0) },
  };
}
