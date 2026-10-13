"use client";

// Lançar várias linhas da fatura como um único título (agrupado). Regra 52 de docs/modulos/financeiro-cartao.md.
// Barra acima da tabela "A lançar": atalhos "Agrupar: <fornecedor>" e o botão "Lançar agrupado" para as linhas marcadas.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ItemALancar } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { aVista, gruposSugeridos, montarTituloAgrupado, sugestaoDoGrupo, type ItemGrupo } from "@/lib/modulos/financeiro/cartao/lancamento-agrupado";
import { CAMPOS_COMPRA, conferirContas, ROTULO_CAMPO_COMPRA, type CampoCompra, type CamposCompra } from "@/lib/modulos/financeiro/cartao/lancamento-compras";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { lancarAgrupado } from "../acoes";
import type { QuadroCompras } from "../dados";
import { BotaoCadastrarFornecedor } from "../fornecedores";
import { SeletorContaFluxo } from "../listas";
import { SeletorFornecedor } from "./compras";

/** Linhas que podem ir para um agrupado: com proposta de compra e à vista. */
export function itensAgrupaveis(aLancar: readonly ItemALancar[], compras: QuadroCompras): ItemGrupo[] {
  return aLancar.filter((a) => compras.propostas[a.linha.id] && aVista(a.linha))
    .map((a) => ({ linha: a.linha, sugestao: compras.propostas[a.linha.id].sugestao, fornecedorNome: compras.propostas[a.linha.id].fornecedorNome }));
}

export function BarraAgrupado({ faturaId, itens, compras, selecionadas, setSelecionadas }: {
  faturaId: string; itens: ItemGrupo[]; compras: QuadroCompras; selecionadas: Set<string>; setSelecionadas: (s: Set<string>) => void;
}) {
  const grupos = useMemo(() => gruposSugeridos(itens), [itens]);
  const escolhidos = itens.filter((i) => selecionadas.has(i.linha.id));
  const total = escolhidos.reduce((s, i) => s + i.linha.valorCentavos, 0);
  if (itens.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[3px] border border-grade bg-cabecalho p-2 text-sm">
      <span className="font-medium">Lançar agrupado:</span>
      {grupos.map((g) => (
        <Button key={g.chave} type="button" size="sm" variant="outline" onClick={() => setSelecionadas(new Set(g.linhaIds))}>
          Agrupar: {g.rotulo} — {g.linhaIds.length} linhas, {formatarMoeda(g.totalCentavos)}
        </Button>
      ))}
      <span className="ml-auto text-muted-foreground">{escolhidos.length} selecionada{escolhidos.length === 1 ? "" : "s"} · {formatarMoeda(total)}</span>
      {escolhidos.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => setSelecionadas(new Set())}>Limpar</Button>}
      <DialogoLancarAgrupado faturaId={faturaId} itens={escolhidos} compras={compras} aoConcluir={() => setSelecionadas(new Set())} />
    </div>
  );
}

function DialogoLancarAgrupado({ faturaId, itens, compras, aoConcluir }: { faturaId: string; itens: ItemGrupo[]; compras: QuadroCompras; aoConcluir: () => void }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [campos, setCampos] = useState<CamposCompra>({});
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [divergentes, setDivergentes] = useState<CampoCompra[]>([]);
  const [fornecedorNome, setFornecedorNome] = useState<string | null>(null);
  const [rotulo, setRotulo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  function abrir() {
    const s = sugestaoDoGrupo(itens);
    setCampos(s.campos);
    setTextos(Object.fromEntries(CAMPOS_COMPRA.map((k) => [k, String(s.campos[k] ?? "")])));
    setDivergentes(s.divergentes);
    const comFornecedor = itens.find((i) => i.sugestao.campos.codFornecedor === s.campos.codFornecedor && i.fornecedorNome);
    setFornecedorNome(comFornecedor?.fornecedorNome ?? null);
    setRotulo(comFornecedor?.fornecedorNome ?? itens.find((i) => i.sugestao.padrao)?.sugestao.padrao ?? "");
    setErro(undefined);
    setAberto(true);
  }
  const avisoContas = conferirContas(campos, compras.creditoPadrao);
  const titulo = montarTituloAgrupado({ linhas: itens.map((i) => i.linha), nomeCartao: compras.cartao.nome, campos, fechamento: compras.fechamento, vencimento: compras.vencimentoFatura, rotulo });
  const mudar = (k: CampoCompra, bruto: string) => {
    const v = bruto.replace(/\D/g, "").slice(0, 9);
    setTextos((t) => ({ ...t, [k]: v }));
    setCampos((c) => { const n = { ...c }; if (v !== "" && Number(v) > 0) n[k] = Number(v); else delete n[k]; return n; });
  };
  function confirmar() {
    iniciar(async () => {
      const r = await lancarAgrupado({ faturaId, linhas: itens.map((i) => i.linha.id), campos, rotulo });
      if (r.ok) { toast.success(r.aviso); setAberto(false); aoConcluir(); router.refresh(); } else { setErro(r.erro); router.refresh(); }
    });
  }
  return (
    <>
      <Button type="button" size="sm" onClick={abrir} disabled={itens.length < 2}>Lançar agrupado</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v && !pendente) setAberto(false); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Lançar {itens.length} linhas num único título</DialogTitle>
              <DialogDescription>Um título no Consistem com a soma, vencimento da fatura e emissão no fechamento. Depois de lançado, as linhas ficam casadas com ele.</DialogDescription>
            </DialogHeader>
            <ul className="max-h-40 overflow-y-auto rounded-[3px] border border-grade text-sm">
              {itens.map((i) => (
                <li key={i.linha.id} className="flex justify-between gap-3 border-b border-grade/60 px-2 py-0.5 last:border-0">
                  <span>{formatarData(i.linha.dataCompra)} · {i.linha.descricao}</span><span className="tabular-nums">{formatarMoeda(i.linha.valorCentavos)}</span>
                </li>
              ))}
            </ul>
            {divergentes.length > 0 && (
              <p className="rounded-[3px] border border-amber-300 bg-amber-50 p-2 text-sm">As linhas são de tipos diferentes ({divergentes.map((k) => ROTULO_CAMPO_COMPRA[k].toLowerCase()).join(", ")}): veio a sugestão da primeira. Confira antes de lançar.</p>
            )}
            <SeletorFornecedor empresaId={compras.empresaId} cod={campos.codFornecedor} nome={fornecedorNome}
              aoEscolher={(cod, nome) => { setCampos((c) => ({ ...c, codFornecedor: cod })); setTextos((t) => ({ ...t, codFornecedor: String(cod) })); setFornecedorNome(nome); }} />
            <div className="-mt-2 flex justify-end">
              <BotaoCadastrarFornecedor empresaId={compras.empresaId} nomeInicial={rotulo} cadastro={compras.cadastro} listas={compras.listas}
                fluxoInicial={{ grupo: campos.grupoContaFluxoCaixa, item: campos.contaFluxoCaixa }}
                aoCadastrar={(cod, nome) => { setCampos((c) => ({ ...c, codFornecedor: cod })); setFornecedorNome(nome); }} />
            </div>
            <label className="block space-y-1 text-sm">
              <span className="block font-medium">Conta de fluxo de caixa</span>
              <SeletorContaFluxo contas={compras.listas.contasFluxo} grupo={campos.grupoContaFluxoCaixa} item={campos.contaFluxoCaixa}
                aoMudar={(g, i) => setCampos((c) => {
                  const n = { ...c };
                  if (g && i) { n.grupoContaFluxoCaixa = g; n.contaFluxoCaixa = i; } else { delete n.grupoContaFluxoCaixa; delete n.contaFluxoCaixa; }
                  return n;
                })} />
            </label>
            <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
              {CAMPOS_COMPRA.filter((k) => k !== "codFornecedor" && k !== "grupoContaFluxoCaixa" && k !== "contaFluxoCaixa").map((k) => (
                <label key={k} className="space-y-1 text-sm">
                  <span className="block font-medium">{ROTULO_CAMPO_COMPRA[k]}</span>
                  <Input value={textos[k] ?? ""} onChange={(e) => mudar(k, e.target.value)} inputMode="numeric" autoComplete="off" maxLength={9} />
                </label>
              ))}
            </div>
            <label className="block space-y-1 text-sm">
              <span className="block font-medium">Nome do grupo no complemento</span>
              <Input value={rotulo} onChange={(e) => setRotulo(e.target.value)} maxLength={60} autoComplete="off" />
            </label>
            {titulo.ok ? (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-muted-foreground">Valor</dt><dd className="tabular-nums">{formatarMoeda(titulo.valorCentavos)}</dd>
                <dt className="text-muted-foreground">Documento</dt><dd className="tabular-nums">{titulo.payload.codDocumento}</dd>
                <dt className="text-muted-foreground">Emissão · vencimento</dt><dd className="tabular-nums">{formatarData(titulo.payload.dataEmissao)} · {formatarData(titulo.payload.dataVencimento)}</dd>
                <dt className="text-muted-foreground">Complemento</dt><dd className="font-mono text-xs">{titulo.payload.complementoHistorico}</dd>
              </dl>
            ) : <p className="text-sm font-medium text-amber-800">{titulo.erro}</p>}
            {avisoContas && <p className="text-sm font-medium text-destructive">{avisoContas}</p>}
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
              <Button onClick={confirmar} disabled={pendente || !titulo.ok || !!avisoContas}>{pendente ? "Lançando…" : `Lançar 1 título de ${formatarMoeda(titulo.valorCentavos)}`}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
