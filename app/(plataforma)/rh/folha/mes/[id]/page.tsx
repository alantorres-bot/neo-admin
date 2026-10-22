import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { rotuloMes } from "@/lib/modulos/rh/calendario";
import { ROTULO_FORMA } from "@/lib/modulos/rh/colaboradores/modulo";
import { titulosDoItem } from "@/lib/modulos/rh/folha/lancamento";
import { ROTA_FOLHA } from "@/lib/modulos/rh/folha/modulo";
import { codigosDoTitulo, contaPagadora, ROTULO_TIPO } from "@/lib/modulos/rh/lancamento";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerParametrosRh } from "../../../_consistem/dados";
import { PainelConsistem } from "../../../_consistem/painel";
import { lerImportacoes, lerItens, lerLancamentos, lerMes, lerPessoasRecibo, lerRecibos, lerRubricas, lerVigencias, ROTULO_STATUS } from "../../dados";
import { lancarNoConsistem, resolverLancamento } from "../acoes";
import { RecibosDoMes } from "./recibos";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ImportarLiquidos } from "./importar";
import { GradeFolha } from "./grade";
import { DecimoTerceiroDoMes, FluxoFolha, PixFolha } from "./paineis";

export const metadata: Metadata = { title: "Folha do mês" };

const quando = (iso: string | null) => (iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "");

export default async function PaginaMesFolha({ params }: PageProps<"/rh/folha/mes/[id]">) {
  const sessao = await exigirSessao();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const podeOperar = temAcesso(sessao.acesso, "rh", "operador");
  const ehGestor = temAcesso(sessao.acesso, "rh", "gestor");
  const supabase = await criarClienteServidor();
  const [mes, itens, importacoes, pessoas, rubricas, vigencias, lancamentos, parametros] = await Promise.all([
    lerMes(supabase, id), lerItens(supabase, id), lerImportacoes(supabase, id), lerPessoasRecibo(supabase), lerRubricas(supabase), lerVigencias(supabase),
    lerLancamentos(supabase, id), lerParametrosRh(supabase),
  ]);
  if (!mes) notFound();
  const recibos = await lerRecibos(supabase, { competencia: mes.competencia });
  const naFolha = new Set(itens.map((i) => i.colaborador_id));
  const pix = itens.filter((i) => i.forma_pagamento !== "fopag" && i.valor > 0);
  const temFopag = itens.some((i) => i.forma_pagamento === "fopag" && i.valor > 0);
  // Último lançamento de cada pessoa × tipo (o ativo, se houver; senão o erro mais recente).
  const ultimo = new Map<string, (typeof lancamentos)[number]>();
  for (const l of lancamentos) {
    const atual = ultimo.get(`${l.item_id}:${l.tipo}`);
    if (!atual || atual.situacao === "erro") ultimo.set(`${l.item_id}:${l.tipo}`, l);
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" render={<Link href={`${ROTA_FOLHA}/meses?ano=${mes.competencia.slice(0, 4)}`} />}><ArrowLeft /> Meses</Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-bold">Folha de {rotuloMes(mes.competencia)} <Badge variant="outline" className="ml-2 align-middle">{ROTULO_STATUS[mes.status]}</Badge></h2>
          <p className="text-sm text-muted-foreground">
            Pagamento até {formatarData(mes.data_pagamento)}
            {mes.conferida_em ? ` · conferida ${quando(mes.conferida_em)}${mes.conferida_por_nome ? ` por ${mes.conferida_por_nome}` : ""}` : ""}
            {mes.aprovada_em ? ` · aprovada ${quando(mes.aprovada_em)}${mes.aprovada_por_nome ? ` por ${mes.aprovada_por_nome}` : ""}` : ""}
            {mes.arquivo_bb_gerado_em ? ` · arquivo do BB gerado ${quando(mes.arquivo_bb_gerado_em)}` : ""}
          </p>
          {mes.reaberta_motivo && mes.status === "aberta" && <p className="text-sm text-amber-700">Reaberta em {quando(mes.reaberta_em)}: {mes.reaberta_motivo}</p>}
        </div>
        <FluxoFolha id={mes.id} status={mes.status} podeOperar={podeOperar} ehGestor={ehGestor} temFopag={temFopag} />
      </div>

      {podeOperar && mes.status === "aberta" && (
        <div className="flex flex-wrap items-center gap-3">
          <ImportarLiquidos mesId={mes.id} />
          <span className="text-xs text-muted-foreground">Relação Geral dos Líquidos (.xls) do escritório: um arquivo por empresa e por cálculo (Folha Mensal, 13º, Férias).</span>
        </div>
      )}

      <GradeFolha mesId={mes.id} editavel={podeOperar && mes.status === "aberta"} itens={itens} />

      <DecimoTerceiroDoMes linhas={itens.filter((i) => i.decimo_terceiro > 0).map((i) => ({ id: i.id, cod_fornecedor: i.cod_fornecedor, nome: i.nome, empregador: i.empregador, forma_pagamento: i.forma_pagamento, decimo_terceiro: i.decimo_terceiro }))} />

      <RecibosDoMes mesId={mes.id} competencia={mes.competencia} aberta={mes.status === "aberta"} podeOperar={podeOperar} recibos={recibos}
        pessoas={pessoas.filter((p) => p.ativo || naFolha.has(p.id))} rubricas={rubricas} vigencias={vigencias} />

      {importacoes.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-base font-bold">Importações do escritório</h3>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Quando</TableHead><TableHead>Empresa</TableHead><TableHead>Cálculo</TableHead><TableHead className="text-right">Pessoas</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Gravadas</TableHead><TableHead>De fora</TableHead><TableHead>Por</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {importacoes.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="tabular-nums">{quando(i.importado_em)}</TableCell><TableCell>{i.empregador}</TableCell><TableCell>{i.calculo}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.pessoas}</TableCell><TableCell className="text-right tabular-nums">{i.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.aplicadas}{i.ligadas ? ` (${i.ligadas} ligada${i.ligadas > 1 ? "s" : ""} à mão)` : ""}</TableCell>
                  <TableCell className="text-xs">{i.sem_cadastro.length ? i.sem_cadastro.map((s) => `${s.codigo} ${s.nome}`).join(", ") : "—"}</TableCell>
                  <TableCell>{i.importado_por_nome ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {(mes.status === "aprovada" || mes.status === "paga") && (
        <section className="space-y-2">
          <h3 className="text-base font-bold">PIX</h3>
          <PixFolha id={mes.id} podeMarcar={podeOperar && mes.status === "aprovada"}
            linhas={pix.map((i) => ({ id: i.id, cod_fornecedor: i.cod_fornecedor, nome: i.nome, empregador: i.empregador,
              pagadora: contaPagadora(parametros.parametros, i.empregador, i.forma_pagamento) ?? ROTULO_FORMA[i.forma_pagamento], valor: i.valor, pix_pago_em: i.pix_pago_em }))} />
        </section>
      )}

      {(mes.status === "aprovada" || mes.status === "paga") && (
        <section className="space-y-2">
          <h3 className="text-base font-bold">Contas a pagar no Consistem</h3>
          <PainelConsistem id={mes.id} ligado={parametros.folhaLigado} podeLancar={podeOperar} parametrosHref={`${ROTA_FOLHA}/parametros`}
            descricao="Um título por pessoa e tipo (salário, férias, 13º, avulso), contra o fornecedor (Nº), com vencimento no dia do pagamento e o portador da empregadora/forma."
            lancar={lancarNoConsistem} resolver={resolverLancamento}
            linhas={itens.flatMap((i) => titulosDoItem(i, mes.competencia).map((t) => {
              const l = ultimo.get(`${i.id}:${t.tipo}`);
              return { chave: `${i.id}:${t.tipo}`, cod_fornecedor: i.cod_fornecedor, nome: i.nome, tipo: ROTULO_TIPO[t.tipo], valor: t.valor,
                portador: codigosDoTitulo(parametros.parametros, t.tipo, i.empregador, i.forma_pagamento)?.codPortador ?? null,
                lancamento: l ? { id: l.id, situacao: l.situacao, cod: l.cod_lancamento_erp, erro: l.erro } : null };
            }))} />
        </section>
      )}
    </div>
  );
}
