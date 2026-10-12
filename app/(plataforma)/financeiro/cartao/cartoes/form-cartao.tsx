"use client";

import { Pencil, Plus } from "lucide-react";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LEITORES, ROTULO_LEITOR } from "@/lib/modulos/financeiro/cartao/modulo";
import { salvarCartao } from "../acoes";
import type { CartaoLinha } from "../dados";

const SELECAO = "h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]";

export function DialogoCartao({ cartao }: { cartao?: CartaoLinha }) {
  return (
    <DialogoFormulario
      titulo={cartao ? `Editar ${cartao.nome}` : "Novo cartão"}
      descricao="Fechamento e vencimento conforme a Planilha Cartões. O código não muda depois de usado em faturas importadas."
      botao={cartao ? <><Pencil /> Editar</> : <><Plus /> Novo cartão</>}
      variante={cartao ? "ghost" : "default"}
      tamanho={cartao ? "sm" : "default"}
      mensagemSucesso={cartao ? "Cartão atualizado." : "Cartão cadastrado."}
      acao={salvarCartao}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="codigo" rotulo="Código" dica="Sem acento, maiúsculas (ex.: NUBANK PF). Vai no complemento do título.">
          <Input id="codigo" name="codigo" defaultValue={cartao?.codigo} readOnly={!!cartao} required maxLength={30} placeholder="Ex.: NUBANK PF" />
        </Campo>
        <Campo id="nome" rotulo="Nome">
          <Input id="nome" name="nome" defaultValue={cartao?.nome} required maxLength={40} placeholder="Ex.: ITAÚ PJ" />
        </Campo>
        <Campo id="banco" rotulo="Banco" dica="Como aparece no complemento (Inter, Sicredi, Nubank…).">
          <Input id="banco" name="banco" defaultValue={cartao?.banco} required maxLength={40} />
        </Campo>
        <Campo id="tipoPessoa" rotulo="PF / PJ">
          <select id="tipoPessoa" name="tipoPessoa" defaultValue={cartao?.tipo_pessoa ?? "PJ"} className={SELECAO}>
            <option value="PF">PF</option><option value="PJ">PJ</option>
          </select>
        </Campo>
        <Campo id="diaFechamento" rotulo="Dia de fechamento">
          <Input id="diaFechamento" name="diaFechamento" type="number" min={1} max={31} defaultValue={cartao?.dia_fechamento ?? ""} required inputMode="numeric" />
        </Campo>
        <Campo id="diaVencimento" rotulo="Dia de vencimento">
          <Input id="diaVencimento" name="diaVencimento" type="number" min={1} max={31} defaultValue={cartao?.dia_vencimento ?? ""} required inputMode="numeric" />
        </Campo>
        <Campo id="tipoTitulo" rotulo="Tipo de título (Consistem)">
          <Input id="tipoTitulo" name="tipoTitulo" defaultValue={cartao?.tipo_titulo ?? ""} inputMode="numeric" pattern="\d{0,4}" />
        </Campo>
        <Campo id="leitor" rotulo="Leitor da fatura" dica="Emissor sem leitor calibrado usa o genérico (confira a integridade).">
          <select id="leitor" name="leitor" defaultValue={cartao?.leitor ?? "generico"} className={SELECAO}>
            {LEITORES.map((l) => <option key={l} value={l}>{ROTULO_LEITOR[l]}</option>)}
          </select>
        </Campo>
      </div>
      <Campo id="pastaFaturas" rotulo="Pasta das faturas no Drive (informativo)">
        <Input id="pastaFaturas" name="pastaFaturas" defaultValue={cartao?.pasta_faturas ?? ""} maxLength={80} />
      </Campo>
      <Campo id="observacao" rotulo="Observação">
        <Textarea id="observacao" name="observacao" defaultValue={cartao?.observacao ?? ""} rows={2} maxLength={300} />
      </Campo>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ativo" defaultChecked={cartao?.ativo ?? true} className="size-4" />
        Ativo (aparece na importação de faturas)
      </label>
    </DialogoFormulario>
  );
}
