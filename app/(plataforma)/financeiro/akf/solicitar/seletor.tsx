"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useLinhasVisiveis } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ROTA_AKF, ROTULO_STATUS_SOLICITACAO, valorParaSolicitar, type MarcacaoTitulo } from "@/lib/modulos/financeiro/akf/solicitacao";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { criarSolicitacao } from "../solicitacoes/acoes";
import type { TituloParaSolicitar } from "../solicitacoes/dados";

type Props = { titulos: TituloParaSolicitar[]; hoje: string; temDestinatario: boolean };

const vazia = (t: TituloParaSolicitar): MarcacaoTitulo => ({ valorTexto: "", semBoleto: t.semBoleto, observacao: "" });

/**
 * Seleção dos títulos a solicitar: caixa de marcação, valor a solicitar (vazio = o que resta com a Neo; menor = parcial),
 * selo "Sem boleto" (pré-marcado pelo cadastro; dá para ligar caso a caso) e observação por título. A barra fixa soma o que
 * está marcado e abre o diálogo "Montar solicitação".
 */
export function Seletor({ titulos, hoje, temDestinatario }: Props) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [marcacoes, setMarcacoes] = useState<Map<string, MarcacaoTitulo>>(new Map());
  const [filtroCliente, setFiltroCliente] = useState("");
  const [dialogo, setDialogo] = useState(false);

  const porId = useMemo(() => new Map(titulos.map((t) => [t.id, t])), [titulos]);
  const marcacaoDe = (t: TituloParaSolicitar) => marcacoes.get(t.id) ?? vazia(t);
  const alterar = (id: string, mudanca: Partial<MarcacaoTitulo>) => setMarcacoes((atual) => {
    const novo = new Map(atual);
    const t = porId.get(id);
    if (!t) return atual;
    novo.set(id, { ...(novo.get(id) ?? vazia(t)), ...mudanca });
    return novo;
  });

  const termo = filtroCliente.trim().toLowerCase();
  const visiveis = titulos.filter((t) => !termo || t.cliente.toLowerCase().includes(termo) || t.documento.toLowerCase().includes(termo));
  const { visivel, aoFiltrar } = useLinhasVisiveis();
  // Além do filtro de cliente acima, respeita o filtro da própria grade.
  const selecionaveis = visiveis.filter((t) => !t.solicitacao && visivel(t.id));
  const todas = selecionaveis.length > 0 && selecionaveis.every((t) => marcadas.has(t.id));

  const alternar = (ids: string[]) => setMarcadas((atual) => {
    const novo = new Set(atual);
    const todasJa = ids.every((id) => novo.has(id));
    for (const id of ids) {
      if (todasJa) novo.delete(id);
      else novo.add(id);
    }
    return novo;
  });

  // O que vai na solicitação: valida o valor digitado de cada linha marcada.
  const selecionados = [...marcadas].map((id) => porId.get(id)).filter((t): t is TituloParaSolicitar => Boolean(t));
  const itens = selecionados.map((t) => {
    const m = marcacaoDe(t);
    const v = valorParaSolicitar(m.valorTexto, t.restanteCentavos);
    return { titulo: t, marcacao: m, valor: v };
  });
  const erros = itens.filter((i) => !i.valor.ok);
  const totalCentavos = itens.reduce((s, i) => s + (i.valor.ok ? (i.valor.valor === null ? i.titulo.restanteCentavos : Math.round(i.valor.valor * 100)) : 0), 0);
  const parciais = itens.filter((i) => i.valor.ok && i.valor.parcial).length;
  const semBoleto = itens.filter((i) => i.marcacao.semBoleto).length;

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[3px] border border-grade bg-marca-clara px-3 py-2 text-sm shadow-sm">
        <strong className="tabular-nums">{marcadas.size} {marcadas.size === 1 ? "título marcado" : "títulos marcados"} · {formatarMoeda(totalCentavos)}</strong>
        {parciais > 0 && <span className="text-[13px]">{parciais} {parciais === 1 ? "parcial" : "parciais"}</span>}
        {semBoleto > 0 && <span className="text-[13px]">{semBoleto} sem boleto</span>}
        <label className="flex items-center gap-1 text-[13px]">
          Filtrar
          <Input value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)} placeholder="Cliente ou documento" aria-label="Filtrar por cliente ou documento" className="h-7 w-52 bg-white" />
        </label>
        <span className="ml-auto flex items-center gap-2">
          {marcadas.size > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setMarcadas(new Set())}>Limpar seleção</Button>}
          <Button type="button" size="sm" onClick={() => setDialogo(true)} disabled={marcadas.size === 0 || erros.length > 0} title={erros.length > 0 ? "Corrija os valores marcados em vermelho" : undefined}>
            Montar solicitação{marcadas.size > 0 ? ` (${marcadas.size})` : ""}
          </Button>
        </span>
        {!temDestinatario && <span className="basis-full text-xs text-destructive">Nenhum contato da AKF com e-mail: cadastre em Configurações &gt; Contrapartes &gt; AKF Securitizadora antes de criar o rascunho.</span>}
        {erros.length > 0 && <span className="basis-full text-xs text-destructive">{erros[0].titulo.documento}: {erros[0].valor.ok ? "" : erros[0].valor.erro}</span>}
      </div>

      {dialogo && (
        <DialogoMontar
          itens={itens.filter((i): i is typeof i & { valor: { ok: true; valor: number | null; parcial: boolean } } => i.valor.ok)}
          totalCentavos={totalCentavos}
          hoje={hoje}
          aoFechar={() => setDialogo(false)}
          aoCriar={(id) => { setMarcadas(new Set()); setDialogo(false); router.push(`${ROTA_AKF}/solicitacoes/${id}`); }}
        />
      )}

      <div className="overflow-x-auto rounded-[3px] border border-grade">
        <Table className="cartoes" aoFiltrar={aoFiltrar}>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input type="checkbox" className="size-4" aria-label="Marcar todos os visíveis" checked={todas} onChange={() => alternar(selecionaveis.map((t) => t.id))} disabled={selecionaveis.length === 0} />
              </TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Resta com a Neo</TableHead>
              <TableHead className="text-right">Valor a solicitar</TableHead>
              <TableHead>Sem boleto</TableHead>
              <TableHead>Observação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((t) => {
              const m = marcacaoDe(t);
              const marcado = marcadas.has(t.id);
              const validacao = marcado ? valorParaSolicitar(m.valorTexto, t.restanteCentavos) : null;
              const bloqueado = Boolean(t.solicitacao);
              return (
                <TableRow key={t.id} className={bloqueado ? "opacity-60" : undefined}>
                  <TableCell>{!bloqueado && <input type="checkbox" className="size-4" aria-label={`Marcar ${t.documento}`} checked={marcado} onChange={() => alternar([t.id])} />}</TableCell>
                  <TableCell className="font-medium tabular-nums">
                    <Link href={`/financeiro/recebiveis/${t.id}`} className="hover:underline">{t.documento}</Link>
                    {t.unidade === "contagem" && <Badge variant="outline" className="ml-1.5 align-middle">Contagem</Badge>}
                    {t.solicitacao && (
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        <Link href={`${ROTA_AKF}/solicitacoes/${t.solicitacao.id}`} className="hover:underline">na solicitação nº {t.solicitacao.numero} ({ROTULO_STATUS_SOLICITACAO[t.solicitacao.status].toLowerCase()})</Link>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 truncate" title={t.cliente}>
                    <Link href={`/financeiro/recebiveis/clientes/${t.clienteId}`} className="hover:underline">{t.cliente}</Link>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatarData(t.vencimento)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatarMoeda(t.restanteCentavos)}
                    {t.restanteCentavos !== t.valorTituloCentavos && <span className="block text-[11px] font-normal text-muted-foreground">de {formatarMoeda(t.valorTituloCentavos)} (parte já na AKF)</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {!bloqueado && (
                      <Input
                        value={m.valorTexto}
                        onChange={(e) => { alterar(t.id, { valorTexto: e.target.value }); if (!marcado && e.target.value.trim() !== "") alternar([t.id]); }}
                        placeholder={formatarMoeda(t.restanteCentavos).replace("R$ ", "")}
                        inputMode="decimal"
                        aria-label={`Valor a solicitar de ${t.documento}`}
                        aria-invalid={validacao ? !validacao.ok : undefined}
                        title="Vazio = o valor inteiro; menor = antecipação parcial"
                        className={`h-8 w-36 text-right tabular-nums ${validacao && !validacao.ok ? "border-destructive" : ""}`}
                      />
                    )}
                    {validacao?.ok && validacao.parcial && <span className="block text-[11px] text-amber-800">parcial</span>}
                  </TableCell>
                  <TableCell>
                    {!bloqueado && (
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" className="size-4" checked={m.semBoleto} onChange={(e) => alterar(t.id, { semBoleto: e.target.checked })} aria-label={`Sem boleto de factoring: ${t.documento}`} />
                        {m.semBoleto ? <Badge variant="outline" title="Operar com 01 dia após o vencimento e não emitir boleto">Sem boleto</Badge> : <span className="text-muted-foreground">—</span>}
                      </label>
                    )}
                  </TableCell>
                  <TableCell>
                    {!bloqueado && <Input value={m.observacao} onChange={(e) => alterar(t.id, { observacao: e.target.value })} maxLength={300} placeholder="ex.: operar com vencimento para 20/10" aria-label={`Observação de ${t.documento}`} className="h-8 w-64" />}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {visiveis.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">Nenhum título com esse filtro.</p>}
    </div>
  );
}

type ItemValido = { titulo: TituloParaSolicitar; marcacao: MarcacaoTitulo; valor: { ok: true; valor: number | null; parcial: boolean } };

function DialogoMontar({ itens, totalCentavos, hoje, aoFechar, aoCriar }: { itens: ItemValido[]; totalCentavos: number; hoje: string; aoFechar: () => void; aoCriar: (id: string) => void }) {
  const [data, setData] = useState(hoje);
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const parciais = itens.filter((i) => i.valor.parcial).length;
  const semBoleto = itens.filter((i) => i.marcacao.semBoleto).length;

  function montar() {
    iniciar(async () => {
      const r = await criarSolicitacao({
        itens: itens.map((i) => ({ tituloId: i.titulo.id, valor: i.valor.valor, semBoleto: i.marcacao.semBoleto, observacao: i.marcacao.observacao })),
        observacao, data,
      });
      if (r.ok) {
        toast.success(r.aviso);
        aoCriar(r.id);
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto) aoFechar(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Montar solicitação de antecipação</DialogTitle>
          <DialogDescription>
            {itens.length} {itens.length === 1 ? "título" : "títulos"} · {formatarMoeda(totalCentavos)}
            {parciais > 0 ? ` · ${parciais} ${parciais === 1 ? "parcial" : "parciais"}` : ""}{semBoleto > 0 ? ` · ${semBoleto} sem boleto` : ""}.
            A solicitação fica em montagem; na página dela você confere o e-mail e cria o rascunho no Gmail.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="akf-data" className="text-sm font-medium">Data da solicitação (vai no assunto)</label>
            <Input id="akf-data" type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-44" />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="akf-obs" className="text-sm font-medium">Observação geral (opcional; vira a última OBS do e-mail)</label>
            <Textarea id="akf-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} rows={3} placeholder="Ex.: abater a NF de R$ 17.000,00 da Canopus que está em aberto" />
          </div>
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={aoFechar} disabled={pendente}>Voltar</Button>
            <Button type="button" onClick={montar} disabled={pendente}>{pendente ? "Montando…" : "Montar solicitação"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
