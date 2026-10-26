import { Casca } from "@/components/plataforma/casca";
import { mostrarAtalhoDocumentos } from "@/lib/nucleo/ged/busca";
import { montarMenu, temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { sair } from "@/app/(auth)/login/acoes";
import { Button } from "@/components/ui/button";

export default async function LayoutPlataforma({ children }: LayoutProps<"/">) {
  // O layout não redireciona quem deve trocar a senha (senão /conta entraria em laço); cada página faz a checagem.
  const sessao = await exigirSessao({ permitirTrocaPendente: true });

  if (!sessao.perfil.ativo) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold">Acesso desativado</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Sua conta ({sessao.perfil.email}) está desativada. Fale com o administrador da plataforma.
        </p>
        <form action={sair}>
          <Button type="submit" variant="outline">Sair</Button>
        </form>
      </main>
    );
  }

  const menu = montarMenu(sessao.areas, sessao.modulos, sessao.acesso, sessao.aplicativos, { incluirVazias: true });
  const mostrarConfiguracoes = temAcessoAlgumaArea(sessao.acesso, sessao.areas);
  // Central de Gestão: para todos com alguma área; o restrito à unidade só usa o Faturamento Filial.
  const mostrarCentral = mostrarConfiguracoes && !sessao.acesso.restrito;
  // Central de Documentos (GED): só admin geral, com o módulo ativo e alguma pasta-raiz ativa. A consulta só acontece para o admin.
  const gedAtivo = sessao.acesso.adminGeral && sessao.modulos.some((m) => m.codigo === "administrativo.ged" && m.ativo);
  const raizesGed = gedAtivo ? (await (await criarClienteServidor()).rpc("ged_raizes")).data as { situacao: string }[] | null : null;
  const mostrarDocumentos = mostrarAtalhoDocumentos(sessao.modulos, sessao.acesso.adminGeral, raizesGed);

  return (
    <Casca
      menu={menu}
      usuario={{ nome: sessao.perfil.nome, email: sessao.perfil.email, adminGeral: sessao.acesso.adminGeral }}
      mostrarConfiguracoes={mostrarConfiguracoes}
      mostrarCentral={mostrarCentral}
      mostrarDocumentos={mostrarDocumentos}
    >
      {children}
    </Casca>
  );
}
