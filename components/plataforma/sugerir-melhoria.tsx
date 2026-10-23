"use client";

// "Sugerir melhoria" na barra superior de todas as telas: já vem com a área e o módulo da tela em que a pessoa está.
// Grava em `sugestoes` (Central de Gestão, migration 0096).
import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { criarSugestao } from "@/app/(plataforma)/gestao/sugestoes/acoes";
import { contextoDaTela } from "@/lib/nucleo/gestao/sugestoes";
import type { MenuArea } from "@/lib/nucleo/permissoes";

const CLASSE_SELECT = "h-8 w-full min-w-0 rounded-[3px] border border-input bg-white px-2 text-[13px]";

export function SugerirMelhoria({ menu, caminho, variante = "ghost", rotulo = "Sugerir melhoria" }: {
  menu: MenuArea[]; caminho: string; variante?: "ghost" | "outline" | "default"; rotulo?: string;
}) {
  const contexto = contextoDaTela(caminho, menu);
  const areaInicial = menu.some((m) => m.area.codigo === contexto.area) ? contexto.area! : (menu[0]?.area.codigo ?? "");
  const [area, setArea] = useState(areaInicial);
  const modulos = menu.find((m) => m.area.codigo === area)?.modulos.filter((m) => !m.externo) ?? [];

  return (
    <DialogoFormulario
      titulo="Sugerir melhoria"
      descricao="Conte o que atrapalha o seu trabalho e como poderia ser melhor. Só o título, a área e a melhoria são obrigatórios. Todos veem o título e a situação; o resto fica com você e com quem avalia."
      botao={<><Lightbulb /> {rotulo}</>}
      variante={variante}
      tamanho="sm"
      rotuloSalvar="Enviar sugestão"
      mensagemSucesso="Sugestão enviada. Acompanhe em Central de Gestão > Sugestões."
      acao={criarSugestao}
    >
      <Campo id="sg-titulo" rotulo="Título"><Input id="sg-titulo" name="titulo" maxLength={150} required /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo id="sg-area" rotulo="Área">
          <select id="sg-area" name="area" value={area} onChange={(e) => setArea(e.target.value)} className={CLASSE_SELECT}>
            {menu.map((m) => <option key={m.area.codigo} value={m.area.codigo}>{m.area.nome}</option>)}
          </select>
        </Campo>
        <Campo id="sg-modulo" rotulo="Módulo (opcional)">
          <select id="sg-modulo" name="modulo" key={area} defaultValue={contexto.area === area ? (contexto.modulo ?? "") : ""} className={CLASSE_SELECT}>
            <option value="">—</option>
            {modulos.map((m) => <option key={m.codigo} value={m.codigo}>{m.nome}</option>)}
          </select>
        </Campo>
      </div>
      <Campo id="sg-melhoria" rotulo="Melhoria sugerida"><Textarea id="sg-melhoria" name="melhoria" maxLength={4000} rows={3} required /></Campo>
      <Campo id="sg-problema" rotulo="Problema observado (opcional)"><Textarea id="sg-problema" name="problema" maxLength={4000} rows={2} /></Campo>
      <Campo id="sg-hoje" rotulo="Como é feito hoje (opcional)"><Textarea id="sg-hoje" name="como_hoje" maxLength={4000} rows={2} /></Campo>
      <Campo id="sg-resultado" rotulo="Resultado esperado (opcional)"><Textarea id="sg-resultado" name="resultado_esperado" maxLength={4000} rows={2} /></Campo>
    </DialogoFormulario>
  );
}
