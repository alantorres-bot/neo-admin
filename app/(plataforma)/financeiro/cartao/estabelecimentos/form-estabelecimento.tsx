"use client";

import { useEffect, useRef } from "react";
import { Pencil, Plus } from "lucide-react";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import { salvarEstabelecimento } from "../acoes";
import type { EstabelecimentoLinha } from "../dados";

export function DialogoEstabelecimento({ estabelecimento, padraoSugerido, abrirAoCarregar }: { estabelecimento?: EstabelecimentoLinha; padraoSugerido?: string; abrirAoCarregar?: boolean }) {
  const caixa = useRef<HTMLDivElement>(null);
  // Vindo de "Cadastrar" na aba A lançar: abre o diálogo já com o trecho da fatura preenchido.
  useEffect(() => {
    if (abrirAoCarregar) caixa.current?.querySelector("button")?.click();
  }, [abrirAoCarregar]);
  return (
    <div ref={caixa} className="inline-block">
      <DialogoFormulario
        titulo={estabelecimento ? `Editar ${estabelecimento.padrao}` : "Novo estabelecimento"}
        descricao="O trecho é procurado dentro da descrição da fatura (sem acento, sem diferenciar maiúsculas). Vale o trecho mais longo que casar."
        botao={estabelecimento ? <><Pencil /> Editar</> : <><Plus /> Novo estabelecimento</>}
        variante={estabelecimento ? "ghost" : "default"}
        tamanho={estabelecimento ? "sm" : "default"}
        mensagemSucesso={estabelecimento ? "Estabelecimento atualizado." : "Estabelecimento cadastrado."}
        acao={salvarEstabelecimento}
      >
        <Campo id="padrao" rotulo="Trecho como aparece na fatura" dica="Ex.: NUVIAGENS, HOTEIS.COM, POSTO. Alterar o trecho de um registro existente cria outro registro.">
          <Input id="padrao" name="padrao" defaultValue={estabelecimento?.padrao ?? padraoSugerido ?? ""} required minLength={2} maxLength={60} autoFocus />
        </Campo>
        <Campo id="categoria" rotulo="Categoria" dica="Ex.: Passagens aéreas, Hospedagem, Combustível, Alimentação, Marketplace.">
          <Input id="categoria" name="categoria" defaultValue={estabelecimento?.categoria ?? ""} required maxLength={60} />
        </Campo>
        <Campo id="contaFluxo" rotulo="Conta de fluxo (Descrição Conta no Consistem)" dica="Vazio = [CONFERIR] a cada lançamento (quando a conta depende do item comprado).">
          <Input id="contaFluxo" name="contaFluxo" defaultValue={estabelecimento?.conta_fluxo ?? ""} maxLength={60} placeholder="Ex.: Passagens, Hospedagens, Softwares e Licenças" />
        </Campo>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ativo" defaultChecked={estabelecimento?.ativo ?? true} className="size-4" />
          Ativo (usado na classificação)
        </label>
      </DialogoFormulario>
    </div>
  );
}
