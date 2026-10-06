// Leitura dos dados da ficha da NF (parcelas, boletos, contatos, mensagens prontas, histórico). Usada pela página e
// pela ação que cria o rascunho no Gmail, para o texto do rascunho ser exatamente o que a tela mostra.
// Tudo com o cliente do usuário (RLS vale).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MODELO_BOLETO_EMAIL, MODELO_BOLETO_WHATSAPP, MODULO_RECEBIVEIS, montarMensagem, TIPO_ANEXO_BOLETO,
  type DadosMensagem, type MensagemMontada, type ParcelaMensagem,
} from "@/lib/modulos/financeiro/recebiveis/boleto";
import { urlAssinadaAnexo } from "@/lib/nucleo/anexos";

export const ENCERRADOS = ["pago", "renegociado", "cancelado"];
export const centavos = (v: number | string) => Math.round(Number(v) * 100);

export type Parcela = {
  id: string; documento: string; parcela: string; emissao: string | null; vencimento: string; valor: number | string; valor_atualizado: number | string;
  dias_atraso: number; estagio: string; linha_digitavel: string | null; boleto_enviado_em: string | null; nota_fiscal: string | null;
  nota_saida_id: string | null; contraparte_id: string;
};
export type Contato = {
  id: string; nome: string; funcao: string | null; email: string | null; whatsapp: string | null; finalidades: string[];
  canal_preferido: "email" | "whatsapp" | "telefone" | "interno" | null;
};
export type Interacao = { id: string; referencia_id: string; canal: string; tipo: string; descricao: string | null; criado_em: string; usuario_id: string | null };

export type Ficha = {
  base: Parcela;
  parcelas: Parcela[];
  nomeCliente: string;
  codigoErp: string | null;
  notaNumero: string | null;
  pedidos: string[];
  referencia: string;
  contatos: Contato[];
  contato: Contato | null;
  boletoDaParcela: Map<string, { nome: string; url: string | null }>;
  interacoes: Interacao[];
  nomesUsuarios: Map<string, string>;
  /** Parcelas que ainda esperam o envio do boleto. */
  aguardando: Parcela[];
  /** Parcelas citadas na mensagem: as que aguardam envio; se não há, as demais em aberto. */
  paraMensagem: Parcela[];
  modeloEmailId: string | null;
  email: MensagemMontada | null;
  whatsapp: MensagemMontada | null;
  totalCentavos: number;
};

const COLUNAS = "id, documento, parcela, emissao, vencimento, valor, valor_atualizado, dias_atraso, estagio, linha_digitavel, boleto_enviado_em, nota_fiscal, nota_saida_id, contraparte_id";

export async function carregarFicha(supabase: SupabaseClient, id: string, contatoPedido: string, opcoes: { assinarLinks: boolean }): Promise<Ficha | null> {
  const { data: alvo } = await supabase.from("rec_vw_titulos").select(COLUNAS).eq("id", id).maybeSingle();
  if (!alvo) return null;
  const base = alvo as Parcela;

  // As parcelas da mesma NF andam juntas (um boleto por parcela, um envio por NF).
  const consultaParcelas = supabase.from("rec_vw_titulos").select(COLUNAS).order("vencimento").order("documento");
  const { data: grupoBruto, error: erroGrupo } = await (base.nota_saida_id ? consultaParcelas.eq("nota_saida_id", base.nota_saida_id) : consultaParcelas.eq("id", id));
  if (erroGrupo) throw new Error(`Falha ao ler as parcelas: ${erroGrupo.message}`);
  const parcelas = (grupoBruto ?? []) as Parcela[];
  const ids = parcelas.map((p) => p.id);

  const [{ data: cliente }, { data: nota }, { data: contatosBrutos }, { data: anexosBrutos }, { data: interacoesBrutas }, { data: modelosBrutos }] = await Promise.all([
    supabase.from("contrapartes").select("nome, codigo_erp").eq("id", base.contraparte_id).maybeSingle(),
    base.nota_saida_id ? supabase.from("rec_notas_saida").select("nota, pedidos").eq("id", base.nota_saida_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("contatos").select("id, nome, funcao, email, whatsapp, finalidades, canal_preferido").eq("contraparte_id", base.contraparte_id).eq("ativo", true).order("nome"),
    supabase.from("anexos").select("referencia_id, arquivo_path, nome_arquivo, enviado_em").eq("modulo", MODULO_RECEBIVEIS).eq("referencia_tabela", "rec_titulos")
      .eq("tipo", TIPO_ANEXO_BOLETO).in("referencia_id", ids).order("enviado_em", { ascending: false }),
    supabase.from("interacoes").select("id, referencia_id, canal, tipo, descricao, criado_em, usuario_id").eq("referencia_tabela", "rec_titulos")
      .in("referencia_id", ids).order("criado_em", { ascending: false }).limit(20),
    supabase.from("modelos_mensagem").select("id, nome, canal, assunto, corpo").eq("modulo", MODULO_RECEBIVEIS).eq("ativo", true).in("nome", [MODELO_BOLETO_EMAIL, MODELO_BOLETO_WHATSAPP]),
  ]);

  // Boleto mais recente de cada parcela; o link assinado (bucket privado) só é gerado quando a tela vai mostrá-lo.
  const boletoDaParcela = new Map<string, { nome: string; url: string | null }>();
  for (const a of anexosBrutos ?? []) {
    const parcelaId = a.referencia_id as string;
    if (boletoDaParcela.has(parcelaId)) continue;
    let url: string | null = null;
    if (opcoes.assinarLinks) {
      const r = await urlAssinadaAnexo(supabase, a.arquivo_path as string, 900);
      url = r.ok ? r.url : null;
    }
    boletoDaParcela.set(parcelaId, { nome: a.nome_arquivo as string, url });
  }

  const interacoes = (interacoesBrutas ?? []) as Interacao[];
  const idsUsuarios = [...new Set(interacoes.map((i) => i.usuario_id).filter((x): x is string => !!x))];
  const nomesUsuarios = new Map<string, string>();
  if (idsUsuarios.length > 0) {
    const { data } = await supabase.from("perfis").select("id, nome").in("id", idsUsuarios);
    for (const p of data ?? []) nomesUsuarios.set(p.id as string, p.nome as string);
  }

  const contatos = (contatosBrutos ?? []) as Contato[];
  const contato = contatos.find((c) => c.id === contatoPedido) ?? contatos.find((c) => c.finalidades.includes("boleto")) ?? contatos[0] ?? null;

  const nomeCliente = (cliente?.nome as string | undefined) ?? "";
  const notaNumero = (nota?.nota as string | undefined) ?? null;
  const referencia = notaNumero ? `NF ${notaNumero}` : `título ${base.documento}${base.parcela !== "1" ? `/${base.parcela}` : ""}`;

  const aguardando = parcelas.filter((p) => p.estagio === "aguardando_boleto");
  const paraMensagem = aguardando.length > 0 ? aguardando : parcelas.filter((p) => !ENCERRADOS.includes(p.estagio));
  const dados: DadosMensagem = {
    contato: contato?.nome ?? "",
    cliente: nomeCliente,
    referencia,
    parcelas: paraMensagem.map((p): ParcelaMensagem => ({
      documento: p.documento, parcela: p.parcela, vencimento: p.vencimento, valorCentavos: centavos(p.valor), linhaDigitavel: p.linha_digitavel,
    })),
  };
  const modeloEmail = modelosBrutos?.find((m) => m.nome === MODELO_BOLETO_EMAIL);
  const modeloWhats = modelosBrutos?.find((m) => m.nome === MODELO_BOLETO_WHATSAPP);
  const email = modeloEmail && paraMensagem.length > 0 ? montarMensagem({ assunto: modeloEmail.assunto as string | null, corpo: modeloEmail.corpo as string }, dados) : null;
  const whatsapp = modeloWhats && paraMensagem.length > 0 ? montarMensagem({ assunto: null, corpo: modeloWhats.corpo as string }, dados) : null;

  return {
    base, parcelas, nomeCliente, codigoErp: (cliente?.codigo_erp as string | null | undefined) ?? null, notaNumero,
    pedidos: (nota?.pedidos as string[] | undefined) ?? [], referencia, contatos, contato, boletoDaParcela, interacoes, nomesUsuarios,
    aguardando, paraMensagem, modeloEmailId: (modeloEmail?.id as string | undefined) ?? null, email, whatsapp,
    totalCentavos: parcelas.reduce((s, p) => s + centavos(p.valor), 0),
  };
}
