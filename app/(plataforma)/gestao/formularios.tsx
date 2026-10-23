"use client";

// Formulários da Central de Gestão: nova tarefa e ações sobre a pendência. As opções mostradas seguem o nível do
// usuário, mas quem decide é o banco (uma tentativa fora da regra volta com a mensagem de recusa).
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIAS, MODULO_TAREFAS_GERAIS, ROTULO_CATEGORIA, type AcaoPendencia } from "@/lib/nucleo/gestao/tarefas";
import { executarAcao, criarTarefa } from "./acoes";

export type Pessoa = { id: string; nome: string };
export type OpcaoModulo = { codigo: string; area: string; rotulo: string };

const CLASSE_SELECT =
  "h-8 w-full min-w-0 rounded-[3px] border border-input bg-white px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function OpcoesPrioridade() {
  return (<><option value="normal">Normal</option><option value="alta">Alta</option><option value="critica">Crítica</option></>);
}
function OpcoesCategoria() {
  return (<><option value="">—</option>{CATEGORIAS.map((c) => <option key={c} value={c}>{ROTULO_CATEGORIA[c]}</option>)}</>);
}

// --- Nova tarefa ------------------------------------------------------------------------------------------------------

export function NovaTarefa({
  modulos, areasGestor, pessoasPorArea, todasPessoas, eu, hoje,
}: {
  modulos: OpcaoModulo[]; areasGestor: string[]; pessoasPorArea: Record<string, Pessoa[]>; todasPessoas: Pessoa[];
  eu: Pessoa; hoje: string;
}) {
  const [modulo, setModulo] = useState(modulos[0]?.codigo ?? "");
  const area = modulos.find((m) => m.codigo === modulo)?.area ?? "";
  const gestor = areasGestor.includes(area);
  // Gestor distribui: nas "Tarefas gerais", para qualquer pessoa ativa; nos módulos, para quem atua na área.
  const candidatos = gestor ? (modulo === MODULO_TAREFAS_GERAIS ? todasPessoas : (pessoasPorArea[area] ?? [])) : [eu];

  return (
    <DialogoFormulario
      titulo="Nova tarefa"
      descricao={gestor
        ? "Você é gestor desta área: pode atribuir a tarefa a outra pessoa ou deixá-la sem responsável para distribuir depois."
        : "A tarefa fica com você ou sem responsável. Atribuir a outra pessoa é do gestor da área."}
      botao={<><Plus /> Nova tarefa</>}
      variante="default"
      tamanho="sm"
      rotuloSalvar="Criar tarefa"
      mensagemSucesso="Tarefa criada."
      acao={criarTarefa}
    >
      <Campo id="nt-titulo" rotulo="Título"><Input id="nt-titulo" name="titulo" maxLength={200} required /></Campo>
      <Campo id="nt-modulo" rotulo="Módulo" dica={'"Tarefas gerais" é para o que não pertence a um módulo.'}>
        <select id="nt-modulo" name="modulo" value={modulo} onChange={(e) => setModulo(e.target.value)} className={CLASSE_SELECT} required>
          {modulos.map((m) => <option key={m.codigo} value={m.codigo}>{m.rotulo}</option>)}
        </select>
      </Campo>
      <Campo id="nt-responsavel" rotulo="Responsável" dica="Sem responsável, a tarefa aparece em &quot;Precisam distribuir&quot;.">
        <select id="nt-responsavel" name="responsavel_id" key={`${area}-${gestor}`} defaultValue={gestor ? "" : eu.id} className={CLASSE_SELECT}>
          <option value="">Sem responsável</option>
          {candidatos.map((p) => <option key={p.id} value={p.id}>{p.id === eu.id ? `${p.nome} (eu)` : p.nome}</option>)}
        </select>
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo id="nt-prazo" rotulo="Prazo"><Input id="nt-prazo" name="prazo" type="date" min={hoje} /></Campo>
        <Campo id="nt-prioridade" rotulo="Prioridade">
          <select id="nt-prioridade" name="prioridade" defaultValue="normal" className={CLASSE_SELECT}><OpcoesPrioridade /></select>
        </Campo>
      </div>
      <Campo id="nt-categoria" rotulo="Categoria (opcional)">
        <select id="nt-categoria" name="categoria" defaultValue="" className={CLASSE_SELECT}><OpcoesCategoria /></select>
      </Campo>
      <Campo id="nt-descricao" rotulo="Descrição (opcional)"><Textarea id="nt-descricao" name="descricao" maxLength={4000} rows={3} /></Campo>
      <Campo id="nt-obs" rotulo="Observações (opcional)" dica="Ficam como primeiro comentário da tarefa.">
        <Textarea id="nt-obs" name="observacoes" maxLength={4000} rows={2} />
      </Campo>
    </DialogoFormulario>
  );
}

// --- Ações sobre a pendência ------------------------------------------------------------------------------------------

/** Ação de um clique (sem texto): iniciar, pausar, assumir, concluir, desbloquear, reabrir. */
export function BotaoAcao({ id, acao, rotulo, sucesso, variante = "outline", confirmar }: {
  id: string; acao: AcaoPendencia; rotulo: string; sucesso: string; variante?: "default" | "outline" | "destructive"; confirmar?: string;
}) {
  const [pendente, iniciar] = useTransition();
  return (
    <Button
      size="sm" variant={variante} disabled={pendente}
      onClick={() => {
        if (confirmar && !window.confirm(confirmar)) return;
        iniciar(async () => {
          const dados = new FormData();
          dados.set("id", id); dados.set("acao", acao);
          const r = await executarAcao({}, dados);
          if (r.ok) toast.success(sucesso); else toast.error(r.erro ?? "Não foi possível concluir a ação.");
        });
      }}
    >
      {pendente ? "Aguarde…" : rotulo}
    </Button>
  );
}

/** Ação com texto (motivo, resposta, comentário), num diálogo. */
export function AcaoComTexto({ id, acao, rotulo, titulo, descricao, campo, obrigatorio = true, sucesso, variante = "outline", children }: {
  id: string; acao: AcaoPendencia; rotulo: string; titulo: string; descricao?: string; campo: string; obrigatorio?: boolean;
  sucesso: string; variante?: "default" | "outline" | "ghost" | "secondary"; children?: React.ReactNode;
}) {
  const idCampo = `${acao}-${id}`;
  return (
    <DialogoFormulario titulo={titulo} descricao={descricao} botao={rotulo} variante={variante} tamanho="sm" rotuloSalvar={rotulo} mensagemSucesso={sucesso} acao={executarAcao}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="acao" value={acao} />
      {children}
      <Campo id={idCampo} rotulo={campo}>
        <Textarea id={idCampo} name="texto" maxLength={4000} rows={3} required={obrigatorio} />
      </Campo>
    </DialogoFormulario>
  );
}

export function Atribuir({ id, atual, candidatos }: { id: string; atual: string | null; candidatos: Pessoa[] }) {
  return (
    <DialogoFormulario titulo="Atribuir responsável" botao="Atribuir" tamanho="sm" rotuloSalvar="Atribuir" mensagemSucesso="Responsável atualizado." acao={executarAcao}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="acao" value="atribuir" />
      <Campo id={`atr-${id}`} rotulo="Responsável">
        <select id={`atr-${id}`} name="responsavel_id" defaultValue={atual ?? ""} className={CLASSE_SELECT}>
          <option value="">Sem responsável</option>
          {candidatos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </Campo>
      <Campo id={`atr-txt-${id}`} rotulo="Recado ao responsável (opcional)">
        <Textarea id={`atr-txt-${id}`} name="texto" maxLength={4000} rows={2} />
      </Campo>
    </DialogoFormulario>
  );
}

export function Bloquear({ id, dependencias }: { id: string; dependencias: { id: string; titulo: string }[] }) {
  return (
    <AcaoComTexto id={id} acao="bloquear" rotulo="Bloquear" titulo="Registrar bloqueio" campo="Motivo do bloqueio" sucesso="Bloqueio registrado."
      descricao="O status não muda: a pendência continua aberta ou em andamento, com a marca de bloqueada.">
      <Campo id={`dep-${id}`} rotulo="Depende de outra pendência? (opcional)" dica="Escolha só quando o bloqueio for outra pendência do sistema.">
        <select id={`dep-${id}`} name="dependencia_id" defaultValue="" className={CLASSE_SELECT}>
          <option value="">Não</option>
          {dependencias.map((d) => <option key={d.id} value={d.id}>{d.titulo}</option>)}
        </select>
      </Campo>
    </AcaoComTexto>
  );
}

export function Alterar({ id, dados }: {
  id: string; dados: {
    titulo: string; descricao: string | null; prazo: string | null; prioridade: string; categoria: string | null; precisaDistribuir: boolean;
    impacto: string | null; impactoFundamento: string | null;
  };
}) {
  return (
    <DialogoFormulario titulo="Alterar dados da pendência" botao="Alterar dados" tamanho="sm" rotuloSalvar="Salvar" mensagemSucesso="Dados alterados." acao={executarAcao}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="acao" value="alterar" />
      <Campo id={`alt-tit-${id}`} rotulo="Título"><Input id={`alt-tit-${id}`} name="titulo" defaultValue={dados.titulo} maxLength={200} required /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo id={`alt-prz-${id}`} rotulo="Prazo"><Input id={`alt-prz-${id}`} name="prazo" type="date" defaultValue={dados.prazo ?? ""} /></Campo>
        <Campo id={`alt-pri-${id}`} rotulo="Prioridade">
          <select id={`alt-pri-${id}`} name="prioridade" defaultValue={dados.prioridade} className={CLASSE_SELECT}><OpcoesPrioridade /></select>
        </Campo>
      </div>
      <Campo id={`alt-cat-${id}`} rotulo="Categoria">
        <select id={`alt-cat-${id}`} name="categoria" defaultValue={dados.categoria ?? ""} className={CLASSE_SELECT}><OpcoesCategoria /></select>
      </Campo>
      <Campo id={`alt-dsc-${id}`} rotulo="Descrição"><Textarea id={`alt-dsc-${id}`} name="descricao" defaultValue={dados.descricao ?? ""} maxLength={4000} rows={3} /></Campo>
      <div className="grid grid-cols-3 gap-3">
        <Campo id={`alt-imp-${id}`} rotulo="Impacto">
          <select id={`alt-imp-${id}`} name="impacto" defaultValue={dados.impacto ?? ""} className={CLASSE_SELECT}>
            <option value="">Nenhum registrado</option><option value="financeiro">Financeiro</option><option value="fiscal">Fiscal</option><option value="operacional">Operacional</option>
          </select>
        </Campo>
        <div className="col-span-2">
          <Campo id={`alt-fun-${id}`} rotulo="Fundamento do impacto" dica="O que pode acontecer e por quê. Obrigatório quando há impacto.">
            <Input id={`alt-fun-${id}`} name="impacto_fundamento" defaultValue={dados.impactoFundamento ?? ""} maxLength={1000} />
          </Campo>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="precisa_distribuir" defaultChecked={dados.precisaDistribuir} /> Precisa distribuir (aparece para o gestor enquanto estiver sem responsável)
      </label>
    </DialogoFormulario>
  );
}

export function AjustarDestaque({ id, atual }: { id: string; atual: string | null }) {
  return (
    <DialogoFormulario titulo="Ajustar o destaque" descricao="O ajuste prevalece sobre o cálculo, que continua visível. Para voltar ao cálculo, escolha &quot;Sem ajuste&quot;."
      botao="Ajustar destaque" tamanho="sm" rotuloSalvar="Salvar" mensagemSucesso="Destaque ajustado." acao={executarAcao}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="acao" value="destacar" />
      <Campo id={`dst-${id}`} rotulo="Destaque">
        <select id={`dst-${id}`} name="nivel" defaultValue={atual ?? ""} className={CLASSE_SELECT}>
          <option value="">Sem ajuste (usar o cálculo)</option>
          <option value="intervir">Intervir</option><option value="acompanhar">Acompanhar</option><option value="normal">Normal</option>
        </select>
      </Campo>
      <Campo id={`dst-txt-${id}`} rotulo="Motivo (obrigatório para ajustar)"><Textarea id={`dst-txt-${id}`} name="texto" maxLength={4000} rows={2} /></Campo>
    </DialogoFormulario>
  );
}
