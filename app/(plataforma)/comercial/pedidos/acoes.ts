"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MODULO_PEDIDOS, ROTA_PEDIDOS } from "@/lib/modulos/comercial/pedidos/carteira";
import { temAcesso, temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

const FUNCAO = "com-pedidos-sincronizar";

/** Mensagem de erro que a Edge Function devolve no corpo (`{ erro }`), ou a genérica. */
async function erroDaFuncao(error: unknown, generica: string): Promise<string> {
  const resposta = (error as { context?: Response }).context;
  if (resposta && typeof resposta.json === "function") {
    try {
      const detalhe = (await resposta.json()) as { erro?: string };
      if (detalhe.erro) return detalhe.erro;
    } catch {
      /* mantém a genérica */
    }
  }
  return generica;
}

export type ResultadoAtualizacao = { ok: true; linhas: string[] } | { ok: false; erro: string };

type ResumoEmpresa = {
  empresa?: string; ok?: boolean; erro?: string; simulado?: boolean; pedidosNaApi?: number; novos?: number; paraDetalhar?: number;
  detalhados?: number; notasGravadas?: number; notasLidas?: number; notasSemTitulos?: number; errosDetalhe?: number; errosParcelas?: number;
  pendenciasAbertas?: number; pendenciasConcluidas?: number; restamParaDetalhar?: number;
  mdfesLidos?: number; pendenciasMdfeAbertas?: number; erroMdfe?: string;
};

function descrever(r: ResumoEmpresa): string[] {
  const nome = r.empresa ?? "Empresa";
  if (r.ok === false) return [`${nome}: falhou — ${r.erro ?? "erro desconhecido"}`];
  if (r.simulado) return [`${nome}: ${r.pedidosNaApi ?? 0} pedidos no Consistem; ${r.novos ?? 0} novos e ${r.paraDetalhar ?? 0} a reler. Nada foi gravado.`];
  const linhas = [
    `${nome}: ${r.pedidosNaApi ?? 0} pedidos lidos (${r.novos ?? 0} novos); ${r.detalhados ?? 0} pedidos relidos, ${r.notasGravadas ?? 0} NFs e parcelas de ${r.notasLidas ?? 0} NFs atualizadas.`,
    `Pendências de previsão vencida: ${r.pendenciasAbertas ?? 0} abertas, ${r.pendenciasConcluidas ?? 0} concluídas.`,
  ];
  linhas.push(r.erroMdfe ? `MDF-e: não foi possível ler (${r.erroMdfe}).` : `MDF-e: ${r.mdfesLidos ?? 0} manifestos lidos; ${r.pendenciasMdfeAbertas ?? 0} pendências de não encerrado abertas.`);
  if ((r.restamParaDetalhar ?? 0) > 0) linhas.push(`Ainda ${r.restamParaDetalhar} pedidos a reler: seguem nas próximas rodadas automáticas (a cada 30 minutos).`);
  if ((r.errosDetalhe ?? 0) + (r.errosParcelas ?? 0) > 0) linhas.push(`Falhas pontuais: ${r.errosDetalhe ?? 0} pedidos e ${r.errosParcelas ?? 0} NFs; serão tentados de novo.`);
  return linhas;
}

/** Atualiza a carteira pela Edge Function (só ela conhece o token da API). Gestor do Comercial; a função confere de novo. */
export async function atualizarPedidos(simular: boolean): Promise<ResultadoAtualizacao> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "comercial", "gestor")) return { ok: false, erro: "Somente o gestor do Comercial pode atualizar os pedidos." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke(FUNCAO, { body: { acao: "sincronizar", simular } });
  if (error) return { ok: false, erro: await erroDaFuncao(error, "Não foi possível atualizar do Consistem.") };
  const resultados = ((data as { resultados?: ResumoEmpresa[] } | null)?.resultados ?? []);
  if (resultados.length === 0) return { ok: false, erro: "A atualização não devolveu resultado." };
  if (!simular) revalidatePath(ROTA_PEDIDOS, "layout");
  return { ok: true, linhas: resultados.flatMap(descrever) };
}

export type ResultadoDocumento = { ok: true; arquivo: string; nome: string; tipo: string } | { ok: false; erro: string };

const esquemaDocumento = z.object({ notaId: z.string().uuid(), tipo: z.enum(["danfe", "xml"]) });

/** DANFE (PDF) ou XML da NF, direto do Consistem, em base64. Quem tem acesso ao módulo. */
export async function baixarDocumentoNota(notaId: string, tipo: "danfe" | "xml"): Promise<ResultadoDocumento> {
  const sessao = await exigirSessao();
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PEDIDOS)) return { ok: false, erro: "Sem acesso aos pedidos." };
  const entrada = esquemaDocumento.safeParse({ notaId, tipo });
  if (!entrada.success) return { ok: false, erro: "Pedido de documento inválido." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.functions.invoke(FUNCAO, { body: { acao: "documento", nota_id: entrada.data.notaId, tipo: entrada.data.tipo } });
  if (error) return { ok: false, erro: await erroDaFuncao(error, "Não foi possível baixar o documento.") };
  const d = data as { arquivo?: string; nome?: string; tipo?: string; erro?: string } | null;
  if (!d?.arquivo || !d.nome || !d.tipo) return { ok: false, erro: d?.erro ?? "O Consistem não devolveu o arquivo." };
  return { ok: true, arquivo: d.arquivo, nome: d.nome, tipo: d.tipo };
}
