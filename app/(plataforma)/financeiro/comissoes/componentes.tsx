"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROTA_COMISSOES } from "@/lib/modulos/financeiro/comissoes/regras";
import { abrirFechamento, ajustarLinha, importarCreditos, lancar, salvarRepresentante, type Resultado } from "./acoes";

const SELECT = "h-9 rounded-md border bg-background px-2 text-sm";

function avisar(r: Resultado, sucesso?: string) {
  if (r.ok) toast.success(r.mensagem ?? sucesso ?? "Feito.");
  else toast.error(r.erro);
}

/** Abre o fechamento de um mês (padrão: o mês anterior). */
export function AbrirFechamento({ mesPadrao }: { mesPadrao: string }) {
  const [mes, setMes] = useState(mesPadrao);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor="mes-fechamento">Mês</Label>
        <Input id="mes-fechamento" type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-44" />
      </div>
      <Button
        disabled={pendente || !mes}
        onClick={() => iniciar(async () => {
          const r = await abrirFechamento(mes);
          if (r.ok && r.id) router.push(`${ROTA_COMISSOES}/${r.id}`);
          else avisar(r);
        })}
      >
        {pendente ? "Abrindo…" : "Abrir fechamento"}
      </Button>
    </div>
  );
}

/** Passo 1: sobe a planilha de créditos da CCCCI010. */
export function ImportarCreditos({ fechamentoId, jaImportado }: { fechamentoId: string; jaImportado: boolean }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="file" accept=".xlsx,.csv,.xls,text/csv" className="max-w-xs" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
      <Button
        variant={jaImportado ? "outline" : "default"}
        disabled={pendente || !arquivo}
        onClick={() => iniciar(async () => {
          const fd = new FormData();
          fd.set("arquivo", arquivo!);
          avisar(await importarCreditos(fechamentoId, fd));
        })}
      >
        {pendente ? "Importando…" : jaImportado ? "Substituir planilha" : "Importar planilha"}
      </Button>
    </div>
  );
}

/** Botão de uma ação sem parâmetros (já ligada ao fechamento no servidor), com confirmação opcional na própria tela. */
export function BotaoAcao({ rotulo, rotuloPendente, acao, confirmar, variante = "default" }: {
  rotulo: string; rotuloPendente: string; acao: () => Promise<Resultado>; confirmar?: string; variante?: "default" | "outline";
}) {
  const [pendente, iniciar] = useTransition();
  const [perguntando, setPerguntando] = useState(false);
  const executar = () => iniciar(async () => {
    setPerguntando(false);
    try {
      avisar(await acao());
    } catch {
      toast.error("Não foi possível concluir. Tente novamente.");
    }
  });
  if (perguntando) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm">
        <span>{confirmar}</span>
        <Button size="sm" onClick={executar}>Confirmar</Button>
        <Button size="sm" variant="outline" onClick={() => setPerguntando(false)}>Cancelar</Button>
      </div>
    );
  }
  return (
    <Button variant={variante} disabled={pendente} onClick={() => (confirmar ? setPerguntando(true) : executar())}>
      {pendente ? rotuloPendente : rotulo}
    </Button>
  );
}

/** Incluir/excluir a linha (motivo ao excluir) e Venda/Locação. */
export function AjusteLinha({ linhaId, fechamentoId, incluida, tipo, motivo, editavel, antecipacao }: {
  linhaId: string; fechamentoId: string; incluida: boolean; tipo: "venda" | "locacao"; motivo: string | null; editavel: boolean; antecipacao: boolean;
}) {
  const [pendente, iniciar] = useTransition();
  const [excluindo, setExcluindo] = useState(false);
  const [texto, setTexto] = useState("");
  const enviar = (novaIncluida: boolean, novoMotivo: string, novoTipo: "venda" | "locacao") =>
    iniciar(async () => {
      const r = await ajustarLinha(linhaId, novaIncluida, novoMotivo, novoTipo, fechamentoId);
      if (!r.ok) toast.error(r.erro);
      else setExcluindo(false);
    });
  if (!editavel) return <span className="text-xs text-muted-foreground">{incluida ? "Incluída" : `Excluída${motivo ? `: ${motivo}` : ""}`}</span>;
  if (excluindo) {
    return (
      <div className="flex min-w-[260px] items-center gap-1">
        <Input autoFocus placeholder="Motivo da exclusão" value={texto} onChange={(e) => setTexto(e.target.value)} className="h-8" />
        <Button size="sm" disabled={pendente || texto.trim() === ""} onClick={() => enviar(false, texto, tipo)}>Excluir</Button>
        <Button size="sm" variant="outline" onClick={() => setExcluindo(false)}>Voltar</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {!antecipacao && (
        <select aria-label="Tipo" className={SELECT} value={tipo} disabled={pendente || !incluida} onChange={(e) => enviar(incluida, motivo ?? "", e.target.value as "venda" | "locacao")}>
          <option value="venda">Venda</option>
          <option value="locacao">Locação</option>
        </select>
      )}
      {incluida ? (
        <Button size="sm" variant="outline" disabled={pendente} onClick={() => setExcluindo(true)}>Excluir</Button>
      ) : (
        <>
          <span className="text-xs text-muted-foreground" title={motivo ?? ""}>Excluída</span>
          <Button size="sm" variant="outline" disabled={pendente} onClick={() => enviar(true, "", tipo)}>Incluir</Button>
        </>
      )}
    </div>
  );
}

/** Lançamento manual ou antecipação de comissão já paga ao representante. */
export function FormLancamento({ fechamentoId, representantes, dataPadrao }: { fechamentoId: string; representantes: { cod: string; nome: string }[]; dataPadrao: string }) {
  const [pendente, iniciar] = useTransition();
  const [origem, setOrigem] = useState<"manual" | "antecipacao">("antecipacao");
  const [chave, setChave] = useState(0);
  return (
    <form
      key={chave}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      action={(fd) => iniciar(async () => {
        const r = await lancar(fechamentoId, fd);
        avisar(r, "Lançamento incluído.");
        if (r.ok) setChave((x) => x + 1);
      })}
    >
      <div className="space-y-1">
        <Label htmlFor="lanc-origem">Tipo de lançamento</Label>
        <select id="lanc-origem" name="origem" className={`${SELECT} w-full`} value={origem} onChange={(e) => setOrigem(e.target.value as "manual" | "antecipacao")}>
          <option value="antecipacao">Antecipação de comissão já paga</option>
          <option value="manual">Comissão manual (sobre um valor)</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="lanc-rep">Representante</Label>
        <select id="lanc-rep" name="representante" className={`${SELECT} w-full`} defaultValue={representantes[0]?.cod}>
          {representantes.map((r) => <option key={r.cod} value={r.cod}>{r.nome}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="lanc-data">Data</Label>
        <Input id="lanc-data" name="data" type="date" defaultValue={dataPadrao} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lanc-valor">{origem === "antecipacao" ? "Valor antecipado (R$)" : "Valor-base (R$)"}</Label>
        <Input id="lanc-valor" name="valor" inputMode="decimal" placeholder="0,00" required />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="lanc-desc">Descrição</Label>
        <Input id="lanc-desc" name="descricao" placeholder={origem === "antecipacao" ? "Antecipação de comissão – 12/03/2026" : "Ex.: contrato 195/25-1"} required />
      </div>
      {origem === "manual" && (
        <>
          <div className="space-y-1">
            <Label htmlFor="lanc-tipo">Venda ou locação</Label>
            <select id="lanc-tipo" name="tipo" className={`${SELECT} w-full`} defaultValue="venda">
              <option value="venda">Venda</option>
              <option value="locacao">Locação</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lanc-titulo">Documento (opcional)</Label>
            <Input id="lanc-titulo" name="titulo" />
          </div>
        </>
      )}
      <div className="flex items-end sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={pendente}>{pendente ? "Incluindo…" : "Incluir lançamento"}</Button>
      </div>
    </form>
  );
}

/** Cadastro do representante comissionado (gestor). */
export function FormRepresentante({ inicial }: { inicial?: { cod: string; nome: string; perc_venda: number; perc_locacao: number; recebe_de: string[]; ativo: boolean } }) {
  const [pendente, iniciar] = useTransition();
  const num = (n: number | undefined) => (n === undefined ? "" : String(n).replace(".", ","));
  return (
    <form className="grid items-end gap-2 sm:grid-cols-6" action={(fd) => iniciar(async () => avisar(await salvarRepresentante(fd)))}>
      <div className="space-y-1"><Label>Código</Label><Input name="cod" defaultValue={inicial?.cod} readOnly={!!inicial} required /></div>
      <div className="space-y-1 sm:col-span-2"><Label>Nome</Label><Input name="nome" defaultValue={inicial?.nome} required /></div>
      <div className="space-y-1"><Label>% venda</Label><Input name="perc_venda" inputMode="decimal" defaultValue={num(inicial?.perc_venda)} required /></div>
      <div className="space-y-1"><Label>% locação</Label><Input name="perc_locacao" inputMode="decimal" defaultValue={num(inicial?.perc_locacao)} required /></div>
      <div className="space-y-1"><Label title="Códigos dos representantes cujas vendas também geram comissão para este">Recebe também de</Label><Input name="recebe_de" defaultValue={inicial?.recebe_de.filter((x) => x !== inicial.cod).join(", ")} placeholder="ex.: 7" /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="ativo" defaultChecked={inicial?.ativo ?? true} /> Ativo</label>
      <div className="sm:col-span-5"><Button type="submit" size="sm" disabled={pendente}>{pendente ? "Salvando…" : inicial ? "Salvar" : "Cadastrar"}</Button></div>
    </form>
  );
}
