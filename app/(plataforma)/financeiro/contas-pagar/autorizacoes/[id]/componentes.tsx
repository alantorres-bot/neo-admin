"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCopy, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseReais } from "@/lib/modulos/financeiro/contas-pagar/autorizacao";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { DialogoExtra } from "../../dialogo-extra";
import { autorizar, cancelar, definirCaixa, enviarNoSlack, excluirDaLista, incluirExtra, removerExtra, removerItem } from "./acoes";

/** "Incluir pagamento extra" na página da autorização (rascunho): o diálogo compartilhado gravando via `incluirExtra`. */
export function DialogoExtraAutorizacao({ autorizacaoId, totalAtualCentavos, caixaCentavos }: { autorizacaoId: string; totalAtualCentavos: number; caixaCentavos: number | null }) {
  return <DialogoExtra totalAtualCentavos={totalAtualCentavos} caixaCentavos={caixaCentavos} aoConfirmar={(e) => incluirExtra({ autorizacaoId, ...e })} />;
}

/** Remove um pagamento extra do rascunho (com motivo; nunca delete). */
export function BotaoRemoverExtra({ autorizacaoId, extraId, descricao }: { autorizacaoId: string; extraId: string; descricao: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      const r = await removerExtra({ autorizacaoId, extraId, motivo });
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
              <DialogTitle>Remover pagamento extra</DialogTitle>
              <DialogDescription>{descricao}. A remoção fica registrada com o motivo.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor={`cap-motivo-extra-${extraId}`} className="text-sm font-medium">Motivo</label>
                <Input id={`cap-motivo-extra-${extraId}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: já lançado no Consistem" />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" onClick={confirmar} disabled={pendente}>{pendente ? "Removendo…" : "Remover"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

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

/** Tira uma autorização CANCELADA da lista (só gestor). Nada é apagado: fica gravada com quem excluiu, quando e por quê. */
export function BotaoExcluirDaLista({ id, codigo }: { id: string; codigo: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      const r = await excluirDaLista({ id, motivo });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.push("/financeiro/contas-pagar/autorizacoes");
      } else {
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => { setErro(undefined); setAberto(true); }}><Trash2 /> Excluir da lista</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Excluir a autorização {codigo} da lista?</DialogTitle>
              <DialogDescription>Ela some do histórico e das telas. O registro fica guardado no banco com quem excluiu e quando, mas não volta para a lista.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="cap-motivo-excluir" className="text-sm font-medium">Motivo (opcional)</label>
                <Input id="cap-motivo-excluir" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: era teste" />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
                <Button type="button" variant="destructive" onClick={confirmar} disabled={pendente}>{pendente ? "Excluindo…" : "Excluir da lista"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** Autorizar em dois cliques: o botão abre a confirmação com o total. */
export function BotaoAutorizar({ id, codigo, resumo }: { id: string; codigo: string; resumo: string }) {
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
              <DialogTitle>Autorizar a autorização {codigo}?</DialogTitle>
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

export function DialogoCancelar({ id, codigo, status, enviadaSlack }: { id: string; codigo: string; status: "rascunho" | "autorizada"; enviadaSlack: boolean }) {
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
              <DialogTitle>Cancelar a autorização {codigo}?</DialogTitle>
              <DialogDescription>
                {status === "autorizada" ? "Ela já foi autorizada: a pendência de execução será cancelada e " : "O rascunho é cancelado e "}
                os itens voltam à lista de pendentes. O registro fica no histórico com o motivo.{enviadaSlack ? " O PDF é retirado do canal do Slack e o canal recebe um aviso de cancelamento." : ""}
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

/**
 * "Enviar no Slack": com confirmação, o Neo Admin publica a mensagem e o PDF no canal do financeiro (Edge Function com o
 * token do aplicativo do Slack). Só gestor; nada sai sem o clique. Se o aplicativo ainda não estiver configurado, cai no
 * plano B: copia a mensagem e abre o canal para o diretor colar.
 */
export function BotaoEnviarSlack({ id, codigo, mensagem, canalUrl, ehGestor, jaEnviadaEm }: { id: string; codigo: string; mensagem: string; canalUrl: string | null; ehGestor: boolean; jaEnviadaEm: string | null }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  async function planoB() {
    try {
      await navigator.clipboard.writeText(mensagem);
      toast.success("Mensagem copiada. No Slack, cole no canal do financeiro e envie.");
    } catch {
      toast.error("Não consegui copiar a mensagem.");
    }
    window.open(canalUrl ?? "https://app.slack.com/client", "_blank", "noopener");
  }

  function confirmar() {
    iniciar(async () => {
      const r = await enviarNoSlack({ id });
      if (r.ok) {
        toast.success(r.aviso);
        setAberto(false);
        router.refresh();
      } else if (r.naoConfigurado) {
        setErro(`${r.erro} Enquanto isso: copie a mensagem e cole no Slack.`);
      } else {
        setErro(r.erro);
      }
    });
  }

  if (!ehGestor) return null;
  return (
    <>
      <Button type="button" variant="outline" onClick={() => { setErro(undefined); setAberto(true); }}><Send /> {jaEnviadaEm ? "Enviar no Slack de novo" : "Enviar no Slack"}</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Enviar no canal do financeiro?</DialogTitle>
              <DialogDescription>O Neo Admin publica somente o PDF do relatório (autorização {codigo}) no canal do financeiro no Slack, sem texto{jaEnviadaEm ? ` (já enviada em ${jaEnviadaEm})` : ""}.</DialogDescription>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">Arquivo: autorizacao-pagamento-{codigo}.pdf. Se o aplicativo não estiver configurado, “Só copiar e abrir o Slack” copia um resumo em texto para colar à mão.</p>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Voltar</Button>
              <Button type="button" variant="outline" onClick={planoB} disabled={pendente}>Só copiar e abrir o Slack</Button>
              <Button type="button" onClick={confirmar} disabled={pendente}>{pendente ? "Enviando…" : "Sim, enviar o PDF"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** Copia a lista do que ainda falta confirmar no Consistem (CCFFB014), uma linha por documento, para marcar na tela do ERP. */
export function BotaoCopiarLista({ texto, quantidade }: { texto: string; quantidade: number }) {
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(`Lista copiada (${quantidade} ${quantidade === 1 ? "documento" : "documentos"}). Cole onde precisar e confirme no CCFFB014.`);
    } catch {
      toast.error("Não foi possível copiar. Selecione a lista na tela e copie à mão.");
    }
  }
  return <Button type="button" variant="outline" size="sm" onClick={copiar}><ClipboardCopy /> Copiar lista</Button>;
}
