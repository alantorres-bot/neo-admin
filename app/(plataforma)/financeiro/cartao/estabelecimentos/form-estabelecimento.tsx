"use client";

import { useEffect, useRef } from "react";
import { Pencil, Plus } from "lucide-react";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import { CAMPOS_COMPRA, ROTULO_CAMPO_COMPRA } from "@/lib/modulos/financeiro/cartao/lancamento-compras";
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
          <input type="checkbox" name="marketplace" defaultChecked={estabelecimento?.marketplace ?? false} className="size-4" />
          Marketplace: a nota é de outro fornecedor (sem fornecedor próprio; a conciliação casa pelo valor)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="fornecedorPorCompra" defaultChecked={estabelecimento?.fornecedor_por_compra ?? false} className="size-4" />
          Genérico: fornecedor por compra (posto, restaurante, hotel…: cada compra é numa empresa diferente)
        </label>
        <fieldset className="space-y-2 rounded-[3px] border border-grade p-3">
          <legend className="px-1 text-sm font-medium">Lançamento no Consistem (sugestão)</legend>
          <p className="text-xs text-muted-foreground">Códigos sugeridos ao lançar a compra deste estabelecimento. Todos opcionais: o que faltar vem do cartão ou o operador escolhe.</p>
          <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
            {CAMPOS_COMPRA.map((k) => (
              <Campo key={k} id={`erp_${k}`} rotulo={ROTULO_CAMPO_COMPRA[k]}>
                <Input id={`erp_${k}`} name={`erp_${k}`} defaultValue={estabelecimento?.lancamento_erp?.[k] ?? ""} inputMode="numeric" pattern="\d{0,9}" autoComplete="off" />
              </Campo>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ativo" defaultChecked={estabelecimento?.ativo ?? true} className="size-4" />
          Ativo (usado na classificação)
        </label>
      </DialogoFormulario>
    </div>
  );
}
