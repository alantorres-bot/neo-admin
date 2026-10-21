import type { Metadata } from "next";
import { Ajuda } from "@/components/plataforma/ajuda";
import { AJUDA } from "@/lib/modulos/rh/banco-horas/ajuda";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerParametros } from "../dados";
import { FormularioParametros } from "./formulario";

export const metadata: Metadata = { title: "Banco de horas — parâmetros" };

export default async function PaginaParametrosBanco() {
  const sessao = await exigirSessao();
  const par = await lerParametros(await criarClienteServidor());
  return (
    <div className="max-w-2xl space-y-3">
      <Ajuda titulo={AJUDA.parametros.titulo} passos={AJUDA.parametros.passos} />
      <p className="text-sm text-muted-foreground">
        Validade pelo acordo individual de banco de horas (6 meses). O início da conta é um dia 26 (início de ciclo): o que nasceu antes é ignorado.
      </p>
      <FormularioParametros par={par} ehGestor={temAcesso(sessao.acesso, "rh", "gestor")} />
    </div>
  );
}
