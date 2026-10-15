// Parcelas a confirmar de um cliente numa unidade, com as mesmas regras da fila: a tela da confirmação e a ação do rascunho no
// Gmail leem daqui para nunca discordarem. Só leitura, com a sessão de quem chama (a RLS vale).
import { lerPartes } from "@/lib/modulos/financeiro/akf/parcial";
import { carregarRegra } from "@/lib/modulos/financeiro/recebiveis/regra";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import type { criarClienteServidor } from "@/lib/supabase/servidor";
import { agruparPorCliente, type GrupoConfirmacao, type TituloConfirmacao } from "@/supabase/functions/_shared/confirmacao";

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;
export type LinhaConfirmacao = { id: string; documento: string; parcela: string; vencimento: string; valor: number | string; estagio: string; cedido: boolean; contestado: boolean };
export type ContatoConfirmacao = { id: string; nome: string; funcao: string | null; whatsapp: string | null; email: string | null; telefone: string | null; finalidades: string[]; canal_preferido: string | null; ativo: boolean };

export async function carregarConfirmacao(supabase: Cliente, clienteId: string, unidade: "matriz" | "contagem") {
  const { data: cliente } = await supabase.from("contrapartes").select("nome, codigo_erp").eq("id", clienteId).maybeSingle();
  if (!cliente) return null;
  const nomeCliente = cliente.nome as string;
  const hoje = hojeEmCuiaba();
  const [{ parametros: regra }, { data: linhasBrutas }, { data: contatosBrutos }] = await Promise.all([
    carregarRegra(supabase),
    supabase.from("rec_titulos").select("id, documento, parcela, vencimento, valor, estagio, cedido, contestado").eq("contraparte_id", clienteId).eq("unidade", unidade)
      .in("estagio", ["importado", "aguardando_boleto", "boleto_enviado", "confirmado_cliente"]).gte("vencimento", hoje).order("vencimento").limit(200),
    supabase.from("contatos").select("id, nome, funcao, whatsapp, email, telefone, finalidades, canal_preferido, ativo").eq("contraparte_id", clienteId).eq("ativo", true).order("nome"),
  ]);
  const linhas = (linhasBrutas ?? []) as LinhaConfirmacao[];
  const contatos = (contatosBrutos ?? []) as ContatoConfirmacao[];
  // Título com parte antecipada na AKF: a confirmação fala só do que resta com a Neo (migration 0113).
  const partes = await lerPartes(supabase, linhas.map((l) => l.id));
  const titulos: TituloConfirmacao[] = linhas.map((l) => ({
    id: l.id, contraparteId: clienteId, nomeCliente, documento: l.documento, parcela: l.parcela, vencimento: l.vencimento,
    valorCentavos: partes.get(l.id)?.restanteCentavos ?? Math.round(Number(l.valor) * 100), estagio: l.estagio, cedido: l.cedido, contestado: l.contestado, unidade,
  }));
  const [grupo] = agruparPorCliente(titulos, hoje, regra.janelaConfirmacaoDias) as (GrupoConfirmacao | undefined)[];
  return { nomeCliente, codigoErp: (cliente.codigo_erp as string | null) ?? null, hoje, regra, linhas, contatos, grupo: grupo ?? null };
}
