import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MODULO_FILIAL, ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import { rotuloSituacao, ROTULO_URGENCIA, textoVencimento, type Papel } from "@/lib/modulos/financeiro/filial/estagios";
import { divergencias, type ParcelaConsistem } from "@/lib/modulos/financeiro/filial/remessa";
import { emCentavos } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso, temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BarraRemessa } from "../../barra-remessa";
import { carregarFila } from "../../fila-dados";
import { PainelLateral } from "../../painel";
import { COR_URGENCIA, ConteudoKit } from "../../painel-conteudo";

export const metadata: Metadata = { title: "Remessa da filial" };

const UUID = /^[0-9a-f-]{36}$/i;
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Marcador de documento: ✓ tem, ✗ falta (null = não se aplica). */
function Marca({ rotulo, ok }: { rotulo: string; ok: boolean | null }) {
  if (ok === null) return null;
  return <span className={`whitespace-nowrap ${ok ? "text-foreground" : "font-medium text-destructive"}`}>{rotulo} {ok ? "✓" : "✗"}</span>;
}

/**
 * Tela da remessa (visão por lote): a barra da remessa (aviso a Cuiabá, baixar, demonstrativos, relatório CCFT040 aberto) e todas
 * as NFs dela — inclusive enviadas e canceladas — com o estágio da fila, o que a nota informou e a conferência com o Consistem.
 * Clicar na NF abre o mesmo painel lateral da fila, sem sair da remessa.
 */
export default async function PaginaRemessa({ params, searchParams }: PageProps<"/financeiro/filial/remessas/[numero]">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FILIAL);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL)) notFound();
  const podeOperar = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL, "operador");
  const ehCuiaba = temAcesso(sessao.acesso, "financeiro");
  const papel: Papel = sessao.acesso.restrito ? "filial" : "cuiaba";

  const { numero } = await params;
  if (!/^\d{1,9}$/.test(numero)) notFound();
  const p = await searchParams;
  const nf = UUID.test(primeiro(p.nf)) ? primeiro(p.nf) : null;
  const hoje = hojeEmCuiaba();
  const aqui = `${ROTA_FILIAL}/remessas/${numero}`;

  const supabase = await criarClienteServidor();
  const { data: r } = await supabase.from("rec_vw_remessas").select("id, numero").eq("numero", Number(numero)).maybeSingle();
  if (!r) notFound();
  const { data: ligacoes } = await supabase.from("rec_remessa_kits").select("kit_id").eq("remessa_id", r.id);
  const ids = (ligacoes ?? []).map((l) => l.kit_id as string);
  const [linhas, { data: kitTitulos }] = await Promise.all([
    carregarFila(supabase, { papel, hoje, estagios: "todas", ids }),
    supabase.from("rec_kit_titulos").select("kit_id, rec_titulos(documento, vencimento, valor, estagio)").in("kit_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  linhas.sort((a, b) => a.nota.localeCompare(b.nota));
  const titulosPorKit = new Map<string, ParcelaConsistem[]>();
  for (const l of kitTitulos ?? []) {
    const t = (Array.isArray(l.rec_titulos) ? l.rec_titulos[0] : l.rec_titulos) as { documento: string; vencimento: string; valor: number | string; estagio: string } | null;
    if (!t || t.estagio === "cancelado" || t.estagio === "renegociado") continue;
    titulosPorKit.set(l.kit_id as string, [...(titulosPorKit.get(l.kit_id as string) ?? []), { documento: t.documento, vencimento: t.vencimento, valorCentavos: emCentavos(t.valor) }]);
  }
  const kitAberto = nf ? linhas.find((l) => l.id === nf) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`${ROTA_FILIAL}/remessas`} />}><ArrowLeft /> Remessas</Button>
        <Link className="text-[13px] underline" href={`${ROTA_FILIAL}?ver=todas&remessa=${r.numero}`}>Ver estas NFs na fila</Link>
      </div>

      <BarraRemessa numero={r.numero} podeOperar={podeOperar} ehCuiaba={ehCuiaba} naTelaDaRemessa />

      <div className="overflow-x-auto rounded-[3px] border border-grade">
        <Table className="cartoes">
          <TableHeader><TableRow>
            <TableHead>NF</TableHead><TableHead>Cliente</TableHead><TableHead>Vencimento e valor (nota)</TableHead><TableHead>Estágio</TableHead>
            <TableHead>Documentos</TableHead><TableHead>Conferência com o Consistem</TableHead><TableHead>Urgência</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {linhas.length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Nenhuma NF nesta remessa.</TableCell></TableRow>}
            {linhas.map((l) => {
              const titulos = titulosPorKit.get(l.id) ?? [];
              const div = divergencias(l.parcelasNota, titulos);
              const tarefas = [...l.situacao.tarefas.filial.map((t) => `filial: ${t}`), ...l.situacao.tarefas.cuiaba.map((t) => `Cuiabá: ${t}`)];
              return (
                <TableRow key={l.id} className={l.id === nf ? "bg-marca-clara" : undefined}>
                  <TableCell className="font-medium tabular-nums"><Link className="underline" href={`${aqui}?nf=${l.id}`} scroll={false}>{Number(l.nota)}</Link></TableCell>
                  <TableCell className="max-w-64">
                    <span className="block truncate font-medium" title={l.cliente}>{l.cliente}</span>
                    {l.obra && <span className="block truncate text-[12px] text-muted-foreground" title={l.obra}>{l.obra}</span>}
                    <span className="flex flex-wrap gap-1">
                      {l.semBoletoFactoring && <Badge variant="outline">Sem boleto de factoring</Badge>}
                      {l.cedido && <Badge variant="outline">AKF</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums">
                    {l.parcelasNota.length === 0 ? <span className="text-muted-foreground">não informado</span>
                      : l.parcelasNota.map((x) => <div key={x.vencimento}>{formatarData(x.vencimento)} · {formatarMoeda(x.valorCentavos)}</div>)}
                  </TableCell>
                  <TableCell className="text-[12px]">
                    <Badge variant={l.situacao.estagio === "cancelada" ? "outline" : "secondary"}>{rotuloSituacao(l.situacao)}</Badge>
                    {tarefas.map((t) => <div key={t} className="text-muted-foreground">{t}</div>)}
                  </TableCell>
                  <TableCell className="space-x-2 text-[12px]">
                    <Marca rotulo="NF" ok={l.docs.nota} /><Marca rotulo="Dem" ok={l.docs.demonstrativo} />
                    <Marca rotulo="Boleto" ok={l.docs.boleto} /><Marca rotulo="Carta" ok={l.docs.carta} />
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {titulos.length === 0 ? <span className="text-muted-foreground">aguardando implantação</span>
                      : div.length === 0 ? (l.parcelasNota.length === 0 ? <span className="text-muted-foreground">sem dado da nota para comparar</span> : "confere")
                        : div.map((d) => <div key={d} className="text-destructive">{d}</div>)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[12px]">
                    {l.urgencia && l.urgencia !== "sem_data" ? <Badge variant={COR_URGENCIA[l.urgencia]}>{ROTULO_URGENCIA[l.urgencia]}</Badge> : null}
                    {l.urgencia && <span className="block text-muted-foreground">{textoVencimento(l.vencimento, hoje)}</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="border-t border-grade px-3 py-2 text-sm text-muted-foreground">{linhas.length} {linhas.length === 1 ? "NF" : "NFs"}</div>
      </div>

      {nf && (
        <PainelLateral
          titulo={kitAberto ? `NF ${Number(kitAberto.nota)} — ${kitAberto.cliente}` : "NF"}
          descricao={kitAberto ? `${rotuloSituacao(kitAberto.situacao)} · remessa nº ${r.numero}` : undefined}
          fecharHref={aqui}>
          <ConteudoKit kitId={nf} sessao={sessao} papel={papel} podeOperar={podeOperar} />
        </PainelLateral>
      )}
    </div>
  );
}
