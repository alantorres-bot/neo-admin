"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { compararComCaixa, parseReais, validarExtra } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";

export type ExtraDigitado = { descricao: string; favorecido: string; valorCentavos: number };
type Resultado = { ok: true; aviso: string } | { ok: false; erro: string };

/**
 * Diálogo "pagamento extra" (fora do Consistem): descrição, favorecido e valor; mostra o novo total e o efeito no caixa.
 * Usado na tela Autorizar pagamento (botão "Extras" da barra: grava no rascunho em montagem) e na página da autorização
 * (rascunho). Quem grava é `aoConfirmar`; aqui só a validação e a apresentação.
 */
export function DialogoExtra({ totalAtualCentavos, caixaCentavos, rotulo = "Incluir pagamento extra", contexto, desativado = false, aoConfirmar, aoSucesso }: {
  totalAtualCentavos: number;
  caixaCentavos: number | null;
  rotulo?: string;
  /** Frase extra na descrição do diálogo (ex.: "Os 2 itens marcados também são salvos no rascunho."). */
  contexto?: string;
  desativado?: boolean;
  aoConfirmar: (extra: ExtraDigitado) => Promise<Resultado>;
  aoSucesso?: () => void;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [favorecido, setFavorecido] = useState("");
  const [valorTexto, setValorTexto] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const valorCentavos = parseReais(valorTexto);
  const novoTotal = totalAtualCentavos + (valorCentavos ?? 0);
  const comparacao = compararComCaixa(novoTotal, caixaCentavos);

  function abrir() {
    setDescricao(""); setFavorecido(""); setValorTexto(""); setErro(undefined); setAberto(true);
  }
  function salvar() {
    const problema = validarExtra({ descricao, favorecido, valorCentavos });
    if (problema) {
      setErro(problema);
      return;
    }
    iniciar(async () => {
      const r = await aoConfirmar({ descricao: descricao.trim(), favorecido: favorecido.trim(), valorCentavos: valorCentavos ?? 0 });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        aoSucesso?.();
        router.refresh();
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={abrir} disabled={desativado}>{rotulo}</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Incluir pagamento extra</DialogTitle>
              <DialogDescription>
                Pagamento pedido pela diretoria que não está no Consistem (frete avulso, reembolso, taxa…). Entra no total autorizado e no relatório; o lançamento no Consistem continua por conta do financeiro.{contexto ? ` ${contexto}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="cap-extra-descricao" className="text-sm font-medium">Descrição</label>
                <Input id="cap-extra-descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={200} placeholder="Ex.: Frete avulso — NF 123" autoFocus />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="cap-extra-favorecido" className="text-sm font-medium">Favorecido (quem recebe)</label>
                <Input id="cap-extra-favorecido" value={favorecido} onChange={(e) => setFavorecido(e.target.value)} maxLength={120} placeholder="Ex.: Transportadora XPTO" />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="cap-extra-valor" className="text-sm font-medium">Valor (R$)</label>
                <Input id="cap-extra-valor" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className="w-44 text-right tabular-nums" />
              </div>
              <p className="text-xs text-muted-foreground">
                Total da autorização passa a <strong className="tabular-nums">{formatarMoeda(novoTotal)}</strong>
                {comparacao && (comparacao.ultrapassa
                  ? <> · <span className="font-bold text-red-700">ultrapassa o caixa em {formatarMoeda(comparacao.excedenteCentavos)}</span></>
                  : <> · sobra {formatarMoeda(comparacao.sobraCentavos)} do caixa</>)}
                .
              </p>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" onClick={salvar} disabled={pendente}>{pendente ? "Incluindo…" : "Incluir"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
