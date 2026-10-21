"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useLinhasVisiveis } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { chaveTitulo, CONFERIR, ROTULO_DECISAO, type ResultadoConciliacao } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { ROTA_CARTAO } from "@/lib/modulos/financeiro/cartao/modulo";
import { descreverTitulo, travaDeLancamento } from "@/lib/modulos/financeiro/cartao/roteiro";
import type { OutroTitulo } from "@/lib/modulos/financeiro/cartao/selecao-titulos";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { cancelarFatura, conferirNaoEhOMesmo } from "../acoes";
import type { DecisaoLinha, LinhaFaturaBanco, QuadroCompras, QuadroCorrecoes } from "../dados";
import { AvisosDoTitulo, BotaoNaoEhDestaFatura } from "./correcoes";
import { DialogoLancarCompra } from "./compras";
import { BarraAgrupado, itensAgrupaveis } from "./agrupado";
import { DialogoDecidir, ListaDecisoes, SeloDecisao, type Candidatos } from "./decisoes";

const centavos = (v: number | string) => Math.round(Number(v) * 100);
const Conferir = ({ texto }: { texto: string }) => (texto === CONFERIR ? <span className="font-bold text-amber-700">{texto}</span> : <>{texto}</>);

export function AbasConciliacao({ resultado: r, outros, linhas, podeOperar, faturaId = null, decisoesHistorico = [], compras = null, correcoes = null }: {
  /** Avisos dos conciliados e correções no Consistem (regras 68 a 71); nulo = sem a coluna Avisos. */
  correcoes?: QuadroCorrecoes | null;
  /** Compras sem título que podem ser lançadas no Consistem; nulo = sem botão Lançar. */
  compras?: QuadroCompras | null;
  resultado: ResultadoConciliacao; outros: OutroTitulo[]; linhas: LinhaFaturaBanco[]; podeOperar: boolean;
  /** Fatura editável (decisões permitidas); nulo = só leitura (mês fechado ou resultado congelado). */
  faturaId?: string | null;
  decisoesHistorico?: DecisaoLinha[];
}) {
  const rotulo = (nome: string, n: number) => `${nome} (${n})`;
  const decide = podeOperar && faturaId !== null;
  const lancaCompra = decide && !!compras && compras.ligado && compras.mesAberto;
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  // Trava no risco (regras 66 e 67): geral (desdobrar, divergência sem decisão) e por linha (possível título já lançado).
  const trava = decide ? travaDeLancamento(r, outros) : null;
  const travadoGeral = !!trava && trava.geral.length > 0;
  const agrupaveis = lancaCompra && !travadoGeral ? itensAgrupaveis(r.aLancar, compras!).filter((i) => !trava?.porLinha.has(i.linha.id)) : [];
  const agrupavel = new Set(agrupaveis.map((i) => i.linha.id));
  const marcar = (id: string, v: boolean) => { const n = new Set(selecionadas); if (v) n.add(id); else n.delete(id); setSelecionadas(n); };
  const { visivel, aoFiltrar } = useLinhasVisiveis();
  // "Selecionar todas" pega só as agrupáveis que o filtro da grade deixou à vista.
  const agrupaveisVisiveis = agrupaveis.filter((i) => visivel(i.linha.id));
  const todasMarcadas = agrupaveisVisiveis.length > 0 && agrupaveisVisiveis.every((i) => selecionadas.has(i.linha.id));
  // Por que a linha não entra em "Lançar selecionadas" (dica na caixa desabilitada).
  const motivoFora = (a: (typeof r.aLancar)[number]): string => {
    if (a.justificativa) return "Já tem decisão (justificada)";
    if (trava?.porLinha.has(a.linha.id)) return "Possível título já lançado: case ou use “Não é o mesmo”";
    if (a.linha.valorCentavos <= 0) return "Estorno: abata do título da compra";
    if ((a.linha.parcelaTotal ?? 1) > 1) return "Parcelada: lance pelo botão Lançar da linha (todas as parcelas restantes)";
    if (a.natureza === "Encargo financeiro") return "Encargo: use o quadro Encargos do mês";
    if (compras?.marketplace[a.linha.id]) return "Marketplace: casa pelo valor da nota do vendedor";
    return "Já lançada no Consistem";
  };
  const candidatos: Candidatos = {
    linhas: r.aLancar,
    titulos: [...r.divergencias.filter((d) => !d.justificativa).map((d) => d.titulo), ...outros.map((o) => o.titulo)],
  };
  const rotuloLinha = Object.fromEntries(linhas.map((l) => [l.id, `${l.descricao} · ${formatarMoeda(centavos(l.valor))}`]));
  const todosTitulos = [...r.conciliados.flatMap((c) => [c.titulo, ...(c.titulosExtras ?? [])]), ...r.divergencias.map((d) => d.titulo), ...outros.map((o) => o.titulo)];
  const rotuloTitulo = Object.fromEntries(todosTitulos.map((t) => [chaveTitulo(t), `título ${t.numeroTitulo} · ${t.fornecedor} · ${formatarMoeda(t.valorCentavos)}`]));
  const ativas = decisoesHistorico.filter((d) => !d.desfeito_em).length;
  return (
    <div className="space-y-2">
    {(r.decisoesSemEfeito ?? []).length > 0 && (
      <ul className="list-disc space-y-1 rounded-[3px] border border-amber-300 bg-amber-50 p-3 pl-7 text-sm">
        {(r.decisoesSemEfeito ?? []).map((s) => <li key={s.decisao.id}><strong>{ROTULO_DECISAO[s.decisao.tipo]} sem efeito</strong> ({s.decisao.motivo}): {s.motivo} Veja a aba Decisões.</li>)}
      </ul>
    )}
    <Tabs defaultValue={r.aLancar.length > 0 ? "lancar" : "quadro"}>
      <TabsList variant="line" className="flex-wrap">
        <TabsTrigger value="lancar">{(r.pendentes ?? r.aLancar.length) === r.aLancar.length ? rotulo("A lançar", r.aLancar.length) : `A lançar (${r.pendentes} pendentes de ${r.aLancar.length})`}</TabsTrigger>
        <TabsTrigger value="divergencias">{rotulo("Divergências", r.divergencias.length)}</TabsTrigger>
        <TabsTrigger value="conciliados">{rotulo("Conciliados", r.conciliados.length)}</TabsTrigger>
        <TabsTrigger value="compensados">{rotulo("Compensados", r.compensados.length)}</TabsTrigger>
        <TabsTrigger value="quadro">Quadro de conciliação</TabsTrigger>
        <TabsTrigger value="linhas">{rotulo("Linhas da fatura", linhas.length)}</TabsTrigger>
        <TabsTrigger value="outros">{rotulo("Outros títulos de cartão", outros.length)}</TabsTrigger>
        <TabsTrigger value="decisoes">{rotulo("Decisões", ativas)}</TabsTrigger>
      </TabsList>

      <TabsContent value="lancar" className="space-y-2">
        <p className="text-xs text-muted-foreground">Linhas da fatura sem título correspondente, classificadas por natureza. Lançar contra a instituição emissora, com o complemento sugerido (máscara do POP). Encargo: parcela única. Estorno: abater do título da compra, não lançar título novo. Parcela não desdobrada: localizar a compra de origem e desdobrar.</p>
        {lancaCompra && travadoGeral && (
          <div className="rounded-[3px] border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-medium">Lançar compra e Lançar selecionadas estão travados até:</p>
            <ul className="list-disc pl-5">{trava!.geral.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        )}
        {lancaCompra && !travadoGeral && <BarraAgrupado faturaId={faturaId!} itens={agrupaveis} compras={compras!} selecionadas={selecionadas} setSelecionadas={setSelecionadas} />}
        {r.aLancar.length === 0 ? <Vazio texto="Nada a lançar: toda linha da fatura tem título." /> : (
          <Table aoFiltrar={aoFiltrar}>
            <TableHeader><TableRow>
              {agrupaveis.length >= 1 && (
                <TableHead className="w-16">
                  <label className="flex items-center gap-1" title="Selecionar todas as linhas à vista que podem ser lançadas">
                    <input type="checkbox" className="size-4" checked={todasMarcadas} aria-label="Selecionar todas as linhas à vista que podem ser lançadas"
                      onChange={(e) => setSelecionadas((atual) => {
                        const novo = new Set(atual);
                        for (const i of agrupaveisVisiveis) {
                          if (e.target.checked) novo.add(i.linha.id);
                          else novo.delete(i.linha.id);
                        }
                        return novo;
                      })} />
                    Selecionar
                  </label>
                </TableHead>
              )}<TableHead>Data</TableHead><TableHead>Descrição na fatura</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Natureza</TableHead>
              <TableHead>Categoria</TableHead><TableHead>Conta de fluxo</TableHead><TableHead className="text-right">Parcelas</TableHead><TableHead>Vencimento</TableHead><TableHead>Complemento sugerido</TableHead><TableHead>Decisão</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {r.aLancar.map((a) => (
                <TableRow key={a.linha.id} className={a.justificativa ? "bg-emerald-50/50" : selecionadas.has(a.linha.id) ? "bg-sky-50" : ""}>
                  {agrupaveis.length >= 1 && (
                    <TableCell>{agrupavel.has(a.linha.id) ? (
                      <input type="checkbox" className="size-4" aria-label={`Selecionar ${a.linha.descricao} para lançar`}
                        checked={selecionadas.has(a.linha.id)} onChange={(e) => marcar(a.linha.id, e.target.checked)} />
                    ) : (
                      <input type="checkbox" className="size-4 cursor-not-allowed opacity-40" disabled title={motivoFora(a)} aria-label={motivoFora(a)} />
                    )}</TableCell>
                  )}
                  <TableCell className="tabular-nums">{formatarData(a.linha.dataCompra)}</TableCell>
                  <TableCell>{a.linha.descricao}</TableCell>
                  <TableCell className={`text-right tabular-nums ${a.linha.valorCentavos < 0 ? "text-red-700" : ""}`}>{formatarMoeda(a.linha.valorCentavos)}</TableCell>
                  <TableCell><Badge variant="outline" className={a.natureza === "Não identificado" || a.natureza === "Parcela não desdobrada" ? "border-amber-500 text-amber-800" : ""}>{a.natureza}</Badge></TableCell>
                  <TableCell>
                    <Conferir texto={a.categoria} />
                    {podeOperar && a.natureza === "Não identificado" && (
                      <> · <Link href={`${ROTA_CARTAO}/estabelecimentos?padrao=${encodeURIComponent(a.linha.descricao.slice(0, 40))}`} className="text-elo hover:underline">Cadastrar</Link></>
                    )}
                  </TableCell>
                  <TableCell><Conferir texto={a.contaFluxo} /></TableCell>
                  <TableCell className="text-right tabular-nums">{a.parcelas}</TableCell>
                  <TableCell className="tabular-nums">{formatarData(a.vencimento)}</TableCell>
                  <TableCell className="font-mono text-xs">{a.complementoSugerido}</TableCell>
                  <TableCell className="min-w-40 space-y-1">
                    <SeloDecisao justificativa={a.justificativa} classificacao={a.classificacao} observacoes={a.observacoes} />
                    {decide && <DialogoDecidir faturaId={faturaId!} alvo={{ tipo: "linha", item: a }} candidatos={candidatos} />}
                    {trava?.possiveis.get(a.linha.id) && (
                      <div className="space-y-1 rounded-[3px] border border-amber-300 bg-amber-50 p-1.5 text-xs">
                        <p className="font-medium text-amber-900">Possível título já lançado (Decidir › Casar, se for a mesma compra):</p>
                        {trava.possiveis.get(a.linha.id)!.map((t) => (
                          <div key={chaveTitulo(t)} className="flex flex-wrap items-center gap-1">
                            <span>{descreverTitulo(t)}</span>
                            <BotaoNaoEhOMesmo faturaId={faturaId!} linhaId={a.linha.id} titulo={chaveTitulo(t)} />
                          </div>
                        ))}
                      </div>
                    )}
                    {lancaCompra && !travadoGeral && !trava?.porLinha.has(a.linha.id) && compras!.propostas[a.linha.id] && <DialogoLancarCompra faturaId={faturaId!} item={a} proposta={compras!.propostas[a.linha.id]} compras={compras!} />}
                    {compras?.marketplace[a.linha.id] && <p className="text-xs text-muted-foreground">Marketplace ({compras.marketplace[a.linha.id]}): lance a nota do vendedor no Consistem; a conciliação casa pelo valor.</p>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>

      <TabsContent value="divergencias" className="space-y-2">
        <p className="text-xs text-muted-foreground">Títulos do Contas a Pagar do cartão, no vencimento desta fatura, sem linha correspondente. Nenhum título deve ser excluído sem apurar a causa.</p>
        {r.divergencias.length === 0 ? <Vazio texto="Todos os títulos têm linha na fatura." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Nº do título</TableHead><TableHead>Fornecedor</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Complemento</TableHead><TableHead>Causa provável</TableHead><TableHead>Decisão</TableHead></TableRow></TableHeader>
            <TableBody>
              {r.divergencias.map((d) => (
                <TableRow key={d.titulo.id}>
                  <TableCell className="tabular-nums">{d.titulo.numeroTitulo}{d.titulo.porRegra && <Badge variant="outline" className="ml-1">pela regra</Badge>}</TableCell><TableCell>{d.titulo.fornecedor}</TableCell>
                  <TableCell className="tabular-nums">{formatarData(d.titulo.vencimento)}</TableCell><TableCell className="text-right tabular-nums">{formatarMoeda(d.titulo.valorCentavos)}</TableCell>
                  <TableCell className="text-xs">{d.titulo.complemento}</TableCell><TableCell className="text-amber-800">{d.causa}</TableCell>
                  <TableCell className="min-w-40 space-y-1">
                    <SeloDecisao justificativa={d.justificativa} observacoes={d.observacoes} />
                    {decide && <DialogoDecidir faturaId={faturaId!} alvo={{ tipo: "titulo", titulo: d.titulo }} candidatos={candidatos} />}
                    {decide && !d.justificativa && !(d.observacoes ?? []).length && <BotaoNaoEhDestaFatura faturaId={faturaId!} titulo={chaveTitulo(d.titulo)} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>

      <TabsContent value="conciliados" className="space-y-2">
        <p className="text-xs text-muted-foreground">Casamentos encontrados (o valor é a chave; a descrição só desempata). “Conferir descrição” = semelhança baixa entre a fatura e o complemento; “ALERTA” = complemento cita outro cartão (erro de classificação, não gera diferença).</p>
        {r.conciliados.length === 0 ? <Vazio texto="Nenhum casamento. Atualize do Consistem se os títulos ainda não foram lançados." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição na fatura</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Nº do título</TableHead><TableHead>Complemento do título</TableHead><TableHead>Modo</TableHead><TableHead>Aderência</TableHead>{correcoes && <TableHead>Avisos</TableHead>}</TableRow></TableHeader>
            <TableBody>
              {r.conciliados.map((c) => (
                <TableRow key={c.titulo.id}>
                  <TableCell className="tabular-nums">{formatarData(c.linhas[0].dataCompra)}</TableCell>
                  <TableCell>{c.linhas[0].descricao}{c.linhas.length > 1 && <span className="text-muted-foreground"> ({c.linhas.length} lançamentos)</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatarMoeda(c.linhas.reduce((s, l) => s + l.valorCentavos, 0))}</TableCell>
                  <TableCell className="tabular-nums">{c.titulo.numeroTitulo}{c.titulo.emBordero && <Badge variant="outline" className="ml-1">borderô</Badge>}{c.titulo.porRegra && <Badge variant="outline" className="ml-1" title="Entrou pela regra do fornecedor no Neo Fiscal (o complemento não cita o cartão)">pela regra</Badge>}{c.titulo.antecipacao && <Badge variant="outline" className="ml-1 border-sky-400 text-sky-800" title="Antecipação a fornecedor paga no cartão">antecipação</Badge>}</TableCell>
                  <TableCell className="text-xs">{c.titulo.complemento}</TableCell>
                  <TableCell>
                    {c.modo === "Arredondamento" ? `Arredondamento (${formatarMoeda(c.diferencaCentavos)})` : c.modo === "Manual" ? `À mão (diferença ${formatarMoeda(c.diferencaCentavos)})` : c.modo}
                    {c.decisao && <span className="block text-[11px] text-muted-foreground">{c.decisao.motivo} — {c.decisao.autor}</span>}
                    {c.titulosExtras && c.titulosExtras.length > 0 && <span className="block text-[11px] text-muted-foreground">+ {c.titulosExtras.map((t) => t.numeroTitulo).join(", ")}</span>}
                  </TableCell>
                  <TableCell className={c.aderencia.startsWith("ALERTA") ? "font-bold text-red-700" : c.aderencia === "OK" ? "" : "text-amber-800"}>{c.aderencia}</TableCell>
                  {correcoes && (
                    <TableCell className="min-w-48 space-y-1">
                      {[c.titulo, ...(c.titulosExtras ?? [])].map((t) => (
                        <AvisosDoTitulo key={chaveTitulo(t)} cod={chaveTitulo(t)} correcoes={correcoes} faturaId={faturaId} podeCorrigir={podeOperar}
                          contas={compras?.listas.contasFluxo ?? []} vencimentoFatura={r.vencimento} />
                      ))}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>

      <TabsContent value="compensados" className="space-y-2">
        <p className="text-xs text-muted-foreground">Pares da fatura que se anulam (IOF cobrado e devolvido; compra estornada e recobrada). Ficam fora do cruzamento.</p>
        {r.compensados.length === 0 ? <Vazio texto="Nenhum par compensado." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Descrição (débito)</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Descrição (crédito)</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
            <TableBody>
              {r.compensados.map((c) => (
                <TableRow key={c.credito.id}>
                  <TableCell>{c.debito.descricao}</TableCell><TableCell className="text-right tabular-nums">{formatarMoeda(c.debito.valorCentavos)}</TableCell>
                  <TableCell>{c.credito.descricao}{c.decisao && <span className="block text-[11px] text-muted-foreground">À mão: {c.decisao.motivo} — {c.decisao.autor}</span>}</TableCell><TableCell className="text-right tabular-nums text-red-700">{formatarMoeda(c.credito.valorCentavos)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>

      <TabsContent value="quadro">
        <Table className="max-w-2xl">
          <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
          <TableBody>
            {r.quadro.map((q) => (
              <TableRow key={q.rotulo} className={q.destaque ? "font-bold" : ""}>
                <TableCell>{q.rotulo}</TableCell>
                <TableCell className={`text-right tabular-nums ${q.destaque && q.centavos !== 0 && q.rotulo.includes("NÃO JUSTIFICADA") ? "text-red-700" : ""}`}>{formatarMoeda(q.centavos)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TabsContent>

      <TabsContent value="linhas">
        <Table>
          <TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead>Parcela</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.id} className={l.descartada ? "text-muted-foreground" : ""}>
                <TableCell className="tabular-nums">{l.ordem}</TableCell><TableCell className="tabular-nums">{formatarData(l.data_compra)}</TableCell>
                <TableCell title={l.texto_origem ?? ""}>{l.descricao}</TableCell>
                <TableCell className="tabular-nums">{l.parcela_num !== null ? `${l.parcela_num}/${l.parcela_total}` : ""}</TableCell>
                <TableCell className={`text-right tabular-nums ${centavos(l.valor) < 0 ? "text-red-700" : ""}`}>{formatarMoeda(centavos(l.valor))}</TableCell>
                <TableCell>{l.descartada ? <Badge variant="outline" title={l.motivo_descarte ?? ""}>Descartada</Badge> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TabsContent>

      <TabsContent value="outros" className="space-y-2">
        <p className="text-xs text-muted-foreground">Títulos de cartão com vencimento na janela desta fatura que citam outro cartão, ficaram ambíguos ou só dizem “CARTÃO”. Se algum deles pertence a esta fatura, o complemento está errado no Consistem (cartão trocado).</p>
        {outros.length === 0 ? <Vazio texto="Nenhum outro título de cartão na janela." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Nº do título</TableHead><TableHead>Fornecedor</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Complemento</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
            <TableBody>
              {outros.map((o) => (
                <TableRow key={o.titulo.id}>
                  <TableCell className="tabular-nums">{o.titulo.numeroTitulo}</TableCell><TableCell>{o.titulo.fornecedor}</TableCell>
                  <TableCell className="tabular-nums">{formatarData(o.titulo.vencimento)}</TableCell><TableCell className="text-right tabular-nums">{formatarMoeda(o.titulo.valorCentavos)}</TableCell>
                  <TableCell className="text-xs">{o.titulo.complemento}</TableCell><TableCell>{o.detalhe}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>

      <TabsContent value="decisoes" className="space-y-2">
        <p className="text-xs text-muted-foreground">Decisões das pessoas sobre os itens desta fatura. Nada é apagado: desfazer grava quem, quando e o motivo.{faturaId === null ? " Mês fechado: para mudar decisões, reabra o mês." : ""}</p>
        <ListaDecisoes decisoes={decisoesHistorico} rotuloLinha={rotuloLinha} rotuloTitulo={rotuloTitulo} podeDesfazer={decide} />
      </TabsContent>
    </Tabs>
    </div>
  );
}

const Vazio = ({ texto }: { texto: string }) => <p className="rounded-[3px] border border-grade bg-cabecalho p-3 text-sm text-muted-foreground">{texto}</p>;

/** "Não é o mesmo": registra que o possível título não é a compra da linha (libera o Lançar). */
function BotaoNaoEhOMesmo({ faturaId, linhaId, titulo }: { faturaId: string; linhaId: string; titulo: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <Button size="xs" variant="outline" disabled={pendente} onClick={() => iniciar(async () => {
      const r = await conferirNaoEhOMesmo({ faturaId, linhaId, titulo });
      if (r.ok) { toast.success("Registrado: não é o mesmo título. A linha pode ser lançada."); router.refresh(); } else toast.error(r.erro);
    })}>{pendente ? "Registrando…" : "Não é o mesmo"}</Button>
  );
}

export function BotaoCancelarFatura({ id }: { id: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  function confirmar() {
    iniciar(async () => {
      const r = await cancelarFatura({ id, motivo });
      if (r.ok) { toast.success(r.aviso); setAberto(false); router.refresh(); } else setErro(r.erro);
    });
  }
  return (
    <>
      <Button variant="outline" onClick={() => { setMotivo(""); setErro(undefined); setAberto(true); }}>Cancelar fatura</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cancelar a fatura importada</DialogTitle>
              <DialogDescription>A fatura e as linhas ficam guardadas como canceladas (nada é apagado). Depois, importe o arquivo de novo. Informe o motivo.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: total digitado errado" autoFocus />
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button onClick={confirmar} disabled={pendente || motivo.trim().length < 3}>{pendente ? "Cancelando…" : "Cancelar fatura"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
