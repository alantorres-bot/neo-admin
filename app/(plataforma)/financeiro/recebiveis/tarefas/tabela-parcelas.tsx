"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DialogoContato } from "@/app/(plataforma)/configuracoes/contrapartes/dialogos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { nomeParcela, type ContatoSugerido, type GrupoNota } from "@/lib/modulos/financeiro/recebiveis/tarefas";
import { formatarWhatsapp } from "@/lib/nucleo/documentos";
import { descreverPrazo } from "@/lib/nucleo/fila";
import { ROTULO_UNIDADE } from "@/supabase/functions/_shared/cobranca";
import { AnexarBoleto } from "../[id]/componentes";
import { definirFormaPagamento, marcarBoletoEnviado, marcarDadosEnviados } from "../[id]/acoes";
import { MarcarEnviadoRapido, PagoPorTransferencia, SeletorCanal, type CanalEnvio } from "./componentes";

type Tipo = "anexar" | "enviar" | "dados";

const andamento = (a: { texto: string; quando: string } | null) =>
  a ? <span className="text-[12px]">{a.texto} <span className="text-muted-foreground">em {a.quando}</span></span> : <span className="text-[12px] text-muted-foreground">Nada registrado</span>;

function Contato({ c, clienteId, podeOperar }: { c: ContatoSugerido; clienteId: string; podeOperar: boolean }) {
  if (!c) {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <Badge variant="outline" className="border-marca text-marca">Sem contato</Badge>
        {podeOperar && <DialogoContato contraparteId={clienteId} finalidadesIniciais={["boleto"]} rotuloBotao="Cadastrar" />}
      </span>
    );
  }
  const meio = c.email ?? (c.whatsapp ? formatarWhatsapp(c.whatsapp) : null);
  return <span className="block leading-tight"><span className="block font-medium">{c.nome}</span><span className="block text-muted-foreground">{meio}</span></span>;
}

const fatiar = <T,>(lista: T[], n: number): T[][] => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, (i + 1) * n));

/**
 * Filas de parcelas (boletos a anexar, boletos a enviar, dados de pagamento): parcelas da mesma NF numa linha só, com as
 * parcelas logo abaixo, e caixas de marcação para agir em várias de uma vez. Nada é enviado pelo sistema: "marcar enviado"
 * só registra o que a pessoa já fez.
 */
export function TabelaParcelas({ grupos, tipo, podeOperar, hoje, mostrarUnidade }: { grupos: GrupoNota[]; tipo: Tipo; podeOperar: boolean; hoje: string; mostrarUnidade: boolean }) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [canal, setCanal] = useState<CanalEnvio>("email");
  const [pendente, iniciar] = useTransition();

  // parcela -> cliente e contato (para o lote por cliente)
  const infoParcela = useMemo(() => {
    const m = new Map<string, { clienteId: string; cliente: string; contatoId: string | null }>();
    for (const g of grupos) for (const p of g.parcelas) m.set(p.id, { clienteId: g.clienteId, cliente: g.cliente, contatoId: p.contato?.id ?? null });
    return m;
  }, [grupos]);
  const todasIds = useMemo(() => grupos.flatMap((g) => g.parcelas.map((p) => p.id)), [grupos]);

  const alternar = (ids: string[]) => setMarcadas((atual) => {
    const novo = new Set(atual);
    const todas = ids.every((id) => novo.has(id));
    for (const id of ids) {
      if (todas) novo.delete(id);
      else novo.add(id);
    }
    return novo;
  });
  const estaMarcado = (ids: string[]) => ids.length > 0 && ids.every((id) => marcadas.has(id));

  function executarLote() {
    const ids = [...marcadas];
    iniciar(async () => {
      if (tipo === "anexar") {
        if (ids.length > 100) { toast.error("Marque no máximo 100 parcelas por vez."); return; }
        const r = await definirFormaPagamento(ids, "transferencia");
        if (r.ok) { toast.success(r.aviso ?? "Forma de pagamento alterada."); setMarcadas(new Set()); router.refresh(); }
        else toast.error(r.erro);
        return;
      }
      // Cada chamada é tudo-ou-nada e de um só cliente: uma por cliente (até 50 parcelas).
      const porCliente = new Map<string, { nome: string; contatoId: string | null; ids: string[] }>();
      for (const id of ids) {
        const info = infoParcela.get(id);
        if (!info) continue;
        const c = porCliente.get(info.clienteId) ?? { nome: info.cliente, contatoId: info.contatoId, ids: [] };
        c.ids.push(id);
        porCliente.set(info.clienteId, c);
      }
      let registradas = 0;
      const falhas: string[] = [];
      const ficamMarcadas = new Set<string>(); // parcelas dos clientes cuja chamada falhou: continuam marcadas para tentar de novo
      for (const c of porCliente.values()) {
        for (const lote of fatiar(c.ids, 50)) {
          const entrada = { tituloIds: lote, canal, contatoId: c.contatoId, observacao: "" };
          const r = tipo === "enviar" ? await marcarBoletoEnviado(entrada) : await marcarDadosEnviados(entrada);
          if (r.ok) registradas += lote.length;
          else {
            falhas.push(`${c.nome}: ${r.erro}`);
            for (const id of lote) ficamMarcadas.add(id);
          }
        }
      }
      if (registradas > 0) toast.success(`Envio registrado em ${registradas} ${registradas === 1 ? "parcela" : "parcelas"}.`);
      for (const f of falhas) toast.error(f);
      setMarcadas(ficamMarcadas);
      router.refresh();
    });
  }

  const verbo = tipo === "anexar" ? "Pago por transferência" : "Marcar enviado";

  return (
    <div>
      {podeOperar && marcadas.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-grade bg-marca-clara px-3 py-2 text-sm">
          <strong>{marcadas.size} {marcadas.size === 1 ? "parcela marcada" : "parcelas marcadas"}</strong>
          {tipo !== "anexar" && <SeletorCanal valor={canal} aoMudar={setCanal} />}
          <Button type="button" size="sm" disabled={pendente} onClick={executarLote}>{pendente ? "Registrando…" : `${verbo} (${marcadas.size})`}</Button>
          <Button type="button" variant="ghost" size="sm" disabled={pendente} onClick={() => setMarcadas(new Set())}>Limpar seleção</Button>
          {tipo !== "anexar" && <span className="text-xs text-muted-foreground">Uma chamada por cliente: se um cliente falhar, os outros continuam.</span>}
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {podeOperar && (
              <TableHead className="w-8">
                <input type="checkbox" className="size-4" aria-label="Marcar todas desta página" checked={estaMarcado(todasIds)} onChange={() => alternar(todasIds)} />
              </TableHead>
            )}
            <TableHead>Cliente</TableHead><TableHead>Título</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead>
            <TableHead>Prazo</TableHead>{tipo !== "anexar" && <TableHead>Contato</TableHead>}<TableHead>Já feito</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {grupos.map((g) => {
            const ids = g.parcelas.map((p) => p.id);
            const varias = g.parcelas.length > 1;
            const primeira = g.parcelas[0];
            const contato = primeira.contato;
            const canalSugerido = contato?.email ? "email" : "whatsapp";
            const prazo = <span className={g.prazo < hoje ? "font-medium text-red-700" : ""}>{descreverPrazo(g.prazo, hoje)}</span>;
            const ficha = `/financeiro/recebiveis/${primeira.id}${tipo === "enviar" ? "#boleto" : tipo === "dados" ? "#dados" : ""}`;
            return (
              <Fragment key={g.chave}>
                <TableRow className={varias ? "bg-muted/30" : undefined}>
                  {podeOperar && (
                    <TableCell>
                      <input type="checkbox" className="size-4" aria-label={`Marcar ${g.cliente}`} checked={estaMarcado(ids)} onChange={() => alternar(ids)} />
                    </TableCell>
                  )}
                  <TableCell className="max-w-72 truncate font-medium" title={g.cliente}>
                    <Link href={`/financeiro/recebiveis/clientes/${g.clienteId}`} className="hover:underline">{g.cliente}</Link>
                    {mostrarUnidade && <Badge variant={g.unidade === "contagem" ? "default" : "secondary"} className="ml-1.5 align-middle">{ROTULO_UNIDADE[g.unidade]}</Badge>}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {varias ? <>{g.nota ? `NF ${g.nota}` : "Parcelas"} <span className="text-muted-foreground">· {g.parcelas.length} parcelas</span></> : <>{nomeParcela(primeira)}{g.nota && <span className="block text-[11px] text-muted-foreground">NF {g.nota}</span>}</>}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatarData(g.vencimentoMaisProximo)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatarMoeda(g.totalCentavos)}</TableCell>
                  <TableCell className="text-[12px]">{prazo}</TableCell>
                  {tipo !== "anexar" && <TableCell className="text-[12px]"><Contato c={contato} clienteId={g.clienteId} podeOperar={podeOperar} /></TableCell>}
                  <TableCell>{andamento(primeira.andamento)}</TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex flex-wrap items-center justify-end gap-1">
                      {tipo === "anexar" && podeOperar && !varias && <><AnexarBoleto tituloId={primeira.id} temBoleto={false} /><PagoPorTransferencia tituloIds={ids} /></>}
                      {tipo === "anexar" && podeOperar && varias && <PagoPorTransferencia tituloIds={ids} rotulo="Todas por transferência" />}
                      {tipo !== "anexar" && podeOperar && <MarcarEnviadoRapido tituloIds={ids} contatoId={contato?.id ?? null} tipo={tipo === "enviar" ? "boleto" : "dados"} canalSugerido={canalSugerido} />}
                      <Button variant={tipo === "anexar" ? "ghost" : "default"} size="sm" render={<Link href={ficha} />}>{tipo === "anexar" ? "Abrir" : "Mensagem e rascunho"}</Button>
                    </span>
                  </TableCell>
                </TableRow>
                {varias && g.parcelas.map((p) => (
                  <TableRow key={p.id}>
                    {podeOperar && (
                      <TableCell>
                        <input type="checkbox" className="size-4" aria-label={`Marcar ${nomeParcela(p)}`} checked={marcadas.has(p.id)} onChange={() => alternar([p.id])} />
                      </TableCell>
                    )}
                    <TableCell />
                    <TableCell className="pl-6 tabular-nums text-muted-foreground">{nomeParcela(p)}</TableCell>
                    <TableCell className="tabular-nums">{formatarData(p.vencimento)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatarMoeda(p.valorCentavos)}</TableCell>
                    <TableCell className="text-[12px]"><span className={p.prazo < hoje ? "font-medium text-red-700" : ""}>{descreverPrazo(p.prazo, hoje)}</span></TableCell>
                    {tipo !== "anexar" && <TableCell />}
                    <TableCell />
                    <TableCell className="text-right">
                      {tipo === "anexar" && podeOperar && <span className="inline-flex items-center gap-1"><AnexarBoleto tituloId={p.id} temBoleto={false} /><PagoPorTransferencia tituloIds={[p.id]} /></span>}
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
