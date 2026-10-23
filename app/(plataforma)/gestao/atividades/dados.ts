// Leitura de Central de Gestão > Atividades: funções da migration 0094, com a sessão de quem consulta (RLS vale; a
// função de resumo confere `pode_ver_atividades` para cada pessoa).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FiltrosAtividades } from "@/lib/nucleo/gestao/atividades";

export type LinhaResumo = {
  usuario_id: string; nome: string; acoes: number; dias_com_atividade: number; por_tipo: Record<string, number>;
  concluidas: number; concluidas_no_prazo: number; concluidas_apos_prazo: number; horas_ate_concluir: number | null;
  ultimo_acesso: string | null; ultima_atividade: string | null;
};

export type LinhaTempo = {
  tipo: "atividade" | "acesso"; em: string; usuario_id: string; nome: string; area: string | null; modulo: string | null;
  codigo: string | null; acao: string; descricao: string; link: string | null; origem: string | null; vezes: number;
  referencia_tabela: string | null; referencia_id: string | null; modulo_nome?: string | null;
};

export const LIMITE_LINHA_DO_TEMPO = 300;

export async function lerAtividades(supabase: SupabaseClient, f: FiltrosAtividades, acompanha: boolean, limite = LIMITE_LINHA_DO_TEMPO) {
  const verTempo = Boolean(f.pessoa || f.ref);
  const [resumo, tempo, regras, config, modulos] = await Promise.all([
    acompanha && !verTempo ? supabase.rpc("atividades_resumo", { p_de: f.de, p_ate: f.ate }) : Promise.resolve(null),
    verTempo
      ? supabase.rpc("atividades_linha_do_tempo", {
          p_usuario: f.ref ? null : f.pessoa, p_de: f.ref ? null : f.de, p_ate: f.ref ? null : f.ate,
          p_acessos: f.acessos, p_referencia: f.ref, p_modulo: f.modulo,
        }).order("em", { ascending: false }).limit(limite)
      : Promise.resolve(null),
    supabase.from("atividade_regras").select("codigo, nome"),
    supabase.from("configuracoes").select("valor").eq("chave", "administrativo.gestao.registrar_acessos").maybeSingle(),
    supabase.from("modulos").select("codigo, nome"),
  ]);
  for (const r of [resumo, tempo, regras]) if (r?.error) throw new Error(`Falha ao ler as atividades: ${r.error.message}`);

  const nomeModulo = new Map(((modulos.data ?? []) as { codigo: string; nome: string }[]).map((m) => [m.codigo, m.nome]));
  const linhas = ((tempo?.data ?? []) as LinhaTempo[]).map((l) => ({ ...l, modulo_nome: l.modulo ? (nomeModulo.get(l.modulo) ?? l.modulo) : null }));

  // Pessoas que posso ver (para o filtro): o resumo já traz; na linha do tempo, consulta à parte.
  let pessoas: { id: string; nome: string }[] = [];
  if (acompanha) {
    const p = resumo?.data
      ? { data: (resumo.data as LinhaResumo[]).map((r) => ({ id: r.usuario_id, nome: r.nome })) }
      : await supabase.from("perfis").select("id, nome").eq("ativo", true).order("nome");
    pessoas = (p.data ?? []) as { id: string; nome: string }[];
  }

  let processo: string | null = null;
  if (f.ref && linhas.length > 0) processo = linhas.find((l) => l.tipo === "atividade")?.descricao ?? null;

  return {
    resumo: resumo ? ((resumo.data ?? []) as LinhaResumo[]) : null,
    linhas,
    nomesTipos: new Map(((regras.data ?? []) as { codigo: string; nome: string }[]).map((r) => [r.codigo, r.nome])),
    registrandoAcessos: (config.data?.valor as unknown) === true,
    pessoas,
    processo,
  };
}
