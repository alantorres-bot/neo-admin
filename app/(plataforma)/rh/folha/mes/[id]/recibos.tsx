"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Printer, Repeat, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { rotuloMes } from "@/lib/modulos/rh/calendario";
import { lerReais } from "@/lib/modulos/rh/folha/modulo";
import {
  dividirPorMes, linhasDeDias, parametrosVigentes, ROTULO_TIPO_RECIBO, type Rubrica, type TipoRecibo, type Vigencia,
} from "@/lib/modulos/rh/folha/recibos";
import { cancelarRecibo, gerarRecorrentes, gravarRecibos } from "../../recibos-acoes";
import { EditorLinhas, linhaVazia, paraEntrada, PreviaRecibo, reaisC, SELECAO, type LinhaEditavel } from "../../componentes-recibo";
import type { PessoaRecibo, Recibo } from "../../dados";

const br = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");

/** Recibos avulsos do mês: lista, novo recibo (assistente por tipo), recorrentes, cancelar e imprimir. */
export function RecibosDoMes({ mesId, competencia, aberta, podeOperar, recibos, pessoas, rubricas, vigencias }: {
  mesId: string; competencia: string; aberta: boolean; podeOperar: boolean; recibos: Recibo[]; pessoas: PessoaRecibo[]; rubricas: Rubrica[]; vigencias: Vigencia[];
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [cancelando, setCancelando] = useState<Recibo | null>(null);
  const [motivo, setMotivo] = useState("");
  const total = recibos.reduce((s, r) => s + Math.round(r.total * 100), 0);
  const editavel = aberta && podeOperar;

  const recorrentes = () => iniciar(async () => {
    const r = await gerarRecorrentes(mesId);
    if (!r.ok) toast.error(r.erro); else { toast.success(r.aviso); router.refresh(); }
  });
  const cancelar = () => iniciar(async () => {
    if (!cancelando) return;
    const r = await cancelarRecibo(cancelando.id, motivo);
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso); setCancelando(null); setMotivo(""); router.refresh();
  });

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold">Recibos avulsos</h3>
          <p className="text-xs text-muted-foreground">Pagamentos fora da folha do escritório. O total de cada pessoa entra sozinho na coluna Avulso da folha.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editavel && <NovoRecibo competencia={competencia} pessoas={pessoas} rubricas={rubricas} vigencias={vigencias} />}
          {editavel && <Button variant="outline" size="sm" disabled={pendente} onClick={recorrentes}><Repeat /> Gerar recorrentes</Button>}
          {recibos.length > 0 && <Button variant="outline" size="sm" render={<a href={`/imprimir/rh/folha/recibos/${mesId}`} target="_blank" rel="noreferrer" />}><Printer /> Imprimir todos</Button>}
        </div>
      </div>
      {recibos.length === 0 ? (
        <p className="rounded-[3px] border border-grade bg-cabecalho p-3 text-sm text-muted-foreground">Nenhum recibo neste mês.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Nº</TableHead><TableHead>Funcionário</TableHead><TableHead>Tipo</TableHead><TableHead>Período</TableHead><TableHead className="text-right">Proventos</TableHead><TableHead className="text-right">Descontos</TableHead><TableHead className="text-right">Líquido</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {recibos.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="tabular-nums">{r.cod_fornecedor}</TableCell>
                <TableCell className="font-medium">{r.nome}</TableCell>
                <TableCell>{ROTULO_TIPO_RECIBO[r.tipo]}</TableCell>
                <TableCell className="tabular-nums">{r.periodo_inicio ? `${br(r.periodo_inicio)} a ${br(r.periodo_fim)}` : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{reaisC(Math.round(r.proventos * 100))}</TableCell>
                <TableCell className="text-right tabular-nums">{r.descontos ? reaisC(Math.round(r.descontos * 100)) : ""}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{reaisC(Math.round(r.total * 100))}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <Button variant="ghost" size="sm" render={<a href={`/imprimir/rh/folha/recibo/${r.id}`} target="_blank" rel="noreferrer" />}><Printer /> Recibo</Button>
                  {editavel && <Button variant="ghost" size="sm" onClick={() => { setCancelando(r); setMotivo(""); }}><XCircle /> Cancelar</Button>}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="font-bold"><TableCell colSpan={6}>Total dos recibos do mês</TableCell><TableCell className="text-right tabular-nums">{reaisC(total)}</TableCell><TableCell /></TableRow>
          </TableBody>
        </Table>
      )}
      <Dialog open={!!cancelando} onOpenChange={(v) => { if (!v) setCancelando(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar recibo</DialogTitle>
            <DialogDescription>{cancelando ? `${cancelando.nome} · ${ROTULO_TIPO_RECIBO[cancelando.tipo]} · ${reaisC(Math.round(cancelando.total * 100))}. O recibo fica guardado como cancelado e sai do avulso da folha.` : ""}</DialogDescription>
          </DialogHeader>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={200} placeholder="Motivo" />
          <div className="flex justify-end"><Button disabled={pendente || motivo.trim().length < 3} onClick={cancelar}>Cancelar recibo</Button></div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Assistente de novo recibo. Compra de férias / início antes do registro: pessoa + período (divide por mês). Recorrente / eventual: linhas livres. */
function NovoRecibo({ competencia, pessoas, rubricas, vigencias }: { competencia: string; pessoas: PessoaRecibo[]; rubricas: Rubrica[]; vigencias: Vigencia[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const [tipo, setTipo] = useState<TipoRecibo>("compra_ferias");
  const [pessoaId, setPessoaId] = useState("");
  const [salario, setSalario] = useState("");
  const [funcao, setFuncao] = useState("");
  const [insal, setInsal] = useState(0);
  const [noturno, setNoturno] = useState(0);
  const [atualizar, setAtualizar] = useState(true);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [mes, setMes] = useState(competencia.slice(0, 7));
  const [linhas, setLinhas] = useState<LinhaEditavel[]>([linhaVazia()]);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState<string>();
  const catalogo = useMemo(() => new Map(rubricas.map((r) => [r.codigo, r])), [rubricas]);

  const escolherPessoa = (id: string) => {
    setPessoaId(id);
    const p = pessoas.find((x) => x.id === id);
    setSalario(p?.salario ? p.salario.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "");
    setFuncao(p?.funcao ?? ""); setInsal(p?.insalubridade_pct ?? 0); setNoturno(p?.adicional_noturno_pct ?? 0);
  };
  const sal = lerReais(salario);
  const dados = { salario: Number.isNaN(sal) ? 0 : sal, insalubridade_pct: insal, adicional_noturno_pct: noturno };
  const porPeriodo = tipo === "compra_ferias" || tipo === "inicio_antes_registro";
  const trechos = porPeriodo && inicio && fim ? dividirPorMes(inicio, fim) : [];
  const entrada = !porPeriodo ? paraEntrada(linhas.filter((l) => l.rubrica), catalogo) : null;

  const gravar = () => iniciar(async () => {
    setErro(undefined);
    if (!pessoaId) { setErro("Escolha a pessoa."); return; }
    if (!(sal > 0)) { setErro("Informe o salário da pessoa."); return; }
    if (entrada && !entrada.ok) { setErro(entrada.erro); return; }
    const r = await gravarRecibos({
      tipo, colaboradorId: pessoaId, competencia: porPeriodo ? null : `${mes}-01`, inicio: inicio || null, fim: fim || null, salario: sal, funcao: funcao || null,
      insalubridade_pct: insal as 0 | 10 | 20 | 40, adicional_noturno_pct: noturno, atualizarCadastro: atualizar, mensagem: mensagem || null, substitui: null,
      linhas: porPeriodo ? [] : linhas.filter((l) => l.rubrica).map((l) => {
        const e = paraEntrada([l], catalogo);
        const x = e.ok ? e.linhas[0] : null;
        return { rubrica: l.rubrica, referencia: x?.referencia ?? 0, valor: x?.valor ?? null, descricao: l.descricao || null };
      }),
    });
    if (!r.ok) { setErro(r.erro); return; }
    toast.success(r.aviso); setAberto(false); router.refresh();
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); setErro(undefined); }}>
      <DialogTrigger render={<Button size="sm" />}><FilePlus2 /> Novo recibo</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Novo recibo avulso</DialogTitle>
          <DialogDescription>O cálculo segue as regras padronizadas (dias ÷ 30, horas ÷ 220, assiduidade e salário mínimo dos Parâmetros). Confira a prévia antes de gravar.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1"><Label>Tipo</Label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoRecibo)} className={SELECAO}>
              {(["compra_ferias", "inicio_antes_registro", "eventual", "recorrente"] as const).map((t) => <option key={t} value={t}>{ROTULO_TIPO_RECIBO[t]}</option>)}
            </select>
          </div>
          <div className="grid gap-1"><Label>Funcionário</Label>
            <select value={pessoaId} onChange={(e) => escolherPessoa(e.target.value)} className={SELECAO}>
              <option value="">Escolha…</option>
              {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.cod_fornecedor})</option>)}
            </select>
          </div>
          <div className="grid gap-1"><Label>Salário (R$)</Label><Input value={salario} onChange={(e) => setSalario(e.target.value)} inputMode="decimal" className="h-8" aria-invalid={salario !== "" && !(sal > 0)} /></div>
          <div className="grid gap-1"><Label>Função</Label><Input value={funcao} onChange={(e) => setFuncao(e.target.value)} maxLength={60} className="h-8" /></div>
          <div className="grid gap-1"><Label>Insalubridade</Label>
            <select value={insal} onChange={(e) => setInsal(Number(e.target.value))} className={SELECAO}>{[0, 10, 20, 40].map((p) => <option key={p} value={p}>{p ? `${p}% do salário mínimo` : "Não tem"}</option>)}</select>
          </div>
          <div className="grid gap-1"><Label>Adicional noturno</Label>
            <select value={noturno} onChange={(e) => setNoturno(Number(e.target.value))} className={SELECAO}>{[0, 20].map((p) => <option key={p} value={p}>{p ? `${p}% do salário` : "Não tem"}</option>)}</select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={atualizar} onChange={(e) => setAtualizar(e.target.checked)} className="size-4" /> Gravar salário, função e percentuais no cadastro da pessoa</label>

        {porPeriodo ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1"><Label>{tipo === "compra_ferias" ? "Férias de" : "Trabalhou de"}</Label><Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-8 w-40" /></div>
            <div className="grid gap-1"><Label>até</Label><Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="h-8 w-40" /></div>
            <span className="text-xs text-muted-foreground">Dias corridos; um recibo por mês tocado pelo período.</span>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid w-48 gap-1"><Label>Mês do recibo</Label><Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="h-8" /></div>
            <EditorLinhas linhas={linhas} mudar={setLinhas} rubricas={rubricas} />
          </div>
        )}
        <div className="grid gap-1"><Label>Mensagem no recibo (opcional)</Label><Input value={mensagem} onChange={(e) => setMensagem(e.target.value)} maxLength={200} className="h-8" /></div>

        {pessoaId && sal > 0 && (
          <div className="space-y-3 rounded-[3px] border border-grade p-3">
            {porPeriodo
              ? trechos.map((t) => (
                <PreviaRecibo key={t.competencia} titulo={`${rotuloMes(t.competencia)}: ${br(t.inicio)} a ${br(t.fim)} (${t.dias} dias)`}
                  linhas={linhasDeDias(tipo as "compra_ferias" | "inicio_antes_registro", t.dias, dados, catalogo)} pessoa={dados} parametros={parametrosVigentes(vigencias, t.competencia)} />
              ))
              : entrada?.ok && entrada.linhas.length > 0 && <PreviaRecibo linhas={entrada.linhas} pessoa={dados} parametros={parametrosVigentes(vigencias, `${mes}-01`)} descricoes={linhas.filter((l) => l.rubrica).map((l) => l.descricao)} />}
          </div>
        )}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex justify-end"><Button onClick={gravar} disabled={pendente}>{pendente ? "Gravando…" : porPeriodo && trechos.length > 1 ? `Gravar ${trechos.length} recibos` : "Gravar recibo"}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
