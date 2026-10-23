// Aplicativo externo cadastrado em `aplicativos`: abre embutido no painel ou, se assim cadastrado, em nova aba.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { QuadroApp } from "@/components/plataforma/quadro-app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { enderecoDaTela } from "@/lib/nucleo/aplicativos";
import type { Aplicativo } from "@/lib/nucleo/tipos";

async function aplicativoDaRota(codigo: string): Promise<Aplicativo> {
  const sessao = await exigirSessao();
  const app = sessao.aplicativos.find((a) => a.codigo === codigo && a.ativo);
  if (!app || !temAcesso(sessao.acesso, app.area)) notFound();
  return app;
}

export async function generateMetadata({ params }: PageProps<"/apps/[codigo]">): Promise<Metadata> {
  const { codigo } = await params;
  const app = await aplicativoDaRota(codigo);
  return { title: app.nome };
}

export default async function PaginaAplicativo({ params, searchParams }: PageProps<"/apps/[codigo]">) {
  const { codigo } = await params;
  const app = await aplicativoDaRota(codigo);
  // ?tela=/pendencias abre direto essa tela do aplicativo (links da Central de Gestão); só caminho interno do próprio app.
  const tela = enderecoDaTela(app.url, (await searchParams).tela);

  if (app.abrir === "embutido") return <QuadroApp nome={app.nome} url={tela} />;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{app.nome}</CardTitle>
        {app.descricao && <CardDescription>{app.descricao}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Este aplicativo abre em uma nova aba, no endereço dele. O login é o do próprio aplicativo.</p>
        <Button render={<a href={tela} target="_blank" rel="noopener noreferrer" />}>
          <ExternalLink /> Abrir {app.nome}
        </Button>
      </CardContent>
    </Card>
  );
}
