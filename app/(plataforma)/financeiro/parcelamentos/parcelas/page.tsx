import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { contaFluxo, emCentavos, formatarCompetencia, MODULO_PARCELAMENTOS, ROTA_PARCELAMENTOS, ROTULO_GUIA, ROTULO_ORIGEM } from "@/lib/modulos/financeiro/parcelamentos/parcelamentos";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { Vincular } from "../componentes";
import { listarApoio, listarLancamentos, listarParcelas } from "../dados";

export const metadata: Metadata = { title: "Parcelas — Gestão de Parcelamentos" };

const ROTA = `${ROTA_PARCELAMENTOS}/parcelas`;
const moeda = (v: string | number | null) => (v === null ? "—" : formatarMoeda(emCentavos(v) ?? 0));
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PaginaParcelas({ searchParams }: PageProps<"/financeiro/parcelamentos/parcelas">) {
  const sessao = await exigirSessao();
  const semParcelamento = primeiro((await searchParams).ver) === "sem-parcelamento";
  const supabase = await criarClienteServidor();
  const operador = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PARCELAMENTOS, "operador");

  const abas = (
    <nav aria-label="Filtro" className="flex flex-wrap gap-1">
      <Button size="sm" variant={semParcelamento ? "outline" : "default"} nativeButton={false} render={<Link href={ROTA} />}>Todas</Button>
      <Button size="sm" variant={semParcelamento ? "default" : "outline"} nativeButton={false} render={<Link href={`${ROTA}?ver=sem-parcelamento`} />}>Sem parcelamento associado</Button>
    </nav>
  );

  if (semParcelamento) {
    const [lancs, apoio] = await Promise.all([listarLancamentos(supabase, "sem_parcela"), listarApoio(supabase)]);
    return (
      <section className="space-y-3">
        {abas}
        <p className="text-sm text-muted-foreground">
          Lançamentos do Consistem que são parcelamento e ainda não estão numa parcela. Os que têm chave aparecem também como sugestão em Classificação.
        </p>
        {lancs.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum lançamento sem parcelamento.</p>
        ) : (
          <div className="overflow-x-auto rounded-[3px] border border-grade">
            <Table className="cartoes">
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead><TableHead>Fornecedor</TableHead><TableHead>Documento</TableHead><TableHead>Histórico</TableHead>
                  <TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Natureza</TableHead><TableHead>Observação</TableHead><TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lancs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.empresa_nome}</TableCell>
                    <TableCell>{l.cod_fornecedor}{l.nome_fornecedor ? ` · ${l.nome_fornecedor}` : ""}</TableCell>
                    <TableCell>{l.num_documento} <span className="text-xs text-muted-foreground">({l.tipo_lancamento} {l.cod_lancamento})</span></TableCell>
                    <TableCell>{l.complemento ?? "—"}</TableCell>
                    <TableCell>{formatarData(l.data_vencimento) || "—"}</TableCell>
                    <TableCell className="text-right">{moeda(l.valor_documento)}</TableCell>
                    <TableCell>{l.natureza_nome ?? "—"}</TableCell>
                    <TableCell className="text-xs">{l.motivo ?? (l.chave_erp ? "Falta criar o parcelamento da chave." : "Documento sem -MM/AA: vincule à mão.")}</TableCell>
                    <TableCell>{operador && <Vincular empresaId={l.empresa_id} lancamentoId={l.id} parcelamentos={apoio.parcelamentos} rotulo="Vincular" />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    );
  }

  const parcelas = await listarParcelas(supabase);
  return (
    <section className="space-y-3">
      {abas}
      {parcelas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma parcela registrada.</p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Vencimento</TableHead><TableHead>Competência</TableHead><TableHead>Parcelamento</TableHead><TableHead>Empresa</TableHead>
                <TableHead>Fornecedor</TableHead><TableHead>Natureza</TableHead><TableHead>Conta de fluxo</TableHead><TableHead>Origem</TableHead>
                <TableHead>Documento</TableHead><TableHead className="text-right">Provisionado</TableHead><TableHead className="text-right">Atualizado</TableHead>
                <TableHead className="text-right">Pago</TableHead><TableHead>Baixa no Consistem</TableHead><TableHead>Guia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parcelas.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>{formatarData(x.vencimento) || "—"}</TableCell>
                  <TableCell>{formatarCompetencia(x.competencia)}</TableCell>
                  <TableCell><Link className="underline-offset-2 hover:underline" href={`${ROTA_PARCELAMENTOS}/${x.parcelamento_id}`}>{x.parcelamento_descricao}</Link></TableCell>
                  <TableCell>{x.empresa_nome}</TableCell>
                  <TableCell>{x.fornecedor_nome ?? x.cod_fornecedor ?? "—"}</TableCell>
                  <TableCell>{x.natureza_nome}</TableCell>
                  <TableCell>{contaFluxo(x.grupo, x.conta)}</TableCell>
                  <TableCell>{ROTULO_ORIGEM[x.origem] ?? x.origem}</TableCell>
                  <TableCell>{x.num_documento ?? "—"}</TableCell>
                  <TableCell className="text-right">{moeda(x.valor_provisionado)}</TableCell>
                  <TableCell className="text-right">{moeda(x.valor_atualizado)}</TableCell>
                  <TableCell className="text-right">{moeda(x.valor_pago)}</TableCell>
                  <TableCell>{x.data_pagamento ? formatarData(x.data_pagamento) : x.quitado_em ? `Baixa vista em ${formatarData(x.quitado_em)}` : "—"}</TableCell>
                  <TableCell>{ROTULO_GUIA[x.situacao_guia]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
