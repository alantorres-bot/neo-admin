"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Mail, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { enviarAnexo } from "@/lib/nucleo/anexos";
import { MODULO_RECEBIVEIS, TIPO_ANEXO_BOLETO } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { criarClienteNavegador } from "@/lib/supabase/navegador";
import { criarRascunhoGmail, marcarBoletoEnviado, salvarLinhaDigitavel } from "./acoes";

/** Envia o PDF (ou imagem) do boleto da parcela para o bucket de anexos. O registro fica em `anexos` (tipo boleto). */
export function AnexarBoleto({ tituloId, temBoleto }: { tituloId: string; temBoleto: boolean }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    if (!(arquivo.type === "application/pdf" || arquivo.type.startsWith("image/"))) {
      toast.error("Envie o boleto em PDF ou imagem.");
      return;
    }
    setEnviando(true);
    try {
      const r = await enviarAnexo(criarClienteNavegador(), { modulo: MODULO_RECEBIVEIS, referenciaTabela: "rec_titulos", referenciaId: tituloId }, arquivo, TIPO_ANEXO_BOLETO);
      if (r.ok) {
        toast.success("Boleto anexado.");
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
      <Button type="button" variant={temBoleto ? "ghost" : "outline"} size="sm" disabled={enviando} onClick={() => entrada.current?.click()}>
        <Paperclip /> {enviando ? "Enviando…" : temBoleto ? "Substituir" : "Anexar boleto"}
      </Button>
    </>
  );
}

/** Linha digitável da parcela (opcional). */
export function LinhaDigitavel({ tituloId, valor, podeEditar }: { tituloId: string; valor: string | null; podeEditar: boolean }) {
  const [texto, setTexto] = useState(valor ?? "");
  const [pendente, iniciar] = useTransition();
  if (!podeEditar) return <span className="break-all font-mono text-xs">{valor ?? "—"}</span>;

  function salvar() {
    iniciar(async () => {
      const r = await salvarLinhaDigitavel(tituloId, texto);
      if (r.ok) toast.success("Linha digitável salva.");
      else toast.error(r.erro);
    });
  }
  return (
    <div className="flex items-center gap-1">
      <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Linha digitável (opcional)" aria-label="Linha digitável" className="h-8 w-56 font-mono text-xs" />
      <Button type="button" variant="ghost" size="sm" disabled={pendente || texto.trim() === (valor ?? "")} onClick={salvar}>
        {pendente ? "Salvando…" : "Salvar"}
      </Button>
    </div>
  );
}

/** Copia um texto para a área de transferência. */
export function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      toast.success(`${rotulo} copiado.`);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={copiar}>
      {copiado ? <Check /> : <Copy />} {copiado ? "Copiado" : `Copiar ${rotulo}`}
    </Button>
  );
}

export type ParcelaEnvio = { id: string; rotulo: string; temBoleto: boolean };

/** "Marcar como enviado": o sistema não envia nada; quem enviou (e-mail, WhatsApp...) registra aqui. */
export function MarcarEnviado({ parcelas, contatoId, canalSugerido }: { parcelas: ParcelaEnvio[]; contatoId: string | null; canalSugerido: "email" | "whatsapp" | "telefone" | "interno" }) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(parcelas.filter((p) => p.temBoleto).map((p) => p.id)));
  const [canal, setCanal] = useState(canalSugerido);
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

  function enviar() {
    iniciar(async () => {
      const r = await marcarBoletoEnviado({ tituloIds: [...marcadas], canal, contatoId, observacao });
      if (r.ok) {
        toast.success(r.aviso ?? "Envio registrado.");
        setObservacao("");
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  if (parcelas.length === 0) return <p className="text-sm text-muted-foreground">Todas as parcelas estão encerradas (pagas ou canceladas).</p>;
  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {parcelas.map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={marcadas.has(p.id)} disabled={!p.temBoleto} onChange={() => alternar(p.id)} />
              <span>{p.rotulo}</span>
              {!p.temBoleto && <span className="text-xs text-muted-foreground">(anexe o boleto primeiro)</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <select value={canal} onChange={(e) => setCanal(e.target.value as typeof canal)} aria-label="Meio do envio" className="h-8 rounded-lg border bg-background px-2 text-sm">
          <option value="email">Enviado por e-mail</option>
          <option value="whatsapp">Enviado por WhatsApp</option>
          <option value="telefone">Combinado por telefone</option>
          <option value="interno">Outro meio</option>
        </select>
        <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Observação (opcional)" aria-label="Observação" maxLength={500} className="h-8 w-64" />
        <Button type="button" disabled={pendente || marcadas.size === 0} onClick={enviar}>
          {pendente ? "Registrando…" : "Marcar como enviado"}
        </Button>
      </div>
    </div>
  );
}

/** "Criar rascunho no Gmail": o rascunho nasce com os boletos em anexo; quem confere e envia é uma pessoa, no Gmail. */
export function CriarRascunhoGmail({ tituloId, contatoId, desabilitadoPor, idsParcelas }: { tituloId: string; contatoId: string | null; desabilitadoPor: string | null; idsParcelas: string[] }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [registrando, iniciarRegistro] = useTransition();
  const [link, setLink] = useState<string>();
  const [registrado, setRegistrado] = useState(false);

  // Depois de enviar o e-mail pelo Gmail: um clique registra o envio (a parcela passa para "Boleto enviado" e o histórico guarda).
  function registrarEnvio() {
    iniciarRegistro(async () => {
      const r = await marcarBoletoEnviado({ tituloIds: idsParcelas, canal: "email", contatoId, observacao: "E-mail enviado a partir do rascunho do Gmail." });
      if (r.ok) {
        setRegistrado(true);
        toast.success(r.aviso ?? "Envio registrado.");
        router.refresh();
      } else {
        toast.error(r.erro);
      }
    });
  }

  function criar() {
    iniciar(async () => {
      const r = await criarRascunhoGmail(tituloId, contatoId);
      if (r.ok) {
        setLink(r.url);
        toast.success(r.aviso ?? `Rascunho criado no Gmail, com ${r.anexos} ${r.anexos === 1 ? "anexo" : "anexos"}.`);
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
      {link && !registrado && (
        <Button type="button" size="sm" disabled={registrando || idsParcelas.length === 0} onClick={registrarEnvio} title="Use depois de enviar o e-mail no Gmail">
          <Check /> {registrando ? "Registrando…" : "Já enviei: marcar boleto como enviado"}
        </Button>
      )}
      {registrado && <span className="text-xs text-emerald-800">Envio registrado.</span>}
    </div>
  );
}
