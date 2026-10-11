"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseReais } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { ROTA_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { criarAutorizacao } from "../acoes";

/**
 * "Novo rascunho vazio": autorização sem itens do Consistem, para receber só pagamentos extras (ex.: "pagar o frete avulso
 * hoje"). Os extras são incluídos na página da autorização. Operador ou acima.
 */
export function NovoRascunhoVazio({ empresas, hoje }: { empresas: { id: string; nome: string }[]; hoje: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [empresaId, setEmpresaId] = useState(empresas[0]?.id ?? "");
  const [data, setData] = useState(hoje);
  const [observacao, setObservacao] = useState("");
  const [caixaTexto, setCaixaTexto] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  if (empresas.length === 0) return null;

  function criar() {
    const caixaCentavos = caixaTexto.trim() === "" ? null : parseReais(caixaTexto);
    if (caixaTexto.trim() !== "" && caixaCentavos === null) {
      setErro("Caixa disponível inválido: use números, ex.: 150.000,00 (ou deixe em branco).");
      return;
    }
    iniciar(async () => {
      const r = await criarAutorizacao({ empresaId, lancamentoIds: [], data, observacao, autorizar: false, caixaCentavos });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.push(`${ROTA_CONTAS_PAGAR}/autorizacoes/${r.id}`);
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => { setErro(undefined); setAberto(true); }}>Novo rascunho só com extras</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Novo rascunho só com pagamentos extras</DialogTitle>
              <DialogDescription>Para pagamentos que não existem no Consistem (frete avulso, reembolso, taxa…). O rascunho nasce vazio; os pagamentos extras são incluídos na página da autorização. Para títulos e antecipações, use a tela “Autorizar pagamento”.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              {empresas.length > 1 && (
                <div className="grid gap-1.5">
                  <label htmlFor="cap-vazio-empresa" className="text-sm font-medium">Empresa</label>
                  <select id="cap-vazio-empresa" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="h-9 rounded-[3px] border border-grade bg-white px-2 text-sm">
                    {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                </div>
              )}
              <div className="grid gap-1.5">
                <label htmlFor="cap-vazio-data" className="text-sm font-medium">Data do pagamento</label>
                <Input id="cap-vazio-data" type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-44" />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="cap-vazio-caixa" className="text-sm font-medium">Caixa disponível (opcional)</label>
                <Input id="cap-vazio-caixa" value={caixaTexto} onChange={(e) => setCaixaTexto(e.target.value)} placeholder="R$ 0,00" inputMode="decimal" className="w-44 text-right tabular-nums" />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="cap-vazio-obs" className="text-sm font-medium">Observação (opcional)</label>
                <Textarea id="cap-vazio-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} rows={2} placeholder="Ex.: pagamentos avulsos de 13/10" />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" onClick={criar} disabled={pendente}>{pendente ? "Criando…" : "Criar rascunho"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
