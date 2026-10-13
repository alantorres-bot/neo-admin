"use client";

import { Pencil, Plus } from "lucide-react";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CAMPOS_CONFIG_ENCARGOS, ROTULO_CAMPO_CONFIG } from "@/lib/modulos/financeiro/cartao/lancamento-encargos";
import { CAMPOS_PADRAO_CARTAO, ROTULO_CAMPO_COMPRA } from "@/lib/modulos/financeiro/cartao/lancamento-compras";
import { LEITORES, ROTULO_LEITOR } from "@/lib/modulos/financeiro/cartao/modulo";
import type { ContaFluxo } from "@/lib/modulos/financeiro/cartao/listas";
import { salvarCartao } from "../acoes";
import { CampoContaFluxo } from "../listas";
import type { CartaoLinha } from "../dados";

const SELECAO = "h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]";

export function DialogoCartao({ cartao, contasFluxo = [] }: { cartao?: CartaoLinha; contasFluxo?: ContaFluxo[] }) {
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
      <fieldset className="space-y-2 rounded-[3px] border border-grade p-3">
        <legend className="px-1 text-sm font-medium">Encargos no Consistem</legend>
        <p className="text-xs text-muted-foreground">Códigos do título de encargos lançado pelo painel (botão “Lançar no Consistem”). Todos preenchidos, ou todos vazios para este cartão não lançar.</p>
        <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
          <CampoContaFluxo contas={contasFluxo} prefixo="enc_" grupo={cartao?.lancamento_encargos?.grupoContaFluxoCaixa} conta={cartao?.lancamento_encargos?.contaFluxoCaixa} />
          {CAMPOS_CONFIG_ENCARGOS.filter((k) => k !== "grupoContaFluxoCaixa" && k !== "contaFluxoCaixa").map((k) => (
            <Campo key={k} id={`enc_${k}`} rotulo={ROTULO_CAMPO_CONFIG[k]}>
              <Input id={`enc_${k}`} name={`enc_${k}`} defaultValue={cartao?.lancamento_encargos?.[k] ?? ""} inputMode="numeric" pattern="\d{0,9}" autoComplete="off" />
            </Campo>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2 rounded-[3px] border border-grade p-3">
        <legend className="px-1 text-sm font-medium">Compras no Consistem (padrões do cartão)</legend>
        <p className="text-xs text-muted-foreground">Sugeridos no lançamento das compras sem título; o estabelecimento e o operador podem trocar. Todos preenchidos, ou todos vazios.</p>
        <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
          {CAMPOS_PADRAO_CARTAO.map((k) => (
            <Campo key={k} id={`cmp_${k}`} rotulo={ROTULO_CAMPO_COMPRA[k]}>
              <Input id={`cmp_${k}`} name={`cmp_${k}`} defaultValue={cartao?.lancamento_compras?.[k] ?? ""} inputMode="numeric" pattern="\d{0,9}" autoComplete="off" />
            </Campo>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2 rounded-[3px] border border-grade p-3">
        <legend className="px-1 text-sm font-medium">Banco da fatura no Consistem</legend>
        <p className="text-xs text-muted-foreground">Código do banco/portador cadastrado no Consistem só para este cartão. Ao fechar o mês, os títulos da fatura passam a esse portador (filtro do borderô) e os lançados pelo painel já nascem com ele. Vazio = não troca.</p>
        <Campo id="portadorFatura" rotulo="Banco/portador da fatura">
          <Input id="portadorFatura" name="portadorFatura" defaultValue={cartao?.portador_fatura ?? ""} inputMode="numeric" pattern="\d{0,9}" autoComplete="off" className="w-32" />
        </Campo>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ativo" defaultChecked={cartao?.ativo ?? true} className="size-4" />
        Ativo (aparece na importação de faturas)
      </label>
    </DialogoFormulario>
  );
}
