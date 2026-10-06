"use client";

import { Pencil, Plus } from "lucide-react";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatarWhatsapp } from "@/lib/nucleo/documentos";
import { FINALIDADES, finalidadesDesconhecidas, normalizarFinalidade, ROTULO_FINALIDADE } from "@/supabase/functions/_shared/contatos";
import { CANAIS_DE_CONTATO, ROTULO_CANAL, ROTULO_TIPO_CONTRAPARTE, TIPOS_CONTRAPARTE } from "@/lib/nucleo/rotulos";
import type { Contato, Contraparte } from "@/lib/nucleo/tipos";
import { salvarContato, salvarContraparte } from "./acoes";

export function DialogoContraparte({ contraparte, podeColaborador }: { contraparte?: Contraparte; podeColaborador: boolean }) {
  const tiposDisponiveis = TIPOS_CONTRAPARTE.filter((t) => t !== "colaborador" || podeColaborador);
  return (
    <DialogoFormulario
      titulo={contraparte ? "Editar contraparte" : "Nova contraparte"}
      descricao="Cadastro único de clientes, fornecedores, órgãos, escritórios e outros, usado por todos os módulos."
      botao={contraparte ? <><Pencil /> Editar</> : <><Plus /> Nova contraparte</>}
      variante={contraparte ? "ghost" : "default"}
      tamanho={contraparte ? "sm" : "default"}
      mensagemSucesso={contraparte ? "Contraparte atualizada." : "Contraparte criada."}
      acao={salvarContraparte}
    >
      {contraparte && <input type="hidden" name="id" value={contraparte.id} />}
      <Campo id="nome" rotulo="Nome">
        <Input id="nome" name="nome" defaultValue={contraparte?.nome} required />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="documento" rotulo="CPF ou CNPJ" dica="Opcional. Não pode repetir.">
          <Input id="documento" name="documento" defaultValue={contraparte?.documento ?? ""} inputMode="numeric" />
        </Campo>
        <Campo id="codigo_erp" rotulo="Código no Consistem">
          <Input id="codigo_erp" name="codigo_erp" defaultValue={contraparte?.codigo_erp ?? ""} />
        </Campo>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-sm font-medium">Tipos</legend>
        <div className="grid grid-cols-2 gap-2">
          {tiposDisponiveis.map((tipo) => (
            <label key={tipo} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="tipos" value={tipo} defaultChecked={contraparte?.tipos.includes(tipo)} className="size-4" />
              {ROTULO_TIPO_CONTRAPARTE[tipo]}
            </label>
          ))}
        </div>
        {!podeColaborador && <p className="text-xs text-muted-foreground">O tipo Colaborador só está disponível para quem tem acesso à área RH/SST.</p>}
      </fieldset>
      <Campo id="observacoes" rotulo="Observações">
        <Textarea id="observacoes" name="observacoes" defaultValue={contraparte?.observacoes ?? ""} rows={3} />
      </Campo>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ativo" defaultChecked={contraparte?.ativo ?? true} className="size-4" />
        Cadastro ativo
      </label>
    </DialogoFormulario>
  );
}

export function DialogoContato({ contraparteId, contato }: { contraparteId: string; contato?: Contato }) {
  return (
    <DialogoFormulario
      titulo={contato ? "Editar contato" : "Novo contato"}
      botao={contato ? <><Pencil /> Editar</> : <><Plus /> Novo contato</>}
      variante={contato ? "ghost" : "default"}
      tamanho={contato ? "sm" : "default"}
      mensagemSucesso={contato ? "Contato atualizado." : "Contato criado."}
      acao={salvarContato}
    >
      {contato && <input type="hidden" name="id" value={contato.id} />}
      <input type="hidden" name="contraparte_id" value={contraparteId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="nome" rotulo="Nome">
          <Input id="nome" name="nome" defaultValue={contato?.nome} required />
        </Campo>
        <Campo id="funcao" rotulo="Função" dica="Financeiro, compras, jurídico…">
          <Input id="funcao" name="funcao" defaultValue={contato?.funcao ?? ""} />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="email" rotulo="E-mail">
          <Input id="email" name="email" type="email" defaultValue={contato?.email ?? ""} />
        </Campo>
        <Campo id="whatsapp" rotulo="WhatsApp" dica="DDD + número.">
          <Input id="whatsapp" name="whatsapp" defaultValue={contato?.whatsapp ? formatarWhatsapp(contato.whatsapp) : ""} inputMode="tel" />
        </Campo>
      </div>
      <Campo id="telefone" rotulo="Telefone para ligar" dica="Fixo ou celular, com DDD. Usado nas ligações de confirmação.">
        <Input id="telefone" name="telefone" defaultValue={contato?.telefone ? formatarWhatsapp(contato.telefone) : ""} inputMode="tel" />
      </Campo>
      <Campo id="canal_preferido" rotulo="Canal preferido">
        <select id="canal_preferido" name="canal_preferido" defaultValue={contato?.canal_preferido ?? "email"} className="h-8 rounded-lg border bg-background px-2 text-sm">
          {CANAIS_DE_CONTATO.map((c) => (
            <option key={c} value={c}>{ROTULO_CANAL[c]}</option>
          ))}
        </select>
      </Campo>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-sm font-medium">Recebe</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {FINALIDADES.map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="finalidades" value={f} defaultChecked={contato?.finalidades.some((x) => normalizarFinalidade(x) === f) ?? false} className="size-4" />
              {ROTULO_FINALIDADE[f]}
            </label>
          ))}
        </div>
        {contato && finalidadesDesconhecidas(contato.finalidades).length > 0 && (
          <p className="text-xs text-red-700">Finalidade que o sistema não reconhece: {finalidadesDesconhecidas(contato.finalidades).join(", ")}. Ao salvar, ela é trocada pelas marcadas acima.</p>
        )}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ativo" defaultChecked={contato?.ativo ?? true} className="size-4" />
        Contato ativo
      </label>
    </DialogoFormulario>
  );
}
