"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alterarSenha, type EstadoSenha } from "./acoes";

export function FormSenha() {
  const [estado, acao, pendente] = useActionState<EstadoSenha, FormData>(alterarSenha, {});
  const formulario = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado.ok) {
      toast.success("Senha alterada.");
      formulario.current?.reset();
    }
  }, [estado.chave, estado.ok]);

  return (
    <form ref={formulario} action={acao} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="senha">Nova senha</Label>
        <Input id="senha" name="senha" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirmacao">Confirmar nova senha</Label>
        <Input id="confirmacao" name="confirmacao" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      {estado.erro && <p role="alert" className="text-sm text-destructive">{estado.erro}</p>}
      <Button type="submit" disabled={pendente} className="w-fit">{pendente ? "Salvando…" : "Alterar senha"}</Button>
    </form>
  );
}
