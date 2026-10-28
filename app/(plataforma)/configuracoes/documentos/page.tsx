import type { Metadata } from "next";
import type { RaizGed, SituacaoConexaoGed } from "@/lib/nucleo/ged/conexao-tela";
import { exigirAdminGeral } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ConexaoDrive } from "./conexao-drive";
import { PastasRaiz } from "./pastas-raiz";

export const metadata: Metadata = { title: "Google Drive (GED)" };

/**
 * Conexão do GED com o Google Drive (A0) e pastas-raiz (A1a). Só o admin geral; a situação vem da projeção ged_situacao_conexao e as
 * raízes da projeção ged_raizes (0804).
 */
export default async function PaginaConexaoDrive() {
  await exigirAdminGeral();
  const supabase = await criarClienteServidor();
  const [situacao, config, raizes, areas] = await Promise.all([
    supabase.rpc("ged_situacao_conexao"),
    supabase.from("configuracoes").select("chave, valor").in("chave", ["administrativo.ged.conta", "administrativo.ged.revogar_no_google"]),
    supabase.rpc("ged_raizes"),
    supabase.from("areas").select("codigo, nome").order("ordem"),
  ]);
  // Sem a migration 0801 neste ambiente, a função não existe: a tela avisa, sem mostrar o erro técnico.
  const disponivel = !situacao.error;
  const valor = (chave: string) => config.data?.find((c) => c.chave === chave)?.valor;
  const conta = valor("administrativo.ged.conta");
  const atual = disponivel ? ((situacao.data as SituacaoConexaoGed[] | null)?.[0] ?? null) : null;

  return (
    <section className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        A Central de Documentos lê o Google Drive com uma conta corporativa dedicada, só com permissão de leitura. Aqui o administrador geral
        conecta e desconecta essa conta. Nenhum token aparece nesta tela: ele fica guardado cifrado no banco.
      </p>
      <ConexaoDrive
        disponivel={disponivel}
        situacao={atual}
        conta={typeof conta === "string" && conta.trim() !== "" ? conta.trim().toLowerCase() : null}
        revogarNoGoogle={valor("administrativo.ged.revogar_no_google") === true}
      />
      {/* Sem a migration 0804 neste ambiente, a projeção não existe: a seção não aparece. */}
      {disponivel && !raizes.error && (
        <PastasRaiz raizes={(raizes.data as RaizGed[] | null) ?? []} areas={areas.data ?? []} conectado={atual?.situacao === "conectada"} />
      )}
    </section>
  );
}
