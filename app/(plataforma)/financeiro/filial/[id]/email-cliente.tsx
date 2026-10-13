"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { criarRascunhoKit, desconectarGmail, iniciarConexaoGmail, marcarKitEnviado } from "../acoes";

type Sugestao = { para: string; cc: string; assunto: string; corpo: string };

/**
 * E-mail ao cliente (Fase C): o rascunho é criado no Gmail de QUEM CLICA, com a nota fatura, o demonstrativo, o comodato e o
 * boleto anexados. A pessoa confere e envia no Gmail; depois marca "Enviado ao cliente". Nada sai sozinho.
 */
export function EmailCliente({ kitId, gmail, sugestao, anexos }: { kitId: string; gmail: string | null; sugestao: Sugestao; anexos: string[] }) {
  const router = useRouter();
  const parametros = useSearchParams();
  const [campos, setCampos] = useState(sugestao);
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  // Volta do "Conectar meu Gmail" (?gmail=conectado|recusado|erro&motivo=…).
  useEffect(() => {
    const r = parametros.get("gmail");
    if (!r) return;
    if (r === "conectado") toast.success("Gmail conectado.");
    else if (r === "recusado") toast.error("A autorização do Gmail foi recusada.");
    else toast.error(parametros.get("motivo") ?? "Não foi possível conectar o Gmail.");
    router.replace(window.location.pathname);
  }, [parametros, router]);

  const mudar = (m: Partial<Sugestao>) => setCampos((c) => ({ ...c, ...m }));

  function conectar() {
    iniciar(async () => {
      const r = await iniciarConexaoGmail(window.location.href.split("?")[0]);
      if (!r.ok) return void toast.error(r.erro);
      window.location.href = r.url;
    });
  }

  function criar() {
    iniciar(async () => {
      const r = await criarRascunhoKit({ kitId, ...campos });
      if (!r.ok) return void toast.error(r.erro);
      setRascunho(r.url);
      toast.success(r.aviso ?? "Rascunho criado no seu Gmail. Confira e envie por lá.");
    });
  }

  function enviado() {
    iniciar(async () => {
      const r = await marcarKitEnviado(kitId);
      if (!r.ok) return void toast.error(r.erro);
      toast.success(r.aviso);
      router.refresh();
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>E-mail ao cliente</CardTitle>
        <CardDescription>
          O rascunho vai para o seu Gmail com {anexos.length} {anexos.length === 1 ? "anexo" : "anexos"} ({anexos.join(", ")}). Confira e envie pelo Gmail;
          depois volte aqui e marque &quot;Enviado ao cliente&quot;.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!gmail ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[3px] border border-marca bg-marca-clara p-3 text-[13px]">
            <span>Para criar o rascunho no seu Gmail, autorize uma vez (só cria rascunhos; quem envia é você).</span>
            <Button size="sm" onClick={conectar} disabled={pendente}>{pendente ? "Abrindo o Google…" : "Conectar meu Gmail"}</Button>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Gmail conectado: <strong>{gmail}</strong>{" "}
            <button type="button" className="underline" onClick={() => iniciar(async () => { const r = await desconectarGmail(); if (r.ok) router.refresh(); })}>desconectar</button>
          </p>
        )}
        <div className="grid gap-2">
          <label className="grid gap-1 text-[13px]">Para<Input value={campos.para} onChange={(e) => mudar({ para: e.target.value })} placeholder="e-mail do cliente (separe vários por vírgula)" /></label>
          <label className="grid gap-1 text-[13px]">Cc<Input value={campos.cc} onChange={(e) => mudar({ cc: e.target.value })} /></label>
          <label className="grid gap-1 text-[13px]">Assunto<Input value={campos.assunto} onChange={(e) => mudar({ assunto: e.target.value })} /></label>
          <label className="grid gap-1 text-[13px]">Texto<Textarea rows={10} value={campos.corpo} onChange={(e) => mudar({ corpo: e.target.value })} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rascunho
            ? <Button render={<a href={rascunho} target="_blank" rel="noreferrer" />}>Abrir o rascunho no Gmail</Button>
            : <Button onClick={criar} disabled={pendente || !gmail}>{pendente ? "Criando…" : "Criar rascunho no meu Gmail"}</Button>}
          <Button variant="outline" onClick={enviado} disabled={pendente}>Enviado ao cliente</Button>
        </div>
      </CardContent>
    </Card>
  );
}
