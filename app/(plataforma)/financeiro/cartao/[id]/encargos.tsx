"use client";

// Quadro "Encargos do mês" da conciliação: o título com a soma dos encargos que o painel lança no Consistem (botão com
// conferência), o lançamento ativo do mês e os erros anteriores. Regras 31 a 36 de docs/modulos/financeiro-cartao.md.
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { NovoLancamentoContaPagar } from "@/lib/modulos/financeiro/cartao/lancamento-encargos";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { lancarEncargos, resolverLancamentoEncargos } from "../acoes";
import type { LancamentoErpLinha, QuadroEncargos as Dados } from "../dados";

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const centavos = (v: number | string) => Math.round(Number(v) * 100);

function CamposTitulo({ p, fornecedorNome }: { p: NovoLancamentoContaPagar; fornecedorNome: string | null }) {
  const itens: [string, string][] = [
    ["Fornecedor", `${p.codFornecedor}${fornecedorNome ? ` · ${fornecedorNome}` : ""}`],
    ["Documento", p.codDocumento],
    ["Emissão e entrada", formatarData(p.dataEmissao)],
    ["Vencimento", formatarData(p.dataVencimento)],
    ["Valor", formatarMoeda(Math.round(p.valorDocumento * 100))],
    ["Complemento", p.complementoHistorico],
    ["Histórico · Portador · Categoria", `${p.codHistorico} · ${p.codPortador} · ${p.categoriaDoc}`],
    ["Fluxo de caixa (grupo · conta)", `${p.grupoContaFluxoCaixa} · ${p.contaFluxoCaixa}`],
    ["Contábil (débito · crédito)", `${p.dadosContabilidade.contaContabilDebito} · ${p.dadosContabilidade.contaContabilCredito}`],
  ];
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
      {itens.map(([k, v]) => (<Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className={k === "Complemento" ? "font-mono text-xs" : "tabular-nums"}>{v}</dd></Fragment>))}
    </dl>
  );
}

export function QuadroEncargos({ dados, faturaId, podeOperar }: { dados: Dados; faturaId: string | null; podeOperar: boolean }) {
  const { titulo: t, ativo, historico, ligado, mesAberto, fornecedorNome } = dados;
  const erros = historico.filter((l) => l.situacao === "erro");
  if (t.linhas.length === 0 && !ativo && erros.length === 0) return null;
  const podeLancar = podeOperar && faturaId !== null && ligado && mesAberto && t.ok && !ativo;
  return (
    <section className="space-y-3 rounded-[3px] border border-grade bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">Encargos do mês{t.linhas.length > 0 ? `: ${formatarMoeda(t.valorCentavos)}` : ""}</h3>
          <p className="text-xs text-muted-foreground">
            Um título com a soma dos encargos (IOF, juros, multa, anuidade, tarifa) contra o banco emissor, com os códigos do cartão (aba Cartões).
            {!ligado && " O lançamento pelo painel está desligado: o título abaixo é só a prévia do que seria enviado."}
            {ligado && !mesAberto && " O mês desta fatura não está em conciliação: nada é lançado daqui."}
          </p>
        </div>
        {podeLancar && t.ok && <BotaoLancar faturaId={faturaId!} dados={dados} />}
      </div>

      {ativo && <Ativo l={ativo} podeResolver={podeOperar && faturaId !== null && mesAberto} />}

      {t.linhas.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ul className="space-y-0.5 text-sm">
            {t.linhas.map((a) => (
              <li key={a.linha.id} className="flex justify-between gap-3"><span>{formatarData(a.linha.dataCompra)} · {a.linha.descricao}</span><span className="tabular-nums">{formatarMoeda(a.linha.valorCentavos)}</span></li>
            ))}
          </ul>
          {t.ok ? <CamposTitulo p={t.payload} fornecedorNome={fornecedorNome} /> : <p className="text-sm font-medium text-amber-800">{t.erro}</p>}
        </div>
      )}

      {erros.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {erros.map((l) => (
            <li key={l.id}><Badge variant="outline" className="mr-1 border-red-300 text-red-800">Não lançado</Badge>{quando(l.criado_em)} · {l.criado_por_nome ?? ""} · {formatarMoeda(centavos(l.valor))} · {l.erro}{l.motivo_resolucao ? ` · Conferido: ${l.motivo_resolucao}` : ""}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Ativo({ l, podeResolver }: { l: LancamentoErpLinha; podeResolver: boolean }) {
  if (l.situacao === "lancado") {
    return (
      <p className="rounded-[3px] border border-emerald-300 bg-emerald-50 p-2 text-sm">
        <strong>Lançado no Consistem:</strong> lançamento {l.cod_lancamento_erp}, {formatarMoeda(centavos(l.valor))}, por {l.criado_por_nome ?? "—"} em {quando(l.concluido_em ?? l.criado_em)}.
        {l.motivo_resolucao ? ` Registrado à mão por ${l.resolvido_por_nome ?? "—"}: ${l.motivo_resolucao}.` : ""} As linhas de encargo estão casadas com o título.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-amber-300 bg-amber-50 p-2 text-sm">
      <p>
        <strong>Sem resposta do Consistem</strong> ({l.situacao === "reservado" ? "não chegou a ser enviado" : `enviado em ${quando(l.enviado_em)}`}).
        {" "}{l.erro ?? "Confira no Consistem se o título foi criado."} Antes de lançar de novo, confira e registre o resultado.
      </p>
      {podeResolver && <BotaoResolver l={l} />}
    </div>
  );
}

function BotaoLancar({ faturaId, dados }: { faturaId: string; dados: Dados }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const t = dados.titulo;
  if (!t.ok) return null;
  function confirmar() {
    if (!t.ok) return;
    iniciar(async () => {
      const r = await lancarEncargos({ faturaId, valorCentavos: t.valorCentavos, linhas: t.linhas.map((a) => a.linha.id) });
      if (r.ok) { toast.success(r.aviso); setAberto(false); router.refresh(); } else { setErro(r.erro); router.refresh(); }
    });
  }
  return (
    <>
      <Button onClick={() => { setErro(undefined); setAberto(true); }}>Lançar no Consistem</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v && !pendente) setAberto(false); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Lançar os encargos no Consistem</DialogTitle>
              <DialogDescription>Confira o título. Ao confirmar, ele é criado no Contas a Pagar do Consistem uma única vez e as linhas da fatura ficam casadas com ele.</DialogDescription>
            </DialogHeader>
            <CamposTitulo p={t.payload} fornecedorNome={dados.fornecedorNome} />
            <p className="text-xs text-muted-foreground">{t.linhas.length} {t.linhas.length === 1 ? "linha" : "linhas"} de encargo da fatura.</p>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
              <Button onClick={confirmar} disabled={pendente}>{pendente ? "Lançando…" : `Lançar ${formatarMoeda(t.valorCentavos)}`}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function BotaoResolver({ l }: { l: LancamentoErpLinha }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [cod, setCod] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  function enviar(codLancamento: string) {
    iniciar(async () => {
      const r = await resolverLancamentoEncargos({ id: l.id, codLancamento, motivo });
      if (r.ok) { toast.success(r.aviso); setAberto(false); router.refresh(); } else setErro(r.erro);
    });
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setCod(""); setMotivo(""); setErro(undefined); setAberto(true); }}>Resolver</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Resolver o lançamento sem resposta</DialogTitle>
              <DialogDescription>Procure no Consistem o título de {formatarMoeda(centavos(l.valor))} (documento {l.payload.codDocumento}, complemento “{l.complemento}”). Se ele existe, informe o código do lançamento. Se não existe, registre que não foi criado.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Input value={cod} onChange={(e) => setCod(e.target.value.replace(/\D/g, ""))} maxLength={12} inputMode="numeric" placeholder="Código do lançamento no Consistem" autoComplete="off" />
              <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="O que foi conferido (ex.: achei o título no CCFFB010)" autoComplete="off" />
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button variant="outline" onClick={() => enviar("")} disabled={pendente || motivo.trim().length < 3}>Não foi criado</Button>
                <Button onClick={() => enviar(cod)} disabled={pendente || motivo.trim().length < 3 || cod === ""}>Foi criado</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
