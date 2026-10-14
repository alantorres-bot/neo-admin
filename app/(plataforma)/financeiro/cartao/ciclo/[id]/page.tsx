import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Printer, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bloqueioDoFechamento, classeDoCiclo, ROTULO_SITUACAO, rotuloCompetencia } from "@/lib/modulos/financeiro/cartao/ciclos";
import { ROTA_CARTAO } from "@/lib/modulos/financeiro/cartao/modulo";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { conciliacaoDaRequisicao, lerCiclo, lerCompras, lerDesdobrar, lerEncargos, lerFatura, lerProvisorio, lerTrocas, quandoEm, registrarApuracao } from "../../dados";
import { BotaoResolver } from "../../[id]/encargos";
import { PainelConciliacao } from "../../[id]/painel";
import { BotaoCancelarFatura } from "../../[id]/componentes";
import { BotaoCriarProvisorio, BotaoFechar, BotaoReabrir, BotaoTrocarPortador } from "./componentes";

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
  const [encargos, compras, desdobrar] = aoVivo ? await Promise.all([lerEncargos(supabase, aoVivo), lerCompras(supabase, aoVivo), lerDesdobrar(supabase, aoVivo)]) : [null, null, null];
  const linhasCongeladas = !aoVivo && vigente ? (await lerFatura(supabase, vigente.fatura_id))?.linhas ?? [] : [];
  const provisorio = ciclo.situacao === "em_conciliacao" || (ciclo.situacao === "fechada" && !ciclo.provisorio_cod_lancamento) ? await lerProvisorio(supabase, ciclo) : null;
  const previaProvisorio = provisorio && aoVivo && !aoVivo.tituloDaFatura
    ? provisorio.titulo.ok && provisorio.ligado
      ? `Será criado no Consistem o provisório de ${formatarMoeda(Math.round(provisorio.titulo.payload.valorDocumento * 100))} contra ${provisorio.titulo.payload.codFornecedor}${provisorio.fornecedorNome ? ` · ${provisorio.fornecedorNome}` : ""}, vencimento ${formatarData(provisorio.titulo.payload.dataVencimento)}, documento ${provisorio.titulo.payload.codDocumento}.`
      : `O provisório não será criado (${provisorio.ligado ? (provisorio.titulo.ok ? "" : provisorio.titulo.erro) : "lançamento no Consistem desligado"}): fica a pendência "Criar o provisório".`
    : null;
  const trocas = ciclo.situacao !== "aguardando_fatura" ? await lerTrocas(supabase, ciclo) : null;
  const alvo = trocas?.portador ? `banco ${trocas.portador}${trocas.historico ? ` e histórico ${trocas.historico}` : ""}` : "";
  const previaPortador = aoVivo && trocas?.portador
    ? trocas.ligado
      ? ` Os títulos conciliados passarão para ${alvo} no Consistem (filtro do borderô).`
      : ` A troca dos títulos para ${alvo} no Consistem está desligada.`
    : "";
  // Pronto = trocado com o histórico atual do cartão (troca antiga só de portador não conta).
  const trocados = trocas?.trocas.filter((t) => t.situacao === "trocado" && (!trocas.historico || t.historico_novo === trocas.historico)).length ?? 0;
  const comErro = trocas?.trocas.filter((t) => t.situacao === "erro") ?? [];
  const bloqueio = aoVivo ? (aoVivo.origemTitulos !== "consistem" ? "Os títulos não foram lidos do Consistem agora; recarregue para tentar de novo." : bloqueioDoFechamento({ itensALancar: aoVivo.resultado.pendentes, residuoCentavos: aoVivo.resultado.residuoCentavos, aDesdobrar: aoVivo.resultado.aDesdobrar?.length })) : null;
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
            {rotulo} <span className={`ml-2 rounded-[3px] border px-2 py-0.5 align-middle text-xs ${classeDoCiclo(ciclo, hojeEmCuiaba())}`}>{ROTULO_SITUACAO[ciclo.situacao]}</span>
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
          {ciclo.situacao === "em_conciliacao" && ehGestor && <BotaoFechar id={ciclo.id} rotulo={rotulo} bloqueio={bloqueio} previaProvisorio={previaProvisorio || previaPortador ? `${previaProvisorio ?? ""}${previaPortador}`.trim() : null} />}
          {ciclo.situacao === "fechada" && ehGestor && <BotaoReabrir id={ciclo.id} />}
        </div>
      </div>

      {ciclo.situacao === "fechada" && !ciclo.provisorio_cod_lancamento && provisorio && (
        <section className="space-y-2 rounded-[3px] border border-amber-300 bg-amber-50 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-bold">Provisório da fatura no Consistem</h3>
              <p className="text-xs">O mês está fechado sem o título provisório. Sem ele, a situação “Paga” não é detectada sozinha.</p>
            </div>
            {ehGestor && provisorio.ligado && provisorio.titulo.ok && !provisorio.lancamentos.some((l) => l.situacao === "reservado" || l.situacao === "enviando") && <BotaoCriarProvisorio cicloId={ciclo.id} />}
          </div>
          {provisorio.titulo.ok ? (
            <p>
              {formatarMoeda(Math.round(provisorio.titulo.payload.valorDocumento * 100))} contra {provisorio.titulo.payload.codFornecedor}{provisorio.fornecedorNome ? ` · ${provisorio.fornecedorNome}` : ""},
              vencimento {formatarData(provisorio.titulo.payload.dataVencimento)}, documento {provisorio.titulo.payload.codDocumento}, complemento “{provisorio.titulo.payload.complementoHistorico}”.
            </p>
          ) : <p className="font-medium text-amber-900">{provisorio.titulo.erro}</p>}
          {!provisorio.ligado && <p className="text-xs">O lançamento no Consistem está desligado.</p>}
          {provisorio.lancamentos.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span>{quandoEm(l.criado_em)} · {l.criado_por_nome ?? ""} · {l.situacao === "erro" ? "não criado" : l.situacao === "lancado" ? `lançado ${l.cod_lancamento_erp}` : "sem resposta"}{l.erro ? ` · ${l.erro}` : ""}</span>
              {ehGestor && (l.situacao === "reservado" || l.situacao === "enviando") && <BotaoResolver l={l} />}
            </div>
          ))}
        </section>
      )}

      {(ciclo.situacao === "fechada" || ciclo.situacao === "paga") && trocas && (trocas.portador || trocas.trocas.length > 0) && (
        <section className={`space-y-2 rounded-[3px] border p-3 text-sm ${comErro.length ? "border-amber-300 bg-amber-50" : "border-grade bg-card"}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-bold">Marcas da fatura no Consistem{alvo ? `: ${alvo}` : ""}</h3>
              <p className="text-xs text-muted-foreground">
                {trocas.trocas.length
                  ? `${trocados} de ${trocas.trocas.length} ${trocas.trocas.length === 1 ? "título" : "títulos"} da fatura com ${alvo || `banco ${trocas.trocas[0].portador_novo}`}${trocas.historico ? `: no borderô (CCFFE065), filtre pelo histórico ${trocas.historico}.` : "."}`
                  : "Nenhum título da fatura teve o banco trocado ainda."}
                {!trocas.ligado && " A troca no Consistem está desligada (financeiro.cartao.trocar_portador_no_erp)."}
              </p>
            </div>
            {podeOperar && trocas.ligado && trocas.portador && (comErro.length > 0 || trocas.trocas.length === 0 || (!!trocas.historico && trocas.trocas.some((t) => t.historico_novo !== trocas.historico))) && <BotaoTrocarPortador cicloId={ciclo.id} />}
          </div>
          {comErro.map((t) => (
            <p key={t.id} className="text-xs text-amber-900">
              <span className="font-medium tabular-nums">{t.cod_lancamento}</span>{t.num_documento ? ` · ${t.num_documento}` : ""}{t.fornecedor ? ` · ${t.fornecedor}` : ""}: {t.erro}
            </p>
          ))}
        </section>
      )}

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
            faturaId={aoVivo.fatura.id} decisoesHistorico={aoVivo.decisoesHistorico} encargos={encargos} compras={compras} desdobrar={desdobrar} podeGestor={ehGestor} />
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
