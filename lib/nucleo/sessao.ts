// Sessão do usuário logado: perfil, permissões por área e catálogo de áreas/módulos.
// Use `exigirSessao()` em toda página/ação que depende do usuário. O layout não re-renderiza a cada
// navegação, então a checagem precisa estar perto dos dados, não só no layout.
import { cache } from "react";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import type { Acesso } from "./permissoes";
import type { Aplicativo, Area, Modulo, NivelAcesso, Perfil } from "./tipos";

export type Sessao = {
  userId: string;
  perfil: Perfil;
  acesso: Acesso;
  areas: Area[];
  modulos: Modulo[];
  /** Aplicativos externos ativos que o usuário pode ver (a RLS já filtra pela área). */
  aplicativos: Aplicativo[];
};

export const obterSessao = cache(async (): Promise<Sessao | null> => {
  const supabase = await criarClienteServidor();
  // getClaims confere a assinatura e a validade do token LOCALMENTE (sem ida ao servidor de Auth: ~200 ms a menos por tela).
  // Conta desativada ou removida continua barrada: o perfil abaixo vem do banco a cada requisição, com a RLS de quem chama.
  // (Se o projeto usar chave de assinatura simétrica, a própria biblioteca volta a confirmar no servidor de Auth.)
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims.sub;
  if (!userId) return null;

  const [perfil, permissoes, areas, modulos, aplicativos] = await Promise.all([
    supabase.from("perfis").select("id, nome, email, admin_geral, ativo, deve_trocar_senha").eq("id", userId).maybeSingle(),
    supabase.from("permissoes").select("area, nivel").eq("perfil_id", userId),
    supabase.from("areas").select("codigo, nome, sensivel, ordem").order("ordem"),
    supabase.from("modulos").select("codigo, area, nome, ativo").order("codigo"),
    supabase.from("aplicativos").select("id, codigo, nome, descricao, area, url, abrir, icone, ordem, ativo")
      .eq("ativo", true).order("ordem").order("nome"),
  ]);
  // Sem a migration 0006 a tabela não existe: o painel segue funcionando, só sem os aplicativos externos.
  if (aplicativos.error) console.warn(`Aplicativos externos indisponíveis: ${aplicativos.error.message}`);

  if (perfil.error) throw new Error(`Falha ao ler o perfil: ${perfil.error.message}`);
  if (!perfil.data) {
    // Usuário existe no Auth sem perfil: o gatilho da migration 0003 não rodou.
    throw new Error("Perfil não encontrado. Verifique se a migration 0003_nucleo_primeiro_acesso foi aplicada.");
  }

  const niveis: Record<string, NivelAcesso> = {};
  for (const p of permissoes.data ?? []) niveis[p.area] = p.nivel as NivelAcesso;

  // Conta desativada ou com troca de senha pendente: sem poderes (o banco já devolve áreas e módulos vazios).
  const liberado = perfil.data.ativo && !perfil.data.deve_trocar_senha;

  return {
    userId: userId,
    perfil: perfil.data as Perfil,
    acesso: { adminGeral: perfil.data.admin_geral && liberado, niveis: liberado ? niveis : {} },
    areas: (areas.data ?? []) as Area[],
    modulos: (modulos.data ?? []) as Modulo[],
    aplicativos: liberado ? ((aplicativos.data ?? []) as Aplicativo[]) : [],
  };
});

/**
 * Exige login. Quem ainda precisa trocar a senha é levado a /conta, a menos que a página
 * seja a própria troca (`permitirTrocaPendente`). Toda página e ação deve chamar isto.
 */
export async function exigirSessao(opcoes: { permitirTrocaPendente?: boolean } = {}): Promise<Sessao> {
  const sessao = await obterSessao();
  if (!sessao) redirect("/login");
  if (sessao.perfil.ativo && sessao.perfil.deve_trocar_senha && !opcoes.permitirTrocaPendente) redirect("/conta");
  return sessao;
}

/** Só administrador geral: caso contrário volta para o início. */
export async function exigirAdminGeral(): Promise<Sessao> {
  const sessao = await exigirSessao();
  if (!sessao.acesso.adminGeral) redirect("/inicio");
  return sessao;
}
