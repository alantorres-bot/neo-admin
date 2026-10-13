"use client";

// Lançar no Consistem a compra sem título (botão "Lançar" na aba A lançar) e a lista das compras lançadas no mês.
// Regras 37 a 43 de docs/modulos/financeiro-cartao.md.
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ItemALancar } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { CAMPOS_COMPRA, montarTitulosCompra, ROTULO_CAMPO_COMPRA, type CampoCompra, type CamposCompra } from "@/lib/modulos/financeiro/cartao/lancamento-compras";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { buscarFornecedores, lancarCompra, reenviarLote } from "../acoes";
import type { LancamentoErpLinha, PropostaCompra, QuadroCompras } from "../dados";
import { BotaoResolver } from "./encargos";
import { BotaoCadastrarFornecedor } from "../fornecedores";

const ORIGEM = { estabelecimento: "do estabelecimento", cartao: "do cartão", escolher: "escolher" } as const;
const centavos = (v: number | string) => Math.round(Number(v) * 100);

function SeletorFornecedor({ empresaId, cod, nome, aoEscolher }: { empresaId: string; cod?: number; nome: string | null; aoEscolher: (cod: number, nome: string) => void }) {
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<{ cod: number; nome: string }[]>([]);
  const [buscando, iniciar] = useTransition();
  function buscar() {
    iniciar(async () => setLista(await buscarFornecedores({ empresaId, termo })));
  }
  return (
    <div className="space-y-1">
      <p className="text-sm">{cod ? <><strong>{cod}</strong>{nome ? ` · ${nome}` : ""}</> : <span className="font-medium text-amber-800">Escolha o fornecedor</span>}</p>
      <div className="flex gap-2">
        <Input value={termo} onChange={(e) => setTermo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(); } }}
          placeholder="Buscar por nome ou código" autoComplete="off" maxLength={60} />
        <Button type="button" variant="outline" onClick={buscar} disabled={buscando || termo.trim().length < 2}>{buscando ? "Buscando…" : "Buscar"}</Button>
      </div>
      {lista.length > 0 && (
        <ul className="max-h-36 overflow-y-auto rounded-[3px] border border-grade text-sm">
          {lista.map((f) => (
            <li key={f.cod}>
              <button type="button" className="w-full px-2 py-1 text-left hover:bg-cabecalho" onClick={() => { aoEscolher(f.cod, f.nome); setLista([]); setTermo(""); }}>
                {f.cod} · {f.nome}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Fornecedor novo cadastrado no Consistem aparece depois de “Atualizar do Consistem” em Contas a pagar.</p>
    </div>
  );
}

export function DialogoLancarCompra({ faturaId, item, proposta, compras }: { faturaId: string; item: ItemALancar; proposta: PropostaCompra; compras: QuadroCompras }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [campos, setCampos] = useState<CamposCompra>(proposta.sugestao.campos);
  const [textos, setTextos] = useState<Record<string, string>>(() => Object.fromEntries(CAMPOS_COMPRA.map((k) => [k, String(proposta.sugestao.campos[k] ?? "")])));
  const [fornecedorNome, setFornecedorNome] = useState<string | null>(proposta.fornecedorNome);
  const [lembrar, setLembrar] = useState(proposta.sugestao.padrao === null);
  const [padrao, setPadrao] = useState(proposta.padraoLembrar);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const titulos = useMemo(() => (compras.competencia
    ? montarTitulosCompra({ linha: item.linha, cartao: compras.cartao, campos, vencimentoFatura: compras.vencimentoFatura, competencia: compras.competencia })
    : { ok: false as const, erro: "Fatura sem mês do cartão." }), [campos, compras, item.linha]);
  const mudar = (k: CampoCompra, bruto: string) => {
    const v = bruto.replace(/\D/g, "").slice(0, 9);
    setTextos((t) => ({ ...t, [k]: v }));
    setCampos((c) => {
      const n = { ...c };
      if (v !== "" && Number(v) > 0) n[k] = Number(v); else delete n[k];
      return n;
    });
  };
  const dica = (k: CampoCompra) => (campos[k] === undefined ? "escolher" : proposta.sugestao.campos[k] === campos[k] ? ORIGEM[proposta.sugestao.origem[k]] : "informado");
  function confirmar() {
    iniciar(async () => {
      const r = await lancarCompra({ faturaId, linhaId: item.linha.id, campos, lembrar: lembrar ? { padrao } : null });
      if (r.ok) { toast.success(r.aviso); setAberto(false); router.refresh(); } else { setErro(r.erro); router.refresh(); }
    });
  }
  const n = titulos.ok ? titulos.titulos.length : 0;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setErro(undefined); setAberto(true); }}>Lançar</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v && !pendente) setAberto(false); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Lançar a compra no Consistem</DialogTitle>
              <DialogDescription>
                {formatarData(item.linha.dataCompra)} · {item.linha.descricao} · {formatarMoeda(item.linha.valorCentavos)}
                {item.linha.parcelaTotal ? ` · parcela ${item.linha.parcelaNum}/${item.linha.parcelaTotal}` : ""}.
                {proposta.sugestao.padrao ? ` Sugestão do estabelecimento ${proposta.sugestao.padrao}.` : " Estabelecimento sem sugestão: escolha os códigos."}
              </DialogDescription>
            </DialogHeader>
            {item.natureza === "Parcela não desdobrada" && (
              <p className="rounded-[3px] border border-amber-300 bg-amber-50 p-2 text-sm">Parcela sem título: confira no Consistem se a compra não foi lançada pelo total antes de lançar as parcelas restantes.</p>
            )}
            <SeletorFornecedor empresaId={compras.empresaId} cod={campos.codFornecedor} nome={fornecedorNome}
              aoEscolher={(cod, nome) => { setCampos((c) => ({ ...c, codFornecedor: cod })); setFornecedorNome(nome); }} />
            <div className="-mt-2 flex justify-end">
              <BotaoCadastrarFornecedor empresaId={compras.empresaId} nomeInicial={proposta.sugestao.padrao ?? proposta.padraoLembrar} cadastro={compras.cadastro}
                aoCadastrar={(cod, nome) => { setCampos((c) => ({ ...c, codFornecedor: cod })); setFornecedorNome(nome); }} />
            </div>
            <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
              {CAMPOS_COMPRA.filter((k) => k !== "codFornecedor").map((k) => (
                <label key={k} className="space-y-1 text-sm">
                  <span className="block font-medium">{ROTULO_CAMPO_COMPRA[k]}</span>
                  <Input value={textos[k]} onChange={(e) => mudar(k, e.target.value)} inputMode="numeric" autoComplete="off" maxLength={9} />
                  <span className={`block text-xs ${campos[k] === undefined ? "font-medium text-amber-800" : "text-muted-foreground"}`}>{dica(k)}</span>
                </label>
              ))}
            </div>
            {titulos.ok ? (
              <table className="w-full text-sm [&_td]:px-2 [&_td]:py-0.5 [&_th]:px-2">
                <thead><tr className="text-left text-xs text-muted-foreground"><th>Parcela</th><th>Vencimento</th><th>Documento</th><th className="text-right">Valor</th><th>Complemento</th></tr></thead>
                <tbody>
                  {titulos.titulos.map((t) => (
                    <tr key={t.parcela}>
                      <td className="tabular-nums">{t.parcela}/{t.parcelas}</td><td className="tabular-nums">{formatarData(t.vencimento)}</td>
                      <td className="tabular-nums">{t.payload.codDocumento}</td><td className="text-right tabular-nums">{formatarMoeda(Math.round(t.payload.valorDocumento * 100))}</td>
                      <td className="font-mono text-xs">{t.payload.complementoHistorico}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-sm font-medium text-amber-800">{titulos.erro}</p>}
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} className="size-4" />
              Lembrar para as próximas compras de
              <Input value={padrao} onChange={(e) => setPadrao(e.target.value)} className="h-7 w-48" maxLength={60} disabled={!lembrar} autoComplete="off" />
            </label>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
              <Button onClick={confirmar} disabled={pendente || !titulos.ok || (lembrar && padrao.trim().length < 2)}>
                {pendente ? "Lançando…" : n > 1 ? `Lançar ${n} títulos` : "Lançar 1 título"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

const SELO: Record<LancamentoErpLinha["situacao"], { rotulo: string; classe: string }> = {
  lancado: { rotulo: "Lançado", classe: "border-emerald-400 text-emerald-800" },
  enviando: { rotulo: "Sem resposta", classe: "border-amber-400 text-amber-800" },
  reservado: { rotulo: "Não enviado", classe: "border-amber-400 text-amber-800" },
  erro: { rotulo: "Não lançado", classe: "border-red-300 text-red-800" },
};

export function ListaComprasLancadas({ compras, podeOperar }: { compras: QuadroCompras; podeOperar: boolean }) {
  const lotes = useMemo(() => {
    const m = new Map<string, LancamentoErpLinha[]>();
    for (const l of compras.lancamentos) m.set(l.lote, [...(m.get(l.lote) ?? []), l]);
    return [...m.values()].map((ls) => ls.sort((a, b) => (a.parcela ?? 0) - (b.parcela ?? 0)));
  }, [compras.lancamentos]);
  if (lotes.length === 0) return null;
  const ativas = new Set(compras.lancamentos.filter((l) => l.situacao !== "erro").map((l) => `${l.linha_origem}:${l.parcela}`));
  const pode = podeOperar && compras.mesAberto;
  return (
    <section className="space-y-2 rounded-[3px] border border-grade bg-card p-3">
      <h3 className="text-sm font-bold">Compras lançadas no Consistem pelo painel</h3>
      <table className="w-full text-sm [&_td]:px-2 [&_td]:py-1 [&_th]:px-2">
        <thead><tr className="text-left text-xs text-muted-foreground"><th>Compra</th><th>Parcela</th><th>Vencimento</th><th className="text-right">Valor</th><th>Situação</th><th>Quem · quando</th><th /></tr></thead>
        <tbody>
          {lotes.map((ls) => {
            const faltando = ls.some((l) => l.situacao === "erro" && !ativas.has(`${l.linha_origem}:${l.parcela}`));
            return (
              <Fragment key={ls[0].lote}>
                {ls.map((l, i) => (
                  <tr key={l.id} className="border-t border-grade/60 align-top">
                    <td>{i === 0 ? l.linha_descricao ?? "" : ""}</td>
                    <td className="tabular-nums">{l.parcela}/{l.parcelas}</td>
                    <td className="tabular-nums">{formatarData(l.vencimento)}</td>
                    <td className="text-right tabular-nums">{formatarMoeda(centavos(l.valor))}</td>
                    <td>
                      <Badge variant="outline" className={SELO[l.situacao].classe}>{SELO[l.situacao].rotulo}{l.cod_lancamento_erp ? ` ${l.cod_lancamento_erp}` : ""}</Badge>
                      {l.erro && <p className="text-xs text-muted-foreground">{l.erro}</p>}
                      {l.motivo_resolucao && <p className="text-xs text-muted-foreground">Conferido: {l.motivo_resolucao}</p>}
                    </td>
                    <td className="text-xs text-muted-foreground">{l.criado_por_nome ?? ""} · {new Date(l.criado_em).toLocaleDateString("pt-BR", { timeZone: "America/Cuiaba" })}</td>
                    <td className="space-y-1 text-right">
                      {pode && (l.situacao === "enviando" || l.situacao === "reservado") && <BotaoResolver l={l} />}
                      {pode && i === ls.length - 1 && faltando && <BotaoReenviar lote={l.lote} />}
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function BotaoReenviar({ lote }: { lote: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pendente} onClick={() => iniciar(async () => {
      const r = await reenviarLote({ lote });
      if (r.ok) toast.success(r.aviso); else toast.error(r.erro);
      router.refresh();
    })}>{pendente ? "Reenviando…" : "Reenviar o que faltou"}</Button>
  );
}
