"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_CARTAO, ROTULO_LEITOR, type CodigoLeitor } from "@/lib/modulos/financeiro/cartao/modulo";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { lerFaturaEnviada, type Previa } from "../acoes";

type CartaoOpcao = { codigo: string; nome: string; leitor: CodigoLeitor; diaVencimento: number };
const SELECAO = "h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]";

type CicloFixo = { id: string; empresaId: string; cartao: string; vencimentoNominal: string; fechamento: string };

export function ImportarFatura({ cartoes, empresas, ciclo }: { cartoes: CartaoOpcao[]; empresas: { id: string; nome: string }[]; ciclo: CicloFixo | null }) {
  const router = useRouter();
  const formulario = useRef<HTMLFormElement>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [precisaSenha, setPrecisaSenha] = useState(false);
  const [pendente, iniciar] = useTransition();
  const [cartao, setCartao] = useState(ciclo?.cartao ?? cartoes[0]?.codigo ?? "");
  const escolhido = cartoes.find((c) => c.codigo === cartao);

  function enviar(confirmar: boolean) {
    const f = formulario.current;
    if (!f) return;
    const dados = new FormData(f);
    dados.set("confirmar", confirmar ? "1" : "0");
    iniciar(async () => {
      const r = await lerFaturaEnviada(dados);
      if (!r.ok) {
        setErro(r.erro);
        setPrecisaSenha(!!r.precisaSenha);
        if (confirmar) toast.error(r.erro);
        return;
      }
      setErro(null);
      if (r.etapa === "previa") {
        setPrevia(r.previa);
        if (!r.previa.integridadeOk) toast.warning("A soma das linhas não bate com o total informado. Confira antes de confirmar.");
        return;
      }
      toast.success(r.aviso);
      router.push(r.cicloId ? `${ROTA_CARTAO}/ciclo/${r.cicloId}` : `${ROTA_CARTAO}/${r.id}`);
    });
  }

  return (
    <div className="space-y-5">
      <form ref={formulario} autoComplete="off" onSubmit={(e) => { e.preventDefault(); enviar(false); }} onChange={() => setPrevia(null)} className="grid gap-3 rounded-[3px] border border-grade bg-cabecalho p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-[13px]">
          <span className="font-medium">Empresa</span>
          {ciclo && <input type="hidden" name="ciclo" value={ciclo.id} />}
          <select name="empresaId" defaultValue={ciclo?.empresaId ?? empresas[0]?.id ?? ""} required disabled={!!ciclo} className={SELECAO}>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="font-medium">Cartão</span>
          {ciclo && <input type="hidden" name="empresaId" value={ciclo.empresaId} />}
          {ciclo && <input type="hidden" name="cartao" value={ciclo.cartao} />}
          <select name={ciclo ? undefined : "cartao"} value={cartao} onChange={(e) => setCartao(e.target.value)} required disabled={!!ciclo} className={SELECAO}>
            {cartoes.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
          </select>
          {escolhido && <span className="text-xs text-muted-foreground">Leitor: {ROTULO_LEITOR[escolhido.leitor]} · vence dia {escolhido.diaVencimento}</span>}
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="font-medium">Vencimento efetivo (impresso na fatura)</span>
          <Input type="date" name="vencimento" required className="w-44" defaultValue={ciclo?.vencimentoNominal ?? ""} />
          {ciclo && <span className="text-xs text-muted-foreground">Sugerido: o vencimento nominal ({formatarData(ciclo.vencimentoNominal)}). Se o emissor deslocou para o dia útil, use a data impressa.</span>}
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="font-medium">Total da fatura (R$)</span>
          <Input name="total" inputMode="decimal" placeholder="R$ 0,00" required autoComplete="off" data-1p-ignore data-lpignore="true" className="w-44 text-right tabular-nums" />
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="font-medium">Arquivo da fatura (PDF ou CSV, até 8 MB)</span>
          <Input type="file" name="arquivo" accept=".pdf,.csv,.txt,.xlsx,application/pdf,text/csv" required />
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="font-medium">Senha do PDF {precisaSenha ? <span className="text-destructive">(obrigatória para este arquivo)</span> : "(se houver)"}</span>
          {/* Campo de texto mascarado (não "password"): assim o gerenciador de senhas do navegador não coloca a senha do login aqui. */}
          <Input name="senha" autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" style={{ WebkitTextSecurity: "disc" } as React.CSSProperties} className="w-44" />
          <span className="text-xs text-muted-foreground">Usada só para abrir o arquivo; não é guardada.</span>
        </label>
        <label className="grid gap-1 text-[13px] sm:col-span-2 lg:col-span-3">
          <span className="font-medium">Observação (opcional)</span>
          <Input name="observacao" maxLength={300} />
        </label>
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
          <Button type="submit" disabled={pendente}>{pendente && !previa ? "Lendo…" : "Ler a fatura"}</Button>
          <span className="text-xs text-muted-foreground">Nada é gravado nesta etapa.</span>
        </div>
      </form>

      {erro && <p role="alert" className="rounded-[3px] border border-destructive/40 p-3 text-sm text-destructive">{erro}</p>}

      {previa && <PreviaLeitura previa={previa} pendente={pendente} aoConfirmar={() => enviar(true)} />}
    </div>
  );
}

function PreviaLeitura({ previa, pendente, aoConfirmar }: { previa: Previa; pendente: boolean; aoConfirmar: () => void }) {
  const uteis = previa.linhas.filter((l) => !l.descartada);
  const descartadas = previa.linhas.filter((l) => l.descartada);
  const diferenca = previa.somaCentavos - previa.totalInformadoCentavos;
  const totalImpressoDiverge = previa.totalImpressoCentavos !== null && previa.totalImpressoCentavos !== previa.totalInformadoCentavos;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao rotulo="Linhas de despesa lidas" valor={String(uteis.length)} nota={descartadas.length > 0 ? `+ ${descartadas.length} descartadas (pagamentos, saldos)` : undefined} />
        <Cartao rotulo="Soma das linhas" valor={formatarMoeda(previa.somaCentavos)} />
        <Cartao rotulo="Total informado" valor={formatarMoeda(previa.totalInformadoCentavos)} nota={previa.totalImpressoCentavos !== null ? `Impresso pelo emissor: ${formatarMoeda(previa.totalImpressoCentavos)}` : "Total impresso não localizado"} ruim={totalImpressoDiverge} />
        <Cartao rotulo="Integridade da leitura" valor={previa.integridadeOk ? "OK" : `Diferença ${formatarMoeda(diferenca)}`} ruim={!previa.integridadeOk} nota={previa.vencimentoImpresso ? `Vencimento impresso: ${formatarData(previa.vencimentoImpresso)}` : undefined} />
      </div>
      {previa.avisos.length > 0 && (
        <ul className="list-disc space-y-1 rounded-[3px] border border-amber-300 bg-amber-50 p-3 pl-7 text-sm">
          {previa.avisos.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={aoConfirmar} disabled={pendente || !previa.integridadeOk || uteis.length === 0}>{pendente ? "Importando…" : "Confirmar importação"}</Button>
        <span className="text-xs text-muted-foreground">
          {previa.integridadeOk ? `Leitor ${ROTULO_LEITOR[previa.leitor]} · arquivo ${previa.arquivo}. Ao confirmar, a fatura e o arquivo ficam gravados como prova.` : "A soma precisa bater com o total: confira o total digitado ou o arquivo (leitura incompleta não pode ser importada)."}
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Data</TableHead>
            <TableHead>Descrição na fatura</TableHead>
            <TableHead>Parcela</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {previa.linhas.map((l) => (
            <TableRow key={l.ordem} className={l.descartada ? "text-muted-foreground" : ""}>
              <TableCell className="tabular-nums">{l.ordem}</TableCell>
              <TableCell className="tabular-nums">{formatarData(l.dataCompra)}</TableCell>
              <TableCell title={l.textoOrigem}>{l.descricao}</TableCell>
              <TableCell className="tabular-nums">{l.parcelaNum !== null ? `${l.parcelaNum}/${l.parcelaTotal}` : ""}</TableCell>
              <TableCell className={`text-right tabular-nums ${l.valorCentavos < 0 ? "text-red-700" : ""}`}>{formatarMoeda(l.valorCentavos)}</TableCell>
              <TableCell>{l.descartada ? <Badge variant="outline" title={l.motivoDescarte ?? ""}>Descartada</Badge> : null}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Cartao({ rotulo, valor, nota, ruim }: { rotulo: string; valor: string; nota?: string; ruim?: boolean }) {
  return (
    <div className={`rounded-[3px] border p-3 ${ruim ? "border-red-300 bg-red-50" : "border-grade bg-card"}`}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`text-lg font-bold tabular-nums ${ruim ? "text-red-700" : ""}`}>{valor}</p>
      {nota && <p className="text-xs text-muted-foreground">{nota}</p>}
    </div>
  );
}
