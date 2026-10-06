"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { criarRascunhoCobranca, registrarCobranca } from "./acoes";

export type ParcelaCobranca = { id: string; rotulo: string };
type Canal = "whatsapp" | "telefone" | "email" | "interno";

/** Resultado da cobrança: "Enviei", "Cliente prometeu pagar em…" ou "Cliente contestou". O sistema não envia a mensagem. */
export function RegistrarCobranca({ marco, parcelas, hoje, canalSugerido }: { marco: 1 | 5 | 10; parcelas: ParcelaCobranca[]; hoje: string; canalSugerido: Canal }) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(parcelas.map((p) => p.id)));
  const [resultado, setResultado] = useState<"enviada" | "promessa" | "contestou">("enviada");
  const [canal, setCanal] = useState<Canal>(canalSugerido);
  const [data, setData] = useState("");
  const [observacao, setObservacao] = useState("");
  const [pendente, iniciar] = useTransition();

  function alternar(id: string) {
    setMarcadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function registrar() {
    iniciar(async () => {
      const r = await registrarCobranca({ tituloIds: [...marcadas], marco, resultado, canal, data: resultado === "promessa" ? data || null : null, observacao });
      if (r.ok) {
        toast.success(r.aviso);
        setObservacao("");
        setData("");
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  const rotuloBotao = resultado === "enviada" ? "Registrar cobrança enviada" : resultado === "promessa" ? "Registrar promessa" : "Registrar contestação";
  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {parcelas.map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={marcadas.has(p.id)} onChange={() => alternar(p.id)} />
              <span>{p.rotulo}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs">
          Resultado
          <select value={resultado} onChange={(e) => setResultado(e.target.value as typeof resultado)} className="h-8 rounded-lg border bg-background px-2 text-sm">
            <option value="enviada">Enviei a cobrança</option>
            <option value="promessa">Cliente prometeu pagar</option>
            <option value="contestou">Cliente contestou</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          Meio
          <select value={canal} onChange={(e) => setCanal(e.target.value as Canal)} className="h-8 rounded-lg border bg-background px-2 text-sm">
            <option value="whatsapp">WhatsApp</option>
            <option value="email">E-mail</option>
            <option value="telefone">Telefone</option>
            <option value="interno">Outro meio</option>
          </select>
        </label>
        {resultado === "promessa" && (
          <label className="grid gap-1 text-xs">
            Data prometida
            <Input type="date" value={data} min={hoje} onChange={(e) => setData(e.target.value)} className="h-8 w-40" />
          </label>
        )}
        <label className="grid flex-1 gap-1 text-xs">
          {resultado === "contestou" ? "Motivo da contestação (obrigatório)" : "Observação (opcional)"}
          <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} className="h-8 min-w-60" />
        </label>
      </div>
      <Button type="button" disabled={pendente || marcadas.size === 0} onClick={registrar}>
        {pendente ? "Registrando…" : rotuloBotao}
      </Button>
    </div>
  );
}

/** "Criar rascunho no Gmail" do e-mail de cobrança: nunca envia; uma pessoa confere e envia no Gmail. */
export function CriarRascunhoCobranca({ clienteId, marco, desabilitadoPor }: { clienteId: string; marco: number; desabilitadoPor: string | null }) {
  const [pendente, iniciar] = useTransition();
  const [link, setLink] = useState<string>();

  function criar() {
    iniciar(async () => {
      const r = await criarRascunhoCobranca(clienteId, marco);
      if (r.ok) {
        setLink(r.url);
        toast.success(r.aviso ?? (r.anexos > 0 ? `Rascunho criado no Gmail, com ${r.anexos} ${r.anexos === 1 ? "boleto" : "boletos"} em anexo.` : "Rascunho criado no Gmail."));
      } else {
        toast.error(r.erro);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" size="sm" disabled={pendente || desabilitadoPor !== null} onClick={criar} title={desabilitadoPor ?? undefined}>
        <Mail /> {pendente ? "Criando rascunho…" : "Criar rascunho no Gmail"}
      </Button>
      {desabilitadoPor && <span className="text-xs text-muted-foreground">{desabilitadoPor}</span>}
      {link && (
        <Button variant="outline" size="sm" render={<a href={link} target="_blank" rel="noreferrer" />}>
          <ExternalLink /> Abrir o rascunho no Gmail
        </Button>
      )}
    </div>
  );
}
