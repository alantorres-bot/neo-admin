"use client";

import { useState } from "react";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ROTULO_SITUACAO_SUGESTAO, exigeJustificativa, proximasSituacoes, type PrioridadeSugestao, type SituacaoSugestao,
} from "@/lib/nucleo/gestao/sugestoes";
import { avaliarSugestao, comentarSugestao, criarTarefaSugestao } from "./acoes";

const CLASSE_SELECT = "h-8 w-full min-w-0 rounded-[3px] border border-input bg-white px-2 text-[13px]";

export function AvaliarSugestao({ id, atual, prioridade }: { id: string; atual: SituacaoSugestao; prioridade: PrioridadeSugestao | null }) {
  const opcoes = proximasSituacoes(atual);
  const [destino, setDestino] = useState<SituacaoSugestao>(opcoes[0]);
  return (
    <DialogoFormulario titulo="Avaliar sugestão" descricao={`Situação atual: ${ROTULO_SITUACAO_SUGESTAO[atual]}.`} botao="Avaliar / mudar situação"
      variante="default" tamanho="sm" rotuloSalvar="Salvar" mensagemSucesso="Sugestão atualizada." acao={avaliarSugestao}>
      <input type="hidden" name="id" value={id} />
      <Campo id={`sg-status-${id}`} rotulo="Nova situação">
        <select id={`sg-status-${id}`} name="status" value={destino} onChange={(e) => setDestino(e.target.value as SituacaoSugestao)} className={CLASSE_SELECT}>
          {opcoes.map((s) => <option key={s} value={s}>{ROTULO_SITUACAO_SUGESTAO[s]}</option>)}
        </select>
      </Campo>
      <Campo id={`sg-prio-${id}`} rotulo="Prioridade">
        <select id={`sg-prio-${id}`} name="prioridade" defaultValue={prioridade ?? ""} className={CLASSE_SELECT}>
          <option value="">—</option><option value="alta">Alta</option><option value="normal">Normal</option><option value="baixa">Baixa</option>
        </select>
      </Campo>
      <Campo id={`sg-just-${id}`} rotulo={exigeJustificativa(destino) ? "Justificativa da decisão" : "Justificativa (opcional)"}
        dica={exigeJustificativa(destino) ? "Fica visível para todos na lista de sugestões." : undefined}>
        <Textarea id={`sg-just-${id}`} name="justificativa" maxLength={4000} rows={3} required={exigeJustificativa(destino)} />
      </Campo>
    </DialogoFormulario>
  );
}

export function ComentarSugestao({ id }: { id: string }) {
  return (
    <DialogoFormulario titulo="Novo comentário" botao="Comentar" tamanho="sm" rotuloSalvar="Comentar" mensagemSucesso="Comentário registrado." acao={comentarSugestao}>
      <input type="hidden" name="id" value={id} />
      <Campo id={`sg-com-${id}`} rotulo="Comentário"><Textarea id={`sg-com-${id}`} name="texto" maxLength={4000} rows={3} required /></Campo>
    </DialogoFormulario>
  );
}

export function CriarTarefaSugestao({ id, pessoas, hoje }: { id: string; pessoas: { id: string; nome: string }[]; hoje: string }) {
  return (
    <DialogoFormulario titulo="Criar tarefa de implementação" descricao="Cria uma tarefa em Tarefas gerais, ligada a esta sugestão."
      botao="Criar tarefa de implementação" tamanho="sm" rotuloSalvar="Criar tarefa" mensagemSucesso="Tarefa criada." acao={criarTarefaSugestao}>
      <input type="hidden" name="id" value={id} />
      <Campo id={`sg-resp-${id}`} rotulo="Responsável">
        <select id={`sg-resp-${id}`} name="responsavel_id" defaultValue="" className={CLASSE_SELECT}>
          <option value="">Sem responsável</option>
          {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </Campo>
      <Campo id={`sg-prazo-${id}`} rotulo="Prazo (opcional)"><Input id={`sg-prazo-${id}`} name="prazo" type="date" min={hoje} /></Campo>
    </DialogoFormulario>
  );
}
