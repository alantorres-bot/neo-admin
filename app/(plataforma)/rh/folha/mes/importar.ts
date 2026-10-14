"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { lerXls } from "@/lib/integracoes/importador/xls";
import { casarRelacao, interpretarRelacao, type Casamento, type Relacao } from "@/lib/modulos/rh/folha/relacao-liquidos";
import { ROTA_FOLHA, ROTULO_NATUREZA } from "@/lib/modulos/rh/folha/modulo";
import { rotuloMes } from "@/lib/modulos/rh/calendario";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerItens, lerMes } from "../dados";

const TAMANHO_MAXIMO = 5 * 1024 * 1024;
const SEM_PERMISSAO = "Somente operador do RH (ou acima) importa a folha do escritório.";

export type Previa = {
  arquivo: string; empresa: string; empregador: string; calculo: string; coluna: string; competencia: string; totalCentavos: number; pessoas: number;
  casados: Casamento["casados"]; semCadastro: Casamento["semCadastro"]; foraDoRelatorio: Casamento["foraDoRelatorio"];
  /** Pessoas da folha (mesma empresa) que ainda não casaram: opções para ligar um código à mão. */
  candidatos: { item_id: string; nome: string; matricula: string | null }[];
};

type Lido = { ok: true; relacao: Relacao; casamento: Casamento; candidatos: Previa["candidatos"]; arquivo: string } | { ok: false; erro: string };

async function ler(mesId: string, dados: FormData, ligacoes: Record<string, string> = {}): Promise<Lido> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "operador")) return { ok: false, erro: SEM_PERMISSAO };
  if (!z.string().uuid().safeParse(mesId).success) return { ok: false, erro: "Mês inválido." };
  const arquivo = dados.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, erro: "Escolha o arquivo .xls do escritório." };
  if (arquivo.size > TAMANHO_MAXIMO) return { ok: false, erro: "O arquivo passa de 5 MB." };
  const xls = lerXls(new Uint8Array(await arquivo.arrayBuffer()));
  if (!xls.ok) return xls;
  const r = interpretarRelacao(xls.planilhas[0]);
  if (!r.ok) return r;
  const supabase = await criarClienteServidor();
  const [mes, itens] = await Promise.all([lerMes(supabase, mesId), lerItens(supabase, mesId)]);
  if (!mes) return { ok: false, erro: "Mês não encontrado." };
  if (mes.status !== "aberta") return { ok: false, erro: "A folha deste mês não está aberta." };
  if (r.relacao.competencia !== mes.competencia) {
    return { ok: false, erro: `O arquivo é de ${rotuloMes(r.relacao.competencia)}, e esta folha é de ${rotuloMes(mes.competencia)}.` };
  }
  const casamento = casarRelacao(r.relacao, itens, ligacoes);
  const usados = new Set(casamento.casados.map((c) => c.item_id));
  const candidatos = itens.filter((i) => i.empregador === r.relacao.empregador && !usados.has(i.id))
    .map((i) => ({ item_id: i.id, nome: i.nome, matricula: i.matricula_escritorio }));
  return { ok: true, relacao: r.relacao, casamento, candidatos, arquivo: arquivo.name };
}

/** Lê o arquivo e mostra o que vai acontecer (não grava nada). */
export async function previaRelacao(mesId: string, dados: FormData): Promise<{ ok: true; previa: Previa } | { ok: false; erro: string }> {
  const l = await ler(mesId, dados);
  if (!l.ok) return l;
  const { relacao: r, casamento: c } = l;
  return {
    ok: true,
    previa: {
      arquivo: l.arquivo, empresa: r.empresa, empregador: r.empregador, calculo: r.calculo, coluna: ROTULO_NATUREZA[r.natureza], competencia: r.competencia,
      totalCentavos: r.totalCentavos, pessoas: r.pessoas.length, casados: c.casados, semCadastro: c.semCadastro, foraDoRelatorio: c.foraDoRelatorio, candidatos: l.candidatos,
    },
  };
}

/** Lê o arquivo de novo (não confia na tela), aplica as ligações escolhidas e grava. */
export async function aplicarRelacao(mesId: string, dados: FormData): Promise<{ ok: true; aviso: string } | { ok: false; erro: string }> {
  let ligacoes: Record<string, string> = {};
  try {
    const bruto = JSON.parse(String(dados.get("ligacoes") ?? "{}")) as unknown;
    const v = z.record(z.string().regex(/^\d{1,9}$/), z.string().uuid()).safeParse(bruto);
    if (!v.success) return { ok: false, erro: "Ligações inválidas." };
    ligacoes = v.data;
  } catch { return { ok: false, erro: "Ligações inválidas." }; }
  const l = await ler(mesId, dados, ligacoes);
  if (!l.ok) return l;
  const { relacao: r, casamento: c } = l;
  const ligados = c.casados.filter((x) => ligacoes[x.codigo] === x.item_id);
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("rh_fp_importar_relacao", {
    p_id: mesId, p_empregador: r.empregador, p_cnpj: r.cnpj, p_calculo: r.calculo, p_natureza: r.natureza, p_arquivo: l.arquivo,
    p_pessoas: r.pessoas.length, p_total: r.totalCentavos / 100,
    p_linhas: c.casados.map((x) => ({ item_id: x.item_id, valor: x.novoCentavos / 100 })),
    p_ligacoes: ligados.map((x) => ({ item_id: x.item_id, codigo: x.codigo })),
    p_sem_cadastro: c.semCadastro.map((p) => ({ codigo: p.codigo, nome: p.nome, valor: p.centavos / 100 })),
  });
  if (error) return { ok: false, erro: error.code === "P0001" ? error.message : "Não foi possível gravar a importação." };
  revalidatePath(ROTA_FOLHA, "layout");
  const fora = c.semCadastro.length ? ` ${c.semCadastro.length} pessoa(s) do arquivo ficaram de fora (sem cadastro na folha).` : "";
  return { ok: true, aviso: `${r.empregador} · ${r.calculo}: ${data as number} valor(es) gravado(s) em ${ROTULO_NATUREZA[r.natureza]}.${fora}` };
}
