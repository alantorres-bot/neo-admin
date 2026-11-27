"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EMPREGADORES_SUGERIDOS, FORMAS_PAGAMENTO, ROTULO_FORMA } from "@/lib/modulos/rh/colaboradores/modulo";
import { buscarFornecedor, salvarColaborador } from "./acoes";
import type { ColaboradorLinha, RascunhoColaborador } from "./dados";

const SELECAO = "h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]";
const reais = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Campo que a ficha de registro não traz: destacado quando o formulário vem da ficha. */
const COMPLETAR = "bg-amber-50";

/** Código de fornecedor + botão que traz nome e CPF do Consistem para os campos (o operador ainda confere e salva). */
function CamposFornecedor({ colaborador, empresas, daFicha }: { colaborador?: RascunhoColaborador; empresas: { id: string; nome: string }[]; daFicha: boolean }) {
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
            <Input id="codFornecedor" name="codFornecedor" value={cod} onChange={(e) => setCod(e.target.value)} required inputMode="numeric" pattern="\d{1,9}" maxLength={9} autoComplete="off" className={daFicha ? COMPLETAR : undefined} />
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

/**
 * Novo / editar colaborador. Com `rascunho` (lido da ficha de registro, 27/11/2026): abre pelo código, preenchido, com os avisos da
 * leitura e o que falta completar em destaque.
 */
export function DialogoColaborador({ colaborador, rascunho, avisos, aberto, aoMudarAberto, empresas, empregadores }: {
  colaborador?: ColaboradorLinha; rascunho?: RascunhoColaborador; avisos?: string[]; aberto?: boolean; aoMudarAberto?: (v: boolean) => void;
  empresas: { id: string; nome: string }[]; empregadores: string[];
}) {
  const sugestoes = [...new Set([...EMPREGADORES_SUGERIDOS, ...empregadores])];
  const base: RascunhoColaborador | undefined = colaborador ?? rascunho;
  const daFicha = !colaborador && !!rascunho;
  return (
    <DialogoFormulario
      titulo={colaborador ? `Editar ${colaborador.nome}` : daFicha ? "Novo colaborador (da ficha de registro)" : "Novo colaborador"}
      descricao="Cadastro único do RH (VT e folha). Nome e CPF vêm do fornecedor no Consistem. Agência e conta só são usadas no arquivo do BB (FOPAG)."
      botao={rascunho ? undefined : colaborador ? <><Pencil /> Editar</> : <><Plus /> Novo colaborador</>}
      aberto={aberto} aoMudarAberto={aoMudarAberto}
      topo={daFicha ? (
        <div className="space-y-1 rounded-[3px] border border-amber-300 bg-amber-50 p-2 text-sm">
          <p>Preenchido pela ficha. Confira e complete o que está em amarelo: <b>Nº de fornecedor</b> (botão Consistem), forma de pagamento, agência/conta e vale-transporte.</p>
          {avisos?.map((a) => <p key={a} className="text-amber-800">• {a}</p>)}
        </div>
      ) : undefined}
      variante={colaborador ? "ghost" : "default"}
      tamanho={colaborador ? "sm" : "default"}
      mensagemSucesso={colaborador ? "Cadastro atualizado." : "Colaborador cadastrado."}
      acao={salvarColaborador}
    >
      <input type="hidden" name="id" value={colaborador?.id ?? ""} />
      <input type="hidden" name="dadosFicha" value="1" />
      <CamposFornecedor colaborador={base} empresas={empresas} daFicha={daFicha} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="empregador" rotulo="Empresa empregadora" dica="Coluna EMPRESA da planilha.">
          <Input id="empregador" name="empregador" defaultValue={base?.empregador ?? "NEO SERVIÇOS"} list="rh-vt-empregadores" required maxLength={40} />
          <datalist id="rh-vt-empregadores">{sugestoes.map((e) => <option key={e} value={e} />)}</datalist>
        </Campo>
        <Campo id="formaPagamento" rotulo="Forma de pagamento habitual" dica="Pode ser trocada em cada mês.">
          <select id="formaPagamento" name="formaPagamento" defaultValue={base?.forma_pagamento ?? "fopag"} className={daFicha ? `${SELECAO} ${COMPLETAR}` : SELECAO}>
            {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{ROTULO_FORMA[f]}</option>)}
          </select>
        </Campo>
        <Campo id="matriculaEscritorio" rotulo="Matrícula no escritório" dica="Código da pessoa no extrato e nos holerites do escritório.">
          <Input id="matriculaEscritorio" name="matriculaEscritorio" defaultValue={base?.matricula_escritorio ?? ""} inputMode="numeric" pattern="\d{0,9}" maxLength={9} autoComplete="off" />
        </Campo>
        <Campo id="agencia" rotulo="Agência (BB)">
          <Input id="agencia" name="agencia" defaultValue={base?.agencia ?? ""} maxLength={8} placeholder="2764-2" autoComplete="off" className={daFicha ? COMPLETAR : undefined} />
        </Campo>
        <Campo id="conta" rotulo="Conta (BB)">
          <Input id="conta" name="conta" defaultValue={base?.conta ?? ""} maxLength={15} placeholder="99149-X" autoComplete="off" className={daFicha ? COMPLETAR : undefined} />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo id="funcao" rotulo="Função (cargo)">
          <Input id="funcao" name="funcao" defaultValue={base?.funcao ?? ""} maxLength={60} />
        </Campo>
        <Campo id="dataAdmissao" rotulo="Admissão">
          <Input id="dataAdmissao" name="dataAdmissao" type="date" defaultValue={base?.data_admissao ?? ""} />
        </Campo>
        <Campo id="salario" rotulo="Salário (R$)">
          <Input id="salario" name="salario" defaultValue={base?.salario ? reais(base.salario) : ""} inputMode="decimal" maxLength={12} placeholder="2.145,87" />
        </Campo>
      </div>
      <CamposVt colaborador={base} novo={!colaborador} destaque={daFicha} />
      <DadosPessoais base={base} abertos={daFicha} />
      <Campo id="observacao" rotulo="Observação">
        <Textarea id="observacao" name="observacao" defaultValue={base?.observacao ?? ""} rows={2} maxLength={300} />
      </Campo>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ativo" defaultChecked={base?.ativo ?? true} className="size-4" />
        Ativo (trabalha na empresa; entra na folha e, se recebe VT, no VT)
      </label>
    </DialogoFormulario>
  );
}

/** Dados de vale-transporte: só para quem recebe VT. */
function CamposVt({ colaborador, novo, destaque }: { colaborador?: RascunhoColaborador; novo: boolean; destaque: boolean }) {
  const [recebe, setRecebe] = useState(colaborador?.recebe_vt ?? true);
  return (
    <fieldset className={`space-y-3 rounded-[3px] border border-grade p-3 ${destaque ? COMPLETAR : ""}`}>
      <legend className="px-1 text-sm font-medium">Vale-transporte</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="recebeVt" checked={recebe} onChange={(e) => setRecebe(e.target.checked)} className="size-4" />
        Recebe vale-transporte
      </label>
      {recebe && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo id="tarifa" rotulo="Valor da passagem (R$)" dica="Vazio só com valor fixo mensal.">
            <Input id="tarifa" name="tarifa" defaultValue={colaborador?.tarifa != null ? reais(colaborador.tarifa) : novo ? "4,95" : ""} inputMode="decimal" maxLength={9} />
          </Campo>
          <Campo id="valorFixo" rotulo="Valor fixo mensal (R$)" dica="Se preenchido, substitui o cálculo por dias.">
            <Input id="valorFixo" name="valorFixo" defaultValue={colaborador?.valor_fixo ? reais(colaborador.valor_fixo) : ""} inputMode="decimal" maxLength={10} placeholder="Vazio = por dias" />
          </Campo>
          <Campo id="passagensDia" rotulo="Passagens por dia">
            <Input id="passagensDia" name="passagensDia" type="number" min={1} max={8} defaultValue={colaborador?.passagens_dia ?? 2} required inputMode="numeric" />
          </Campo>
        </div>
      )}
    </fieldset>
  );
}

/** Dados pessoais da ficha de registro do escritório (0532): recolhidos na edição, abertos quando vêm da ficha. */
function DadosPessoais({ base, abertos }: { base?: RascunhoColaborador; abertos: boolean }) {
  const campo = (id: string, rotulo: string, valor: string | null | undefined, extra: React.ComponentProps<typeof Input> = {}) => (
    <Campo id={id} rotulo={rotulo}><Input id={id} name={id} defaultValue={valor ?? ""} autoComplete="off" {...extra} /></Campo>
  );
  return (
    <details open={abertos} className="rounded-[3px] border border-grade p-3">
      <summary className="cursor-pointer text-sm font-medium">Dados pessoais (ficha de registro)</summary>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {campo("dataNascimento", "Nascimento", base?.data_nascimento, { type: "date" })}
        {campo("telefone", "Telefone", base?.telefone, { maxLength: 20, inputMode: "tel" })}
        {campo("pis", "PIS", base?.pis, { maxLength: 14, inputMode: "numeric" })}
      </div>
      <div className="mt-3 grid gap-4">{campo("endereco", "Endereço", base?.endereco, { maxLength: 200 })}</div>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {campo("rg", "RG", base?.rg, { maxLength: 20 })}
        {campo("rgOrgao", "Órgão/UF do RG", base?.rg_orgao, { maxLength: 20, placeholder: "SSP/MT" })}
        {campo("rgEmissao", "Emissão do RG", base?.rg_emissao, { type: "date" })}
        {campo("ctps", "CTPS", base?.ctps, { maxLength: 11, inputMode: "numeric" })}
        {campo("ctpsSerie", "Série da CTPS", base?.ctps_serie, { maxLength: 6, inputMode: "numeric" })}
        {campo("ctpsUf", "UF da CTPS", base?.ctps_uf, { maxLength: 2, placeholder: "MT" })}
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {campo("nomePai", "Pai", base?.nome_pai, { maxLength: 120 })}
        {campo("nomeMae", "Mãe", base?.nome_mae, { maxLength: 120 })}
      </div>
    </details>
  );
}
