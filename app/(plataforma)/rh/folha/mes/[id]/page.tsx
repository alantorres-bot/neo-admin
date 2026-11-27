import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROTULO_FORMA } from "@/lib/modulos/rh/colaboradores/modulo";
import { titulosDoItem } from "@/lib/modulos/rh/folha/lancamento";
import { ROTA_FOLHA, rotuloFolha } from "@/lib/modulos/rh/folha/modulo";
import { PARTES_FOLHA, valorDaParte } from "@/lib/modulos/rh/arquivo-bb";
import { codigosDoTitulo, contaPagadora, ROTULO_TIPO } from "@/lib/modulos/rh/lancamento";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerParametrosRh } from "../../../_consistem/dados";
import { PainelConsistem } from "../../../_consistem/painel";
import { lerImportacoes, lerItens, lerLancamentos, lerMes, lerModelos, lerPessoasRecibo, lerRecibos, lerRubricas, lerVigencias, ROTULO_STATUS } from "../../dados";
import { avosDoDecimo, calcularRecibo, parametrosVigentes, type Rubrica } from "@/lib/modulos/rh/folha/recibos";
import { DecimoDosRecorrentes, type LinhaDecimoRecorrente } from "./decimo-recorrentes";
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
  const mensal = mes.tipo === "mensal";
  const recibos = await lerRecibos(supabase, { competencia: mes.competencia, folha: mes.tipo });
  const naFolha = new Set(itens.map((i) => i.colaborador_id));
  // Folha do 13º: 13º por fora de quem tem recibo recorrente ativo (0531)
  let decimoRecorrentes: LinhaDecimoRecorrente[] = [];
  if (mes.tipo !== "mensal") {
    const ano = Number(mes.competencia.slice(0, 4));
    const [modelos, daPrimeira] = await Promise.all([
      lerModelos(supabase),
      mes.tipo === "decimo_2" ? lerRecibos(supabase, { competencia: `${ano}-11-01`, folha: "decimo_1" }) : Promise.resolve([]),
    ]);
    const catalogo = new Map<string, Rubrica>(rubricas.map((r) => [r.codigo, r]));
    const pessoa = new Map(pessoas.map((p) => [p.id, p]));
    const par = parametrosVigentes(vigencias, mes.competencia);
    const centavos = (v: number) => Math.round(v * 100);
    decimoRecorrentes = modelos.filter((m) => m.ativo && naFolha.has(m.colaborador_id) && pessoa.get(m.colaborador_id)?.salario).map((m) => {
      const p = pessoa.get(m.colaborador_id)!;
      const linhas = m.linhas.flatMap((l) => (catalogo.get(l.rubrica) ? [{ rubrica: catalogo.get(l.rubrica)!, referencia: Number(l.referencia), valor: l.valor ?? null }] : []));
      const gerado = recibos.find((r) => r.colaborador_id === p.id && r.tipo === "decimo_recorrente");
      return {
        colaboradorId: p.id, cod_fornecedor: p.cod_fornecedor, nome: p.nome,
        base: calcularRecibo(linhas, { salario: p.salario!, insalubridade_pct: p.insalubridade_pct, adicional_noturno_pct: p.adicional_noturno_pct }, par).proventos,
        avos: avosDoDecimo(ano, p.data_admissao),
        jaPago: daPrimeira.filter((r) => r.colaborador_id === p.id && r.tipo === "decimo_recorrente").reduce((s, r) => s + centavos(r.total), 0),
        gerado: gerado ? centavos(gerado.total) : null,
      };
    }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }
  const pix = itens.filter((i) => i.forma_pagamento !== "fopag" && i.valor > 0);
  const partesFopag = PARTES_FOLHA.filter((p) => itens.some((i) => i.forma_pagamento === "fopag" && valorDaParte(i, p) > 0));
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
          <h2 className="text-lg font-bold">Folha {mensal ? "de " : "do "}{rotuloFolha(mes.competencia, mes.tipo)} <Badge variant="outline" className="ml-2 align-middle">{ROTULO_STATUS[mes.status]}</Badge></h2>
          <p className="text-sm text-muted-foreground">
            Pagamento até {formatarData(mes.data_pagamento)}
            {mes.conferida_em ? ` · conferida ${quando(mes.conferida_em)}${mes.conferida_por_nome ? ` por ${mes.conferida_por_nome}` : ""}` : ""}
            {mes.aprovada_em ? ` · aprovada ${quando(mes.aprovada_em)}${mes.aprovada_por_nome ? ` por ${mes.aprovada_por_nome}` : ""}` : ""}
            {mes.arquivo_bb_gerado_em ? ` · arquivo do BB gerado ${quando(mes.arquivo_bb_gerado_em)}` : ""}
          </p>
          {mes.reaberta_motivo && mes.status === "aberta" && <p className="text-sm text-amber-700">Reaberta em {quando(mes.reaberta_em)}: {mes.reaberta_motivo}</p>}
        </div>
        <FluxoFolha id={mes.id} status={mes.status} podeOperar={podeOperar} ehGestor={ehGestor} partesFopag={partesFopag} />
      </div>

      {podeOperar && mes.status === "aberta" && (
        <div className="flex flex-wrap items-center gap-3">
          <ImportarLiquidos mesId={mes.id} />
          <span className="text-xs text-muted-foreground">{mensal ? "Relação Geral dos Líquidos (.xls) do escritório: um arquivo por empresa e por cálculo (Folha Mensal, Férias). O 13º vai na folha do 13º." : "Relação Geral dos Líquidos (.xls) do cálculo do 13º, um arquivo por empresa."}</span>
        </div>
      )}

      <GradeFolha mesId={mes.id} tipo={mes.tipo} editavel={podeOperar && mes.status === "aberta"} itens={itens} />

      {mensal && <DecimoTerceiroDoMes linhas={itens.filter((i) => i.decimo_terceiro > 0).map((i) => ({ id: i.id, cod_fornecedor: i.cod_fornecedor, nome: i.nome, empregador: i.empregador, forma_pagamento: i.forma_pagamento, decimo_terceiro: i.decimo_terceiro }))} />}

      {mes.tipo !== "mensal" && <DecimoDosRecorrentes mesId={mes.id} parcela={mes.tipo} editavel={podeOperar && mes.status === "aberta"} linhas={decimoRecorrentes} />}

      {(mensal || recibos.length > 0) && <RecibosDoMes mesId={mes.id} competencia={mes.competencia} aberta={mes.status === "aberta"} podeOperar={podeOperar} recibos={recibos}
        pessoas={pessoas.filter((p) => p.ativo || naFolha.has(p.id))} rubricas={rubricas} vigencias={vigencias} soLista={!mensal} />}

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
            linhas={itens.flatMap((i) => titulosDoItem(i, mes.competencia, mes.tipo).map((t) => {
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
