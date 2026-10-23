"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROTA_INTIMACOES } from "@/lib/modulos/financeiro/intimacoes/intimacoes";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

// Ações da tela de Intimações de cartório (docs/modulos/financeiro-intimacoes-cartorio.md). Cada uma chama a função do banco
// (migration 0181), que confere de novo o nível e a etapa. Não há ação de lançar adiantamento: ele é feito À MÃO no Consistem.

export type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

const mensagemDeErro = (e: { code?: string; message: string }) => (e.code === "P0001" ? e.message : "Não foi possível salvar. Tente novamente.");
const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

async function mensagemDaFuncao(error: unknown, padrao: string): Promise<string> {
  const resposta = (error as { context?: Response }).context;
  if (resposta && typeof resposta.json === "function") {
    try {
      const j = (await resposta.json()) as { erro?: string };
      return j.erro ?? padrao;
    } catch { /* mantém */ }
  }
  return padrao;
}

async function chamar(nivel: "operador" | "gestor", funcao: string, args: Record<string, unknown>, aviso: string, id?: string): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", nivel)) return { ok: false, erro: `Somente ${nivel} do Financeiro (ou acima) faz isto.` };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc(funcao, args);
  revalidatePath(id ? `${ROTA_INTIMACOES}/${id}` : ROTA_INTIMACOES);
  revalidatePath(ROTA_INTIMACOES);
  return error ? { ok: false, erro: mensagemDeErro(error) } : { ok: true, aviso };
}

/** "Ler o Gmail agora" (operador): a Edge Function lê a caixa autorizada; a leitura agendada faz o mesmo a cada 30 min. */
export async function lerGmailAgora(): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) lê o Gmail." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke("fin-intimacoes-ler-gmail", { body: { acao: "ler" } });
  revalidatePath(ROTA_INTIMACOES);
  if (error) return { ok: false, erro: await mensagemDaFuncao(error, "Não foi possível falar com a função de leitura do Gmail.") };
  const r = data as { novas?: number; repetidas?: number; emails?: number; restantes?: number };
  const resto = r.restantes ? ` Ficaram ${r.restantes} para a próxima leitura.` : "";
  return { ok: true, aviso: `${r.emails ?? 0} e-mail(s) novo(s): ${r.novas ?? 0} intimação(ões) nova(s), ${r.repetidas ?? 0} já conhecida(s).${resto}` };
}

const esquemaDados = z.object({
  id: uuid,
  empresaId: uuid,
  credorDocumento: z.string().trim().max(18),
  credorNome: z.string().trim().max(200),
  numeroTitulo: z.string().trim().max(50),
  valorTituloCentavos: z.number().int().positive().nullable(),
  vencimentoTitulo: dataIso.nullable(),
  dataLimite: dataIso.nullable(),
  valorCustasCentavos: z.number().int().positive("As custas precisam ser maiores que zero.").nullable(),
});

/** Dados conferidos/informados a partir da intimação (prazo e custas só a pessoa informa). */
export async function informarDados(entrada: z.input<typeof esquemaDados>): Promise<Resultado> {
  const d = esquemaDados.safeParse(entrada);
  if (!d.success) return { ok: false, erro: d.error.issues[0].message };
  const v = d.data;
  return chamar("operador", "fin_int_informar_dados", {
    p_id: v.id, p_empresa: v.empresaId, p_credor_documento: v.credorDocumento, p_credor_nome: v.credorNome, p_numero: v.numeroTitulo,
    p_valor: v.valorTituloCentavos === null ? null : v.valorTituloCentavos / 100, p_vencimento: v.vencimentoTitulo,
    p_data_limite: v.dataLimite, p_custas: v.valorCustasCentavos === null ? null : v.valorCustasCentavos / 100,
  }, "Dados salvos.", v.id);
}

export type CandidatoTela = { codLancamento: string; numDocumento: string; vencimento: string | null; valorCentavos: number; saldoCentavos: number; numeroConfere: boolean; valorConfere: boolean };
export type ResultadoConsulta = { ok: true; candidatos: CandidatoTela[]; sugerido: string | null; aviso: string | null } | { ok: false; erro: string };

/** Consulta (só leitura) os títulos do credor no Consistem pela Edge Function. */
export async function consultarTitulos(id: string): Promise<ResultadoConsulta> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro (ou acima) consulta títulos." };
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Intimação inválida." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke("fin-intimacoes-consistem", { body: { acao: "consultar", id } });
  if (error) return { ok: false, erro: await mensagemDaFuncao(error, "Não foi possível consultar o Consistem.") };
  const r = data as { candidatos?: { titulo: { codLancamento: string; numDocumento: string; vencimento: string | null; valorDocumentoCentavos: number; saldoCentavos: number }; numeroConfere: boolean; valorConfere: boolean }[]; sugerido?: string | null; aviso?: string };
  return {
    ok: true,
    sugerido: r.sugerido ?? null,
    aviso: r.aviso ?? null,
    candidatos: (r.candidatos ?? []).map((c) => ({
      codLancamento: c.titulo.codLancamento, numDocumento: c.titulo.numDocumento, vencimento: c.titulo.vencimento,
      valorCentavos: c.titulo.valorDocumentoCentavos, saldoCentavos: c.titulo.saldoCentavos, numeroConfere: c.numeroConfere, valorConfere: c.valorConfere,
    })),
  };
}

const esquemaTitulo = z.object({
  id: uuid,
  titulo: z.object({
    codLancamento: z.string().regex(/^\d{1,12}$/), numDocumento: z.string().max(50), vencimento: dataIso.nullable(),
    valorCentavos: z.number().int(), saldoCentavos: z.number().int(),
  }),
});

export async function escolherTitulo(entrada: z.input<typeof esquemaTitulo>): Promise<Resultado> {
  const d = esquemaTitulo.safeParse(entrada);
  if (!d.success) return { ok: false, erro: "Título inválido." };
  return chamar("operador", "fin_int_escolher_titulo", { p_id: d.data.id, p_cod: d.data.titulo.codLancamento, p_titulo: d.data.titulo }, `Título ${d.data.titulo.codLancamento} escolhido.`, d.data.id);
}

export const proporVencimento = async (id: string) => chamar("operador", "fin_int_propor_vencimento", { p_id: id }, "Proposta enviada ao gestor.", id);
export const devolverProposta = async (id: string, motivo: string) => chamar("gestor", "fin_int_devolver_proposta", { p_id: id, p_motivo: motivo }, "Proposta devolvida.", id);

/**
 * Aprovação do gestor: reserva a alteração (fin_int_aprovar_vencimento) e chama a Edge Function, que lê o título, altera SÓ o
 * vencimento, lê de novo e confere. O resultado (concluído ou revisão) fica registrado com o antes e o depois.
 */
export async function aprovarVencimento(id: string): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) aprova." };
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Intimação inválida." };
  const supabase = await criarClienteServidor();
  const { data: envio, error } = await supabase.rpc("fin_int_aprovar_vencimento", { p_id: id });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const { data, error: erroFuncao } = await supabase.functions.invoke("fin-intimacoes-consistem", { body: { acao: "alterar_vencimento", id: envio } });
  revalidatePath(`${ROTA_INTIMACOES}/${id}`);
  revalidatePath(ROTA_INTIMACOES);
  if (erroFuncao) return { ok: false, erro: `${await mensagemDaFuncao(erroFuncao, "Não foi possível falar com a função do Consistem.")} A intimação fica em revisão; confira o título no Consistem.` };
  return { ok: true, aviso: (data as { aviso?: string } | null)?.aviso ?? "Vencimento alterado e conferido no Consistem." };
}

export type ResultadoPrevia = { ok: true; codLancamento: string; complementoAtual: string; complementoNovo: string } | { ok: false; erro: string };

/** Prévia (só leitura) da troca do complemento do título protestado: o atual e o novo, lidos agora no Consistem. */
export async function previaProtestado(id: string): Promise<ResultadoPrevia> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) marca título como protestado." };
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Intimação inválida." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke("fin-intimacoes-consistem", { body: { acao: "previa_protestado", id } });
  if (error) return { ok: false, erro: await mensagemDaFuncao(error, "Não foi possível ler o título no Consistem.") };
  const r = data as { codLancamento: string; complementoAtual: string; complementoNovo: string };
  return { ok: true, codLancamento: r.codLancamento, complementoAtual: r.complementoAtual, complementoNovo: r.complementoNovo };
}

/**
 * Aprovação do gestor (0185): reserva a troca do complemento pelo texto da prévia e chama a Edge Function, que lê o título,
 * altera SÓ o complemento, lê de novo e confere. Sucesso = intimação concluída.
 */
export async function marcarProtestado(id: string, complemento: string): Promise<Resultado> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "gestor")) return { ok: false, erro: "Somente gestor do Financeiro (ou acima) aprova." };
  if (!uuid.safeParse(id).success) return { ok: false, erro: "Intimação inválida." };
  const supabase = await criarClienteServidor();
  const { data: envio, error } = await supabase.rpc("fin_int_aprovar_protestado", { p_id: id, p_complemento: complemento });
  if (error) return { ok: false, erro: mensagemDeErro(error) };
  const { data, error: erroFuncao } = await supabase.functions.invoke("fin-intimacoes-consistem", { body: { acao: "alterar", id: envio } });
  revalidatePath(`${ROTA_INTIMACOES}/${id}`);
  revalidatePath(ROTA_INTIMACOES);
  if (erroFuncao) return { ok: false, erro: `${await mensagemDaFuncao(erroFuncao, "Não foi possível falar com a função do Consistem.")} Confira o título no Consistem.` };
  return { ok: true, aviso: (data as { aviso?: string } | null)?.aviso ?? "Título marcado como PROTESTADO no Consistem." };
}

export const confirmarAdiantamento = async (id: string, referencia: string) =>
  chamar("operador", "fin_int_confirmar_adiantamento", { p_id: id, p_referencia: referencia.trim().slice(0, 50) }, "Adiantamento confirmado por você. Agora falta a NF do cartório.", id);
export const registrarNf = async (id: string, numero: string) => chamar("operador", "fin_int_registrar_nf", { p_id: id, p_numero: numero }, "NF registrada.", id);
export const confirmarConsignacao = async (id: string, referencia: string) =>
  chamar("operador", "fin_int_confirmar_consignacao", { p_id: id, p_referencia: referencia.trim().slice(0, 50) }, "Consignação confirmada. Processo concluído.", id);
export const descartar = async (id: string, motivo: string) => chamar("operador", "fin_int_descartar", { p_id: id, p_motivo: motivo }, "Intimação descartada.", id);
export const mesclar = async (origem: string, destino: string) => chamar("operador", "fin_int_mesclar", { p_origem: origem, p_destino: destino }, "Intimação juntada ao apontamento.", destino);
export const retomar = async (id: string) => chamar("operador", "fin_int_retomar", { p_id: id }, "Intimação de volta à conferência.", id);
