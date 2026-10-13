"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerNomeArquivo, normalizarNota, ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import { escolherTitulo, type BoletoLido } from "@/lib/modulos/financeiro/filial/boleto-pdf";
import { MODULO_RECEBIVEIS, TIPO_ANEXO_BOLETO } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { enviarAnexo } from "@/lib/nucleo/anexos";
import { criarClienteNavegador } from "@/lib/supabase/navegador";
import { concluirLoteBoletos, gravarLinhaDigitavel, lerBoleto, titulosDasNotas, type TituloDaNota } from "./acoes";

const SELECAO = "h-8 w-full rounded-[3px] border border-input bg-white px-2 text-[13px]";

type Item = {
  indice: number;
  arquivo: File;
  notaTexto: string;
  nota: string | null;
  lendo: boolean;
  boleto: BoletoLido | null;
  /** Parcela escolhida (sozinha ou pela pessoa). */
  tituloId: string | null;
  escolhidoPelaPessoa: boolean;
};

/**
 * Boletos em lote (Fase B): cada PDF é ligado à parcela da NF pelo nº do arquivo ("002345.pdf") ou do boleto; com mais de uma
 * parcela, pela linha digitável (vencimento e valor). Prévia com a conferência boleto × título; só grava quando a pessoa confirma.
 */
export function BoletosEmLote() {
  const entrada = useRef<HTMLInputElement>(null);
  const proximo = useRef(0);
  const [itens, setItens] = useState<Item[]>([]);
  const [titulos, setTitulos] = useState<Record<string, TituloDaNota[]>>({});
  const [resultado, setResultado] = useState<{ anexados: number; erros: string[] } | null>(null);
  const [pendente, iniciar] = useTransition();

  const alterar = (indice: number, m: Partial<Item>) => setItens((atual) => atual.map((i) => (i.indice === indice ? { ...i, ...m } : i)));

  async function carregarTitulos(notas: string[]) {
    const faltam = notas.filter((n) => !(n in titulos));
    if (faltam.length === 0) return;
    const r = await titulosDasNotas(faltam);
    if (!r.ok) return void toast.error(r.erro);
    setTitulos((atual) => ({ ...atual, ...Object.fromEntries(faltam.map((n) => [n, r.porNota[n] ?? []])) }));
  }

  async function escolher(lista: FileList | null) {
    const novos = [...(lista ?? [])].map((arquivo): Item => {
      const nota = lerNomeArquivo(arquivo.name).nota;
      return { indice: proximo.current++, arquivo, notaTexto: nota ?? "", nota, lendo: true, boleto: null, tituloId: null, escolhidoPelaPessoa: false };
    });
    setItens((atual) => [...atual, ...novos]);
    setResultado(null);
    if (entrada.current) entrada.current.value = "";
    const notas = new Set<string>();
    for (const item of novos) {
      const fd = new FormData();
      fd.set("arquivo", item.arquivo);
      const r = await lerBoleto(fd).catch(() => null);
      const boleto = r?.ok ? r.boleto : null;
      const nota = item.nota ?? normalizarNota(boleto?.documento);
      if (nota) notas.add(nota);
      alterar(item.indice, { lendo: false, boleto, nota, notaTexto: nota ?? item.notaTexto });
    }
    await carregarTitulos([...notas]);
  }

  // Escolha automática da parcela (quando a pessoa ainda não escolheu) e avisos, recalculados a cada mudança.
  const linhas = itens.map((i) => {
    const candidatos = i.nota ? titulos[i.nota] : undefined;
    const escolha = candidatos ? escolherTitulo(i.boleto, candidatos) : { tituloId: null, avisos: [] as string[] };
    const tituloId = i.escolhidoPelaPessoa ? i.tituloId : escolha.tituloId;
    const titulo = candidatos?.find((t) => t.id === tituloId) ?? null;
    const avisos = i.escolhidoPelaPessoa && titulo ? escolherTitulo(i.boleto, [titulo]).avisos : escolha.avisos;
    return { ...i, candidatos, tituloId, titulo, avisos: [...(i.boleto?.avisos ?? []), ...avisos] };
  });
  const repetidos = new Set(linhas.map((l) => l.tituloId).filter((id, k, arr) => id && arr.indexOf(id) !== k));
  const prontos = linhas.filter((l) => l.tituloId && !repetidos.has(l.tituloId));
  const bloqueio =
    itens.length === 0 ? "Escolha os boletos." :
    itens.some((i) => i.lendo) ? "Lendo os boletos…" :
    repetidos.size > 0 ? "Dois boletos na mesma parcela: tire um ou escolha outra parcela." :
    prontos.length === 0 ? "Nenhum boleto ligado a uma parcela." : null;

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
        if (l.boleto?.linha) {
          const g = await gravarLinhaDigitavel({ tituloId: l.tituloId!, linha: l.boleto.linha.linha });
          if (!g.ok) erros.push(`${l.arquivo.name}: anexado, mas ${g.erro.toLowerCase()}`);
        }
      }
      await concluirLoteBoletos();
      setResultado({ anexados, erros });
      const feitos = new Set(prontos.map((p) => p.indice));
      setItens((atual) => atual.filter((i) => !feitos.has(i.indice)));
      setTitulos({});
      if (erros.length === 0) toast.success(`${anexados} ${anexados === 1 ? "boleto anexado" : "boletos anexados"}. Os kits completos ficaram prontos para a filial.`);
      else toast.error(`${erros.length} ${erros.length === 1 ? "boleto teve" : "boletos tiveram"} erro.`);
    });
  }

  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Boletos</CardTitle>
          <CardDescription>
            Escolha de uma vez os boletos (PDF) das NFs da filial. O nome &quot;002345.pdf&quot; liga à NF 2345; do boleto da AKF também se leem a
            linha digitável, o vencimento e o valor, que são conferidos com o título e gravados.
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
                <TableRow><TableHead>Arquivo</TableHead><TableHead className="w-28">NF</TableHead><TableHead className="w-80">Parcela</TableHead><TableHead>Boleto lido</TableHead><TableHead className="w-16" /></TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={l.indice}>
                    <TableCell className="max-w-56 truncate" title={l.arquivo.name}>{l.arquivo.name}</TableCell>
                    <TableCell>
                      <Input value={l.notaTexto} inputMode="numeric" aria-label={`NF de ${l.arquivo.name}`} aria-invalid={!l.nota}
                        onChange={(e) => {
                          const nota = normalizarNota(e.target.value);
                          alterar(l.indice, { notaTexto: e.target.value, nota, tituloId: null, escolhidoPelaPessoa: false });
                          if (nota) void carregarTitulos([nota]);
                        }} />
                    </TableCell>
                    <TableCell>
                      {l.lendo ? <span className="text-[13px] text-muted-foreground">lendo…</span>
                        : !l.candidatos ? <span className="text-[13px] text-muted-foreground">{l.nota ? "buscando…" : "informe a NF"}</span>
                          : l.candidatos.length === 0 ? <span className="text-[13px] text-destructive">sem parcela em aberto</span> : (
                            <>
                              <select className={SELECAO} value={l.tituloId ?? ""} aria-label={`Parcela de ${l.arquivo.name}`}
                                onChange={(e) => alterar(l.indice, { tituloId: e.target.value || null, escolhidoPelaPessoa: true })}>
                                <option value="">Escolha…</option>
                                {l.candidatos.map((t) => (
                                  <option key={t.id} value={t.id}>{t.documento} · {formatarData(t.vencimento)} · {formatarMoeda(t.valorCentavos)}{t.temBoleto ? " · já tem boleto" : ""}</option>
                                ))}
                              </select>
                              {l.titulo && <div className="text-[12px] text-muted-foreground">{l.titulo.cliente}{l.titulo.cedido ? " · cedido à AKF" : ""}</div>}
                            </>
                          )}
                    </TableCell>
                    <TableCell className="text-[13px]">
                      {l.boleto?.linha
                        ? <>{formatarData(l.boleto.linha.vencimento)} · {formatarMoeda(l.boleto.linha.valorCentavos)}{l.boleto.beneficiarioAkf && <Badge variant="outline" className="ml-1">AKF</Badge>}</>
                        : !l.lendo && <span className="text-muted-foreground">sem linha digitável</span>}
                      {repetidos.has(l.tituloId ?? "") && <div className="text-destructive">outra linha usa a mesma parcela</div>}
                      {l.avisos.map((a) => <div key={a} className={/sem texto|Imagem|nº do arquivo/.test(a) ? "text-muted-foreground" : "text-destructive"}>{a}</div>)}
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
            <p>{resultado.anexados} {resultado.anexados === 1 ? "boleto anexado" : "boletos anexados"}. <Link className="underline" href={`${ROTA_FILIAL}?ver=pronta`}>Ver as notas prontas para envio</Link></p>
            {resultado.erros.map((e) => <p key={e} className="text-destructive">{e}</p>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
