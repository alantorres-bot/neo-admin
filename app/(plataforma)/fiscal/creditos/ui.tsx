"use client";

// Componentes de tela do Fiscal Control: diálogo de ação (formulário que chama uma server action e mostra a mensagem do
// servidor), botão com confirmação, filtros que aplicam ao escolher e campo monetário com máscara brasileira.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { lerValor } from "@/lib/modulos/fiscal/creditos/formatos";
import type { Resultado } from "./acoes";

export const SELECT = "h-9 w-full rounded-[3px] border border-input bg-background px-2 text-sm disabled:opacity-60";
export const TEXTAREA = "min-h-20 w-full rounded-[3px] border border-input bg-background px-2 py-1.5 text-sm";

type Acao = (anterior: unknown, dados: FormData) => Promise<Resultado>;

function avisar(r: Resultado, padrao = "Feito.") {
  if (r.ok) toast.success(r.mensagem ?? padrao);
  else toast.error(r.erro ?? "Não foi possível concluir.");
}

/** Diálogo com formulário. `ocultos` vão como campos escondidos. Fecha e atualiza a tela no sucesso. */
export function FormularioAcao({ titulo, descricao, botao, acao, ocultos = {}, rotuloSalvar = "Salvar", variante = "outline", tamanho = "sm", aoConcluir, children, larga }: {
  titulo: string; descricao?: string; botao: React.ReactNode; acao: Acao; ocultos?: Record<string, string>; rotuloSalvar?: string;
  variante?: "default" | "outline" | "ghost" | "destructive" | "secondary"; tamanho?: "default" | "sm" | "xs"; aoConcluir?: (r: Resultado) => void;
  children: React.ReactNode; larga?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string>();
  const [chave, setChave] = useState(() => crypto.randomUUID());
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); if (v) setErro(undefined); }}>
      <DialogTrigger render={<Button variant={variante} size={tamanho} />}>{botao}</DialogTrigger>
      <DialogContent className={`max-h-[92svh] overflow-y-auto ${larga ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {descricao && <DialogDescription>{descricao}</DialogDescription>}
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            iniciar(async () => {
              try {
                const r = await acao(null, fd);
                if (r.ok) {
                  avisar(r);
                  setAberto(false);
                  setChave(crypto.randomUUID());
                  aoConcluir?.(r);
                  router.refresh();
                } else setErro(r.erro);
              } catch {
                setErro("Falha de comunicação. Tente novamente.");
              }
            });
          }}
        >
          <input type="hidden" name="chave" value={chave} />
          {Object.entries(ocultos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {children}
          {erro && <p role="alert" className="rounded-[3px] border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button type="submit" disabled={pendente}>{pendente ? "Salvando…" : rotuloSalvar}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Botão de ação direta, com confirmação opcional na própria tela. */
export function BotaoAcao({ rotulo, acao, campos, confirmar, variante = "outline", tamanho = "sm" }: {
  rotulo: React.ReactNode; acao: Acao; campos: Record<string, string>; confirmar?: string;
  variante?: "default" | "outline" | "ghost" | "destructive"; tamanho?: "default" | "sm" | "xs";
}) {
  const [pendente, iniciar] = useTransition();
  const [perguntando, setPerguntando] = useState(false);
  const router = useRouter();
  const executar = () => iniciar(async () => {
    setPerguntando(false);
    const fd = new FormData();
    for (const [k, v] of Object.entries(campos)) fd.set(k, v);
    try {
      const r = await acao(null, fd);
      avisar(r);
      if (r.ok) router.refresh();
    } catch {
      toast.error("Falha de comunicação. Tente novamente.");
    }
  });
  if (perguntando) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2 rounded-[3px] border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
        {confirmar}
        <Button size="xs" onClick={executar}>Confirmar</Button>
        <Button size="xs" variant="outline" onClick={() => setPerguntando(false)}>Cancelar</Button>
      </span>
    );
  }
  return (
    <Button variant={variante} size={tamanho} disabled={pendente} onClick={() => (confirmar ? setPerguntando(true) : executar())}>
      {pendente ? "Aguarde…" : rotulo}
    </Button>
  );
}

/** Campo monetário: aceita 1.234,56 e formata ao sair do campo (o servidor valida de novo). */
export function CampoValor({ name, id, defaultValue, required, permitirZero, placeholder = "0,00" }: {
  name: string; id?: string; defaultValue?: string; required?: boolean; permitirZero?: boolean; placeholder?: string;
}) {
  const [v, setV] = useState(defaultValue ?? "");
  const [erro, setErro] = useState<string>();
  return (
    <div className="grid gap-1">
      <Input
        id={id ?? name} name={name} inputMode="decimal" autoComplete="off" required={required} placeholder={placeholder} value={v}
        aria-invalid={!!erro}
        onChange={(e) => { setV(e.target.value); setErro(undefined); }}
        onBlur={() => {
          if (!v.trim()) return;
          const r = lerValor(v, { permitirZero });
          if (!r.ok) { setErro(r.erro); return; }
          const [i, f] = (Math.abs(r.centavos) / 100).toFixed(2).split(".");
          setV(`${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${f}`);
        }}
      />
      {erro && <span className="text-xs text-destructive">{erro}</span>}
    </div>
  );
}

export function Campo({ rotulo, htmlFor, dica, children, className }: { rotulo: string; htmlFor?: string; dica?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid gap-1 ${className ?? ""}`}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium">{rotulo}</label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

/** Filtros por GET: cada mudança aplica na hora (mantém o restante da URL). */
export function FiltrosAuto({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} method="get" className={`flex flex-wrap items-end gap-2 ${className ?? ""}`} onChange={(e) => {
      if ((e.target as HTMLElement).tagName === "SELECT") ref.current?.requestSubmit();
    }}>
      {children}
      <Button type="submit" variant="outline" size="sm" className="h-9">Aplicar</Button>
    </form>
  );
}
