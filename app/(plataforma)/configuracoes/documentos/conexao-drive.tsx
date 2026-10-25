"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatarDataHora } from "@/lib/nucleo/fila";
import { criarTrava, descreverSituacao, lerRetornoGed, ROTA_CONEXAO_GED, type Aviso, type SituacaoConexaoGed } from "@/lib/nucleo/ged/conexao-tela";
import { definirContaGed, desconectarGed, iniciarConexaoGed } from "./acoes";
import { AmostraDrive } from "./amostra-drive";

// `id` fixo: o mesmo aviso não se repete quando o efeito de retorno roda de novo (modo estrito do React, atualização da tela).
const avisar = (a: Aviso, id?: string) =>
  a.tipo === "erro" ? toast.error(a.mensagem, { id }) : a.tipo === "aviso" ? toast.warning(a.mensagem, { id }) : toast.success(a.mensagem, { id });

export function ConexaoDrive({ disponivel, situacao, conta, revogarNoGoogle }: {
  disponivel: boolean;
  situacao: SituacaoConexaoGed | null;
  conta: string | null;
  revogarNoGoogle: boolean;
}) {
  const router = useRouter();
  const parametros = useSearchParams();
  const [pendente, iniciar] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [contaDigitada, setContaDigitada] = useState(conta ?? "");
  const contaConfigurada = !!conta;
  const trava = useRef(criarTrava()); // clique duplo antes de o estado da transição atualizar

  // Volta do OAuth (?ged=…&codigo=…): mensagem por código fixo e limpeza da URL (nada da query é exibido como texto).
  useEffect(() => {
    const aviso = lerRetornoGed(parametros.get("ged"), parametros.get("codigo"));
    if (!aviso) return;
    avisar(aviso, "ged-retorno-oauth");
    router.replace(ROTA_CONEXAO_GED, { scroll: false });
    router.refresh();
  }, [parametros, router]);

  const executar = (acao: () => Promise<void>) => iniciar(async () => void (await trava.current(acao)));

  const conectar = () =>
    executar(async () => {
      const r = await iniciarConexaoGed();
      if (!r.ok) return void toast.error(r.erro);
      window.location.assign(r.url);
    });

  const desconectar = () =>
    executar(async () => {
      const r = await desconectarGed();
      setConfirmando(false);
      if (!r.ok) return void toast.error(r.erro);
      avisar(r);
      router.refresh();
    });

  const salvarConta = (e: FormEvent) => {
    e.preventDefault();
    executar(async () => {
      const r = await definirContaGed(contaDigitada);
      if (!r.ok) return void toast.error(r.erro);
      toast.success("Conta do GED salva.");
      router.refresh();
    });
  };

  if (!disponivel) {
    return (
      <p role="status" className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        A conexão com o Google Drive ainda não está disponível neste ambiente (a publicação da fase A0 do GED está pendente).
      </p>
    );
  }

  const s = descreverSituacao(situacao);
  const ativa = s.estado !== "desconectada";

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Google Drive
          <Badge variant={s.estado === "conectada" ? "default" : s.estado === "com_erro" ? "destructive" : "secondary"}>{s.rotulo}</Badge>
        </CardTitle>
        {ativa && (
          <CardDescription>
            {revogarNoGoogle
              ? "Ao desconectar, o acesso também é revogado no Google."
              : "Ao desconectar, o acesso é removido daqui; a revogação no Google fica manual (myaccount.google.com)."}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-[13px]">
        {ativa && situacao && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Conta</dt>
            <dd>{situacao.email}</dd>
            <dt className="text-muted-foreground">Permissão</dt>
            <dd>{situacao.escopos.some((e) => e.endsWith("/drive.readonly")) ? "Somente leitura do Drive" : "—"}</dd>
            <dt className="text-muted-foreground">Conectado em</dt>
            <dd>{formatarDataHora(situacao.conectado_em)}</dd>
            {situacao.ultimo_erro_em && (
              <>
                <dt className="text-muted-foreground">Último erro em</dt>
                <dd>{formatarDataHora(situacao.ultimo_erro_em)}</dd>
              </>
            )}
          </dl>
        )}
        {s.detalhe && <p role="alert" className={s.estado === "com_erro" ? "text-destructive" : "text-muted-foreground"}>{s.detalhe}</p>}
        {!contaConfigurada && !ativa && (
          <p role="alert" className="text-destructive">
            Antes de conectar, configure a conta dedicada do GED (administrativo.ged.conta).
          </p>
        )}
        {/* D-TROCA: a conta só muda sem conexão ativa (a ação de servidor confere de novo). */}
        {!ativa && (
          <form onSubmit={salvarConta} className="flex max-w-md flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="ged-conta">Conta dedicada do GED</Label>
              <Input id="ged-conta" type="email" autoComplete="off" placeholder="nome@neoformas.com.br" value={contaDigitada}
                onChange={(e) => setContaDigitada(e.target.value)} disabled={pendente} />
            </div>
            <Button type="submit" variant="outline" disabled={pendente || contaDigitada.trim().toLowerCase() === (conta ?? "")}>Salvar conta</Button>
          </form>
        )}

        <div className="flex flex-wrap gap-2">
          {s.estado !== "conectada" && (
            <Button onClick={conectar} disabled={pendente || !contaConfigurada}>
              {pendente ? "Abrindo o Google…" : s.estado === "com_erro" ? "Reconectar Google Drive" : "Conectar Google Drive"}
            </Button>
          )}
          {ativa && (
            <Button variant="outline" onClick={() => setConfirmando(true)} disabled={pendente}>Desconectar</Button>
          )}
        </div>
        {s.estado === "conectada" && <AmostraDrive />}
      </CardContent>

      {confirmando && (
        <Dialog open onOpenChange={(v) => { if (!v && !pendente) setConfirmando(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Desconectar o Google Drive?</DialogTitle>
              <DialogDescription>
                A Central de Documentos deixa de ler o Drive até alguém conectar de novo. O registro da conexão continua no histórico.
                {revogarNoGoogle ? " O acesso também será revogado no Google." : " A revogação no Google não será feita: faça manualmente se precisar."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmando(false)} disabled={pendente}>Voltar</Button>
              <Button variant="destructive" onClick={desconectar} disabled={pendente}>{pendente ? "Desconectando…" : "Confirmar desconexão"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
