"use client";

// Decisões por item da conciliação (Fase 2b): o diálogo "Decidir" de uma linha a lançar ou de um título sem linha, e a lista das
// decisões (ativas e desfeitas) com "Desfazer". Quem valida as regras é o banco (crt_registrar_decisao); aqui só a apresentação.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { chaveTitulo, ROTULO_DECISAO, type DecisaoItem, type ItemALancar, type TipoDecisao, type TituloPagar } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { valorCompativel } from "@/lib/modulos/financeiro/cartao/roteiro";
import { normalizar } from "@/lib/modulos/financeiro/cartao/texto";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { desfazerDecisao, registrarDecisao } from "../acoes";
import type { DecisaoLinha } from "../dados";

export type Alvo = { tipo: "linha"; item: ItemALancar } | { tipo: "titulo"; titulo: TituloPagar };
export type Candidatos = {
  linhas: ItemALancar[];
  titulos: TituloPagar[];
  /** Chaves dos títulos que citam OUTRO cartão (aba "Outros títulos de cartão"); os demais são deste cartão (sem linha). */
  deOutroCartao?: string[];
};

type FiltroTitulos = "todos" | "parecido" | "deste" | "outros";
const ROTULO_FILTRO: Record<FiltroTitulos, string> = { todos: "Todos", parecido: "Valor parecido com a linha", deste: "Deste cartão", outros: "Outros cartões" };

/** Valor parecido: o da linha (até 5 centavos), a compra inteira (N × parcela) ou até 10% de diferença. */
const parecido = (linha: ItemALancar["linha"], t: TituloPagar) =>
  valorCompativel(linha, t) || Math.abs(t.valorCentavos - linha.valorCentavos) <= Math.abs(linha.valorCentavos) * 0.1;

const OPCOES: Record<Alvo["tipo"], { tipo: TipoDecisao; rotulo: string; ajuda: string }[]> = {
  linha: [
    { tipo: "justificar", rotulo: "Justificar (não gera título)", ajuda: "A linha não vai virar título no Consistem (ex.: estorno já abatido, crédito usado em outro título). Deixa de ser pendente; o valor continua justificando a diferença." },
    { tipo: "casar", rotulo: "Casar com título(s)", ajuda: "Liga esta linha (e outras, se preciso) a títulos que o cruzamento não achou pelo valor (ex.: título lançado pelo total e a fatura cobra a parcela; cartão trocado). A diferença vira ajuste justificado." },
    { tipo: "compensar", rotulo: "Compensar com outra linha", ajuda: "Linhas da fatura que se anulam (somam zero), como a anuidade e o crédito da anuidade." },
    { tipo: "classificar", rotulo: "Classificar", ajuda: "Troca a categoria e a conta de fluxo sugeridas. Pode gravar no dicionário para as próximas faturas." },
    { tipo: "observar", rotulo: "Observação", ajuda: "Anotação livre; não muda o cálculo." },
  ],
  titulo: [
    { tipo: "justificar", rotulo: "Justificar (fica sem linha)", ajuda: "O título não tem linha nesta fatura por um motivo conhecido (ex.: compra da próxima fatura lançada antes)." },
    { tipo: "casar", rotulo: "Casar com linha(s) da fatura", ajuda: "Liga este título às linhas da fatura que ele paga." },
    { tipo: "observar", rotulo: "Observação", ajuda: "Anotação livre; não muda o cálculo." },
  ],
};

export function DialogoDecidir({ faturaId, alvo, candidatos }: { faturaId: string; alvo: Alvo; candidatos: Candidatos }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<TipoDecisao>("justificar");
  const [motivo, setMotivo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [conta, setConta] = useState("");
  const [lembrar, setLembrar] = useState(false);
  const [padrao, setPadrao] = useState("");
  const [linhasMarcadas, setLinhasMarcadas] = useState<Set<string>>(new Set());
  const [titulosMarcados, setTitulosMarcados] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState<FiltroTitulos>("todos");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  const descricao = alvo.tipo === "linha" ? `${alvo.item.linha.descricao} · ${formatarMoeda(alvo.item.linha.valorCentavos)}` : `Título ${alvo.titulo.numeroTitulo} · ${alvo.titulo.fornecedor} · ${formatarMoeda(alvo.titulo.valorCentavos)}`;
  const opcao = OPCOES[alvo.tipo].find((o) => o.tipo === tipo)!;
  const outrasLinhas = candidatos.linhas.filter((l) => alvo.tipo !== "linha" || l.linha.id !== alvo.item.linha.id)
    .sort((a, b) => a.linha.valorCentavos - b.linha.valorCentavos);
  const deOutro = useMemo(() => new Set(candidatos.deOutroCartao ?? []), [candidatos.deOutroCartao]);
  // Títulos para casar: ordenados por valor; o filtro rápido restringe (o funil e a busca da grade continuam valendo).
  const titulosVisiveis = useMemo(() => {
    const todos = [...candidatos.titulos].sort((a, b) => a.valorCentavos - b.valorCentavos);
    if (filtro === "todos" || alvo.tipo !== "linha") return todos;
    return todos.filter((t) => filtro === "parecido" ? parecido(alvo.item.linha, t) : filtro === "outros" ? deOutro.has(chaveTitulo(t)) : !deOutro.has(chaveTitulo(t)));
  }, [candidatos.titulos, filtro, alvo, deOutro]);

  const linhasEscolhidas = useMemo(() => {
    const ids = new Set(linhasMarcadas);
    if (alvo.tipo === "linha") ids.add(alvo.item.linha.id);
    return [...ids];
  }, [linhasMarcadas, alvo]);
  const titulosEscolhidos = useMemo(() => {
    const ids = new Set(titulosMarcados);
    if (alvo.tipo === "titulo") ids.add(chaveTitulo(alvo.titulo));
    return [...ids];
  }, [titulosMarcados, alvo]);
  const somaLinhas = linhasEscolhidas.reduce((s, id) => s + (candidatos.linhas.find((l) => l.linha.id === id)?.linha.valorCentavos ?? 0), 0);
  const somaTitulos = titulosEscolhidos.reduce((s, k) => s + (candidatos.titulos.find((t) => chaveTitulo(t) === k)?.valorCentavos ?? 0), 0);

  function abrir() {
    setTipo(OPCOES[alvo.tipo][0].tipo); setMotivo(""); setCategoria(alvo.tipo === "linha" ? alvo.item.categoria.replace("[CONFERIR]", "") : "");
    setConta(alvo.tipo === "linha" ? alvo.item.contaFluxo.replace("[CONFERIR]", "") : ""); setLembrar(false);
    setPadrao(alvo.tipo === "linha" ? normalizar(alvo.item.linha.descricao).split(" ").slice(0, 2).join(" ") : "");
    setLinhasMarcadas(new Set()); setTitulosMarcados(new Set()); setErro(undefined); setAberto(true);
    // Abre já no "valor parecido" quando há algum título assim.
    setFiltro(alvo.tipo === "linha" && candidatos.titulos.some((t) => parecido(alvo.item.linha, t)) ? "parecido" : "todos");
  }
  const alternar = (conj: Set<string>, id: string, definir: (s: Set<string>) => void) => {
    const novo = new Set(conj);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    definir(novo);
  };

  function salvar() {
    const base = { faturaId, tipo, motivo: motivo.trim() || null };
    const alvoLinhas = alvo.tipo === "linha" ? [alvo.item.linha.id] : [];
    const alvoTitulos = alvo.tipo === "titulo" ? [chaveTitulo(alvo.titulo)] : [];
    const entrada =
      tipo === "casar" ? { ...base, linhas: linhasEscolhidas, titulos: titulosEscolhidos }
      : tipo === "compensar" ? { ...base, linhas: linhasEscolhidas, titulos: [] }
      : tipo === "classificar" ? { ...base, linhas: alvoLinhas, titulos: [], categoria: categoria.trim() || null, contaFluxo: conta.trim() || null, lembrar: lembrar ? { padrao } : null }
      : { ...base, linhas: alvoLinhas, titulos: alvoTitulos };
    iniciar(async () => {
      const r = await registrarDecisao(entrada);
      if (r.ok) { toast.success(r.aviso); setAberto(false); router.refresh(); } else setErro(r.erro);
    });
  }

  return (
    <>
      <Button size="xs" variant="outline" onClick={abrir}>Decidir</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Decidir sobre o item</DialogTitle>
              <DialogDescription>{descricao}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 text-[13px]">
              <div className="flex flex-wrap gap-1">
                {OPCOES[alvo.tipo].map((o) => (
                  <Button key={o.tipo} size="sm" variant={tipo === o.tipo ? "default" : "outline"} onClick={() => { setTipo(o.tipo); setErro(undefined); }}>{o.rotulo}</Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{opcao.ajuda}</p>

              {tipo === "classificar" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1"><span className="font-medium">Categoria</span><Input value={categoria} onChange={(e) => setCategoria(e.target.value)} maxLength={60} /></label>
                  <label className="grid gap-1"><span className="font-medium">Conta de fluxo (Descrição Conta)</span><Input value={conta} onChange={(e) => setConta(e.target.value)} maxLength={60} /></label>
                  <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} className="size-4" /> Gravar no dicionário para as próximas faturas, pelo trecho</label>
                  {lembrar && <Input value={padrao} onChange={(e) => setPadrao(e.target.value)} maxLength={60} className="sm:col-span-2" aria-label="Trecho do estabelecimento" />}
                </div>
              )}

              {(tipo === "casar" || tipo === "compensar") && (
                <div className="space-y-2">
                  {(tipo === "compensar" || alvo.tipo === "titulo" || outrasLinhas.length > 0) && (
                    <Escolha titulo={tipo === "compensar" || alvo.tipo === "linha" ? "Outras linhas da fatura (marque as que entram juntas)" : "Linhas da fatura"}>
                      {outrasLinhas.length === 0 ? <p className="text-muted-foreground">Nenhuma outra linha a lançar.</p> : (
                        <Table>
                          <TableHeader><TableRow><TableHead className="w-8"> </TableHead><TableHead>Data</TableHead><TableHead>Descrição na fatura</TableHead><TableHead>Natureza</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {outrasLinhas.map((l) => (
                              <TableRow key={l.linha.id} className={linhasMarcadas.has(l.linha.id) ? "bg-sky-50" : ""}>
                                <TableCell><input type="checkbox" className="size-4" aria-label={`Marcar ${l.linha.descricao}`} checked={linhasMarcadas.has(l.linha.id)} onChange={() => alternar(linhasMarcadas, l.linha.id, setLinhasMarcadas)} /></TableCell>
                                <TableCell className="tabular-nums">{formatarData(l.linha.dataCompra)}</TableCell>
                                <TableCell>{l.linha.descricao}{l.justificativa ? " (justificada)" : ""}</TableCell>
                                <TableCell className="text-xs">{l.natureza}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatarMoeda(l.linha.valorCentavos)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </Escolha>
                  )}
                  {tipo === "casar" && alvo.tipo === "linha" && (
                    <Escolha titulo="Títulos do Consistem na janela do vencimento (sem linha, ou de outro cartão)" alto>
                      <div className="flex flex-wrap items-center gap-1 pb-1">
                        {(Object.keys(ROTULO_FILTRO) as FiltroTitulos[]).map((f) => (
                          <Button key={f} type="button" size="xs" variant={filtro === f ? "default" : "outline"} onClick={() => setFiltro(f)}>{ROTULO_FILTRO[f]}</Button>
                        ))}
                        <span className="ml-auto text-xs text-muted-foreground">{titulosVisiveis.length} de {candidatos.titulos.length} · ordenados por valor (clique no título da coluna para mudar)</span>
                      </div>
                      {titulosVisiveis.length === 0 ? (
                        <p className="text-muted-foreground">{candidatos.titulos.length === 0 ? "Nenhum título sem linha na janela. Lance o título no Consistem e atualize a tela." : "Nenhum título com este filtro."}</p>
                      ) : (
                        <Table>
                          <TableHeader><TableRow><TableHead className="w-8"> </TableHead><TableHead>Nº do título</TableHead><TableHead>Fornecedor</TableHead><TableHead>Vencimento</TableHead><TableHead>Complemento</TableHead><TableHead>Cartão</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {titulosVisiveis.map((t) => {
                              const k = chaveTitulo(t);
                              return (
                                <TableRow key={k} className={titulosMarcados.has(k) ? "bg-sky-50" : ""}>
                                  <TableCell><input type="checkbox" className="size-4" aria-label={`Marcar o título ${t.numeroTitulo}`} checked={titulosMarcados.has(k)} onChange={() => alternar(titulosMarcados, k, setTitulosMarcados)} /></TableCell>
                                  <TableCell className="tabular-nums">{t.numeroTitulo}</TableCell>
                                  <TableCell className="text-xs">{t.fornecedor}</TableCell>
                                  <TableCell className="tabular-nums">{formatarData(t.vencimento)}</TableCell>
                                  <TableCell className="text-xs">{t.complemento}</TableCell>
                                  <TableCell className="text-xs">{deOutro.has(k) ? "Outro cartão" : "Deste cartão"}</TableCell>
                                  <TableCell className="text-right tabular-nums">{formatarMoeda(t.valorCentavos)}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      )}
                    </Escolha>
                  )}
                  <p className="text-xs">
                    Linhas: <strong className="tabular-nums">{formatarMoeda(somaLinhas)}</strong>
                    {tipo === "casar" && <> · títulos: <strong className="tabular-nums">{formatarMoeda(somaTitulos)}</strong> · diferença (vira ajuste justificado): <strong className="tabular-nums">{formatarMoeda(somaLinhas - somaTitulos)}</strong></>}
                    {tipo === "compensar" && somaLinhas !== 0 && <span className="text-destructive"> · precisa somar zero</span>}
                  </p>
                </div>
              )}

              <label className="grid gap-1">
                <span className="font-medium">{tipo === "observar" ? "Observação" : `Motivo${tipo === "classificar" ? " (opcional)" : ""}`}</span>
                <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} placeholder={tipo === "justificar" ? "Ex.: crédito abatido no título da anuidade" : ""} />
              </label>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button onClick={salvar} disabled={pendente}>{pendente ? "Gravando…" : "Registrar decisão"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function Escolha({ titulo, children, alto = false }: { titulo: string; children: React.ReactNode; alto?: boolean }) {
  return (
    <fieldset className={`${alto ? "max-h-[50svh]" : "max-h-56"} space-y-1 overflow-y-auto rounded-[3px] border border-grade p-2`}>
      <legend className="px-1 text-xs font-medium">{titulo}</legend>
      {children}
    </fieldset>
  );
}

/** Selo da decisão ativa no item (justificada, classificada, observação). */
export function SeloDecisao({ justificativa, classificacao, observacoes }: { justificativa?: DecisaoItem; classificacao?: DecisaoItem; observacoes?: DecisaoItem[] }) {
  return (
    <span className="flex flex-col gap-0.5">
      {justificativa && <Badge variant="outline" className="border-emerald-400 text-emerald-800" title={`${justificativa.motivo ?? ""} — ${justificativa.autor ?? ""}`}>Justificada: {justificativa.motivo}</Badge>}
      {classificacao && <span className="text-[11px] text-muted-foreground">classificada por {classificacao.autor ?? "?"}</span>}
      {observacoes?.map((o) => <span key={o.id} className="text-[11px] italic text-muted-foreground">“{o.motivo}” — {o.autor ?? "?"}</span>)}
    </span>
  );
}

/** Aba Decisões: todas as decisões da fatura, com Desfazer (motivo) nas ativas. */
export function ListaDecisoes({ decisoes, rotuloLinha, rotuloTitulo, podeDesfazer }: {
  decisoes: DecisaoLinha[]; rotuloLinha: Record<string, string>; rotuloTitulo: Record<string, string>; podeDesfazer: boolean;
}) {
  if (decisoes.length === 0) return <p className="rounded-[3px] border border-grade bg-cabecalho p-3 text-sm text-muted-foreground">Nenhuma decisão registrada nesta fatura.</p>;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Quando</TableHead><TableHead>Tipo</TableHead><TableHead>Itens</TableHead><TableHead>Motivo / detalhe</TableHead><TableHead>Por</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
      <TableBody>
        {[...decisoes].reverse().map((d) => (
          <TableRow key={d.id} className={d.desfeito_em ? "text-muted-foreground" : ""}>
            <TableCell className="tabular-nums">{new Date(d.criado_em).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" })}</TableCell>
            <TableCell>{ROTULO_DECISAO[d.tipo]}</TableCell>
            <TableCell className="text-xs">
              {d.linhas.map((id) => <span key={id} className="block">{rotuloLinha[id] ?? "linha"}</span>)}
              {d.titulos.map((k) => <span key={k} className="block">{rotuloTitulo[k] ?? `título ${k}`}</span>)}
            </TableCell>
            <TableCell className="text-xs">{[d.categoria, d.conta_fluxo].filter(Boolean).join(" · ")}{d.categoria || d.conta_fluxo ? " " : ""}{d.motivo}</TableCell>
            <TableCell>{d.criado_por_nome ?? ""}</TableCell>
            <TableCell>
              {d.desfeito_em
                ? <span className="text-xs">Desfeita por {d.desfeito_por_nome ?? "?"}: {d.motivo_desfazer}</span>
                : podeDesfazer ? <BotaoDesfazer id={d.id} /> : <Badge variant="outline">Ativa</Badge>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BotaoDesfazer({ id }: { id: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pendente, iniciar] = useTransition();
  if (!aberto) return <Button size="xs" variant="outline" onClick={() => { setMotivo(""); setAberto(true); }}>Desfazer</Button>;
  return (
    <span className="flex items-center gap-1">
      <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" className="h-7 w-40" autoFocus />
      <Button size="xs" disabled={pendente || motivo.trim().length < 3} onClick={() => iniciar(async () => {
        const r = await desfazerDecisao({ id, motivo });
        if (r.ok) { toast.success(r.aviso); setAberto(false); router.refresh(); } else toast.error(r.erro);
      })}>OK</Button>
      <Button size="xs" variant="ghost" onClick={() => setAberto(false)}>×</Button>
    </span>
  );
}
