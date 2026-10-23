import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarDataHora } from "@/lib/nucleo/fila";
import { LIMITES_PADRAO, regrasDoDestaque, type LimitesDestaque } from "@/lib/nucleo/gestao/destaque";
import { temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { SeloDestaque } from "../componentes";
import { EditarLimites } from "./formulario";

export const metadata: Metadata = { title: "Como a Central classifica" };

// Transparência do destaque gerencial (docs/modulos/administrativo-gestao.md, 5.3 a 5.6): cada regra, o nível que dá e os
// limites em vigor. Todos veem; só o admin geral altera e aprova os limites.
export default async function PaginaRegras() {
  const sessao = await exigirSessao();
  if (sessao.acesso.restrito || !temAcessoAlgumaArea(sessao.acesso, sessao.areas)) notFound();
  const supabase = await criarClienteServidor();
  const [parametros, aprovacao] = await Promise.all([
    supabase.rpc("central_parametros"),
    supabase.from("configuracoes").select("valor").eq("chave", "administrativo.gestao.limites_aprovados").maybeSingle(),
  ]);
  if (parametros.error) throw new Error(`Falha ao ler os limites: ${parametros.error.message}`);
  const limites = { ...LIMITES_PADRAO, ...(parametros.data as Partial<LimitesDestaque>) };
  const aprovado = aprovacao.data?.valor as { por: string; em: string } | undefined;

  return (
    <div className="max-w-5xl space-y-5">
      <Button size="sm" variant="ghost" nativeButton={false} render={<Link href="/gestao" />}><ArrowLeft /> Central de Gestão</Button>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Como a Central classifica</h1>
        <p className="text-sm text-muted-foreground">
          Prioridade, situação e destaque são coisas diferentes. A <strong>prioridade</strong> (crítica, alta, normal) é informada pelo módulo
          ou pelo gestor. A <strong>situação</strong> é o andamento (aberta, em andamento, bloqueada, aguardando gestor). O <strong>destaque</strong> é
          calculado a cada consulta pelas regras abaixo. Nenhum prazo legal é calculado aqui: o prazo vem do módulo de origem.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Limites em vigor</CardTitle>
          <CardDescription>
            Dias corridos (ainda não há calendário de feriados).{" "}
            {aprovado
              ? `Aprovados por ${aprovado.por} em ${formatarDataHora(aprovado.em)}.`
              : "Valores iniciais propostos na especificação, ainda não aprovados pelo administrador."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-[11px] text-muted-foreground">Prazo próximo</dt><dd>{limites.dias_prazo_proximo} dias</dd></div>
            <div><dt className="text-[11px] text-muted-foreground">Atraso relevante</dt><dd>mais de {limites.dias_atraso_relevante} dias</dd></div>
            <div><dt className="text-[11px] text-muted-foreground">Bloqueio relevante</dt><dd>mais de {limites.dias_bloqueio_relevante} dias</dd></div>
            <div><dt className="text-[11px] text-muted-foreground">Sem movimentação</dt><dd>mais de {limites.dias_sem_movimentacao} dias</dd></div>
          </dl>
          {sessao.acesso.adminGeral && <EditarLimites atuais={limites} aprovados={Boolean(aprovado)} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Regras</CardTitle>
          <CardDescription>
            Cada regra que se aplica vira um motivo, mostrado na pendência. O destaque final é o mais alto entre os motivos
            (Intervir &gt; Avaliar &gt; Acompanhar). Prioridade alta, sozinha, não vira intervenção; atraso não é tratado como crítico
            só por ser atraso; impacto financeiro ou fiscal só conta quando registrado com fundamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="cartoes">
            <TableHeader>
              <TableRow><TableHead>Destaque</TableHead><TableHead>Quando</TableHead><TableHead>Código</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {regrasDoDestaque(limites).map((r, i) => (
                <TableRow key={`${r.codigo}-${i}`}>
                  <TableCell>{r.codigo === "AJUSTE_MANUAL" ? "Definido pelo gestor" : <SeloDestaque nivel={r.nivel} />}</TableCell>
                  <TableCell className="whitespace-normal">{r.quando}</TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{r.codigo}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
