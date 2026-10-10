"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseReais, TIPO_ANEXO_AUTORIZACAO } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { MODULO_CONTAS_PAGAR } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { enviarAnexo } from "@/lib/nucleo/anexos";
import { criarClienteNavegador } from "@/lib/supabase/navegador";
import { autorizar, cancelar, definirCaixa, removerItem } from "./acoes";

/** Altera o caixa disponível de um rascunho (ou remove). Ultrapassar o caixa é só aviso. */
export function DialogoCaixa({ id, caixaCentavos }: { id: string; caixaCentavos: number | null }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState(caixaCentavos === null ? "" : (caixaCentavos / 100).toFixed(2).replace(".", ","));
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function salvar() {
    const centavos = texto.trim() === "" ? null : parseReais(texto);
    if (texto.trim() !== "" && centavos === null) {
      setErro("Caixa inválido: use números, ex.: 150.000,00.");
      return;
    }
    iniciar(async () => {
      const r = await definirCaixa({ id, caixaCentavos: centavos });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.refresh();
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => { setErro(undefined); setAberto(true); }}>{caixaCentavos === null ? "Informar caixa" : "Alterar caixa"}</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Caixa disponível</DialogTitle>
              <DialogDescription>Quanto há em caixa para esta autorização{caixaCentavos !== null ? ` (hoje: ${formatarMoeda(caixaCentavos)})` : ""}. Em branco remove. Passar do caixa não impede autorizar: o relatório mostra o excedente.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="cap-caixa-editar" className="text-sm font-medium">Caixa disponível (R$)</label>
                <Input id="cap-caixa-editar" value={texto} onChange={(e) => setTexto(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className="w-48 text-right tabular-nums" />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" onClick={salvar} disabled={pendente}>{pendente ? "Salvando…" : "Salvar"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** Guarda o relatório assinado (PDF ou foto) como anexo da autorização. Anexo é prova: não se apaga; para trocar, envie outro. */
export function AnexarAssinada({ autorizacaoId, temAnexo }: { autorizacaoId: string; temAnexo: boolean }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    if (!(arquivo.type === "application/pdf" || arquivo.type.startsWith("image/"))) {
      toast.error("Envie o relatório assinado em PDF ou imagem.");
      return;
    }
    setEnviando(true);
    try {
      const r = await enviarAnexo(criarClienteNavegador(), { modulo: MODULO_CONTAS_PAGAR, referenciaTabela: "cap_autorizacoes", referenciaId: autorizacaoId }, arquivo, TIPO_ANEXO_AUTORIZACAO);
      if (r.ok) {
        toast.success("Relatório assinado anexado.");
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <input ref={entrada} type="file" accept="application/pdf,image/*" className="hidden" onChange={aoEscolher} />
      <Button type="button" variant="outline" disabled={enviando} onClick={() => entrada.current?.click()}>
        <Paperclip /> {enviando ? "Enviando…" : temAnexo ? "Anexar outra versão assinada" : "Anexar PDF assinado"}
      </Button>
    </>
  );
}

/** Autorizar em dois cliques: o botão abre a confirmação com o total. */
export function BotaoAutorizar({ id, numero, resumo }: { id: string; numero: number; resumo: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      const r = await autorizar(id);
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.refresh();
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" onClick={() => { setErro(undefined); setAberto(true); }}>Autorizar pagamento</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Autorizar a autorização nº {numero}?</DialogTitle>
              <DialogDescription>{resumo}. A pendência “Executar autorização de pagamento” é aberta na Fila do dia para o financeiro. Depois de autorizada, os itens não mudam mais.</DialogDescription>
            </DialogHeader>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
              <Button type="button" onClick={confirmar} disabled={pendente}>{pendente ? "Autorizando…" : "Sim, autorizar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function DialogoCancelar({ id, numero, status }: { id: string; numero: number; status: "rascunho" | "autorizada" }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      const r = await cancelar({ id, motivo });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.refresh();
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => { setErro(undefined); setAberto(true); }}>Cancelar autorização</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cancelar a autorização nº {numero}?</DialogTitle>
              <DialogDescription>
                {status === "autorizada" ? "Ela já foi autorizada: a pendência de execução será cancelada e " : "O rascunho é cancelado e "}
                os itens voltam à lista de pendentes. O registro fica no histórico com o motivo.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="cap-motivo-cancelar" className="text-sm font-medium">Motivo</label>
                <Input id="cap-motivo-cancelar" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: pagamento adiado pela diretoria" />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" variant="destructive" onClick={confirmar} disabled={pendente}>{pendente ? "Cancelando…" : "Cancelar autorização"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function BotaoRemoverItem({ autorizacaoId, itemId, descricao }: { autorizacaoId: string; itemId: string; descricao: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      const r = await removerItem({ autorizacaoId, itemId, motivo });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.refresh();
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="ghost" size="xs" onClick={() => { setErro(undefined); setAberto(true); }}>Remover</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Remover item do rascunho</DialogTitle>
              <DialogDescription>{descricao}. O item volta à lista de pendentes; a remoção fica registrada com o motivo.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor={`cap-motivo-${itemId}`} className="text-sm font-medium">Motivo</label>
                <Input id={`cap-motivo-${itemId}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: fornecedor pediu para segurar" />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" onClick={confirmar} disabled={pendente}>{pendente ? "Removendo…" : "Remover item"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
