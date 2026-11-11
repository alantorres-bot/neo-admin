import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  contaFluxo, emCentavos, formatarCompetencia, MODULO_PARCELAMENTOS, ROTULO_GUIA, ROTULO_ORIGEM, ROTULO_SITUACAO,
} from "@/lib/modulos/financeiro/parcelamentos/parcelamentos";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { Desvincular, FormParcela, FormParcelamento } from "../componentes";
import { lerParcelamento, listarApoio } from "../dados";

export const metadata: Metadata = { title: "Parcelamento" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const moeda = (v: string | number | null) => (v === null ? "—" : formatarMoeda(emCentavos(v) ?? 0));

export default async function PaginaParcelamento({ params }: PageProps<"/financeiro/parcelamentos/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const [dados, apoio] = await Promise.all([lerParcelamento(supabase, id), listarApoio(supabase)]);
  if (!dados) notFound();
  const { parcelamento: p, parcelas } = dados;
  const operador = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PARCELAMENTOS, "operador");
  const gestor = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PARCELAMENTOS, "gestor");

  const resumo: [string, string][] = [
    ["Empresa", p.empresa_nome], ["Credor", p.credor ?? "—"], ["Devedor", p.devedor ?? "—"], ["Natureza", p.natureza_nome],
    ["Origem", ROTULO_ORIGEM[p.origem] ?? p.origem], ["Nº do parcelamento", p.numero ?? "—"], ["Processo", p.processo ?? "—"], ["CDA", p.cda ?? "—"],
    ["Inscrição", p.inscricao ?? "—"], ["Referência do débito", p.referencia_debito ?? "—"], ["Adesão", formatarData(p.data_adesao) || "—"],
    ["Valor original", moeda(p.valor_original)], ["Parcelas", `${p.parcelas_pagas} paga(s) de ${p.parcelas_registradas} registrada(s)${p.qtd_parcelas ? ` · total ${p.qtd_parcelas}` : ""}`],
    ["Total pago", moeda(p.total_pago)], ["Em aberto (registrado)", moeda(p.total_em_aberto)], ["Próximo vencimento", formatarData(p.proximo_vencimento) || "—"],
    ["Chave no Consistem", p.chave_erp ?? "—"], ["Responsável", p.responsavel_nome ?? "—"],
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{p.descricao}</h2>
          <Badge variant={p.situacao === "ativo" ? "secondary" : "outline"}>{ROTULO_SITUACAO[p.situacao]}</Badge>
        </div>
        {gestor && (
          <div className="flex flex-wrap gap-2">
            <FormParcelamento naturezas={apoio.naturezas} empresas={apoio.empresas} rotulo="Editar" titulo="Editar parcelamento" variante="outline"
              inicial={{
                id: p.id, empresaId: p.empresa_id, descricao: p.descricao, natureza: p.natureza, chaveErp: p.chave_erp ?? "", devedor: p.devedor ?? "",
                credor: p.credor ?? "", numero: p.numero ?? "", processo: p.processo ?? "", cda: p.cda ?? "", inscricao: p.inscricao ?? "",
                referenciaDebito: p.referencia_debito ?? "", dataAdesao: p.data_adesao ?? "", valorOriginalCentavos: emCentavos(p.valor_original),
                qtdParcelas: p.qtd_parcelas, diaVencimento: p.dia_vencimento, situacao: p.situacao, observacoes: p.observacoes ?? "",
              }} />
            <FormParcela parcelamentoId={p.id} />
          </div>
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-2 rounded-[3px] border border-grade p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {resumo.map(([k, v]) => (
          <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd>{v}</dd></div>
        ))}
        {p.observacoes && <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs text-muted-foreground">Observações</dt><dd className="whitespace-pre-wrap">{p.observacoes}</dd></div>}
      </dl>

      <h3 className="font-semibold">Parcelas</h3>
      {parcelas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma parcela registrada.</p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Competência</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Lançamento</TableHead>
                <TableHead>Conta de fluxo</TableHead>
                <TableHead className="text-right">Provisionado</TableHead>
                <TableHead className="text-right">Atualizado</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead>Baixa no Consistem</TableHead>
                <TableHead>Guia</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parcelas.map((x) => (
                <TableRow key={x.id} className={x.cancelada_em ? "opacity-50" : undefined}>
                  <TableCell>{formatarCompetencia(x.competencia)}{x.cancelada_em ? " (cancelada)" : ""}</TableCell>
                  <TableCell>{formatarData(x.vencimento) || "—"}</TableCell>
                  <TableCell>{ROTULO_ORIGEM[x.origem] ?? x.origem}</TableCell>
                  <TableCell>
                    {x.cod_lancamento ? `${x.cod_lancamento} · ${x.tipo_lancamento} · ${x.num_documento}` : "—"}
                    {x.sumiu_em && <span className="block text-xs text-destructive">Não está mais no Consistem desde {formatarData(x.sumiu_em)}</span>}
                  </TableCell>
                  <TableCell>{contaFluxo(x.grupo, x.conta)}</TableCell>
                  <TableCell className="text-right">{moeda(x.valor_provisionado)}</TableCell>
                  <TableCell className="text-right">{moeda(x.valor_atualizado)}</TableCell>
                  <TableCell className="text-right">{moeda(x.valor_pago)}</TableCell>
                  <TableCell>{x.data_pagamento ? formatarData(x.data_pagamento) : x.quitado_em ? `Baixa vista em ${formatarData(x.quitado_em)}` : "—"}</TableCell>
                  <TableCell>{ROTULO_GUIA[x.situacao_guia]}</TableCell>
                  <TableCell>{operador && x.lancamento_id && !x.cancelada_em ? <Desvincular lancamentoId={x.lancamento_id} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
