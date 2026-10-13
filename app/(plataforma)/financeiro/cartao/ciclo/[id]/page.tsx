import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Printer, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bloqueioDoFechamento, CLASSE_SITUACAO, ROTULO_SITUACAO, rotuloCompetencia } from "@/lib/modulos/financeiro/cartao/ciclos";
import { ROTA_CARTAO } from "@/lib/modulos/financeiro/cartao/modulo";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { conciliacaoDaRequisicao, lerCiclo, lerCompras, lerEncargos, lerFatura, quandoEm, registrarApuracao } from "../../dados";
import { PainelConciliacao } from "../../[id]/painel";
import { BotaoCancelarFatura } from "../../[id]/componentes";
import { BotaoFechar, BotaoReabrir } from "./componentes";

export const metadata: Metadata = { title: "Mês do cartão" };

const centavos = (v: number | string | null) => (v === null ? null : Math.round(Number(v) * 100));

export default async function PaginaCiclo({ params }: PageProps<"/financeiro/cartao/ciclo/[id]">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const lido = await lerCiclo(supabase, id);
  if (!lido) notFound();
  const { ciclo, fechamentos, faturas } = lido;
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");
  const ehGestor = temAcesso(sessao.acesso, "financeiro", "gestor");
  const rotulo = `${ciclo.cartao_nome} ${rotuloCompetencia(ciclo.competencia)}`;
  const vigente = fechamentos.find((f) => f.reaberto_em === null) ?? null;
  const fatura = faturas.find((f) => f.id === ciclo.fatura_id) ?? null;

  // Em conciliação: calcula ao vivo e grava a apuração (mantém as pendências). Fechada/paga: mostra a foto do fechamento.
  const aoVivo = ciclo.situacao === "em_conciliacao" && ciclo.fatura_id ? await conciliacaoDaRequisicao(ciclo.fatura_id) : null;
  if (aoVivo) await registrarApuracao(supabase, ciclo.id, aoVivo);
  const [encargos, compras] = aoVivo ? await Promise.all([lerEncargos(supabase, aoVivo), lerCompras(supabase, aoVivo)]) : [null, null];
  const linhasCongeladas = !aoVivo && vigente ? (await lerFatura(supabase, vigente.fatura_id))?.linhas ?? [] : [];
  const bloqueio = aoVivo ? (aoVivo.origemTitulos !== "consistem" ? "Os títulos não foram lidos do Consistem agora; recarregue para tentar de novo." : bloqueioDoFechamento({ itensALancar: aoVivo.resultado.pendentes, residuoCentavos: aoVivo.resultado.residuoCentavos })) : null;
  const podeCancelarFatura = fatura?.status === "importada" && ciclo.situacao === "em_conciliacao" && (ehGestor || (podeOperar && fatura.importado_por === sessao.userId));

  const etapas: { rotulo: string; quando: string | null; detalhe?: string }[] = [
    { rotulo: "Cartão fechou", quando: formatarData(ciclo.fechamento), detalhe: `vence ${formatarData(ciclo.vencimento_nominal)}` },
    { rotulo: "Fatura importada", quando: fatura ? quandoEm(fatura.importado_em) : null, detalhe: fatura ? `${fatura.importado_por_nome ?? ""}${fatura.arquivo_nome ? ` · ${fatura.arquivo_nome}` : ""}` : undefined },
    { rotulo: "Fechada", quando: ciclo.fechada_em ? quandoEm(ciclo.fechada_em) : null, detalhe: ciclo.fechada_por_nome ?? undefined },
    { rotulo: "Paga", quando: ciclo.paga_em ? formatarData(ciclo.paga_em) : null, detalhe: ciclo.paga_por_cod_lancamento ? `provisório ${ciclo.paga_por_cod_lancamento} saiu do Consistem` : undefined },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" render={<Link href={`${ROTA_CARTAO}/meses`} />}><ArrowLeft /> Meses</Button>
          <h2 className="text-lg font-bold">
            {rotulo} <span className={`ml-2 rounded-[3px] border px-2 py-0.5 align-middle text-xs ${CLASSE_SITUACAO[ciclo.situacao]}`}>{ROTULO_SITUACAO[ciclo.situacao]}</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            {ciclo.empresa_nome} · fechamento {formatarData(ciclo.fechamento)} · vencimento {formatarData(ciclo.vencimento_nominal)} ·{" "}
            <Link href={`${ROTA_CARTAO}/historico?cartao=${encodeURIComponent(ciclo.cartao)}`} className="text-elo hover:underline">histórico do cartão</Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ciclo.situacao === "aguardando_fatura" && podeOperar && (
            <Button render={<Link href={`${ROTA_CARTAO}/nova?ciclo=${ciclo.id}`} />}><Upload /> Importar fatura</Button>
          )}
          {fatura && ciclo.situacao === "em_conciliacao" && (
            <Button variant="outline" render={<a href={`${ROTA_CARTAO}/${fatura.id}/planilha`} />}><Download /> Baixar planilha (XLSX)</Button>
          )}
          {vigente?.planilha_url && (
            <Button variant="outline" render={<a href={vigente.planilha_url} />}><Download /> Planilha do fechamento</Button>
          )}
          {(fatura || vigente) && (
            <Button variant="outline" render={<a href={`/imprimir/cartao/ciclo/${ciclo.id}`} target="_blank" rel="noopener" />}><Printer /> Imprimir / salvar PDF</Button>
          )}
          {podeCancelarFatura && fatura && <BotaoCancelarFatura id={fatura.id} />}
          {ciclo.situacao === "em_conciliacao" && ehGestor && <BotaoFechar id={ciclo.id} rotulo={rotulo} bloqueio={bloqueio} />}
          {ciclo.situacao === "fechada" && ehGestor && <BotaoReabrir id={ciclo.id} />}
        </div>
      </div>

      <ol className="grid gap-2 sm:grid-cols-4">
        {etapas.map((e) => (
          <li key={e.rotulo} className={`rounded-[3px] border p-2 text-[13px] ${e.quando ? "border-emerald-300 bg-emerald-50" : "border-grade bg-card text-muted-foreground"}`}>
            <p className="font-bold">{e.rotulo}</p>
            <p className="tabular-nums">{e.quando ?? "—"}</p>
            {e.quando && e.detalhe && <p className="text-xs text-muted-foreground">{e.detalhe}</p>}
          </li>
        ))}
      </ol>

      {ciclo.situacao === "aguardando_fatura" && (
        <p className="rounded-[3px] border border-amber-300 bg-amber-50 p-3 text-sm">
          O cartão fechou em {formatarData(ciclo.fechamento)}. Baixe a fatura do emissor (PDF) e importe aqui para conciliar com o contas a pagar.
        </p>
      )}

      {aoVivo && (
        <>
          <p className="text-xs text-muted-foreground">
            {aoVivo.origemTitulos === "consistem"
              ? <>Conciliação calculada agora, com os títulos lidos do Consistem (inclusive os do borderô do cartão).</>
              : <><strong className="text-amber-800">Não foi possível consultar o Consistem ({aoVivo.avisoOrigem}).</strong> Títulos do espelho, que não tem os do borderô: recarregue para tentar de novo.</>}
            {" "}<Link href={`${ROTA_CARTAO}/${aoVivo.fatura.id}`} className="text-elo hover:underline">Abrir só a fatura</Link>
          </p>
          <PainelConciliacao resultado={aoVivo.resultado} outros={aoVivo.outros} linhas={aoVivo.linhas} tituloDaFatura={aoVivo.tituloDaFatura} podeOperar={podeOperar}
            faturaId={aoVivo.fatura.id} decisoesHistorico={aoVivo.decisoesHistorico} encargos={encargos} compras={compras} />
        </>
      )}

      {!aoVivo && vigente && (
        <>
          <p className="rounded-[3px] border border-emerald-300 bg-emerald-50 p-3 text-sm">
            <strong>Resultado congelado no fechamento</strong> (versão {vigente.versao}, {quandoEm(vigente.fechado_em)}{vigente.fechado_por_nome ? ` por ${vigente.fechado_por_nome}` : ""}): é a prova do mês.
            {ciclo.situacao === "fechada" && (vigente.provisorio_cod_lancamento
              ? ` Aguardando o pagamento: quando o título provisório ${vigente.provisorio_cod_lancamento} sair do Consistem, o mês passa a Paga.`
              : " Nenhum título provisório foi identificado no fechamento: a situação Paga não será detectada sozinha.")}
          </p>
          <PainelConciliacao resultado={vigente.resultado.resultado} outros={vigente.resultado.outros ?? []} linhas={linhasCongeladas} tituloDaFatura={vigente.resultado.tituloDaFatura ?? null} podeOperar={false} congelado />
        </>
      )}

      {fechamentos.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-base font-bold">Histórico de fechamentos</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Versão</TableHead><TableHead>Fechado</TableHead><TableHead className="text-right">Fatura</TableHead><TableHead className="text-right">Títulos</TableHead>
                <TableHead>Provisório</TableHead><TableHead>Reaberto</TableHead><TableHead>Planilha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fechamentos.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="tabular-nums">{f.versao}</TableCell>
                  <TableCell>{quandoEm(f.fechado_em)}{f.fechado_por_nome ? ` · ${f.fechado_por_nome}` : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatarMoeda(centavos(f.total_fatura) ?? 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatarMoeda(centavos(f.total_titulos) ?? 0)}</TableCell>
                  <TableCell className="tabular-nums">{f.provisorio_cod_lancamento ?? "—"}</TableCell>
                  <TableCell>{f.reaberto_em ? `${quandoEm(f.reaberto_em)}${f.reaberto_por_nome ? ` · ${f.reaberto_por_nome}` : ""} — ${f.motivo_reabertura ?? ""}` : ""}</TableCell>
                  <TableCell>{f.planilha_url ? <a href={f.planilha_url} className="text-elo hover:underline">{f.planilha_nome ?? "baixar"}</a> : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {faturas.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Faturas importadas neste mês: {faturas.map((f) => <span key={f.id}><Link href={`${ROTA_CARTAO}/${f.id}`} className="text-elo hover:underline">{quandoEm(f.importado_em)}</Link> ({f.status}) </span>)}
        </p>
      )}
    </div>
  );
}
