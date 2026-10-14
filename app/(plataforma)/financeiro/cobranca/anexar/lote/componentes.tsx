"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerNomeArquivo } from "@/lib/modulos/financeiro/filial/arquivos";
import { MODULO_RECEBIVEIS, TIPO_ANEXO_BOLETO } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { conferir, escolherTitulo, lerNumeroDocumento, type BoletoLido } from "@/lib/modulos/financeiro/recebiveis/boleto-pdf";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { enviarAnexo } from "@/lib/nucleo/anexos";
import { criarClienteNavegador } from "@/lib/supabase/navegador";
import { ROTULO_UNIDADE, type Unidade } from "@/supabase/functions/_shared/cobranca";
import { concluirLoteBoletos, gravarLinhaDigitavel, lerArquivoBoleto, titulosParaBoletos, type TituloDoLote } from "./acoes";

const SELECAO = "h-8 w-full rounded-[3px] border border-input bg-white px-2 text-[13px]";

type Item = {
  indice: number;
  arquivo: File;
  /** Nº do documento (lido do boleto ou do nome do arquivo; a pessoa pode corrigir): "2316", "1237/8". */
  documentoTexto: string;
  lendo: boolean;
  boleto: BoletoLido | null;
  /** Título escolhido pela pessoa (sobrepõe a escolha automática). */
  tituloId: string | null;
  escolhidoPelaPessoa: boolean;
};

type Busca = { notas: string[]; pares: { vencimento: string; valorCentavos: number }[] };

/**
 * Boletos em lote: cada PDF é lido (texto ou, no PDF-imagem do Bradesco, OCR) e ligado ao título pela NF/parcela do
 * "Nº do documento" e pela linha digitável (vencimento + valor). Prévia com a conferência boleto × título; só grava quando a
 * pessoa confirma. `unidade` fixa a busca numa unidade (tela da filial); null = todas.
 */
export function BoletosEmLote({ unidade, linkDepois }: { unidade: Unidade | null; linkDepois?: { href: string; rotulo: string } }) {
  const entrada = useRef<HTMLInputElement>(null);
  const proximo = useRef(0);
  const consultadas = useRef(new Set<string>());
  const [itens, setItens] = useState<Item[]>([]);
  const [titulos, setTitulos] = useState<Record<string, TituloDoLote>>({});
  const [resultado, setResultado] = useState<{ anexados: number; erros: string[] } | null>(null);
  const [pendente, iniciar] = useTransition();

  const alterar = (indice: number, m: Partial<Item>) => setItens((atual) => atual.map((i) => (i.indice === indice ? { ...i, ...m } : i)));

  async function carregar(busca: Busca) {
    const chaveNota = (n: string) => `nf:${n}`;
    const chavePar = (p: Busca["pares"][number]) => `par:${p.vencimento}:${p.valorCentavos}`;
    const notas = busca.notas.filter((n) => !consultadas.current.has(chaveNota(n)));
    const pares = busca.pares.filter((p) => !consultadas.current.has(chavePar(p)));
    if (notas.length === 0 && pares.length === 0) return;
    const r = await titulosParaBoletos({ notas, pares, unidade });
    if (!r.ok) return void toast.error(r.erro);
    notas.forEach((n) => consultadas.current.add(chaveNota(n)));
    pares.forEach((p) => consultadas.current.add(chavePar(p)));
    setTitulos((atual) => ({ ...atual, ...Object.fromEntries(r.titulos.map((t) => [t.id, t])) }));
  }

  async function escolher(lista: FileList | null) {
    const novos = [...(lista ?? [])].map((arquivo): Item => ({
      indice: proximo.current++, arquivo, documentoTexto: "", lendo: true, boleto: null, tituloId: null, escolhidoPelaPessoa: false,
    }));
    setItens((atual) => [...atual, ...novos]);
    setResultado(null);
    if (entrada.current) entrada.current.value = "";
    for (const item of novos) {
      const fd = new FormData();
      fd.set("arquivo", item.arquivo);
      const r = await lerArquivoBoleto(fd).catch(() => null);
      const boleto = r?.ok ? r.boleto : null;
      // Sem nº do documento no boleto: o nome do arquivo ("002345.pdf", "NF 2345 - CLIENTE.pdf").
      const pelaNome = lerNomeArquivo(item.arquivo.name).nota?.replace(/^0+/, "") ?? "";
      const documentoTexto = boleto?.documento?.texto ?? pelaNome;
      alterar(item.indice, { lendo: false, boleto, documentoTexto });
      if (r && !r.ok) toast.error(`${item.arquivo.name}: ${r.erro}`);
      const nota = lerNumeroDocumento(documentoTexto)?.nota;
      await carregar({ notas: nota ? [nota] : [], pares: boleto?.linha ? [{ vencimento: boleto.linha.vencimento ?? "", valorCentavos: boleto.linha.valorCentavos }].filter((p) => p.vencimento) : [] });
    }
  }

  // Escolha automática (quando a pessoa ainda não escolheu) e conferência, recalculadas a cada mudança.
  const todos = Object.values(titulos);
  const linhas = itens.map((i) => {
    const documento = lerNumeroDocumento(i.documentoTexto);
    const boleto = i.boleto ? { ...i.boleto, documento } : { linha: null, documento, pagadorDocumento: null, beneficiarioAkf: false };
    const linha = boleto.linha;
    const candidatos = i.lendo ? [] : todos.filter((t) =>
      (documento?.nota && t.nota === documento.nota) || (linha && t.vencimento === linha.vencimento && t.valorCentavos === linha.valorCentavos));
    const escolha = escolherTitulo(boleto, candidatos);
    const tituloId = i.escolhidoPelaPessoa ? i.tituloId : escolha.tituloId;
    const titulo = candidatos.find((t) => t.id === tituloId) ?? null;
    const avisos = i.lendo ? [] : i.escolhidoPelaPessoa ? (titulo ? conferir(boleto, titulo) : []) : escolha.avisos;
    return { ...i, linha, candidatos, tituloId: titulo ? tituloId : null, titulo, avisos: [...(i.boleto?.avisos ?? []), ...avisos] };
  });
  const repetidos = new Set(linhas.map((l) => l.tituloId).filter((id, k, arr) => id && arr.indexOf(id) !== k));
  const prontos = linhas.filter((l) => l.tituloId && !repetidos.has(l.tituloId));
  const bloqueio =
    itens.length === 0 ? "Escolha os boletos." :
    itens.some((i) => i.lendo) ? "Lendo os boletos…" :
    repetidos.size > 0 ? "Dois boletos no mesmo título: tire um ou escolha outro título." :
    prontos.length === 0 ? "Nenhum boleto ligado a um título." : null;

  function anexar() {
    if (bloqueio) return toast.error(bloqueio);
    iniciar(async () => {
      const supabase = criarClienteNavegador();
      const erros: string[] = [];
      let anexados = 0;
      for (const l of prontos) {
        const r = await enviarAnexo(supabase, { modulo: MODULO_RECEBIVEIS, referenciaTabela: "rec_titulos", referenciaId: l.tituloId! }, l.arquivo, TIPO_ANEXO_BOLETO);
        if (!r.ok) {
          erros.push(`${l.arquivo.name}: ${r.erro}`);
          continue;
        }
        anexados += 1;
        if (l.linha) {
          const g = await gravarLinhaDigitavel({ tituloId: l.tituloId!, linha: l.linha.linha });
          if (!g.ok) erros.push(`${l.arquivo.name}: anexado, mas ${g.erro.toLowerCase()}`);
        }
      }
      await concluirLoteBoletos();
      setResultado({ anexados, erros });
      const feitos = new Set(prontos.map((p) => p.indice));
      setItens((atual) => atual.filter((i) => !feitos.has(i.indice)));
      setTitulos({});
      consultadas.current.clear();
      if (erros.length === 0) toast.success(`${anexados} ${anexados === 1 ? "boleto anexado" : "boletos anexados"}.`);
      else toast.error(`${erros.length} ${erros.length === 1 ? "boleto teve" : "boletos tiveram"} erro.`);
    });
  }

  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Boletos</CardTitle>
          <CardDescription>
            Escolha de uma vez os boletos em PDF (próprios do Bradesco ou da AKF){unidade ? ` da ${ROTULO_UNIDADE[unidade]}` : ""}. De cada um se leem a
            linha digitável (vencimento e valor), o nº do documento (NF ou NF/parcela) e o pagador, e o boleto é ligado ao título. O PDF do
            Bradesco, que é uma imagem, é lido por OCR e demora alguns segundos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input ref={entrada} type="file" multiple accept="application/pdf,image/*" onChange={(e) => void escolher(e.target.files)}
            className="block text-[13px] file:mr-3 file:rounded-[3px] file:border file:border-input file:bg-white file:px-3 file:py-1.5" />
        </CardContent>
      </Card>

      {linhas.length > 0 && (
        <Card size="sm">
          <CardHeader><CardTitle>Conferir <span className="font-normal text-muted-foreground">({linhas.length})</span></CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Arquivo</TableHead><TableHead className="w-32">Nº documento</TableHead><TableHead className="w-96">Título</TableHead><TableHead>Boleto lido</TableHead><TableHead className="w-16">Ação</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={l.indice}>
                    <TableCell className="max-w-56 truncate" title={l.arquivo.name}>{l.arquivo.name}</TableCell>
                    <TableCell>
                      <Input value={l.documentoTexto} aria-label={`Nº do documento de ${l.arquivo.name}`} placeholder="NF ou NF/parcela"
                        onChange={(e) => {
                          alterar(l.indice, { documentoTexto: e.target.value, tituloId: null, escolhidoPelaPessoa: false });
                          const nota = lerNumeroDocumento(e.target.value)?.nota;
                          if (nota) void carregar({ notas: [nota], pares: [] });
                        }} />
                    </TableCell>
                    <TableCell>
                      {l.lendo ? <span className="text-[13px] text-muted-foreground">lendo…</span>
                        : l.candidatos.length === 0 ? <span className="text-[13px] text-destructive">nenhum título em aberto</span> : (
                          <>
                            <select className={SELECAO} value={l.tituloId ?? ""} aria-label={`Título de ${l.arquivo.name}`}
                              onChange={(e) => alterar(l.indice, { tituloId: e.target.value || null, escolhidoPelaPessoa: true })}>
                              <option value="">Escolha…</option>
                              {l.candidatos.map((t) => (
                                <option key={t.id} value={t.id}>{t.documento} · {formatarData(t.vencimento)} · {formatarMoeda(t.valorCentavos)}{t.temBoleto ? " · já tem boleto" : ""}</option>
                              ))}
                            </select>
                            {l.titulo && (
                              <div className="text-[12px] text-muted-foreground">
                                {l.titulo.cliente} · {ROTULO_UNIDADE[l.titulo.unidade]}{l.titulo.cedido ? " · cedido à AKF" : ""}
                              </div>
                            )}
                          </>
                        )}
                    </TableCell>
                    <TableCell className="text-[13px]">
                      {l.linha
                        ? <>{formatarData(l.linha.vencimento)} · {formatarMoeda(l.linha.valorCentavos)}</>
                        : !l.lendo && <span className="text-muted-foreground">sem linha digitável</span>}
                      {l.boleto?.beneficiarioAkf && <Badge variant="outline" className="ml-1">AKF</Badge>}
                      {l.boleto?.porOcr && <Badge variant="outline" className="ml-1">OCR</Badge>}
                      {repetidos.has(l.tituloId ?? "") && <div className="text-destructive">outra linha usa o mesmo título</div>}
                      {l.avisos.map((a) => <div key={a} className={/Imagem|informe a NF|escolha/.test(a) ? "text-muted-foreground" : "text-destructive"}>{a}</div>)}
                    </TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => setItens((atual) => atual.filter((i) => i.indice !== l.indice))}>Tirar</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={pendente || bloqueio !== null} onClick={anexar}>
                {pendente ? "Anexando…" : `Anexar ${prontos.length} ${prontos.length === 1 ? "boleto" : "boletos"}`}
              </Button>
              {bloqueio && <span className="text-[13px] text-muted-foreground">{bloqueio}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {resultado && (
        <Card size="sm">
          <CardHeader><CardTitle>Resultado</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-[13px]">
            <p>
              {resultado.anexados} {resultado.anexados === 1 ? "boleto anexado" : "boletos anexados"}.
              {linkDepois && <> <Link className="underline" href={linkDepois.href}>{linkDepois.rotulo}</Link></>}
            </p>
            {resultado.erros.map((e) => <p key={e} className="text-destructive">{e}</p>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
