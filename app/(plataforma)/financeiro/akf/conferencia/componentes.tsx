"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { explicarDiferenca, type ItemParcial, type LinhaAkf } from "@/lib/modulos/financeiro/akf/conciliacao";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { desdobrarTitulo, encerrarParte, marcarNaAkf } from "../acoes";
import { conferirPlanilha, type RespostaConferencia } from "./acoes";

type Dados = Extract<RespostaConferencia, { ok: true }>;

const STATUS_DESTACADOS = new Set(["liquidado parcial", "baixado da cobranca"]);
const statusDestacado = (status: string) => STATUS_DESTACADOS.has(status.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase());

/** Confirmação em dois cliques: o primeiro mostra o que vai acontecer, o segundo executa. Nada é gravado sem o segundo. */
function BotaoConfirmado({ rotulo, aviso, ocupado, onConfirmar, desabilitado, variante = "default" }: {
  rotulo: string; aviso: ReactNode; ocupado: boolean; onConfirmar: () => void; desabilitado?: boolean; variante?: "default" | "outline";
}) {
  const [armado, setArmado] = useState(false);
  if (!armado) return <Button size="sm" variant={variante} disabled={desabilitado || ocupado} onClick={() => setArmado(true)}>{rotulo}</Button>;
  return (
    <div role="alert" className="space-y-2 rounded-[3px] border border-marca bg-marca-clara p-2 text-[13px]">
      <p>{aviso}</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={ocupado} onClick={() => { setArmado(false); onConfirmar(); }}>Confirmar</Button>
        <Button size="sm" variant="outline" onClick={() => setArmado(false)}>Cancelar</Button>
      </div>
    </div>
  );
}

const Selo = ({ linha }: { linha: LinhaAkf }) => (statusDestacado(linha.status) ? <Badge variant="outline" className="ml-1 border-marca text-marca">{linha.status}</Badge> : null);

function Secao({ titulo, descricao, total, children }: { titulo: string; descricao: string; total: number; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{titulo} <span className="font-normal text-muted-foreground">({total})</span></CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

/** Conferência da carteira com a planilha da AKF: envia a planilha, mostra o cruzamento e aplica cada correção só com confirmação. */
export function Conferencia({ hoje }: { hoje: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const [dataOperacao, setDataOperacao] = useState(hoje);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [retirar, setRetirar] = useState<Set<string>>(new Set());

  const observacao = `Conferência com a planilha da AKF de ${formatarData(hoje)}.`;

  async function conferir(file: File) {
    const formulario = new FormData();
    formulario.set("arquivo", file);
    const r = await conferirPlanilha(formulario);
    if (!r.ok) {
      setErro(r.erro);
      setDados(null);
      return;
    }
    setErro(null);
    setDados(r);
    setMarcados(new Set(r.resultado.marcar.map((m) => m.titulo.id)));
    setRetirar(new Set());
  }

  function enviar() {
    if (!arquivo) return toast.error("Escolha o arquivo da planilha da AKF.");
    iniciar(async () => { await conferir(arquivo); });
  }

  /** Roda os passos de uma correção na ordem, para na primeira falha e refaz a conferência no fim. */
  function aplicar(passos: (() => Promise<{ ok: true; aviso: string } | { ok: false; erro: string }>)[], sucesso: string) {
    iniciar(async () => {
      for (const passo of passos) {
        const r = await passo();
        if (!r.ok) {
          toast.error(r.erro);
          if (arquivo) await conferir(arquivo);
          return;
        }
      }
      toast.success(sucesso);
      if (arquivo) await conferir(arquivo);
    });
  }

  const alternar = (conjunto: Set<string>, id: string, definir: (s: Set<string>) => void) => {
    const novo = new Set(conjunto);
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    definir(novo);
  };

  function marcarSelecionados() {
    if (!dados) return;
    const itens = dados.resultado.marcar.filter((m) => marcados.has(m.titulo.id));
    aplicar([
      ...itens.flatMap((m) => m.encerrarPartesAntes.map((p) => () => encerrarParte({ id: p.id, motivo: `Título marcado por inteiro na AKF. ${observacao}` }))),
      () => marcarNaAkf({ ids: itens.map((m) => m.titulo.id), cedido: true, observacao }),
    ], `${itens.length} ${itens.length === 1 ? "título marcado" : "títulos marcados"} como cedidos à AKF.`);
  }

  function aplicarParcial(p: ItemParcial) {
    aplicar([
      ...(p.retirarCedidoAntes ? [() => marcarNaAkf({ ids: [p.titulo.id], cedido: false, observacao: `Na AKF só em parte. ${observacao}` })] : []),
      ...p.encerrar.map((parte) => () => encerrarParte({ id: parte.id, motivo: `Parte diferente da planilha da AKF. ${observacao}` })),
      ...p.lancar.map((l) => () => desdobrarTitulo({
        tituloId: p.titulo.id, valor: l.valorCentavos / 100, vencimento: l.vencimento, dataOperacao, observacao: `${observacao} Borderô ${l.linha.bordero ?? "—"}.`,
      })),
    ], `Antecipação parcial de ${p.titulo.documento} ajustada.`);
  }

  function retirarSelecionados() {
    if (!dados) return;
    const ids = dados.resultado.soNoApp.filter((t) => retirar.has(t.id) && t.cedido).map((t) => t.id);
    aplicar([() => marcarNaAkf({ ids, cedido: false, observacao: `Fora da planilha da AKF. ${observacao}` })], `${ids.length} ${ids.length === 1 ? "título retirado" : "títulos retirados"} da AKF.`);
  }

  const r = dados?.resultado;
  const e = r ? explicarDiferenca(r) : null;
  const linhasDiferenca: [string, number][] = e
    ? ([
      ["Falta marcar como cedido (título inteiro)", e.faltaMarcarCentavos],
      ["Falta antecipação parcial (partes)", e.faltaParcialCentavos],
      ["Na planilha, sem título no app", e.semTituloCentavos],
      ["No app como AKF, fora da planilha", e.soNoAppCentavos],
      ["A confirmar", e.aConfirmarCentavos],
    ] as [string, number][]).filter(([, v]) => v !== 0)
    : [];

  return (
    <div className="space-y-5">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Planilha da AKF</CardTitle>
          <CardDescription>
            Envie o arquivo de recebíveis da AKF (.xlsx). Enviar só lê e compara: nada é gravado até você confirmar cada correção abaixo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <input ref={entrada} type="file" accept=".xlsx,.csv" className="text-sm" onChange={(ev) => setArquivo(ev.target.files?.[0] ?? null)} />
          <Button onClick={enviar} disabled={pendente || !arquivo}>{pendente ? "Conferindo…" : dados ? "Conferir de novo" : "Conferir"}</Button>
          {dados && <span className="text-[12px] text-muted-foreground">Arquivo: {dados.arquivo}</span>}
        </CardContent>
      </Card>

      {erro && <p role="alert" className="rounded-[3px] border border-marca bg-marca-clara p-3 text-sm">{erro}</p>}
      {dados?.avisos.map((a) => <p key={a} role="alert" className="rounded-[3px] border border-marca bg-marca-clara p-3 text-sm">{a}</p>)}

      {r && e && dados && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card size="sm">
              <CardHeader><CardDescription>Planilha da AKF</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(r.resumo.planilhaCentavos)}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">{r.resumo.planilhaQtd} títulos</CardContent>
            </Card>
            <Card size="sm">
              <CardHeader><CardDescription>Neo Admin hoje (Na AKF)</CardDescription><CardTitle className="text-xl tabular-nums">{formatarMoeda(r.resumo.appCentavos)}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">{r.resumo.appQtd} títulos (inteiros ou com parte)</CardContent>
            </Card>
            <Card size="sm">
              <CardHeader><CardDescription>Diferença</CardDescription><CardTitle className={`text-xl tabular-nums ${r.resumo.diferencaCentavos === 0 ? "" : "text-red-700"}`}>{formatarMoeda(r.resumo.diferencaCentavos)}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">{r.resumo.diferencaCentavos === 0 ? "Carteira igual à da AKF." : "planilha menos Neo Admin"}</CardContent>
            </Card>
          </div>
          {linhasDiferenca.length > 0 && (
            <ul className="rounded-[3px] border border-grade p-3 text-sm">
              {linhasDiferenca.map(([rotulo, valor]) => (
                <li key={rotulo} className="flex justify-between gap-4 py-0.5"><span>{rotulo}</span><span className="tabular-nums">{formatarMoeda(valor)}</span></li>
              ))}
            </ul>
          )}

          <Secao titulo="Falta marcar como cedido" total={r.marcar.length} descricao="Estão na planilha da AKF por inteiro, mas o app não os mostra como antecipados (portador 998 ou cedido).">
            {r.marcar.length === 0 ? <p className="text-sm text-muted-foreground">Nada a marcar.</p> : (
              <>
                <div className="overflow-x-auto rounded-[3px] border border-grade">
                  <Table className="cartoes">
                    <TableHeader><TableRow><TableHead /><TableHead>Planilha</TableHead><TableHead>Título no app</TableHead><TableHead>Cliente</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Observação</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {r.marcar.map((m) => (
                        <TableRow key={m.titulo.id}>
                          <TableCell><input type="checkbox" className="size-4" checked={marcados.has(m.titulo.id)} onChange={() => alternar(marcados, m.titulo.id, setMarcados)} aria-label={`Marcar ${m.titulo.documento}`} /></TableCell>
                          <TableCell className="tabular-nums">{m.linha.numero}<Selo linha={m.linha} /></TableCell>
                          <TableCell className="font-medium tabular-nums">{m.titulo.documento}</TableCell>
                          <TableCell className="max-w-64 truncate" title={m.titulo.cliente}>{m.titulo.cliente}</TableCell>
                          <TableCell className="tabular-nums">{formatarData(m.titulo.vencimento)}{m.titulo.vencimento !== m.linha.vencimento && <span className="block text-[11px] text-muted-foreground">AKF: {formatarData(m.linha.vencimento)}</span>}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatarMoeda(m.titulo.valorCentavos)}</TableCell>
                          <TableCell className="text-[12px] text-muted-foreground">{m.encerrarPartesAntes.length > 0 ? `Tem parte antecipada (${m.encerrarPartesAntes.map((p) => formatarMoeda(p.valorCentavos)).join(", ")}): será encerrada antes.` : "Portador no Consistem: " + (m.titulo.codPortador ?? "—")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <BotaoConfirmado
                  rotulo={`Marcar ${marcados.size} como cedidos`}
                  desabilitado={marcados.size === 0}
                  ocupado={pendente}
                  aviso={<>Marcar <strong>{marcados.size}</strong> {marcados.size === 1 ? "título" : "títulos"} como cedidos à AKF? Eles saem da régua de cobrança e entram em “Na AKF”. É a mesma marcação manual da tela AKF.</>}
                  onConfirmar={marcarSelecionados}
                />
              </>
            )}
          </Secao>

          <Secao titulo="Antecipação parcial" total={r.parciais.length} descricao="A AKF tem só uma parte do título. O app precisa ter a parte lançada com o valor e o vencimento da AKF.">
            <label className="flex flex-wrap items-center gap-2 text-sm">
              Data da operação das partes que forem lançadas:
              <Input type="date" className="w-44" value={dataOperacao} max={hoje} onChange={(ev) => setDataOperacao(ev.target.value)} />
              <span className="text-[12px] text-muted-foreground">A planilha não traz a data do borderô; confira se precisar de outra.</span>
            </label>
            {r.parciais.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma antecipação parcial na planilha.</p> : r.parciais.map((p) => (
              <div key={p.titulo.id} className="space-y-2 rounded-[3px] border border-grade p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <strong className="tabular-nums">{p.titulo.documento}</strong> <span className="text-muted-foreground">— {p.titulo.cliente} · título de {formatarMoeda(p.titulo.valorCentavos)}, vence {formatarData(p.titulo.vencimento)}</span>
                  </div>
                  {p.certo ? <Badge variant="secondary">Já está certo</Badge> : <Badge className="bg-amber-100 text-amber-900">Ajustar</Badge>}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[12px] font-medium text-muted-foreground">Planilha da AKF ({formatarMoeda(p.planilhaCentavos)})</p>
                    <ul>{p.linhas.map((l) => <li key={l.linha} className="tabular-nums">{formatarMoeda(l.valorCentavos)} · vence {formatarData(l.vencimento)} · linha {l.numero}<Selo linha={l} /></li>)}</ul>
                  </div>
                  <div>
                    <p className="text-[12px] font-medium text-muted-foreground">Neo Admin ({formatarMoeda(p.appCentavos)})</p>
                    {p.titulo.partes.length === 0 && !p.retirarCedidoAntes && <p>Nenhuma parte lançada.</p>}
                    {p.retirarCedidoAntes && <p>Título marcado como cedido por inteiro.</p>}
                    <ul>{p.titulo.partes.map((x) => <li key={x.id} className="tabular-nums">{formatarMoeda(x.valorCentavos)} · vence {formatarData(x.vencimento)}</li>)}</ul>
                  </div>
                </div>
                {!p.certo && (
                  <BotaoConfirmado
                    rotulo="Aplicar este ajuste"
                    ocupado={pendente}
                    aviso={<>
                      {p.retirarCedidoAntes && <>Retirar o título de “cedido” (a AKF tem só parte). </>}
                      {p.encerrar.length > 0 && <>Encerrar {p.encerrar.length === 1 ? "a parte" : "as partes"} de {p.encerrar.map((x) => formatarMoeda(x.valorCentavos)).join(" e ")}. </>}
                      {p.lancar.length > 0 && <>Lançar {p.lancar.map((l) => `${formatarMoeda(l.valorCentavos)} (vence ${formatarData(l.vencimento)})`).join(" e ")}, operação em {formatarData(dataOperacao)}.</>}
                    </>}
                    onConfirmar={() => aplicarParcial(p)}
                  />
                )}
              </div>
            ))}
          </Secao>

          <Secao titulo="No app como AKF, mas fora da planilha" total={r.soNoApp.length + r.partesSoNoApp.length} descricao="O app mostra estes títulos como antecipados e a AKF não os lista. Pode ser que ainda não tenham sido enviados à AKF, ou que já tenham saído. Confira antes de retirar.">
            {r.soNoApp.length + r.partesSoNoApp.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum.</p> : (
              <>
                <div className="overflow-x-auto rounded-[3px] border border-grade">
                  <Table className="cartoes">
                    <TableHeader><TableRow><TableHead /><TableHead>Título</TableHead><TableHead>Cliente</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Situação no app</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {r.soNoApp.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell>{t.cedido ? <input type="checkbox" className="size-4" checked={retirar.has(t.id)} onChange={() => alternar(retirar, t.id, setRetirar)} aria-label={`Retirar ${t.documento}`} /> : null}</TableCell>
                          <TableCell className="font-medium tabular-nums">{t.documento}</TableCell>
                          <TableCell className="max-w-64 truncate" title={t.cliente}>{t.cliente}</TableCell>
                          <TableCell className="tabular-nums">{formatarData(t.vencimento)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatarMoeda(t.valorCentavos)}</TableCell>
                          <TableCell className="text-[12px] text-muted-foreground">{t.cedido ? "Cedido" : "Portador 998 no Consistem"}{t.codPortador === "998" ? " (portador 998)" : ""}</TableCell>
                        </TableRow>
                      ))}
                      {r.partesSoNoApp.map(({ titulo, parte }) => (
                        <TableRow key={parte.id}>
                          <TableCell />
                          <TableCell className="font-medium tabular-nums">{titulo.documento}</TableCell>
                          <TableCell className="max-w-64 truncate" title={titulo.cliente}>{titulo.cliente}</TableCell>
                          <TableCell className="tabular-nums">{formatarData(parte.vencimento)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatarMoeda(parte.valorCentavos)}</TableCell>
                          <TableCell className="text-[12px]">
                            Parte antecipada fora da planilha
                            <BotaoConfirmado
                              rotulo="Encerrar parte" variante="outline" ocupado={pendente}
                              aviso={<>Encerrar a parte de {formatarMoeda(parte.valorCentavos)} de {titulo.documento}? O histórico fica.</>}
                              onConfirmar={() => aplicar([() => encerrarParte({ id: parte.id, motivo: `Parte fora da planilha da AKF. ${observacao}` })], "Parte encerrada.")}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {r.soNoApp.some((t) => t.cedido) && (
                  <BotaoConfirmado
                    rotulo={`Retirar ${[...retirar].length} da AKF`} variante="outline" desabilitado={retirar.size === 0} ocupado={pendente}
                    aviso={<>Retirar {retirar.size} {retirar.size === 1 ? "título" : "títulos"} da AKF no app? Eles voltam à carteira e à régua de cobrança. O portador 998 continua no Consistem: se ele mudar de novo, o app pode remarcar.</>}
                    onConfirmar={retirarSelecionados}
                  />
                )}
              </>
            )}
          </Secao>

          {r.aConfirmar.length > 0 && (
            <Secao titulo="A confirmar" total={r.aConfirmar.length} descricao="O cruzamento não teve certeza. Nada é aplicado sozinho: confira estes casos na planilha e no Consistem.">
              <ul className="space-y-1 text-sm">
                {r.aConfirmar.map((c) => <li key={c.linha.linha}><strong>{c.linha.numero}</strong> ({formatarMoeda(c.linha.valorCentavos)}, {c.linha.sacado}) → {c.titulo.documento}: {c.motivo}.</li>)}
              </ul>
            </Secao>
          )}

          <Secao titulo="Na planilha, sem título no app" total={r.semTitulo.length} descricao="A AKF tem, mas não achei título do mesmo cliente com este valor na carteira em aberto (pode ser de outra carteira ou já baixado).">
            {r.semTitulo.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum.</p> : (
              <ul className="space-y-1 text-sm">
                {r.semTitulo.map((l) => <li key={l.linha} className="tabular-nums"><strong>{l.numero}</strong> · {l.sacado} · {formatarMoeda(l.valorCentavos)} · vence {formatarData(l.vencimento)} · borderô {l.bordero ?? "—"}<Selo linha={l} /></li>)}
              </ul>
            )}
          </Secao>

          <Secao titulo="Certo" total={r.certos.length} descricao="Títulos da planilha que já estão como antecipados no app.">
            <p className="text-sm tabular-nums">{r.certos.length} títulos · {formatarMoeda(r.certos.reduce((s, c) => s + c.titulo.valorCentavos, 0))}.
              {r.certos.some((c) => statusDestacado(c.linha.status)) && <> Com status destacado na planilha: {r.certos.filter((c) => statusDestacado(c.linha.status)).map((c) => `${c.linha.numero} (${c.linha.status})`).join(", ")}.</>}
            </p>
          </Secao>
        </>
      )}
    </div>
  );
}
