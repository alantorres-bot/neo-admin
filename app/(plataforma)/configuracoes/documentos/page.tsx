import type { Metadata } from "next";
import type { SituacaoConexaoGed } from "@/lib/nucleo/ged/conexao-tela";
import { exigirAdminGeral } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ConexaoDrive } from "./conexao-drive";

export const metadata: Metadata = { title: "Google Drive (GED)" };

/** Conexão do GED com o Google Drive (fase A0-conexão). Só o admin geral; a situação vem da projeção ged_situacao_conexao. */
export default async function PaginaConexaoDrive() {
  await exigirAdminGeral();
  const supabase = await criarClienteServidor();
  const [situacao, config] = await Promise.all([
    supabase.rpc("ged_situacao_conexao"),
    supabase.from("configuracoes").select("chave, valor").in("chave", ["administrativo.ged.conta", "administrativo.ged.revogar_no_google"]),
  ]);
  // Sem a migration 0801 neste ambiente, a função não existe: a tela avisa, sem mostrar o erro técnico.
  const disponivel = !situacao.error;
  const valor = (chave: string) => config.data?.find((c) => c.chave === chave)?.valor;
  const conta = valor("administrativo.ged.conta");

  return (
    <section className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        A Central de Documentos lê o Google Drive com uma conta corporativa dedicada, só com permissão de leitura. Aqui o administrador geral
        conecta e desconecta essa conta. Nenhum token aparece nesta tela: ele fica guardado cifrado no banco.
      </p>
      <ConexaoDrive
        disponivel={disponivel}
        situacao={disponivel ? ((situacao.data as SituacaoConexaoGed[] | null)?.[0] ?? null) : null}
        conta={typeof conta === "string" && conta.trim() !== "" ? conta.trim().toLowerCase() : null}
        revogarNoGoogle={valor("administrativo.ged.revogar_no_google") === true}
      />
    </section>
  );
}
