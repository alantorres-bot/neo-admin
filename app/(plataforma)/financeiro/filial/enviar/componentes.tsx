"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  agruparLote, DOCUMENTOS_DA_FILIAL, lerNomeArquivo, normalizarNota, ROTA_FILIAL, ROTULO_DOCUMENTO_KIT, TIPOS_DOCUMENTO_KIT,
  type ItemLote, type TipoDocumentoKit,
} from "@/lib/modulos/financeiro/filial/arquivos";
import type { ItemAviso } from "@/lib/modulos/financeiro/filial/remessa";
import { centavosDeTexto } from "@/lib/modulos/financeiro/akf/conciliacao";
import { clienteSemBoleto } from "@/supabase/functions/_shared/akf";
import { anexarDocumentoKit, concluirRemessa, conferirClientesErp, criarRemessa, lerNotaFatura, registrarKit } from "../acoes";
import { BotaoAvisoCuiaba } from "../aviso";

const SELECAO = "h-8 w-full rounded-[3px] border border-input bg-white px-2 text-[13px]";
const LIMITE_BYTES = 9 * 1024 * 1024; // abaixo do limite de 10 MB das server actions

type Leitura = { estado: "lendo" | "lido" | "erro"; avisos: string[] };
type Item = ItemLote & { arquivo: File; notaTexto: string; leitura?: Leitura };
type ParcelaTexto = { vencimento: string; valorTexto: string };
type DadosNota = {
  cliente?: string; obra?: string; aceita?: boolean; parcelas?: ParcelaTexto[]; periodoInicio?: string | null; periodoFim?: string | null;
  emissao?: string | null; clienteDocumento?: string | null;
};

const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Resultado = { nota: string; id: string | null; enviados: number; erros: string[] };
type Remessa = { id: string; numero: number; itens: ItemAviso[] };

/** Parcelas digitadas → válidas (vencimento + valor > 0), ignorando linhas totalmente vazias; null se alguma estiver pela metade. */
function lerParcelas(lista: ParcelaTexto[]): { vencimento: string; valorCentavos: number }[] | null {
  const saida: { vencimento: string; valorCentavos: number }[] = [];
  for (const p of lista) {
    if (p.vencimento === "" && p.valorTexto.trim() === "") continue;
    const valorCentavos = centavosDeTexto(p.valorTexto);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.vencimento) || !valorCentavos || valorCentavos <= 0) return null;
    saida.push({ vencimento: p.vencimento, valorCentavos });
  }
  return saida;
}

/**
 * Envio em lote das faturas da filial. Lê NF, cliente e tipo pelo nome de cada arquivo, mostra a prévia agrupada por NF
 * e só grava quando a pessoa confirma: um kit por NF e um anexo por arquivo.
 */
export function EnvioEmLote({ termosSemBoleto, para, hoje }: { termosSemBoleto: string[]; para: string[]; hoje: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const proximo = useRef(0); // índice único por arquivo, mesmo depois de tirar algum da lista
  const [itens, setItens] = useState<Item[]>([]);
  const [porNota, setPorNota] = useState<Record<string, DadosNota>>({});
  const [resultado, setResultado] = useState<Resultado[] | null>(null);
  const [remessa, setRemessa] = useState<Remessa | null>(null);
  const [progresso, setProgresso] = useState("");
  const [pendente, iniciar] = useTransition();

  const alterar = (indice: number, mudanca: Partial<Item>) =>
    setItens((atual) => atual.map((i) => (i.indice === indice ? { ...i, ...mudanca } : i)));
  const remover = (indice: number) => setItens((atual) => atual.filter((i) => i.indice !== indice));
  const alterarNota = (nota: string, mudanca: DadosNota) => setPorNota((atual) => ({ ...atual, [nota]: { ...atual[nota], ...mudanca } }));

  function escolher(lista: FileList | null) {
    const novos = [...(lista ?? [])].map((arquivo): Item => {
      const lido = lerNomeArquivo(arquivo.name);
      const pdf = /\.pdf$/i.test(arquivo.name) || arquivo.type === "application/pdf";
      const ler = pdf && (lido.tipo === null || lido.tipo === "nota_fatura") && arquivo.size <= LIMITE_BYTES;
      return { indice: proximo.current++, nome: arquivo.name, arquivo, ...lido, notaTexto: lido.nota ?? "", leitura: ler ? { estado: "lendo", avisos: [] } : undefined };
    });
    setItens((atual) => [...atual, ...novos]);
    setResultado(null);
    setRemessa(null);
    if (entrada.current) entrada.current.value = "";
    void lerNotas(novos.filter((i) => i.leitura));
  }

  /** Lê cada nota fatura no servidor e preenche NF, tipo, cliente, obra, período, vencimento e valor (só o que estiver vazio). */
  async function lerNotas(lista: Item[]) {
    for (const item of lista) {
      const fd = new FormData();
      fd.set("arquivo", item.arquivo);
      const r = await lerNotaFatura(fd).catch(() => ({ ok: false as const, erro: "Falha ao ler o PDF." }));
      if (!r.ok || r.nota.parcelas.length === 0) {
        // não é nota fatura do Syslock (ou não deu para ler): fica como estava, para a pessoa informar
        alterar(item.indice, { leitura: { estado: "erro", avisos: [r.ok ? "Não reconheci a nota neste PDF." : r.erro] } });
        continue;
      }
      const n = r.nota;
      const avisos = [...n.avisos];
      if (item.nota && n.nota && item.nota !== n.nota) avisos.push(`O nome do arquivo diz NF ${item.nota}, mas o PDF é da NF ${n.nota}. Usei a do PDF.`);
      const nota = n.nota ?? item.nota;
      alterar(item.indice, {
        nota, notaTexto: nota ?? item.notaTexto, tipo: item.tipo ?? "nota_fatura", cliente: item.cliente ?? n.cliente,
        leitura: { estado: "lido", avisos },
      });
      if (nota) {
        setPorNota((atual) => {
          const d = atual[nota] ?? {};
          return {
            ...atual,
            [nota]: {
              ...d,
              obra: d.obra ?? n.obra ?? undefined,
              periodoInicio: d.periodoInicio ?? n.periodoInicio, periodoFim: d.periodoFim ?? n.periodoFim,
              emissao: d.emissao ?? n.emissao, clienteDocumento: d.clienteDocumento ?? n.clienteDocumento,
              parcelas: d.parcelas ?? n.parcelas.map((p) => ({ vencimento: p.vencimento, valorTexto: reais(p.valorCentavos) })),
            },
          };
        });
      }
    }
  }

  const { grupos, semNota } = useMemo(() => agruparLote(itens), [itens]);
  const grandes = itens.filter((i) => i.arquivo.size > LIMITE_BYTES);
  const semTipo = itens.filter((i) => !i.tipo);
  const linhas = grupos.map((g) => {
    const extra = porNota[g.nota] ?? {};
    const cliente = (extra.cliente ?? g.cliente).trim();
    const aceita = extra.aceita ?? !(cliente !== "" && clienteSemBoleto(cliente, termosSemBoleto));
    const tipos = new Set(g.itens.map((i) => i.tipo));
    const faltam = DOCUMENTOS_DA_FILIAL.filter((t) => !tipos.has(t)).map((t) => ROTULO_DOCUMENTO_KIT[t].toLowerCase());
    const parcelasTexto = extra.parcelas ?? [{ vencimento: "", valorTexto: "" }];
    const lendo = g.itens.some((i) => i.leitura?.estado === "lendo");
    const avisosLeitura = g.itens.flatMap((i) => (i.leitura?.estado === "lido" ? i.leitura.avisos : []));
    const lidoDoPdf = g.itens.some((i) => i.leitura?.estado === "lido");
    return {
      ...g, cliente, obra: extra.obra ?? "", aceita, faltam, parcelasTexto, parcelas: lerParcelas(parcelasTexto),
      periodoInicio: extra.periodoInicio ?? null, periodoFim: extra.periodoFim ?? null, lendo, avisosLeitura, lidoDoPdf,
      emissao: extra.emissao ?? null, clienteDocumento: extra.clienteDocumento ?? null,
    };
  });
  const semCliente = linhas.filter((l) => l.cliente === "");
  const parcelaIncompleta = linhas.filter((l) => l.parcelas === null);
  const bloqueio =
    itens.length === 0 ? "Escolha os arquivos." :
    itens.some((i) => i.leitura?.estado === "lendo") ? "Lendo as notas…" :
    semNota.length > 0 ? "Informe a NF de todos os arquivos." :
    semTipo.length > 0 ? "Informe o tipo de todos os arquivos." :
    semCliente.length > 0 ? "Informe o cliente de todas as NFs." :
    parcelaIncompleta.length > 0 ? `Complete o vencimento e o valor da NF ${parcelaIncompleta[0].nota} (ou deixe a linha vazia).` :
    grandes.length > 0 ? "Há arquivo acima de 9 MB." : null;

  function registrar() {
    if (bloqueio) return toast.error(bloqueio);
    iniciar(async () => {
      const rem = await criarRemessa();
      if (!rem.ok) return void toast.error(rem.erro);
      const saida: Resultado[] = [];
      for (const [n, l] of linhas.entries()) {
        setProgresso(`NF ${l.nota} (${n + 1}/${linhas.length})…`);
        const r = await registrarKit({
          nota: l.nota, cliente: l.cliente, aceitaBoletoFactoring: l.aceita, obra: l.obra, remessaId: rem.id, parcelas: l.parcelas ?? [],
          periodoInicio: l.periodoInicio, periodoFim: l.periodoFim, emissao: l.emissao, clienteDocumento: l.clienteDocumento,
        });
        if (!r.ok) {
          saida.push({ nota: l.nota, id: null, enviados: 0, erros: [r.erro] });
          continue;
        }
        const res: Resultado = { nota: l.nota, id: r.id, enviados: 0, erros: [] };
        for (const item of l.itens) {
          const fd = new FormData();
          fd.set("kitId", r.id);
          fd.set("tipo", item.tipo as string);
          fd.set("arquivo", item.arquivo);
          const a = await anexarDocumentoKit(fd);
          if (a.ok) res.enviados += 1;
          else res.erros.push(`${item.nome}: ${a.erro}`);
        }
        saida.push(res);
      }
      const fechada = saida.some((s) => s.id) ? await concluirRemessa(rem.id) : null;
      if (fechada && !fechada.ok) toast.error(fechada.erro);
      // Código do cliente no Consistem (para a implantação): não bloqueia a remessa se a consulta falhar.
      const conferidos = await conferirClientesErp(saida.flatMap((s) => (s.id ? [s.id] : [])));
      if (!conferidos.ok) toast.warning(`Clientes não conferidos no Consistem: ${conferidos.erro} Confira depois na remessa.`);
      else if (conferidos.naoCadastrados > 0) toast.warning(`${conferidos.naoCadastrados} ${conferidos.naoCadastrados === 1 ? "cliente não está cadastrado" : "clientes não estão cadastrados"} no Consistem: cadastrar antes de implantar.`);
      setProgresso("");
      setResultado(saida);
      const registradas = new Set(saida.filter((s) => s.id).map((s) => s.nota));
      setRemessa({
        id: rem.id, numero: rem.numero,
        itens: linhas.filter((l) => registradas.has(l.nota)).map((l) => ({ nota: l.nota, cliente: l.cliente, aceitaBoletoFactoring: l.aceita, parcelas: l.parcelas ?? [] })),
      });
      const falhas = saida.filter((s) => s.erros.length > 0).length;
      if (falhas === 0) {
        toast.success(`Remessa nº ${rem.numero} registrada. Agora abra o e-mail de aviso para Cuiabá.`);
        setItens([]);
        setPorNota({});
      } else toast.error(`${falhas} ${falhas === 1 ? "NF teve" : "NFs tiveram"} erro. Veja o resumo.`);
    });
  }

  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Arquivos</CardTitle>
          <CardDescription>
            Escolha de uma vez a nota fatura, o demonstrativo e o comodato de cada NF (PDF). O nome &quot;NF 02351 - CLIENTE.pdf&quot;
            já preenche a NF e o cliente, e a nota fatura é lida automaticamente (vencimento, valor, obra e período). Confira o que foi lido; o que não for reconhecido, informe abaixo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input ref={entrada} type="file" multiple accept="application/pdf,image/*" onChange={(e) => escolher(e.target.files)}
            className="block text-[13px] file:mr-3 file:rounded-[3px] file:border file:border-input file:bg-white file:px-3 file:py-1.5" />
        </CardContent>
      </Card>

      {itens.length > 0 && (
        <Card size="sm">
          <CardHeader><CardTitle>Conferir cada arquivo <span className="font-normal text-muted-foreground">({itens.length})</span></CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Arquivo</TableHead><TableHead className="w-32">NF</TableHead><TableHead className="w-48">Tipo</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
              <TableBody>
                {itens.map((i) => (
                  <TableRow key={i.indice}>
                    <TableCell className="max-w-md truncate" title={i.nome}>
                      {i.nome}
                      {i.arquivo.size > LIMITE_BYTES && <Badge variant="destructive" className="ml-2">acima de 9 MB</Badge>}
                    </TableCell>
                    <TableCell>
                      <Input value={i.notaTexto} inputMode="numeric" aria-label={`NF de ${i.nome}`} aria-invalid={!i.nota}
                        onChange={(e) => alterar(i.indice, { notaTexto: e.target.value, nota: normalizarNota(e.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <select className={SELECAO} value={i.tipo ?? ""} aria-label={`Tipo de ${i.nome}`}
                        onChange={(e) => alterar(i.indice, { tipo: (e.target.value || null) as TipoDocumentoKit | null })}>
                        <option value="">Escolha…</option>
                        {TIPOS_DOCUMENTO_KIT.map((t) => <option key={t} value={t}>{ROTULO_DOCUMENTO_KIT[t]}</option>)}
                      </select>
                    </TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => remover(i.indice)}>Tirar</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {linhas.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Faturas a registrar <span className="font-normal text-muted-foreground">({linhas.length})</span></CardTitle>
            <CardDescription>
              &quot;Aceita boleto de factoring&quot; vem desmarcado para os clientes da lista da AKF (Configurações); ajuste se for o caso.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow><TableHead className="w-24">NF</TableHead><TableHead>Cliente</TableHead><TableHead>Obra</TableHead><TableHead className="w-72">Vencimento e valor</TableHead><TableHead className="w-28">Aceita boleto de factoring</TableHead><TableHead>Documentos</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={l.nota}>
                    <TableCell className="tabular-nums">{l.nota}</TableCell>
                    <TableCell><Input value={l.cliente} aria-label={`Cliente da NF ${l.nota}`} aria-invalid={l.cliente === ""} onChange={(e) => alterarNota(l.nota, { cliente: e.target.value })} /></TableCell>
                    <TableCell><Input value={l.obra} aria-label={`Obra da NF ${l.nota}`} placeholder="opcional" onChange={(e) => alterarNota(l.nota, { obra: e.target.value })} /></TableCell>
                    <TableCell>
                      {l.lendo ? <span className="text-[13px] text-muted-foreground">lendo a nota…</span> : (
                        <>
                          <EditorParcelas nota={l.nota} parcelas={l.parcelasTexto} invalido={l.parcelas === null} onChange={(parcelas) => alterarNota(l.nota, { parcelas })} />
                          {l.lidoDoPdf && (
                            <div className="text-[12px] text-muted-foreground">
                              lido da nota{l.emissao ? ` · emissão ${l.emissao.split("-").reverse().join("/")}` : ""}
                              {l.clienteDocumento ? ` · ${l.clienteDocumento}` : ""}
                              {l.periodoInicio && l.periodoFim ? ` · período ${l.periodoInicio.split("-").reverse().join("/")} a ${l.periodoFim.split("-").reverse().join("/")}` : ""}
                            </div>
                          )}
                          {l.avisosLeitura.map((a) => <div key={a} className="text-[12px] text-destructive">{a}</div>)}
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      <input type="checkbox" className="size-4" checked={l.aceita} aria-label={`NF ${l.nota} aceita boleto de factoring`}
                        onChange={(e) => alterarNota(l.nota, { aceita: e.target.checked })} />
                    </TableCell>
                    <TableCell className="text-[13px]">
                      {l.itens.length} {l.itens.length === 1 ? "arquivo" : "arquivos"}
                      {l.faltam.length > 0 && <span className="text-muted-foreground"> · sem {l.faltam.join(", ")}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={pendente || bloqueio !== null} onClick={registrar}>
                {pendente ? `Enviando ${progresso}` : `Registrar remessa com ${linhas.length} ${linhas.length === 1 ? "fatura" : "faturas"}`}
              </Button>
              {bloqueio && <span className="text-[13px] text-muted-foreground">{bloqueio}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {resultado && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>{remessa ? <Link className="underline" href={`${ROTA_FILIAL}/remessas/${remessa.numero}`}>Remessa nº {remessa.numero}</Link> : "Resumo do envio"}</CardTitle>
            <CardDescription>Os arquivos ficam no Neo Admin. Abra o e-mail de aviso, confira e envie: ele leva só a relação e o link da remessa.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {remessa && remessa.itens.length > 0 && <BotaoAvisoCuiaba remessaId={remessa.id} numero={remessa.numero} data={hoje} itens={remessa.itens} para={para} />}
            <ul className="space-y-1 text-[13px]">
              {resultado.map((r) => (
                <li key={r.nota}>
                  {r.id ? <Link className="underline" href={`${ROTA_FILIAL}/${r.id}`}>NF {r.nota}</Link> : <>NF {r.nota}</>}
                  {" — "}{r.enviados} {r.enviados === 1 ? "arquivo anexado" : "arquivos anexados"}
                  {r.erros.map((e) => <div key={e} className="text-destructive">{e}</div>)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Vencimento e valor de cada parcela da NF (como na nota). Linha vazia é ignorada. */
function EditorParcelas({ nota, parcelas, invalido, onChange }: { nota: string; parcelas: ParcelaTexto[]; invalido: boolean; onChange: (p: ParcelaTexto[]) => void }) {
  const mudar = (i: number, m: Partial<ParcelaTexto>) => onChange(parcelas.map((p, j) => (j === i ? { ...p, ...m } : p)));
  return (
    <div className="space-y-1">
      {parcelas.map((p, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input type="date" className="w-36" value={p.vencimento} aria-label={`Vencimento ${i + 1} da NF ${nota}`} aria-invalid={invalido}
            onChange={(e) => mudar(i, { vencimento: e.target.value })} />
          <Input className="w-28" inputMode="decimal" placeholder="0,00" value={p.valorTexto} aria-label={`Valor ${i + 1} da NF ${nota}`} aria-invalid={invalido}
            onChange={(e) => mudar(i, { valorTexto: e.target.value })} />
          {parcelas.length > 1 && <Button size="sm" variant="ghost" aria-label="Tirar parcela" onClick={() => onChange(parcelas.filter((_, j) => j !== i))}>×</Button>}
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...parcelas, { vencimento: "", valorTexto: "" }])}>+ parcela</Button>
    </div>
  );
}
