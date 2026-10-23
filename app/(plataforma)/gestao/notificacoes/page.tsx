import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarDataHora } from "@/lib/nucleo/fila";
import { EVENTOS_AVISO, ROTULO_STATUS_AVISO } from "@/lib/nucleo/gestao/avisos";
import { exigirAdminGeral } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ConfigurarAvisos, EnviarAgora } from "./formularios";

export const metadata: Metadata = { title: "Avisos da Central" };

type Aviso = {
  id: number; evento: string; texto: string; status: string; motivo: string | null; tentativas: number; criado_em: string; enviado_em: string | null;
  destinatario: { nome: string } | null;
};

// Avisos (Slack) e ClickUp da Central de Gestão (docs/modulos/administrativo-gestao.md, 6.1 e 6.2). Só admin geral.
export default async function PaginaAvisos() {
  await exigirAdminGeral();
  const supabase = await criarClienteServidor();
  const [cfg, fila] = await Promise.all([
    supabase.from("configuracoes").select("chave, valor").like("chave", "administrativo.gestao.%"),
    supabase.from("notificacoes").select("id, evento, texto, status, motivo, tentativas, criado_em, enviado_em, destinatario:perfis!notificacoes_destinatario_id_fkey(nome)")
      .order("id", { ascending: false }).limit(100),
  ]);
  const valor = (c: string) => cfg.data?.find((x) => x.chave === `administrativo.gestao.${c}`)?.valor;
  const config = {
    ligadas: valor("notificacoes_ligadas") === true,
    eventos: (valor("notificacoes_eventos") ?? {}) as Record<string, boolean>,
    canal: typeof valor("slack_canal_gestao") === "string" ? (valor("slack_canal_gestao") as string) : "",
    horario: typeof valor("resumo_horario") === "string" ? (valor("resumo_horario") as string) : "07:30",
    clickupLista: typeof valor("clickup_lista_id") === "string" ? (valor("clickup_lista_id") as string) : "",
  };
  const nomeEvento = new Map<string, string>(EVENTOS_AVISO.map((e) => [e.codigo, e.nome]));
  const avisos = (fila.data ?? []) as unknown as Aviso[];
  const ligados = EVENTOS_AVISO.filter((e) => config.eventos[e.codigo]);

  return (
    <div className="max-w-5xl space-y-5">
      <Button size="sm" variant="ghost" nativeButton={false} render={<Link href="/gestao" />}><ArrowLeft /> Central de Gestão</Button>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Avisos da Central</h1>
        <p className="text-sm text-muted-foreground">
          Lembretes e avisos pelo Slack e envio de tarefas ao ClickUp. Nada sai enquanto o envio estiver desligado. A mesma pendência não
          gera o mesmo aviso duas vezes, e a cobrança ao responsável só sai quando o gestor clica em &quot;Cobrar andamento&quot;.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Configuração</CardTitle>
          <CardDescription>
            Envio <strong>{config.ligadas ? "ligado" : "desligado"}</strong> · eventos ligados: {ligados.length ? ligados.map((e) => e.nome).join(", ") : "nenhum"} ·
            canal da gestão: {config.canal || "não configurado"} · resumo às {config.horario} · lista do ClickUp: {config.clickupLista || "não configurada"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <ConfigurarAvisos cfg={config} />
          <EnviarAgora destino="slack" rotulo="Gerar lembretes e enviar agora" />
          <EnviarAgora destino="clickup" rotulo="Enviar ao ClickUp agora" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registro dos avisos</CardTitle>
          <CardDescription>Os 100 mais recentes: o que entrou na fila, o que foi enviado, ignorado (com o motivo) ou falhou (com o erro).</CardDescription>
        </CardHeader>
        <CardContent>
          {avisos.length === 0 ? (
            <p className="rounded-[3px] border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum aviso registrado. Os eventos só geram avisos depois de ligados.</p>
          ) : (
            <Table className="cartoes">
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead><TableHead>Evento</TableHead><TableHead>Para</TableHead><TableHead>Aviso</TableHead>
                  <TableHead>Situação</TableHead><TableHead>Detalhe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {avisos.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{formatarDataHora(a.criado_em)}</TableCell>
                    <TableCell>{nomeEvento.get(a.evento) ?? a.evento}</TableCell>
                    <TableCell>{a.destinatario?.nome ?? "Canal da gestão"}</TableCell>
                    <TableCell className="max-w-[24rem] whitespace-pre-line">{a.texto}</TableCell>
                    <TableCell className={a.status === "falhou" ? "text-marca" : undefined}>{ROTULO_STATUS_AVISO[a.status] ?? a.status}</TableCell>
                    <TableCell className="max-w-[16rem] whitespace-normal text-[12px]">
                      {a.status === "enviada" ? formatarDataHora(a.enviado_em) : (a.motivo ?? (a.tentativas ? `${a.tentativas} tentativa(s)` : "—"))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
