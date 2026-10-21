"use client";

// "Lançar selecionadas": várias linhas da fatura de uma vez, UM TÍTULO POR LINHA (regra 52 de docs/modulos/financeiro-cartao.md;
// até 21/10/2026 a seleção virava um título agrupado). Barra acima da tabela "A lançar": atalhos de seleção e o botão.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ItemALancar } from "@/lib/modulos/financeiro/cartao/conciliacao";
import { aVista, camposDaSelecao, gruposSugeridos, sugestaoDoGrupo, type ItemGrupo } from "@/lib/modulos/financeiro/cartao/lancamento-agrupado";
import { CAMPOS_COMPRA, conferirContas, montarTitulosCompra, ROTULO_CAMPO_COMPRA, type CampoCompra, type CamposCompra } from "@/lib/modulos/financeiro/cartao/lancamento-compras";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { lancarSelecionadas } from "../acoes";
import type { QuadroCompras } from "../dados";
import { BotaoCadastrarFornecedor } from "../fornecedores";
import { SeletorContaFluxo } from "../listas";
import { SeletorFornecedor } from "./compras";

/** Linhas que podem ser lançadas pela seleção: com proposta de compra e à vista. */
export function itensAgrupaveis(aLancar: readonly ItemALancar[], compras: QuadroCompras): ItemGrupo[] {
  return aLancar.filter((a) => compras.propostas[a.linha.id] && aVista(a.linha))
    .map((a) => ({ linha: a.linha, sugestao: compras.propostas[a.linha.id].sugestao, fornecedorNome: compras.propostas[a.linha.id].fornecedorNome, categoria: a.categoria }));
}

export function BarraAgrupado({ faturaId, itens, compras, selecionadas, setSelecionadas }: {
  faturaId: string; itens: ItemGrupo[]; compras: QuadroCompras; selecionadas: Set<string>; setSelecionadas: (s: Set<string>) => void;
}) {
  const grupos = useMemo(() => gruposSugeridos(itens), [itens]);
  const escolhidos = itens.filter((i) => selecionadas.has(i.linha.id));
  const total = escolhidos.reduce((s, i) => s + i.linha.valorCentavos, 0);
  if (itens.length < 1) return null;
  return (
    <div className="space-y-2 rounded-[3px] border border-grade bg-cabecalho p-2 text-sm">
      <p>
        <strong>Lançar selecionadas:</strong> marque na coluna “Selecionar” as linhas à vista e clique em <strong>Lançar selecionadas</strong>.
        Sai <strong>um título por linha</strong>, com a descrição e o fornecedor de cada uma; o que faltar você completa no diálogo.
      </p>
      <div className="flex flex-wrap items-center gap-2">
      {grupos.length > 0 && <span className="text-muted-foreground">Atalhos:</span>}
      {grupos.map((g) => (
        <Button key={g.chave} type="button" size="sm" variant="outline" onClick={() => setSelecionadas(new Set(g.linhaIds))}>
          Selecionar: {g.rotulo} — {g.linhaIds.length} linhas, {formatarMoeda(g.totalCentavos)}
        </Button>
      ))}
      <span className="ml-auto text-muted-foreground">{escolhidos.length} selecionada{escolhidos.length === 1 ? "" : "s"} · {formatarMoeda(total)}</span>
      {escolhidos.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => setSelecionadas(new Set())}>Limpar</Button>}
      <DialogoLancarSelecionadas faturaId={faturaId} itens={escolhidos} compras={compras} aoConcluir={() => setSelecionadas(new Set())} />
      </div>
    </div>
  );
}

function DialogoLancarSelecionadas({ faturaId, itens, compras, aoConcluir }: { faturaId: string; itens: ItemGrupo[]; compras: QuadroCompras; aoConcluir: () => void }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [campos, setCampos] = useState<CamposCompra>({});
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [fornecedorNome, setFornecedorNome] = useState<string | null>(null);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  // Campos que alguma linha não tem na sugestão: só esses aparecem para completar.
  const faltando = CAMPOS_COMPRA.filter((k) => itens.some((i) => i.sugestao.campos[k] === undefined));
  function abrir() {
    const s = sugestaoDoGrupo(itens);
    const comuns = Object.fromEntries(faltando.filter((k) => s.campos[k] !== undefined && !s.divergentes.includes(k)).map((k) => [k, s.campos[k]])) as CamposCompra;
    setCampos(comuns);
    setTextos(Object.fromEntries(CAMPOS_COMPRA.map((k) => [k, String(comuns[k] ?? "")])));
    setFornecedorNome(null);
    setErro(undefined);
    setAberto(true);
  }
  const previas = itens.map((i) => {
    const c = camposDaSelecao(i.sugestao.campos, campos);
    const contas = compras.competencia ? conferirContas(c, compras.creditoPadrao) : null;
    const t = compras.competencia
      ? montarTitulosCompra({ linha: i.linha, cartao: compras.cartao, campos: c, vencimentoFatura: compras.vencimentoFatura, competencia: compras.competencia, fechamento: compras.fechamento })
      : { ok: false as const, erro: "Mês do cartão sem competência." };
    const fornecedor = i.sugestao.campos.codFornecedor !== undefined ? `${i.sugestao.campos.codFornecedor}${i.fornecedorNome ? ` · ${i.fornecedorNome}` : ""}`
      : c.codFornecedor !== undefined ? `${c.codFornecedor}${fornecedorNome ? ` · ${fornecedorNome}` : ""} (do diálogo)` : "—";
    return { i, fornecedor, problema: contas ?? (t.ok ? null : t.erro), payload: t.ok ? t.titulos[0].payload : null };
  });
  const comProblema = previas.filter((p) => p.problema).length;
  const total = itens.reduce((s, i) => s + i.linha.valorCentavos, 0);
  const mudar = (k: CampoCompra, bruto: string) => {
    const v = bruto.replace(/\D/g, "").slice(0, 9);
    setTextos((t) => ({ ...t, [k]: v }));
    setCampos((c) => { const n = { ...c }; if (v !== "" && Number(v) > 0) n[k] = Number(v); else delete n[k]; return n; });
  };
  function confirmar() {
    iniciar(async () => {
      const r = await lancarSelecionadas({ faturaId, linhas: itens.map((i) => i.linha.id), campos });
      if (r.ok) { toast.success(r.aviso); setAberto(false); aoConcluir(); router.refresh(); } else { setErro(r.erro); router.refresh(); }
    });
  }
  const rotuloBotao = `Lançar ${itens.length === 1 ? "1 título" : `${itens.length} títulos`}`;
  return (
    <>
      <Button type="button" size="sm" onClick={abrir} disabled={itens.length < 1}>
        {itens.length < 1 ? "Marque as linhas" : `Lançar selecionadas (${itens.length} · ${formatarMoeda(total)})`}
      </Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v && !pendente) setAberto(false); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Lançar {itens.length} {itens.length === 1 ? "linha" : "linhas"}, um título por linha</DialogTitle>
              <DialogDescription>Cada linha vira um título no Consistem com a sua descrição, o seu fornecedor e o vencimento da fatura. Os títulos saem um de cada vez; se um for recusado, os seguintes esperam.</DialogDescription>
            </DialogHeader>
            <Table>
              <TableHeader><TableRow><TableHead>Linha da fatura</TableHead><TableHead>Fornecedor</TableHead><TableHead>Documento</TableHead><TableHead>Complemento</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody>
                {previas.map((p) => (
                  <TableRow key={p.i.linha.id} className={p.problema ? "bg-amber-50" : ""}>
                    <TableCell>{p.i.linha.descricao}{p.problema && <p className="text-xs font-medium text-amber-800">{p.problema}</p>}</TableCell>
                    <TableCell className="text-xs">{p.fornecedor}</TableCell>
                    <TableCell className="tabular-nums">{p.payload?.codDocumento ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{p.payload?.complementoHistorico ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatarMoeda(p.i.linha.valorCentavos)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {faltando.length > 0 && (
              <div className="space-y-3 rounded-[3px] border border-grade p-2">
                <p className="text-sm"><strong>Para completar</strong> o que falta nas linhas sem sugestão ({faltando.map((k) => ROTULO_CAMPO_COMPRA[k].toLowerCase()).join(", ")}). As linhas com sugestão ficam com os códigos delas.</p>
                {faltando.includes("codFornecedor") && (
                  <>
                    <SeletorFornecedor empresaId={compras.empresaId} cod={campos.codFornecedor} nome={fornecedorNome}
                      aoEscolher={(cod, nome, cat) => {
                        setCampos((c) => ({ ...c, codFornecedor: cod, ...(cat ? { categoriaDoc: cat } : {}) }));
                        setTextos((t) => ({ ...t, codFornecedor: String(cod), ...(cat ? { categoriaDoc: String(cat) } : {}) }));
                        setFornecedorNome(nome);
                      }} />
                    <div className="-mt-2 flex justify-end">
                      <BotaoCadastrarFornecedor empresaId={compras.empresaId} nomeInicial={itens.find((i) => i.sugestao.campos.codFornecedor === undefined)?.linha.descricao ?? ""} cadastro={compras.cadastro} listas={compras.listas}
                        fluxoInicial={{ grupo: campos.grupoContaFluxoCaixa, item: campos.contaFluxoCaixa }}
                        aoCadastrar={(cod, nome) => { setCampos((c) => ({ ...c, codFornecedor: cod })); setFornecedorNome(nome); }} />
                    </div>
                  </>
                )}
                {(faltando.includes("grupoContaFluxoCaixa") || faltando.includes("contaFluxoCaixa")) && (
                  <label className="block space-y-1 text-sm">
                    <span className="block font-medium">Conta de fluxo de caixa</span>
                    <SeletorContaFluxo contas={compras.listas.contasFluxo} grupo={campos.grupoContaFluxoCaixa} item={campos.contaFluxoCaixa}
                      aoMudar={(g, i) => setCampos((c) => {
                        const n = { ...c };
                        if (g && i) { n.grupoContaFluxoCaixa = g; n.contaFluxoCaixa = i; } else { delete n.grupoContaFluxoCaixa; delete n.contaFluxoCaixa; }
                        return n;
                      })} />
                  </label>
                )}
                <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
                  {faltando.filter((k) => k !== "codFornecedor" && k !== "grupoContaFluxoCaixa" && k !== "contaFluxoCaixa").map((k) => (
                    <label key={k} className="space-y-1 text-sm">
                      <span className="block font-medium">{ROTULO_CAMPO_COMPRA[k]}</span>
                      <Input value={textos[k] ?? ""} onChange={(e) => mudar(k, e.target.value)} inputMode="numeric" autoComplete="off" maxLength={9} />
                    </label>
                  ))}
                </div>
              </div>
            )}
            {comProblema > 0 && <p className="text-sm font-medium text-amber-800">{comProblema === 1 ? "1 linha precisa" : `${comProblema} linhas precisam`} de atenção (veja na tabela).</p>}
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
              <Button onClick={confirmar} disabled={pendente || comProblema > 0}>{pendente ? "Lançando…" : `${rotuloBotao} (${formatarMoeda(total)})`}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
