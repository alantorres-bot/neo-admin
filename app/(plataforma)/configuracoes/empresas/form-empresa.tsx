"use client";

import { Pencil, Plus } from "lucide-react";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import type { Empresa } from "@/lib/nucleo/tipos";
import { salvarEmpresa } from "./acoes";

export function DialogoEmpresa({ empresa }: { empresa?: Empresa }) {
  return (
    <DialogoFormulario
      titulo={empresa ? "Editar empresa" : "Nova empresa"}
      botao={empresa ? <><Pencil /> Editar</> : <><Plus /> Nova empresa</>}
      variante={empresa ? "ghost" : "default"}
      tamanho={empresa ? "sm" : "default"}
      mensagemSucesso={empresa ? "Empresa atualizada." : "Empresa criada."}
      acao={salvarEmpresa}
    >
      {empresa && <input type="hidden" name="id" value={empresa.id} />}
      <Campo id="razao_social" rotulo="Razão social">
        <Input id="razao_social" name="razao_social" defaultValue={empresa?.razao_social} required />
      </Campo>
      <Campo id="nome_curto" rotulo="Nome curto" dica="Como aparece nas telas e relatórios. Ex.: Neo Formas.">
        <Input id="nome_curto" name="nome_curto" defaultValue={empresa?.nome_curto} required />
      </Campo>
      <Campo id="cnpj" rotulo="CNPJ" dica="Opcional. Aceita com ou sem pontuação.">
        <Input id="cnpj" name="cnpj" defaultValue={empresa?.cnpj ?? ""} inputMode="numeric" placeholder="00.000.000/0000-00" />
      </Campo>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ativa" defaultChecked={empresa?.ativa ?? true} className="size-4" />
        Empresa ativa
      </label>
    </DialogoFormulario>
  );
}
