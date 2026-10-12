"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CONFERIR, type ResultadoConciliacao } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { ROTA_CARTAO } from "@/lib/modulos/financeiro/cartao/modulo";
import type { OutroTitulo } from "@/lib/modulos/financeiro/cartao/selecao-titulos";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { cancelarFatura } from "../acoes";
import type { LinhaFaturaBanco } from "../dados";

const centavos = (v: number | string) => Math.round(Number(v) * 100);
const Conferir = ({ texto }: { texto: string }) => (texto === CONFERIR ? <span className="font-bold text-amber-700">{texto}</span> : <>{texto}</>);

export function AbasConciliacao({ resultado: r, outros, linhas, podeOperar }: { resultado: ResultadoConciliacao; outros: OutroTitulo[]; linhas: LinhaFaturaBanco[]; podeOperar: boolean }) {
  const rotulo = (nome: string, n: number) => `${nome} (${n})`;
  return (
    <Tabs defaultValue={r.aLancar.length > 0 ? "lancar" : "quadro"}>
      <TabsList variant="line" className="flex-wrap">
        <TabsTrigger value="lancar">{rotulo("A lançar", r.aLancar.length)}</TabsTrigger>
        <TabsTrigger value="divergencias">{rotulo("Divergências", r.divergencias.length)}</TabsTrigger>
        <TabsTrigger value="conciliados">{rotulo("Conciliados", r.conciliados.length)}</TabsTrigger>
        <TabsTrigger value="compensados">{rotulo("Compensados", r.compensados.length)}</TabsTrigger>
        <TabsTrigger value="quadro">Quadro de conciliação</TabsTrigger>
        <TabsTrigger value="linhas">{rotulo("Linhas da fatura", linhas.length)}</TabsTrigger>
        <TabsTrigger value="outros">{rotulo("Outros títulos de cartão", outros.length)}</TabsTrigger>
      </TabsList>

      <TabsContent value="lancar" className="space-y-2">
        <p className="text-xs text-muted-foreground">Linhas da fatura sem título correspondente, classificadas por natureza. Lançar contra a instituição emissora, com o complemento sugerido (máscara do POP). Encargo: parcela única. Estorno: abater do título da compra, não lançar título novo. Parcela não desdobrada: localizar a compra de origem e desdobrar.</p>
        {r.aLancar.length === 0 ? <Vazio texto="Nada a lançar: toda linha da fatura tem título." /> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Data</TableHead><TableHead>Descrição na fatura</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Natureza</TableHead>
              <TableHead>Categoria</TableHead><TableHead>Conta de fluxo</TableHead><TableHead className="text-right">Parcelas</TableHead><TableHead>Vencimento</TableHead><TableHead>Complemento sugerido</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {r.aLancar.map((a) => (
                <TableRow key={a.linha.id}>
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
            <TableHeader><TableRow><TableHead>Nº do título</TableHead><TableHead>Fornecedor</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Complemento</TableHead><TableHead>Causa provável</TableHead></TableRow></TableHeader>
            <TableBody>
              {r.divergencias.map((d) => (
                <TableRow key={d.titulo.id}>
                  <TableCell className="tabular-nums">{d.titulo.numeroTitulo}</TableCell><TableCell>{d.titulo.fornecedor}</TableCell>
                  <TableCell className="tabular-nums">{formatarData(d.titulo.vencimento)}</TableCell><TableCell className="text-right tabular-nums">{formatarMoeda(d.titulo.valorCentavos)}</TableCell>
                  <TableCell className="text-xs">{d.titulo.complemento}</TableCell><TableCell className="text-amber-800">{d.causa}</TableCell>
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
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição na fatura</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Nº do título</TableHead><TableHead>Complemento do título</TableHead><TableHead>Modo</TableHead><TableHead>Aderência</TableHead></TableRow></TableHeader>
            <TableBody>
              {r.conciliados.map((c) => (
                <TableRow key={c.titulo.id}>
                  <TableCell className="tabular-nums">{formatarData(c.linhas[0].dataCompra)}</TableCell>
                  <TableCell>{c.linhas[0].descricao}{c.linhas.length > 1 && <span className="text-muted-foreground"> ({c.linhas.length} lançamentos)</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatarMoeda(c.linhas.reduce((s, l) => s + l.valorCentavos, 0))}</TableCell>
                  <TableCell className="tabular-nums">{c.titulo.numeroTitulo}{c.titulo.emBordero && <Badge variant="outline" className="ml-1">borderô</Badge>}</TableCell>
                  <TableCell className="text-xs">{c.titulo.complemento}</TableCell>
                  <TableCell>{c.modo === "Arredondamento" ? `Arredondamento (${formatarMoeda(c.diferencaCentavos)})` : c.modo}</TableCell>
                  <TableCell className={c.aderencia.startsWith("ALERTA") ? "font-bold text-red-700" : c.aderencia === "OK" ? "" : "text-amber-800"}>{c.aderencia}</TableCell>
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
                  <TableCell>{c.credito.descricao}</TableCell><TableCell className="text-right tabular-nums text-red-700">{formatarMoeda(c.credito.valorCentavos)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>

      <TabsContent value="quadro">
        <Table className="max-w-2xl">
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
    </Tabs>
  );
}

const Vazio = ({ texto }: { texto: string }) => <p className="rounded-[3px] border border-grade bg-cabecalho p-3 text-sm text-muted-foreground">{texto}</p>;

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
