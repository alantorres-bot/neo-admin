"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EMPREGADORES_SUGERIDOS, FORMAS_PAGAMENTO, ROTULO_FORMA } from "@/lib/modulos/rh/vale-transporte/modulo";
import { buscarFornecedor, salvarColaborador } from "../acoes";
import type { ColaboradorLinha } from "../dados";

const SELECAO = "h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]";
const reais = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Código de fornecedor + botão que traz nome e CPF do Consistem para os campos (o operador ainda confere e salva). */
function CamposFornecedor({ colaborador, empresas }: { colaborador?: ColaboradorLinha; empresas: { id: string; nome: string }[] }) {
  const [empresaId, setEmpresaId] = useState(colaborador?.empresa_id ?? empresas[0]?.id ?? "");
  const [cod, setCod] = useState(colaborador?.cod_fornecedor ?? "");
  const [nome, setNome] = useState(colaborador?.nome ?? "");
  const [cpf, setCpf] = useState(colaborador?.cpf ?? "");
  const [aviso, setAviso] = useState<{ erro: boolean; texto: string }>();
  const [buscando, iniciar] = useTransition();

  const buscar = () => iniciar(async () => {
    const r = await buscarFornecedor({ empresaId, codFornecedor: cod });
    if (!r.ok) { setAviso({ erro: true, texto: r.erro }); return; }
    setNome(r.fornecedor.nome);
    if (r.fornecedor.cpf) setCpf(r.fornecedor.cpf);
    setAviso({ erro: !r.fornecedor.ativo || !r.fornecedor.cpf, texto: `Consistem: ${r.fornecedor.nome}${r.fornecedor.cpf ? "" : " (sem CPF válido no cadastro)"}${r.fornecedor.ativo ? "" : " — fornecedor INATIVO"}.` });
  });

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="empresaId" rotulo="Empresa no Consistem" dica="Onde está o fornecedor (e onde o título será lançado).">
          <select id="empresaId" name="empresaId" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className={SELECAO} required>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </Campo>
        <Campo id="codFornecedor" rotulo="Código de fornecedor (Nº)" dica="O “Nº” da planilha do VT.">
          <div className="flex gap-2">
            <Input id="codFornecedor" name="codFornecedor" value={cod} onChange={(e) => setCod(e.target.value)} required inputMode="numeric" pattern="\d{1,9}" maxLength={9} autoComplete="off" />
            <Button type="button" variant="outline" size="sm" onClick={buscar} disabled={buscando || !cod}><Search /> {buscando ? "Buscando…" : "Consistem"}</Button>
          </div>
        </Campo>
      </div>
      {aviso && <p role="status" className={aviso.erro ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{aviso.texto}</p>}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Campo id="nome" rotulo="Nome">
          <Input id="nome" name="nome" value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={120} />
        </Campo>
        <Campo id="cpf" rotulo="CPF">
          <Input id="cpf" name="cpf" value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" maxLength={14} placeholder="000.000.000-00" />
        </Campo>
      </div>
    </>
  );
}

export function DialogoColaborador({ colaborador, empresas, empregadores }: { colaborador?: ColaboradorLinha; empresas: { id: string; nome: string }[]; empregadores: string[] }) {
  const sugestoes = [...new Set([...EMPREGADORES_SUGERIDOS, ...empregadores])];
  return (
    <DialogoFormulario
      titulo={colaborador ? `Editar ${colaborador.nome}` : "Novo colaborador"}
      descricao="Nome e CPF vêm do fornecedor no Consistem. Agência e conta só são usadas no arquivo do BB (FOPAG)."
      botao={colaborador ? <><Pencil /> Editar</> : <><Plus /> Novo colaborador</>}
      variante={colaborador ? "ghost" : "default"}
      tamanho={colaborador ? "sm" : "default"}
      mensagemSucesso={colaborador ? "Cadastro atualizado." : "Colaborador cadastrado."}
      acao={salvarColaborador}
    >
      <input type="hidden" name="id" value={colaborador?.id ?? ""} />
      <CamposFornecedor colaborador={colaborador} empresas={empresas} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="empregador" rotulo="Empresa empregadora" dica="Coluna EMPRESA da planilha.">
          <Input id="empregador" name="empregador" defaultValue={colaborador?.empregador ?? "NEO SERVIÇOS"} list="rh-vt-empregadores" required maxLength={40} />
          <datalist id="rh-vt-empregadores">{sugestoes.map((e) => <option key={e} value={e} />)}</datalist>
        </Campo>
        <Campo id="formaPagamento" rotulo="Forma de pagamento habitual" dica="Pode ser trocada em cada mês.">
          <select id="formaPagamento" name="formaPagamento" defaultValue={colaborador?.forma_pagamento ?? "fopag"} className={SELECAO}>
            {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{ROTULO_FORMA[f]}</option>)}
          </select>
        </Campo>
        <Campo id="tarifa" rotulo="Valor da passagem (R$)" dica="Vazio só com valor fixo mensal.">
          <Input id="tarifa" name="tarifa" defaultValue={colaborador ? (colaborador.tarifa === null ? "" : reais(colaborador.tarifa)) : "4,95"} inputMode="decimal" maxLength={9} />
        </Campo>
        <Campo id="valorFixo" rotulo="Valor fixo mensal (R$)" dica="Se preenchido, substitui o cálculo por dias.">
          <Input id="valorFixo" name="valorFixo" defaultValue={colaborador?.valor_fixo ? reais(colaborador.valor_fixo) : ""} inputMode="decimal" maxLength={10} placeholder="Vazio = por dias" />
        </Campo>
        <Campo id="passagensDia" rotulo="Passagens por dia">
          <Input id="passagensDia" name="passagensDia" type="number" min={1} max={8} defaultValue={colaborador?.passagens_dia ?? 2} required inputMode="numeric" />
        </Campo>
        <Campo id="agencia" rotulo="Agência (BB)">
          <Input id="agencia" name="agencia" defaultValue={colaborador?.agencia ?? ""} maxLength={8} placeholder="2764-2" autoComplete="off" />
        </Campo>
        <Campo id="conta" rotulo="Conta (BB)">
          <Input id="conta" name="conta" defaultValue={colaborador?.conta ?? ""} maxLength={15} placeholder="99149-X" autoComplete="off" />
        </Campo>
      </div>
      <Campo id="observacao" rotulo="Observação">
        <Textarea id="observacao" name="observacao" defaultValue={colaborador?.observacao ?? ""} rows={2} maxLength={300} />
      </Campo>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ativo" defaultChecked={colaborador?.ativo ?? true} className="size-4" />
        Ativo (entra nas próximas competências)
      </label>
    </DialogoFormulario>
  );
}
