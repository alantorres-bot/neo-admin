"use client";

import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import type { LimitesDestaque } from "@/lib/nucleo/gestao/destaque";
import { salvarLimites } from "./acoes";

const CAMPOS: { chave: keyof LimitesDestaque; rotulo: string; dica: string; min: number; max: number }[] = [
  { chave: "dias_prazo_proximo", rotulo: "Prazo próximo (dias)", dica: "Vence em até N dias: entra em acompanhamento. De 0 a 30.", min: 0, max: 30 },
  { chave: "dias_atraso_relevante", rotulo: "Atraso relevante (dias)", dica: "Atrasada há mais de N dias: exige intervenção. De 1 a 90.", min: 1, max: 90 },
  { chave: "dias_bloqueio_relevante", rotulo: "Bloqueio relevante (dias)", dica: "Bloqueada há mais de N dias: exige intervenção. De 0 a 30.", min: 0, max: 30 },
  { chave: "dias_sem_movimentacao", rotulo: "Sem movimentação (dias)", dica: "Sem ação de uma pessoa há mais de N dias: acompanhamento. De 1 a 90.", min: 1, max: 90 },
];

export function EditarLimites({ atuais, aprovados }: { atuais: LimitesDestaque; aprovados: boolean }) {
  return (
    <DialogoFormulario
      titulo="Limites do destaque"
      descricao="Valem para todas as áreas, a partir do próximo carregamento da Central. Ao salvar, fica registrado que você aprovou estes valores."
      botao={aprovados ? "Alterar limites" : "Revisar e aprovar limites"}
      variante={aprovados ? "outline" : "default"}
      rotuloSalvar="Salvar e aprovar"
      mensagemSucesso="Limites salvos e aprovados."
      acao={salvarLimites}
    >
      {CAMPOS.map((c) => (
        <Campo key={c.chave} id={c.chave} rotulo={c.rotulo} dica={c.dica}>
          <Input id={c.chave} name={c.chave} type="number" min={c.min} max={c.max} step={1} defaultValue={atuais[c.chave]} required />
        </Campo>
      ))}
    </DialogoFormulario>
  );
}
