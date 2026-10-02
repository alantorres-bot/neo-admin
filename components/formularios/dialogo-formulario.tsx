"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** Retorno padrão das ações de formulário. */
export type EstadoForm = { ok?: boolean; erro?: string; chave?: number };

type Props = {
  titulo: string;
  descricao?: string;
  /** conteúdo do botão que abre o diálogo */
  botao: React.ReactNode;
  variante?: "default" | "outline" | "ghost" | "secondary";
  tamanho?: "default" | "sm" | "xs" | "icon-sm";
  rotuloSalvar?: string;
  mensagemSucesso: string;
  acao: (anterior: EstadoForm, dados: FormData) => Promise<EstadoForm>;
  children: React.ReactNode;
};

function BotaoSalvar({ rotulo }: { rotulo: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Salvando…" : rotulo}</Button>;
}

export function DialogoFormulario({
  titulo, descricao, botao, variante = "outline", tamanho = "sm", rotuloSalvar = "Salvar", mensagemSucesso, acao, children,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string>();

  async function enviar(dados: FormData) {
    const resultado = await acao({}, dados);
    if (resultado.ok) {
      toast.success(mensagemSucesso);
      setErro(undefined);
      setAberto(false);
    } else {
      setErro(resultado.erro ?? "Não foi possível salvar.");
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(valor) => { setAberto(valor); if (valor) setErro(undefined); }}>
      <DialogTrigger render={<Button variant={variante} size={tamanho} />}>{botao}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {descricao && <DialogDescription>{descricao}</DialogDescription>}
        </DialogHeader>
        <form action={enviar} className="grid gap-4">
          {children}
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <BotaoSalvar rotulo={rotuloSalvar} />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Campo({ rotulo, id, dica, children }: { rotulo: string; id: string; dica?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{rotulo}</label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}
