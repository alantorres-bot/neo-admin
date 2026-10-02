import { Casca } from "@/components/plataforma/casca";
import { montarMenu, temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
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

  const menu = montarMenu(sessao.areas, sessao.modulos, sessao.acesso);
  const mostrarConfiguracoes = temAcessoAlgumaArea(sessao.acesso, sessao.areas);

  return (
    <Casca
      menu={menu}
      usuario={{ nome: sessao.perfil.nome, email: sessao.perfil.email, adminGeral: sessao.acesso.adminGeral }}
      mostrarConfiguracoes={mostrarConfiguracoes}
    >
      {children}
    </Casca>
  );
}
