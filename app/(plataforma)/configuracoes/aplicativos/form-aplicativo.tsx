"use client";

import { Pencil, Plus } from "lucide-react";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ICONES_APP, MODOS_ABRIR, ROTULO_ABRIR, ROTULO_ICONE } from "@/lib/nucleo/aplicativos";
import type { Aplicativo, Area } from "@/lib/nucleo/tipos";
import { salvarAplicativo } from "./acoes";

const SELECAO = "h-8 rounded-lg border bg-background px-2 text-sm";

export function DialogoAplicativo({ aplicativo, areas }: { aplicativo?: Aplicativo; areas: Area[] }) {
  return (
    <DialogoFormulario
      titulo={aplicativo ? "Editar aplicativo" : "Novo aplicativo"}
      descricao="Sistema separado (com login próprio) que aparece no menu e no Início de quem tem acesso à área."
      botao={aplicativo ? <><Pencil /> Editar</> : <><Plus /> Novo aplicativo</>}
      variante={aplicativo ? "ghost" : "default"}
      tamanho={aplicativo ? "sm" : "default"}
      mensagemSucesso={aplicativo ? "Aplicativo atualizado." : "Aplicativo cadastrado."}
      acao={salvarAplicativo}
    >
      {aplicativo && <input type="hidden" name="id" value={aplicativo.id} />}
      <Campo id="nome" rotulo="Nome">
        <Input id="nome" name="nome" defaultValue={aplicativo?.nome} required maxLength={80} placeholder="Ex.: Vigilância Fiscal" />
      </Campo>
      <Campo id="codigo" rotulo="Código" dica="Vira o endereço dentro do painel (/apps/código). Só letras minúsculas, números e _. Evite mudar depois de cadastrado.">
        <Input id="codigo" name="codigo" defaultValue={aplicativo?.codigo} required pattern="[a-z0-9_]{2,40}" placeholder="Ex.: vigilancia_fiscal" />
      </Campo>
      <Campo id="url" rotulo="Endereço (https://)">
        <Input id="url" name="url" type="url" defaultValue={aplicativo?.url} required placeholder="https://..." inputMode="url" />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="area" rotulo="Área" dica="Quem tem acesso à área (consulta ou acima) vê o aplicativo.">
          <select id="area" name="area" defaultValue={aplicativo?.area ?? ""} required className={SELECAO}>
            <option value="" disabled>Escolha…</option>
            {areas.map((a) => <option key={a.codigo} value={a.codigo}>{a.nome}{a.sensivel ? " (restrita)" : ""}</option>)}
          </select>
        </Campo>
        <Campo id="abrir" rotulo="Como abre">
          <select id="abrir" name="abrir" defaultValue={aplicativo?.abrir ?? "embutido"} className={SELECAO}>
            {MODOS_ABRIR.map((m) => <option key={m} value={m}>{ROTULO_ABRIR[m]}</option>)}
          </select>
        </Campo>
        <Campo id="icone" rotulo="Ícone" dica="Vazio usa o ícone da área.">
          <select id="icone" name="icone" defaultValue={aplicativo?.icone ?? ""} className={SELECAO}>
            <option value="">Ícone da área</option>
            {ICONES_APP.map((i) => <option key={i} value={i}>{ROTULO_ICONE[i]}</option>)}
          </select>
        </Campo>
        <Campo id="ordem" rotulo="Ordem" dica="Menor aparece primeiro dentro da área.">
          <Input id="ordem" name="ordem" type="number" min={0} max={999} defaultValue={aplicativo?.ordem ?? 10} inputMode="numeric" />
        </Campo>
      </div>
      <Campo id="descricao" rotulo="Descrição curta" dica="Aparece no cartão do Início.">
        <Textarea id="descricao" name="descricao" defaultValue={aplicativo?.descricao ?? ""} rows={2} maxLength={300} />
      </Campo>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ativo" defaultChecked={aplicativo?.ativo ?? true} className="size-4" />
        Aplicativo ativo (desativado some do menu e do Início, sem apagar o cadastro)
      </label>
    </DialogoFormulario>
  );
}
