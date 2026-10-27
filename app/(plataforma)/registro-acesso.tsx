"use client";

// Registro de acessos (Central de Gestão > Atividades): grava a tela quando ela é aberta de verdade. No proxy.ts não dá,
// porque o Next 16 esconde dele o cabeçalho de pré-carregamento e cada link pré-carregado virava um acesso.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { registrarAcesso } from "./acoes-acesso";

export function RegistroAcesso() {
  const rota = usePathname();
  useEffect(() => {
    registrarAcesso(rota).catch(() => undefined);
  }, [rota]);
  return null;
}
