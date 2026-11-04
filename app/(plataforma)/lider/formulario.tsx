"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { avisosDoPedido, MODULO_PORTAL_LIDER, ROTA_PORTAL_LIDER, ROTULO_TIPO, TIPOS, type Tipo } from "@/lib/modulos/rh/portal-lider/modulo";
import { enviarAnexo } from "@/lib/nucleo/anexos";
import { criarClienteNavegador } from "@/lib/supabase/navegador";
import { cancelar, solicitar } from "./acoes";

type Campo = { chave: string; rotulo: string; tipo: "data" | "texto" | "numero" | "sim_nao" | "opcoes"; opcional?: boolean; opcoes?: [string, string][] };

const CAMPOS: Record<Tipo, Campo[]> = {
  ferias: [
    { chave: "inicio", rotulo: "Início do gozo", tipo: "data" },
    { chave: "dias", rotulo: "Dias de gozo", tipo: "numero" },
    { chave: "abono", rotulo: "Vende 10 dias?", tipo: "sim_nao" },
    { chave: "observacao", rotulo: "Observação", tipo: "texto", opcional: true },
  ],
  funcao: [
    { chave: "funcao_nova", rotulo: "Função nova (ex.: SOLDADOR II)", tipo: "texto" },
    { chave: "salario_proposto", rotulo: "Salário proposto (R$)", tipo: "numero", opcional: true },
    { chave: "vigencia", rotulo: "A partir de", tipo: "data" },
    { chave: "exame", rotulo: "Precisa de exame (mudança de função)?", tipo: "sim_nao" },
    { chave: "motivo", rotulo: "Motivo", tipo: "texto" },
  ],
  desligamento: [
    { chave: "iniciativa", rotulo: "Iniciativa", tipo: "opcoes", opcoes: [["empregado", "Pedido de demissão (empregado)"], ["empresa", "Dispensa (empresa)"]] },
    { chave: "aviso", rotulo: "Aviso prévio", tipo: "opcoes", opcoes: [["trabalhado", "Trabalhado"], ["indenizado", "Indenizado"], ["dispensado", "Dispensado do cumprimento"]] },
    { chave: "data", rotulo: "Data", tipo: "data" },
    { chave: "motivo", rotulo: "Motivo", tipo: "texto" },
  ],
  atestado: [
    { chave: "inicio", rotulo: "Primeiro dia", tipo: "data" },
    { chave: "fim", rotulo: "Último dia", tipo: "data" },
    { chave: "observacao", rotulo: "Observação", tipo: "texto", opcional: true },
  ],
  contratacao: [
    { chave: "nome", rotulo: "Nome completo", tipo: "texto" },
    { chave: "cargo", rotulo: "Cargo", tipo: "texto" },
    { chave: "salario", rotulo: "Salário (R$)", tipo: "numero" },
    { chave: "beneficios", rotulo: "Benefícios (ex.: combustível, Unimed)", tipo: "texto", opcional: true },
    { chave: "contato", rotulo: "Telefone de contato", tipo: "texto", opcional: true },
    { chave: "data_prevista", rotulo: "Início previsto", tipo: "data" },
  ],
};

const CLASSE_SELECT = "h-9 w-full rounded-[3px] border border-input bg-white px-2 text-sm";
const anexar = (pedido: string, arquivo: File) =>
  enviarAnexo(criarClienteNavegador(), { modulo: MODULO_PORTAL_LIDER, referenciaTabela: "rh_ld_solicitacoes", referenciaId: pedido }, arquivo, "atestado");

/** Converte o que foi digitado no formato do esquema (números e sim/não); campos em branco ficam de fora. */
function montarDados(tipo: Tipo, valores: Record<string, string>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  for (const c of CAMPOS[tipo]) {
    const v = (valores[c.chave] ?? "").trim();
    if (c.tipo === "sim_nao") d[c.chave] = v === "sim";
    else if (v !== "") d[c.chave] = c.tipo === "numero" ? Number(v.replace(/\./g, "").replace(",", ".")) : v;
  }
  return d;
}

export function NovoPedido({ setor, equipe, hoje }: { setor: string; equipe: { id: string; nome: string }[]; hoje: string }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<Tipo>("ferias");
  const [pessoa, setPessoa] = useState("");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const dados = montarDados(tipo, valores);
  const avisos = avisosDoPedido(tipo, dados, hoje);

  const enviar = () => iniciar(async () => {
    setErro(undefined);
    if (tipo !== "contratacao" && !pessoa) return setErro("Escolha o funcionário.");
    if (tipo === "atestado" && !arquivo) return setErro("Anexe o atestado (foto ou PDF).");
    const r = await solicitar({ setor, colaborador: tipo === "contratacao" ? null : pessoa, tipo, dados });
    if (!r.ok) return setErro(r.erro);
    if (arquivo) {
      const a = await anexar(r.id, arquivo);
      if (!a.ok) toast.error(`Pedido enviado, mas o arquivo não subiu: ${a.erro} Use "Anexar" na lista de pedidos.`);
    }
    toast.success("Pedido enviado ao RH.");
    router.push(`${ROTA_PORTAL_LIDER}?setor=${setor}`);
  });

  return (
    <div className="max-w-xl space-y-4">
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Tipo de pedido</span>
        <select className={CLASSE_SELECT} value={tipo} onChange={(e) => { setTipo(e.target.value as Tipo); setValores({}); setErro(undefined); }}>
          {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
        </select>
      </label>
      {tipo !== "contratacao" && (
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Funcionário</span>
          <select className={CLASSE_SELECT} value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
            <option value="">Escolha…</option>
            {equipe.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>
      )}
      {CAMPOS[tipo].map((c) => (
        <label key={`${tipo}-${c.chave}`} className="block space-y-1 text-sm">
          <span className="font-medium">{c.rotulo}{c.opcional && <span className="font-normal text-muted-foreground"> (opcional)</span>}</span>
          {c.tipo === "sim_nao" || c.tipo === "opcoes" ? (
            <select className={CLASSE_SELECT} value={valores[c.chave] ?? (c.tipo === "sim_nao" ? "nao" : "")} onChange={(e) => setValores((a) => ({ ...a, [c.chave]: e.target.value }))}>
              {c.tipo === "sim_nao" ? <><option value="nao">Não</option><option value="sim">Sim</option></> : <><option value="">Escolha…</option>{c.opcoes!.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</>}
            </select>
          ) : (
            <Input type={c.tipo === "data" ? "date" : "text"} inputMode={c.tipo === "numero" ? "decimal" : undefined} maxLength={500}
              value={valores[c.chave] ?? ""} onChange={(e) => setValores((a) => ({ ...a, [c.chave]: e.target.value }))} />
          )}
        </label>
      ))}
      {tipo === "atestado" && (
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Atestado (foto ou PDF, até 25 MB)</span>
          <Input type="file" accept="application/pdf,image/*" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          <span className="text-xs text-muted-foreground">Guarde o original em papel e entregue ao RH.</span>
        </label>
      )}
      {avisos.map((a) => <p key={a} className="rounded-[3px] border border-amber-600 bg-amber-50 p-2 text-sm text-amber-800">{a}</p>)}
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={pendente}>Voltar</Button>
        <Button onClick={enviar} disabled={pendente}>{pendente ? "Enviando…" : "Enviar ao RH"}</Button>
      </div>
    </div>
  );
}

/** Para atestado cujo arquivo não subiu junto com o pedido. */
export function AnexarArquivo({ pedido }: { pedido: string }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <>
      <input ref={entrada} type="file" accept="application/pdf,image/*" className="hidden" aria-label="Arquivo do atestado"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) iniciar(async () => { const r = await anexar(pedido, f); if (r.ok) { toast.success("Arquivo anexado."); router.refresh(); } else toast.error(r.erro); }); }} />
      <Button variant="outline" size="sm" disabled={pendente} onClick={() => entrada.current?.click()}>{pendente ? "Enviando…" : "Anexar"}</Button>
    </>
  );
}

export function CancelarPedido({ pedido }: { pedido: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <Button variant="outline" size="sm" disabled={pendente}
      onClick={() => iniciar(async () => { const r = await cancelar(pedido); if (r.ok) { toast.success("Pedido cancelado."); router.refresh(); } else toast.error(r.erro); })}>
      Cancelar
    </Button>
  );
}
