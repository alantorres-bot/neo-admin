"use server";

import { lerBuffer } from "@/lib/integracoes/importador/ler-arquivo";
import { cruzarComCarteira, lerPlanilhaAkf, type ResultadoConferencia, type TituloApp } from "@/lib/modulos/financeiro/akf/conciliacao";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type RespostaConferencia =
  | {
    ok: true;
    arquivo: string;
    avisos: string[];
    planilha: { linhas: number; totalCentavos: number; totalDeclaradoCentavos: number | null };
    resultado: ResultadoConferencia;
  }
  | { ok: false; erro: string };

const TAMANHO_MAXIMO = 1024 * 1024; // 1 MB: a planilha da AKF tem dezenas de linhas
const emCentavos = (v: number | string) => Math.round(Number(v) * 100);

/**
 * Lê a planilha da AKF enviada e a cruza com a carteira em aberto. SÓ LÊ: nada é gravado. As correções são aplicadas depois, uma a uma,
 * pelas ações do módulo (marcar como cedido, lançar/encerrar parte), cada uma com a confirmação de uma pessoa.
 */
export async function conferirPlanilha(formData: FormData): Promise<RespostaConferencia> {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro", "operador")) return { ok: false, erro: "Somente operador do Financeiro ou acima pode conferir a carteira com a planilha da AKF." };

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, erro: "Escolha o arquivo da planilha da AKF (.xlsx)." };
  if (arquivo.size > TAMANHO_MAXIMO) return { ok: false, erro: "O arquivo passa de 1 MB: não parece ser a planilha da AKF." };

  const lido = await lerBuffer(await arquivo.arrayBuffer(), arquivo.name);
  if (!lido.ok) return { ok: false, erro: lido.erro };
  let planilha = null;
  let erroLeitura = "";
  for (const p of lido.planilhas) {
    const r = lerPlanilhaAkf(p.matriz);
    if (r.ok) {
      planilha = r.planilha;
      break;
    }
    erroLeitura = r.erro;
  }
  if (!planilha) return { ok: false, erro: erroLeitura || "Não encontrei a planilha da AKF no arquivo." };

  const supabase = await criarClienteServidor();
  // Carteira em aberto (PostgREST devolve até 1000 por vez), nomes dos clientes e partes antecipadas ativas.
  const abertos: { id: string; documento: string; nota_fiscal: string | null; vencimento: string; valor: number | string; cedido: boolean; cod_portador: string | null; unidade: string; contraparte_id: string }[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from("rec_vw_titulos")
      .select("id, documento, nota_fiscal, vencimento, valor, cedido, cod_portador, unidade, contraparte_id")
      .neq("faixa", "encerrado").order("id").range(de, de + 999);
    if (error) return { ok: false, erro: "Não foi possível ler a carteira. Tente novamente." };
    abertos.push(...((data ?? []) as typeof abertos));
    if (!data || data.length < 1000) break;
  }
  const idsClientes = [...new Set(abertos.map((t) => t.contraparte_id))];
  const nomes = new Map<string, string>();
  await Promise.all(Array.from({ length: Math.ceil(idsClientes.length / 100) }, (_, i) => idsClientes.slice(i * 100, (i + 1) * 100)).map(async (lote) => {
    const { data } = await supabase.from("contrapartes").select("id, nome").in("id", lote);
    for (const c of data ?? []) nomes.set(c.id as string, c.nome as string);
  }));
  const { data: partesBrutas, error: erroPartes } = await supabase.from("akf_desdobramentos").select("id, titulo_id, valor, vencimento").eq("status", "ativo");
  if (erroPartes) return { ok: false, erro: "Não foi possível ler as antecipações parciais. Tente novamente." };
  const partesPorTitulo = new Map<string, { id: string; valorCentavos: number; vencimento: string }[]>();
  for (const p of partesBrutas ?? []) {
    const lista = partesPorTitulo.get(p.titulo_id as string) ?? [];
    lista.push({ id: p.id as string, valorCentavos: emCentavos(p.valor as number | string), vencimento: p.vencimento as string });
    partesPorTitulo.set(p.titulo_id as string, lista);
  }

  const titulos: TituloApp[] = abertos.map((t) => ({
    id: t.id, documento: t.documento, notaFiscal: t.nota_fiscal, vencimento: t.vencimento, valorCentavos: emCentavos(t.valor),
    cliente: nomes.get(t.contraparte_id) ?? "", unidade: t.unidade, cedido: !!t.cedido, codPortador: t.cod_portador, partes: partesPorTitulo.get(t.id) ?? [],
  }));

  return {
    ok: true,
    arquivo: arquivo.name,
    avisos: planilha.avisos,
    planilha: { linhas: planilha.linhas.length, totalCentavos: planilha.totalLidoCentavos, totalDeclaradoCentavos: planilha.totalDeclaradoCentavos },
    resultado: cruzarComCarteira(planilha.linhas, titulos),
  };
}
