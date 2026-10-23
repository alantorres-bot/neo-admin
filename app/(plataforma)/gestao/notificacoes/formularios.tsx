"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EVENTOS_AVISO } from "@/lib/nucleo/gestao/avisos";
import { enviarAgora, marcarClickup, salvarAvisos } from "./acoes";

export type ConfigAvisos = { ligadas: boolean; eventos: Record<string, boolean>; canal: string; horario: string; clickupLista: string };

export function ConfigurarAvisos({ cfg }: { cfg: ConfigAvisos }) {
  return (
    <DialogoFormulario titulo="Configurar avisos" descricao="Ligue só depois de configurar o Slack (segredo SLACK_BOT_TOKEN e o canal) e comunicar a equipe."
      botao="Configurar" variante="default" tamanho="sm" rotuloSalvar="Salvar" mensagemSucesso="Configuração salva." acao={salvarAvisos}>
      <label className="flex items-start gap-2 text-sm font-medium">
        <input type="checkbox" name="ligadas" defaultChecked={cfg.ligadas} className="mt-0.5 size-4" />
        <span>Envio ligado <span className="block text-xs font-normal text-muted-foreground">Desligado, nada sai: os avisos só ficam registrados na fila.</span></span>
      </label>
      <fieldset className="grid gap-1.5 rounded-[3px] border border-grade p-2.5">
        <legend className="px-1 text-xs text-muted-foreground">Eventos</legend>
        {EVENTOS_AVISO.map((e) => (
          <label key={e.codigo} className="flex items-start gap-2 text-sm">
            <input type="checkbox" name={`evento_${e.codigo}`} defaultChecked={Boolean(cfg.eventos[e.codigo])} className="mt-0.5 size-4" />
            <span>{e.nome} <span className="block text-xs text-muted-foreground">{e.quando}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Campo id="av-canal" rotulo="Canal da gestão (ID do Slack)" dica="Ex.: C0123ABCD. O aplicativo precisa estar no canal.">
          <Input id="av-canal" name="canal" defaultValue={cfg.canal} />
        </Campo>
        <Campo id="av-horario" rotulo="Horário do resumo (Cuiabá)"><Input id="av-horario" name="horario" type="time" defaultValue={cfg.horario} required /></Campo>
      </div>
      <Campo id="av-clickup" rotulo="Lista do ClickUp (ID)" dica="Recebe as tarefas marcadas &quot;Enviar ao ClickUp&quot;. Exige o segredo CLICKUP_TOKEN.">
        <Input id="av-clickup" name="clickup_lista" defaultValue={cfg.clickupLista} inputMode="numeric" />
      </Campo>
    </DialogoFormulario>
  );
}

export function EnviarAgora({ destino, rotulo }: { destino: "slack" | "clickup"; rotulo: string }) {
  const [pendente, iniciar] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pendente}
      onClick={() => iniciar(async () => {
        const r = await enviarAgora(destino);
        if (r.ok) toast.success(r.resumo); else toast.error(r.erro);
      })}>
      {pendente ? "Aguarde…" : rotulo}
    </Button>
  );
}

export function AlternarClickup({ id, marcado, tarefa }: { id: string; marcado: boolean; tarefa: string | null }) {
  const [pendente, iniciar] = useTransition();
  if (tarefa) return <span className="text-[12px] text-muted-foreground">Tarefa no ClickUp: {tarefa}</span>;
  return (
    <Button size="sm" variant="outline" disabled={pendente}
      onClick={() => iniciar(async () => {
        const r = await marcarClickup(id, !marcado);
        if (r.ok) toast.success(marcado ? "Não será enviada ao ClickUp." : "Será enviada ao ClickUp no próximo envio.");
        else toast.error(r.erro);
      })}>
      {pendente ? "Aguarde…" : marcado ? "Não enviar ao ClickUp" : "Enviar ao ClickUp"}
    </Button>
  );
}
